# P2 detector: training feasibility on this machine

Measured 23 September 2026 on the working copy. Every number below came from
running something, and the command that produced it is given so it can be
re-run and contradicted.

**Summary: a lung nodule detector cannot be trained here, and the local
collection cannot demonstrate the proposed performance gate even if one
appeared.** Both are constraints on what P2 can claim, not reasons to lower
what it claims.

---

## 1. Compute

| | Measured |
|---|---|
| Interpreter (inference) | Python 3.8.10, AMD64 |
| Interpreter (offline work) | Python ≥3.10 environment specified in `inference/py310/requirements.txt`; **not instantiated** — no venv exists |
| torch | 2.1.0+cpu |
| `torch.cuda.is_available()` | **False** |
| CUDA devices | 0 |
| GPU present | Intel Iris Xe Graphics (integrated, no CUDA) |
| Logical cores | 8 |
| torch threads | 4 |
| System memory | 7.8 GB |

```
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.device_count())"
```

### What that costs, measured rather than asserted

A deliberately tiny 3D backbone — 69,953 parameters, three conv blocks — was
timed doing full forward/backward/step on a batch of four 96³ patches:

```
batch 4 of 96^3 patches, one training step: 1.77 s
patches per second: 2.3
```

At that rate, a modest schedule of 100 epochs over 400 series at 8 patches per
series is about **39 hours** — for a model roughly 400× smaller than a real 3D
detector. A RetinaNet-class 3D detector at ~30M parameters is two to three
orders of magnitude more work, which puts a single training run in the range
of months of wall-clock time on this hardware.

The conclusion is not that training is slow. It is that training is **not
available**, and any P2 plan that assumes it is has to name where the compute
comes from before it means anything.

---

## 2. Data actually present

The split manifest assigns all 740 patients in the label table, because the
assignment must be a property of the collection rather than of whatever has
been downloaded. What is on disk is a third of it.

```
python scripts/lidc_series_availability.py --check
```

| Split | Series assigned | Series available | Nodules assigned | Nodules available |
|---|---|---|---|---|
| train | 482 | **149** | 1083 | **518** |
| validation | 93 | **27** | 208 | **90** |
| calibration | 71 | **21** | 168 | **88** |
| test | 102 | **32** | 244 | **126** |
| **total** | 748 | **229** | 1703 | **822** |

All 229 available series are CT, and every one of them is named in the label
table — there are no orphans in either direction. 37,970 DICOM objects.

The recorded index is `docs/splits/lidc-availability.json`, which is tracked,
and it carries the split fingerprint `f55f6cd5188ae3ee` so an availability
report can never be read against a different split than the one it was
computed for.

Availability is an inventory, not a verdict. Whether a given series has valid
geometry and survives the quality gate is decided per series, when it is used,
by `inference/series.py` and `inference/quality_gate.py`.

---

## 3. What 126 test nodules can and cannot show

Interval width is a property of sample size and is knowable before any
detector exists. Computed with the project's own Wilson implementation
(`inference/detection_eval.wilson`):

| If a detector found | Sensitivity | 95% interval | Width |
|---|---|---|---|
| 101 of 126 | 0.802 | 0.724 – 0.862 | 0.138 |
| 107 of 126 | 0.849 | 0.776 – 0.901 | 0.125 |
| 113 of 126 | 0.897 | 0.832 – 0.939 | 0.107 |
| 120 of 126 | 0.952 | 0.900 – 0.978 | 0.078 |

**Nothing in that table is a result.** No detector exists; these are the
intervals a hypothetical count would carry.

The consequence is concrete. The gate proposed in `docs/bars/p2.json` — and
never approved — is 0.85 sensitivity at ≤4 false positives per scan. On 126
nodules, an observed 0.849 has a lower bound of 0.776, and even an observed
0.897 has a lower bound of 0.832. **The available test split cannot
demonstrate that a 0.85 bar was met.** It could only rule it out, or fail to
distinguish it from considerably worse.

That is an argument for one of: acquiring the rest of the collection, deciding
the bar in terms this data can actually support, or stating plainly that the
local figure is an internal check and not evidence of meeting a bar. It is not
an argument for quoting the point estimate without its interval.

---

## 4. What this does not decide

- **It does not choose a detector architecture.** No checkpoint is registered,
  and `inference/detection_service.py` refuses with `model_unavailable` rather
  than returning an empty candidate list.
- **It does not authorise downloading anything.** Fetching the remainder of
  LIDC-IDRI, or LUNA16, is a project decision with licence and leakage
  consequences — see `docs/P2_DATASET_DECISION.md`, still PENDING.
- **It does not set the bar.** `proposedGate.approval.approved` stays `false`.
- **It does not settle the matching rule.**
  `docs/P2_LOCALIZATION_METHODOLOGY.md` stays PENDING, and
  `inference/detection_eval.rule_from_bar` refuses while it does.

## 5. Options, none of them selected

| | What it costs | What it changes |
|---|---|---|
| Rented GPU for training | Money, and a data-transfer decision about moving a research collection off this machine | Makes training possible; the transfer needs its own privacy assessment even for public de-identified data |
| Adopt a pretrained checkpoint | Licence review of the weights **and** of the data they were trained on; LUNA16-derived weights create the leakage problem `docs/P2_DATASET_DECISION.md` describes | Removes the training requirement entirely; replaces it with a provenance requirement |
| Download the rest of LIDC-IDRI | Time and roughly 60 GB | Triples the evaluation set, narrowing the test interval to about ±0.045 at 0.85 |
| Stay at route 1 | Nothing | The clinician marks the nodule and the existing characteriser runs; this is what ships today and it is a complete workflow |

The roadmap's stated fallback remains in force: if no detector meets an
approved bar, P2 stops at "candidates not shown" and the pipeline stays at
route 1.

---

## Reproduce

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
python scripts/lidc_build_splits.py --audit-only
python scripts/lidc_series_availability.py --check
python scripts/validate-detector-on-lidc.py --check   # exits 1, BLOCKED
python -m pytest inference/tests -q
```
