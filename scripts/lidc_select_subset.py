"""
Emits a reduced .tcia manifest: the most label-bearing CT series within a size budget.

    python scripts/lidc_select_subset.py \
        dataset/lidc-labels.csv "TCIA Folder/TCIA_LIDC-IDRI_20200921.tcia" \
        dataset/lidc-subset.tcia --budget-gb 20

Feed the output to the NBIA Data Retriever in place of the full manifest.

── Why a subset rather than the whole collection ──────────────────────────

The full collection is 128 GB of CT; the series that actually carry a confident
malignancy label are 96 GB of that. But the binding constraint is not bytes, it
is **malignant nodules**, and they are scarce: 304 confident ones across the
whole collection against 1,159 benign.

That changes the shape of the decision, because the returns fall away sharply:

    20 GB   229 series   197 malignant   585 benign
    96 GB   664 series   304 malignant  1159 benign

Nearly five times the download buys about one and a half times the malignant
nodules. Past roughly 20 GB you are mostly downloading more benign examples of a
class that is already the majority.

── How series are ranked ──────────────────────────────────────────────────

By confident labelled nodules per byte, with malignant weighted double because
it is the scarce class. Series whose nodules were all excluded as indeterminate
carry no label and are never selected.

Selection is greedy under the budget. It is deliberately NOT balanced by
patient demographics, because the digest carries no usable demographics — sex,
age and ethnic group are all null in the LIDC metadata. **A subset selected this
way is representative of nothing in particular, and the model card must say so.**
"""
from __future__ import annotations

import argparse
import collections
import csv
import os


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("labels_csv")
    parser.add_argument("full_manifest")
    parser.add_argument("out_manifest")
    parser.add_argument("--budget-gb", type=float, default=20.0)
    parser.add_argument("--min-agreement", type=float, default=0.75)
    args = parser.parse_args()

    rows = list(csv.DictReader(open(args.labels_csv, encoding="utf-8")))
    confident = [r for r in rows if float(r["agreement"]) >= args.min_agreement]

    series = collections.defaultdict(
        lambda: {"malignant": 0, "benign": 0, "bytes": 0, "patient": None}
    )
    for row in confident:
        entry = series[row["series_uid"]]
        entry["bytes"] = int(row["series_bytes"])
        entry["patient"] = row["patient"]
        entry["malignant" if row["positive"] == "1" else "benign"] += 1

    ranked = sorted(
        series.items(),
        key=lambda kv: -((kv[1]["malignant"] * 2 + kv[1]["benign"]) / max(kv[1]["bytes"], 1)),
    )

    budget = args.budget_gb * 1e9
    chosen, used = [], 0
    for uid, entry in ranked:
        if used + entry["bytes"] > budget:
            continue
        chosen.append(uid)
        used += entry["bytes"]

    # Preserve the original manifest's header verbatim. It carries the download
    # server URL and the manifest version, and the Data Retriever validates both.
    header, in_list = [], False
    for line in open(args.full_manifest, encoding="utf-8"):
        header.append(line.rstrip("\n"))
        if line.startswith("ListOfSeriesToDownload"):
            in_list = True
            break
    if not in_list:
        raise SystemExit("could not find ListOfSeriesToDownload in the source manifest")

    os.makedirs(os.path.dirname(args.out_manifest) or ".", exist_ok=True)
    with open(args.out_manifest, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(header) + "\n")
        handle.write("\n".join(chosen) + "\n")

    malignant = sum(series[u]["malignant"] for u in chosen)
    benign = sum(series[u]["benign"] for u in chosen)
    patients = {series[u]["patient"] for u in chosen}

    print(f"wrote {args.out_manifest}")
    print()
    print(f"  series selected  : {len(chosen)} of {len(series)}")
    print(f"  patients         : {len(patients)}")
    print(f"  download size    : {used / 1e9:.1f} GB (budget {args.budget_gb} GB)")
    print(f"  malignant nodules: {malignant}")
    print(f"  benign nodules   : {benign}")
    print()
    print("  Leave room beyond the download for extracted patches and the model.")
    print("  Patient-level splits only — nodules from one patient must not appear")
    print("  on both sides, or the held-out figure is optimistic and unfixable.")


if __name__ == "__main__":
    main()
