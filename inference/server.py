"""
Long-running inference service. Holds both models in memory.

── Why this exists ────────────────────────────────────────────────────────

Every scan used to spawn a fresh Python process that imported TensorFlow,
loaded a ResNet50V2 from disk, ran one image through it, and exited. Measured
on the development machine: 8.4 s, 11.0 s and 13.6 s per scan, essentially all
of it startup. The model weights are around 90 MB and were read from disk,
parsed and materialised into a graph once per request.

Two consequences, and the second is the serious one:

  1. It is not real-time. Nothing that takes eight seconds and gives no
     progress signal feels like it is working.

  2. It has no ceiling. There was no queue, no worker pool and no concurrency
     cap anywhere in the path, so N simultaneous uploads meant N TensorFlow
     processes, each holding several hundred megabytes. The rate limiter
     allowed 600 requests per five minutes per authenticated account, so one
     ordinary user could exhaust the host's memory without doing anything
     unusual — no attack, just enthusiasm.

Loading each model once and keeping it resident fixes both. Warm inference is
a forward pass, and memory is bounded by the two resident models rather than by
how many people happen to press the button at the same moment.

── What this deliberately does NOT do ─────────────────────────────────────

It does not reimplement any inference logic. The quality checks, the
out-of-distribution screening, the calibration temperature, the lung decision
threshold and the skin probability banding all live in `server/` and are called
from here unchanged. A second implementation of the safety machinery is a
second thing to keep correct, and the failure mode — server and CLI quietly
disagreeing about whether an image should have been refused — is exactly the
class of defect this codebase has spent its history removing.

The CLI entry points still work and still produce identical output. They are
what `scripts/evaluate-model.py` and the model cards' reproduction commands
use, and those must keep working or the published figures stop being checkable.

── Running it ─────────────────────────────────────────────────────────────

    pip install -r inference/requirements.txt
    uvicorn inference.server:app --host 127.0.0.1 --port 8001

Then point the Node server at it:

    INFERENCE_URL=http://127.0.0.1:8001

Without that variable the Node server falls back to spawning Python per
request, so local development works with no extra process running.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import os
import sys
import threading
import time
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(REPO_ROOT, "server")

# The server package is not importable as a package, and one of the two modules
# has a hyphen in its filename, so neither can be reached with a plain import.
sys.path.insert(0, SERVER_DIR)


def _load_module(name: str, filename: str):
    """Import a module from server/ by path, hyphenated filenames included."""
    path = os.path.join(SERVER_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Importing the lung module constructs its module-level detector, which loads
# the model. That is the behaviour we want here and the reason it is imported
# eagerly rather than on first request.
skin_model = _load_module("skin_cancer_model", "skin_cancer_model.py")
lung_service = _load_module("lung_cancer_service", "lung-cancer-service.py")

SKIN_MODEL_PATH = os.environ.get(
    "SKIN_CANCER_MODEL_PATH",
    os.path.join(REPO_ROOT, "dataset", "data", "resnet50v2_skin_cancer_model.h5"),
)

# Upload ceiling, mirroring the 10 MB multer limit on the Node side. Enforced
# here too: this service must be safe to run even if something else is talking
# to it.
MAX_UPLOAD_BYTES = int(os.environ.get("INFERENCE_MAX_UPLOAD_BYTES", 10 * 1024 * 1024))

# How many requests may be waiting for the model at once.
#
# The lock below serialises inference, so this is the depth of the queue in
# front of it, not a parallelism setting. Past this depth the service returns
# 503 with a Retry-After rather than accumulating work it cannot get to — the
# whole point of the change is that load produces backpressure instead of an
# out-of-memory kill.
MAX_QUEUE_DEPTH = int(os.environ.get("INFERENCE_MAX_QUEUE_DEPTH", 16))

# TensorFlow's Python-level predict path is not reliably re-entrant across
# threads on one model instance, and FastAPI runs synchronous endpoints in a
# threadpool. Serialising is also what keeps memory flat: one forward pass of
# intermediate activations at a time, regardless of arrival rate.
_inference_lock = threading.Lock()
_queue_depth = 0
_queue_lock = threading.Lock()

app = FastAPI(title="HealthAI inference", docs_url=None, redoc_url=None)


def _artifact_digest(path: str) -> str:
    """First 12 hex of SHA-256, matching server/model-fingerprint.ts.

    The Node side records this against every scan as `model_version`. Reporting
    the same value here means an operator can confirm that the service actually
    serving predictions holds the artifact those rows name, rather than assuming
    the deployment is coherent.
    """
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()[:12]
    except OSError:
        return "unknown"


class _Admission:
    """Bounded admission to the model. Raises 503 rather than queueing forever."""

    def __enter__(self):
        global _queue_depth
        with _queue_lock:
            if _queue_depth >= MAX_QUEUE_DEPTH:
                raise HTTPException(
                    status_code=503,
                    detail="Inference queue is full; retry shortly.",
                    headers={"Retry-After": "5"},
                )
            _queue_depth += 1
        return self

    def __exit__(self, *exc):
        global _queue_depth
        with _queue_lock:
            _queue_depth -= 1
        return False


def _read_upload(image: UploadFile) -> bytes:
    data = image.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the size limit.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    return data


@app.post("/infer/skin")
def infer_skin(image: UploadFile = File(...)) -> Any:
    """Classify a dermoscopic image.

    Returns exactly the JSON `server/skin_cancer_model.py` produces on the
    command line, including its refusal shapes — `rejected_input` when the image
    fails a quality or domain check, `unavailable` when the artifact is missing.
    Nothing downstream has to know which transport was used.
    """
    data = _read_upload(image)
    started = time.perf_counter()
    with _Admission(), _inference_lock:
        result = skin_model.predict_skin_cancer(io.BytesIO(data), SKIN_MODEL_PATH)
    result["inferenceMs"] = round((time.perf_counter() - started) * 1000, 1)
    return JSONResponse(result)


@app.post("/infer/lung")
def infer_lung(image: UploadFile = File(...)) -> Any:
    """Classify a chest image.

    Same contract as the skin endpoint: the module's own output, unaltered. The
    lung module already takes raw bytes, so there is no temporary file anywhere
    in this path.
    """
    data = _read_upload(image)
    started = time.perf_counter()
    with _Admission(), _inference_lock:
        result = lung_service.predict_lung_cancer(data)
    result["inferenceMs"] = round((time.perf_counter() - started) * 1000, 1)
    return JSONResponse(result)


@app.get("/healthz")
def healthz() -> Any:
    """Which models are resident, and which artifacts they came from.

    Reports per-model readiness rather than a single boolean: one modality being
    unavailable is a real state, and the Node server refuses only that modality
    rather than the whole service.
    """
    detector = lung_service.lung_cancer_detector
    skin_loaded = SKIN_MODEL_PATH in skin_model._MODEL_CACHE

    return {
        "status": "ok",
        "queueDepth": _queue_depth,
        "maxQueueDepth": MAX_QUEUE_DEPTH,
        "models": {
            "skin": {
                "loaded": skin_loaded,
                "path": SKIN_MODEL_PATH,
                "version": f"resnet50v2-skin-{_artifact_digest(SKIN_MODEL_PATH)}",
            },
            "lung": {
                "loaded": detector.model is not None,
                "path": detector.model_path,
                "version": f"resnet50v2-lung-{_artifact_digest(detector.model_path)}",
                "threshold": detector.cancer_threshold,
                "temperature": detector.temperature,
            },
        },
    }


def _warm_frame() -> bytes:
    """A small PNG with enough texture to pass the pixel quality checks.

    Deliberately noise rather than a flat colour: a uniform frame is refused by
    `check_image_quality` before the model is ever consulted, so warming with
    one would exercise none of the path that actually needs warming.
    """
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(0)
    noise = rng.integers(0, 256, size=(224, 224, 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(noise).save(buffer, format="PNG")
    return buffer.getvalue()


@app.on_event("startup")
def warm_models() -> None:
    """Run one throwaway image through each model before serving traffic.

    Loading the weights is not enough. Both modalities build a second Keras
    graph for out-of-distribution screening — the ResNet trunk re-applied to the
    rescaling output — and that construction is lazy, on first use. Warming only
    the weights left it in the request path, which was measurable: the first
    skin request took 4.4 s against 453 ms for every one after it. Whichever
    patient arrives first should not pay for the deployment.

    The warm frame is random noise. It will be refused as out-of-distribution,
    which is the correct outcome and irrelevant — the point is that every graph
    on the path gets built, not what the verdict was.

    Failures are logged, never raised. The service should still start and serve
    whichever modality does work; `/healthz` reports which is which. Refusing to
    boot because one of two models is missing would take out the other one too.
    """
    import numpy as np

    frame = _warm_frame()
    # Raw RGB 0-255 at the models' input size — the representation both graphs
    # expect, since normalisation is fused into the saved models.
    blank = np.zeros((1, 224, 224, 3), dtype=np.float32)

    try:
        model = skin_model.get_model(SKIN_MODEL_PATH)
        started = time.perf_counter()
        # Two separate graphs, and each has to be traced once.
        #
        # The noise frame is rejected as out-of-distribution — by design, that is
        # what noise should be — so it exercises the feature-extraction graph and
        # returns before the classifier is ever reached. Warming with it alone
        # left a 1.8 s first request, because the classification forward pass was
        # still being traced on arrival. The direct call below covers that half.
        skin_model.predict_skin_cancer(io.BytesIO(frame), SKIN_MODEL_PATH)
        model.predict(blank, verbose=0)
        elapsed = (time.perf_counter() - started) * 1000
        print(f"skin model warm: {SKIN_MODEL_PATH} ({elapsed:.0f} ms)", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 - reported through /healthz
        print(f"skin model failed to load ({exc})", file=sys.stderr)

    detector = lung_service.lung_cancer_detector
    if detector.model is None:
        print(f"lung model failed to load ({detector.load_error})", file=sys.stderr)
    else:
        try:
            started = time.perf_counter()
            detector.predict(frame)
            detector.model.predict(blank, verbose=0)
            elapsed = (time.perf_counter() - started) * 1000
            print(f"lung model warm: {detector.model_path} ({elapsed:.0f} ms)", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"lung model warm-up failed ({exc})", file=sys.stderr)
