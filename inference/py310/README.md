# The Python ≥3.10 environment

A second Python, for training and validation work only. **The inference
service does not use it and must not be pointed at it.**

Nothing is installed by this directory. It records the decision, the
separation and the activation, so that when P2 training work begins it does
not start by quietly upgrading the runtime that serves patients.

---

## Why there are two

The resident inference service runs on the machine's system Python:

```
$ python --version
Python 3.8.10
```

with TensorFlow 2.13, torch 2.1.0+cpu, pydicom 2.4.4 and FastAPI 0.115. That
is what `inference/server.py` is served by and what the whole pytest suite
runs against.

It cannot simply be moved. Python 3.8 has specific consequences this codebase
has already been bitten by — FastAPI evaluates an endpoint's annotations at
import time, so `list[UploadFile]` in a route signature raises a `TypeError`
and takes down *every* endpoint, not just the new one. That is recorded in
`inference/tests/test_server_app.py`, which exists because it happened.

The ML tooling P2 would adopt requires ≥3.10. Upgrading the serving runtime to
get it would mean revalidating every model, every render path and every
published figure against a new interpreter and a new set of library versions,
for the benefit of work that does not run in production at all. Training and
serving have different requirements and different risk; they get different
environments.

---

## The rule

| | Serving | Training / validation |
|---|---|---|
| Python | 3.8.10, system | ≥3.10, this directory |
| Runs | `inference/server.py`, the pytest suite | offline scripts only |
| Touches patient data | yes, de-identified | no |
| In the request path | yes | **never** |

`INFERENCE_URL` must never point at a service started from this environment.
Nothing in `inference/` other than offline scripts may import from it. If a
piece of code needs to run in both, it belongs in `inference/` and must stay
3.8-compatible — `inference/nodule_patch.py` is the precedent, shared between
training and serving precisely so the two cannot drift.

---

## Creating it

```bash
py -3.10 -m venv inference/py310/.venv        # Windows
python3.10 -m venv inference/py310/.venv      # Linux / macOS

inference/py310/.venv/Scripts/activate        # Windows
source inference/py310/.venv/bin/activate     # Linux / macOS

python -m pip install -r inference/py310/requirements.txt
```

`.venv/` is gitignored along with every other virtualenv in this repository.

Confirm you are in the right one before running anything:

```bash
python --version      # must be 3.10 or newer
```

And confirm you are **not** in it before starting the service:

```bash
deactivate
python --version      # must be 3.8.10
python -m pytest inference/tests
```

---

## Detector training (added 2026-09-24)

The candidate-detector training harness lives in `training/` and its stack is
pinned in `training/requirements-training.txt`, installed into this same
environment. See `docs/P2_TRAINING_READINESS.md`. On the machine this was
written on, `py -3.10` resolves to a Microsoft Store alias that Windows refuses
to launch ("The file cannot be accessed by the system"), so this environment
has not been instantiated here; the harness's own tests run under the 3.8
interpreter because the code is kept 3.8-compatible, and real training is
refused on that interpreter by `scripts/check-training-environment.py`.

## Dependencies

`requirements.txt` is deliberately almost empty. The detector is not chosen,
so its dependencies are not knowable, and installing a stack on the chance it
will be useful would mean carrying licence and supply-chain obligations for
libraries nothing imports.

What a detector would plausibly need, and why none of it is here yet:

| Package | For | Status |
|---|---|---|
| SimpleITK or nibabel | volume I/O and resampling | **not added** — the volume builder is not written |
| MONAI | detection and transforms | **not added** — no detector chosen |
| scikit-image | connected components, morphology | **not added** — candidate post-processing is not written |
| ONNX Runtime | portable CPU inference | **not added** — no artifact to run |
| pylidc | LIDC access | **not added** — `scripts/lidc_build_labels.py` and `scripts/lidc_extract_diameters.py` parse the XML directly, which is why this dependency has never been needed |

Each is a decision with a licence attached, to be made when the thing that
needs it exists. See `docs/ML_CHANGE_PROCESS.md`.

---

## What still runs on 3.8

The prerequisite work committed alongside this directory needs nothing new:

- `inference/geometry.py` — standard library only
- `inference/series.py` polarity — standard library only
- `scripts/lidc_extract_diameters.py` — standard library, plus the pydicom
  already installed, and only when `--dicom-root` is given

So none of it requires this environment. It is prepared, documented and empty
on purpose.
