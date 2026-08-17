#!/usr/bin/env python3
"""Builds the actionable variant panel from a ClinVar VCF.

    curl -sL https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh37/clinvar.vcf.gz \
      | python scripts/build-actionable-panel.py

Reads a gzipped ClinVar VCF on stdin (or a path as argv[1]) and writes
server/genomics/panels/actionable-variants.json.

WHY A SCRIPT RATHER THAN A HAND-WRITTEN LIST

Pathogenicity assertions are curated and get revised — a variant called
pathogenic one year can be downgraded to uncertain significance the next.
Transcribing them by hand produces assertions that look identical to curated ones
but drift silently out of date. This regenerates from a dated ClinVar release and
records which release it used.

WHAT IS KEPT

  * classification is Pathogenic or Likely pathogenic (conflicting and
    uncertain-significance records are excluded — a VUS is not actionable)
  * the record carries an rsID (panels here are keyed by rsID, because that is
    what consumer genotyping arrays report)
  * single-nucleotide substitution (a two-character diploid call cannot represent
    an indel, so those cannot be matched and would be silently dropped anyway)
  * the gene is on the curated hereditary-cancer list below

WHAT THIS PANEL CANNOT DO

Consumer arrays assay a fixed set of positions and cover almost none of these.
The screening code reports un-assayed positions as *unknown*, separately from
"assayed and negative", precisely so a clean result is not mistaken for a
clearance. Expect the not-assayed count to dwarf the assayed count.
"""
import gzip
import io
import json
import os
import sys
from datetime import date

# Hereditary cancer predisposition genes.
#
# Base list: the hereditary cancer entries of the ACMG Secondary Findings list
# (v3.2), which is the professional consensus on genes worth reporting when found
# incidentally. Extended with melanoma predisposition genes, since this app's
# working imaging model is a skin lesion classifier.
GENES = {
    # ACMG SF - hereditary breast/ovarian and Lynch syndrome
    'BRCA1', 'BRCA2', 'PALB2', 'MLH1', 'MSH2', 'MSH6', 'PMS2', 'EPCAM',
    # ACMG SF - polyposis and other GI
    'APC', 'MUTYH', 'BMPR1A', 'SMAD4',
    # ACMG SF - multi-system tumour predisposition
    'TP53', 'PTEN', 'STK11', 'CDH1', 'RB1', 'WT1', 'NF2', 'TSC1', 'TSC2',
    # ACMG SF - endocrine / paraganglioma
    'VHL', 'MEN1', 'RET', 'SDHAF2', 'SDHB', 'SDHC', 'SDHD', 'MAX', 'TMEM127',
    # Melanoma predisposition
    'CDKN2A', 'CDK4', 'BAP1', 'POT1', 'MITF',
}

PATHOGENIC = {'Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic'}

# Autosomal dominant unless noted. MUTYH-associated polyposis is recessive, so a
# single copy carries markedly different implications.
RECESSIVE = {'MUTYH'}

BASES = {'A', 'C', 'G', 'T'}


def parse_info(field):
    info = {}
    for part in field.split(';'):
        if '=' in part:
            key, _, value = part.partition('=')
            info[key] = value
    return info


def classify(clnsig):
    """Maps ClinVar's CLNSIG onto our classification, or None to skip."""
    # CLNSIG can be like "Pathogenic", "Likely_pathogenic",
    # "Pathogenic/Likely_pathogenic", or carry extra terms after a pipe.
    primary = clnsig.split('|')[0].strip()
    if primary not in PATHOGENIC:
        return None
    if primary == 'Likely_pathogenic':
        return 'likely_pathogenic'
    return 'pathogenic'


def main():
    if len(sys.argv) > 1:
        stream = gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace')
    else:
        stream = io.TextIOWrapper(
            gzip.GzipFile(fileobj=sys.stdin.buffer), encoding='utf-8', errors='replace'
        )

    release = None
    seen_rsids = set()
    variants = []
    scanned = 0

    for line in stream:
        if line.startswith('##'):
            if line.startswith('##fileDate='):
                release = line.strip().split('=', 1)[1]
            continue
        if line.startswith('#'):
            continue

        scanned += 1
        if scanned % 500000 == 0:
            print(f'  scanned {scanned:,} records, kept {len(variants):,}', file=sys.stderr)

        cols = line.rstrip('\n').split('\t')
        if len(cols) < 8:
            continue
        _chrom, _pos, _vid, ref, alt, _qual, _filt, info_field = cols[:8]

        # Two-character diploid genotypes can only represent SNVs.
        if ref not in BASES or alt not in BASES:
            continue

        info = parse_info(info_field)

        rs = info.get('RS')
        if not rs:
            continue
        rsid = f'rs{rs.split("|")[0]}'
        if rsid in seen_rsids:
            continue

        classification = classify(info.get('CLNSIG', ''))
        if not classification:
            continue

        # GENEINFO looks like "BRCA1:672" or "GENE1:1|GENE2:2"
        geneinfo = info.get('GENEINFO', '')
        genes = [g.split(':')[0] for g in geneinfo.split('|') if g]
        gene = next((g for g in genes if g in GENES), None)
        if not gene:
            continue

        seen_rsids.add(rsid)
        variants.append({
            'rsid': rsid,
            'gene': gene,
            # ClinVar reports on the reference forward strand, as do the consumer
            # exports this is matched against.
            'riskAllele': alt,
            'classification': classification,
            'condition': (info.get('CLNDN', '') or 'not_specified').split('|')[0].replace('_', ' '),
            'clinvarId': _vid if _vid != '.' else None,
            'inheritance': 'autosomal recessive' if gene in RECESSIVE else 'autosomal dominant',
        })

    variants.sort(key=lambda v: (v['gene'], v['rsid']))

    by_gene = {}
    for v in variants:
        by_gene[v['gene']] = by_gene.get(v['gene'], 0) + 1

    output = {
        'source': 'ClinVar (NCBI), GRCh37 VCF',
        'version': release or f'unknown-release-retrieved-{date.today().isoformat()}',
        'synthetic': False,
        'genomeBuild': 'GRCh37',
        'selection': {
            'classifications': ['Pathogenic', 'Likely pathogenic'],
            'requires': ['rsID present', 'single-nucleotide substitution'],
            'geneList': 'ACMG SF v3.2 hereditary cancer genes plus melanoma predisposition genes',
            'genes': sorted(GENES),
            'recordsScanned': scanned,
            'generatedAt': date.today().isoformat(),
        },
        'variantsByGene': dict(sorted(by_gene.items())),
        'variants': variants,
    }

    out_path = os.path.join('server', 'genomics', 'panels', 'actionable-variants.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=1)
        f.write('\n')

    print(f'\nWrote {out_path}', file=sys.stderr)
    print(f'  ClinVar release : {output["version"]}', file=sys.stderr)
    print(f'  records scanned : {scanned:,}', file=sys.stderr)
    print(f'  variants kept   : {len(variants):,}', file=sys.stderr)
    for gene, count in sorted(by_gene.items(), key=lambda kv: -kv[1])[:12]:
        print(f'    {gene:10} {count:,}', file=sys.stderr)


if __name__ == '__main__':
    main()
