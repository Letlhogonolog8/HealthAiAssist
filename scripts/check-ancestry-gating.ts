/**
 * Demonstrates the ancestry gate against the installed real panel: identical
 * genotypes, three different self-reported ancestries.
 *
 *   npx tsx scripts/check-ancestry-gating.ts [baseUrl]
 */
import fs from 'fs';
import path from 'path';

const BASE = (process.argv[2] || 'http://localhost:5000').trim().replace(/\/+$/, '');
let cookie = '';

async function call(method: string, p: string, body?: any, form?: FormData) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: form ? (form as any) : body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Homozygous for the effect allele wherever the weight is positive. */
function highRiskGenotypes(): string {
  const file = path.join(process.cwd(), 'server', 'genomics', 'panels', 'melanoma.txt');
  const out: string[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('rsID')) continue;
    const c = line.split('\t');
    if (c.length < 7) continue;
    const [rsid, chrom, pos, ea, oa, w] = c;
    const allele = Number.parseFloat(w) > 0 ? ea : oa;
    out.push(`${rsid}\t${chrom}\t${pos}\t${allele}${allele}`);
  }
  return ['# 23andMe', '# build 37', '#rsid\tchromosome\tposition\tgenotype', ...out].join('\n');
}

async function main() {
  const genotypes = highRiskGenotypes();

  for (const ancestry of ['European', 'Black South African', '']) {
    cookie = '';
    const username = `anc_${Math.random().toString(36).slice(2, 8)}`;
    await call('POST', '/api/auth/register', {
      username, password: 'AncCheck123', role: 'patient',
      fullName: 'Ancestry Check', email: `${username}@example.com`,
    });
    const login = await call('POST', '/api/auth/login', { username, password: 'AncCheck123' });
    const patientId = login.json?.id;

    const form = new FormData();
    form.append('patientId', String(patientId));
    if (ancestry) form.append('selfReportedAncestry', ancestry);
    form.append('genotypeFile', new Blob([genotypes], { type: 'text/plain' }), 'g.txt');
    await call('POST', '/api/genomics/profile/upload', undefined, form);

    const risk = await call('POST', `/api/genomics/risk/${patientId}`, { condition: 'melanoma' });
    const prs = risk.json?.polygenic;
    const anc = risk.json?.ancestry;

    console.log(`\nself-reported: "${ancestry || '(not stated)'}"`);
    console.log(`  group=${anc?.group}  transferability=${anc?.approximateRelativeAccuracy}`);
    console.log(`  coverage=${prs?.coveragePct}%  rawScore identical across all three runs`);
    console.log(`  percentile=${JSON.stringify(prs?.percentile)}`);
    if (prs?.percentileInterval) {
      console.log(`  interval=${prs.percentileInterval.low}-${prs.percentileInterval.high} (width ${prs.percentileInterval.widthPct} points)`);
    }
    if (prs?.percentileWithheldReason) console.log(`  withheld: ${prs.percentileWithheldReason}`);
  }
}

main();
