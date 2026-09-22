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

import base64
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from typing import Any, List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

# Enough of a file to decide whether it is DICOM at all: the 128-byte preamble
# plus the marker.
DICOM_HEAD_BYTES = 160

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(REPO_ROOT, "server")

# The server package is not importable as a package, and one of the two modules
# has a hyphen in its filename, so neither can be reached with a plain import.
sys.path.insert(0, SERVER_DIR)

# And this directory, so `dicom_ingest` resolves however uvicorn was invoked.
# Loaded as `inference.server` the sibling module is not on the path by default,
# and the failure is at import time rather than on the first DICOM upload — which
# is the better of the two, but only if it never happens in front of a clinic.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


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
from dicom_ingest import DicomRejected, dicom_to_model_frame, looks_like_dicom  # noqa: E402
from gradcam import CAVEAT as GRADCAM_CAVEAT, heatmap_png  # noqa: E402
from quality_gate import evaluate_ct_series  # noqa: E402
from series import SeriesRejected, assemble, order_slices, read_instance_metadata  # noqa: E402
from uid_remap import UidRemapper  # noqa: E402
import lung_nodule_service  # noqa: E402  constructs the characteriser, loading its model

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

# Series ceilings. A chest CT in the LIDC-IDRI subset runs 109-351 objects at
# roughly 0.5 MB each, so the defaults leave room for a large study and still
# bound what one request can cost. Enforced here as well as on the Node side:
# this service must be safe to run even if something else is talking to it.
MAX_SERIES_INSTANCES = int(os.environ.get("DICOM_SERIES_MAX_INSTANCES", 1024))
MAX_SERIES_BYTES = int(os.environ.get("DICOM_SERIES_MAX_BYTES", 1024 * 1024 * 1024))

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


def _read_upload(image: UploadFile) -> tuple[bytes, dict | None]:
    """The image bytes, converted from DICOM first when that is what arrived.

    Returns the acquisition metadata alongside, so the caller can record which
    modality and manufacturer produced a scan — useful later for drift analysis,
    since a model's behaviour is a property of the scanner as much as of the
    patient.

    De-identification happens inside dicom_to_model_frame, before anything is
    returned, so no code path here can hold an identified object even briefly.
    """
    data = image.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the size limit.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")

    if looks_like_dicom(data):
        try:
            frame, meta, deidentified = dicom_to_model_frame(data)
        except DicomRejected as exc:  # noqa: PERF203
            # 422, not 503: the service is fine and this object will fail the
            # same way on retry. Same status the model's own input screening
            # uses, so the client has one refusal shape to handle.
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        from PIL import Image

        buffer = io.BytesIO()
        Image.fromarray(frame).convert("RGB").save(buffer, format="PNG")
        # The de-identified object rides along so the Node side can persist it
        # instead of the upload. Base64 because this dict becomes JSON.
        meta = dict(meta)
        meta["deidentifiedObject"] = base64.b64encode(deidentified).decode()
        return buffer.getvalue(), meta

    return data, None



def _wants_explanation(value: str) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _attach_explanation(
    result: dict, model, img_array, class_index: int, modality: str
) -> None:
    """Adds a Grad-CAM overlay to a result, when one was asked for.

    Only for a result that actually classified something. A refusal has no class
    score to explain, and rendering a heatmap over an image the model declined
    to assess would suggest it had an opinion about it.

    Failure is non-fatal and reported in the payload. An explanation is an aid,
    and losing it must not lose the prediction.
    """
    if result.get("prediction") in (None, "rejected_input", "unavailable", "Error"):
        return

    try:
        result["explanation"] = {
            "heatmapPng": "data:image/png;base64,"
            + base64.b64encode(heatmap_png(model, img_array, class_index)).decode(),
            "method": "Grad-CAM on the final ResNet50V2 feature map (7x7, upsampled)",
            "caveat": GRADCAM_CAVEAT,
        }
    except Exception as exc:  # noqa: BLE001
        print(f"grad-cam failed for {modality}: {exc}", file=sys.stderr)
        result["explanationError"] = "The explanation could not be generated for this image."

@app.post("/infer/skin")
def infer_skin(image: UploadFile = File(...), explain: str = Form(default="")) -> Any:
    """Classify a dermoscopic image.

    Returns exactly the JSON `server/skin_cancer_model.py` produces on the
    command line, including its refusal shapes — `rejected_input` when the image
    fails a quality or domain check, `unavailable` when the artifact is missing.
    Nothing downstream has to know which transport was used.
    """
    data, acquisition = _read_upload(image)
    started = time.perf_counter()
    with _Admission(), _inference_lock:
        result = skin_model.predict_skin_cancer(io.BytesIO(data), SKIN_MODEL_PATH)
        if _wants_explanation(explain):
            # Class index 1 is malignant, fixed by training and recorded in
            # dataset/data/skin_model_training.json.
            _attach_explanation(
                result,
                skin_model.get_model(SKIN_MODEL_PATH),
                skin_model.preprocess_image(io.BytesIO(data)),
                1,
                "skin",
            )
    result["inferenceMs"] = round((time.perf_counter() - started) * 1000, 1)
    if acquisition:
        result["acquisition"] = acquisition
    return JSONResponse(result)


@app.post("/infer/lung")
def infer_lung(image: UploadFile = File(...), explain: str = Form(default="")) -> Any:
    """Classify a chest image with the legacy web-PNG lung model.

    Same contract as the skin endpoint: the module's own output, unaltered. The
    lung module already takes raw bytes, so there is no temporary file anywhere
    in this path.

    ── Withdrawn from clinical serving, 2026-09-20 ────────────────────────────

    The Node server no longer routes scans here: `MODEL_REGISTRY.lung` is
    disabled and its governance status is `withdrawn`. The endpoint remains so
    that the model can still be measured (scripts/verify-lung-operating-point.py
    and the reproduction commands in MODEL_CARDS.md go through the module this
    calls), and so that a request reaching it by mistake meets the same refusal
    shapes as before rather than a 404 that says nothing.

    The reason it was withdrawn is the comment on the DICOM gate below.
    """
    data, acquisition = _read_upload(image)

    # A DICOM acquisition is refused here, deterministically.
    #
    # This gate used to be described as belt-and-braces: "the out-of-distribution
    # screen catches real CT anyway, at 22.9 against a 16.51 threshold". That
    # figure was measured on pydicom's bundled `CT_small.dcm` — a 128×128 GE
    # acquisition from the 1990s — and it does not generalise. Measured on the
    # LIDC-IDRI chest CT in dataset/ on 2026-09-20, through this service's own
    # conversion: 11 of 12 real DICOMs and 84 of 87 whole slices at the lung
    # window scored BELOW the threshold (median 12–14, the same range as the
    # model's own test set) and received cancer / no_cancer verdicts.
    #
    # So this gate is the only thing that stops a DICOM, and nothing stops a
    # PNG export of the same slice. Real CT is inside this model's training
    # distribution in feature space — the training set is web-scraped chest
    # images — and a screen built on reconstruction error cannot separate what
    # the features do not separate. Raising the threshold would not be a fix; it
    # would be tuning the safety check to defeat itself.
    #
    # The model has no measured performance on CT, so any verdict it gives on
    # CT is a guess. That is why it no longer serves. The record is
    # `python scripts/build-ood-reference.py lung --measure-only`, which exits
    # non-zero on the real-CT domain, and MODEL_CARDS.md.
    if acquisition is not None:
        raise HTTPException(
            status_code=422,
            detail=(
                "The legacy lung model does not accept clinical DICOM acquisitions. "
                "It was trained on web-sourced PNG images, not on scanner output, "
                "and has no measured performance on CT — this is the model's "
                "limitation, not a problem with your image. The modality is "
                "withdrawn from serving until a CT-trained model is bound. See "
                "MODEL_CARDS.md."
            ),
        )

    started = time.perf_counter()
    with _Admission(), _inference_lock:
        result = lung_service.predict_lung_cancer(data)
        if _wants_explanation(explain):
            detector = lung_service.lung_cancer_detector
            if detector.model is not None:
                # Class index 0 is cancer, per lung_model_training.json.
                _attach_explanation(
                    result,
                    detector.model,
                    detector.preprocess_image(data),
                    0,
                    "lung",
                )
    result["inferenceMs"] = round((time.perf_counter() - started) * 1000, 1)
    if acquisition:
        result["acquisition"] = acquisition
    return JSONResponse(result)


def _parse_centre(value: str, name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{name} must be a number (pixels).")


@app.post("/infer/lung_nodule")
def infer_lung_nodule(
    image: UploadFile = File(...),
    cx: str = Form(...),
    cy: str = Form(...),
    explain: str = Form(default=""),
) -> Any:
    """Characterise a nodule a clinician has marked on one CT slice.

    Takes the DICOM object and the marked centre in the pixel coordinates of
    the rendered frame. Returns the module's own output: a calibrated
    probability with its threshold, temperature, OOD score and acquisition
    record, or a refusal in the same shape the other endpoints use. Raster
    input is refused by the service, with the reason — see
    inference/lung_nodule_service.py.

    The de-identified object comes back inside `acquisition.deidentifiedObject`
    as base64 so the Node side can persist THAT and never the upload.
    """
    data = image.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the size limit.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    centre_x = _parse_centre(cx, "cx")
    centre_y = _parse_centre(cy, "cy")

    started = time.perf_counter()
    with _Admission(), _inference_lock:
        result = lung_nodule_service.characterise_nodule(data, centre_x, centre_y)
        if _wants_explanation(explain) and result.get("status") == "success":
            characteriser = lung_nodule_service.lung_nodule_characteriser
            try:
                batch, _acq = characteriser.prepare(data, centre_x, centre_y)
                # Class index 0 is cancer, per lung_nodule_training.json.
                _attach_explanation(result, characteriser.model, batch, 0, "lung_nodule")
            except DicomRejected as exc:  # pragma: no cover - prepare already succeeded once
                result["explanationError"] = str(exc)
    result["inferenceMs"] = round((time.perf_counter() - started) * 1000, 1)

    acquisition = result.get("acquisition")
    if isinstance(acquisition, dict) and isinstance(acquisition.get("deidentifiedObject"), (bytes, bytearray)):
        acquisition["deidentifiedObject"] = base64.b64encode(acquisition["deidentifiedObject"]).decode()
    return JSONResponse(result)


@app.post("/deidentify")
def deidentify_only(image: UploadFile = File(...), preview: str = Form(default="true")) -> Any:
    """De-identify a DICOM object without running any model.

    For the paths that store an object but do not analyse it — a patient who
    has not consented to automated analysis, a modality with no model. Those
    paths used to persist the upload as it arrived, identity and all, because
    the only de-identifier lived behind the model call. Nothing here touches a
    model; the object comes back de-identified with its acquisition record.
    """
    data = image.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the size limit.")
    if not data or not looks_like_dicom(data):
        raise HTTPException(status_code=422, detail="Not a DICOM object.")
    try:
        frame, meta, deidentified = dicom_to_model_frame(data)
    except DicomRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    body = {
        "acquisition": meta,
        "deidentifiedObject": base64.b64encode(deidentified).decode(),
    }

    # The rendered frame, so a clinician can see the slice they are about to
    # mark. Rendered by the same function the model input comes from, so what
    # is marked on screen is what the crop is cut from. Skippable, because the
    # ingest path de-identifies hundreds of slices that nobody is looking at.
    if _wants_explanation(preview) or str(preview).strip().lower() == "true":
        from PIL import Image

        buffer = io.BytesIO()
        Image.fromarray(frame).convert("RGB").save(buffer, format="PNG")
        body["previewPng"] = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()

    return JSONResponse(body)


def _series_event(payload: dict) -> bytes:
    """One newline-delimited JSON event."""
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


@app.post("/ingest/series")
def ingest_series(files: List[UploadFile] = File(...)) -> Any:
    """Assemble, order, quality-gate and de-identify one CT series.

    ── Why the response is a stream ───────────────────────────────────────

    A 133-slice chest CT is about 70 MB of pixel data, and the caller needs
    every de-identified object in order to store them. Returning that as one
    JSON document means roughly 93 MB of base64 held whole on both sides at
    once, which is the kind of number that works on a developer's machine and
    falls over on a clinic's. So the response is newline-delimited JSON: a
    verdict first, then one event per slice in anatomical order. Each side
    holds one slice at a time.

    The verdict comes first deliberately. A rejected series emits the verdict
    and nothing else, so a caller never receives pixel data for a series it is
    not allowed to store, and never has to unpick a partial write.

    ── Ordering of operations ─────────────────────────────────────────────

    Assemble, order, gate, and only then de-identify and emit. The gate runs
    against the whole series, which is the only level at which "is this a
    chest CT that can be read" is answerable — a single slice cannot tell you
    it is one of forty or one of four hundred.

    ── The originals ──────────────────────────────────────────────────────

    Uploads are spooled to a private temporary directory, read twice (tags,
    then pixels), and the directory is removed in a finally that runs whether
    the generator completes, raises, or the client disconnects. Identified
    bytes never outlive the request.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were supplied.")
    if len(files) > MAX_SERIES_INSTANCES:
        raise HTTPException(
            status_code=413,
            detail=f"{len(files)} objects exceeds the {MAX_SERIES_INSTANCES} per-series limit.",
        )

    staging = tempfile.mkdtemp(prefix="healthai-series-")
    staged: list[str] = []
    total = 0
    try:
        for index, upload in enumerate(files):
            path = os.path.join(staging, f"{index:05d}.dcm")
            with open(path, "wb") as handle:
                while chunk := upload.file.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_SERIES_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"The upload exceeds the {MAX_SERIES_BYTES} byte series limit.",
                        )
                    handle.write(chunk)
            staged.append(path)
    except HTTPException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(staging, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Could not read the upload: {exc}") from exc

    import pydicom

    def rejection(code: str, message: str, detail: dict | None = None) -> Any:
        shutil.rmtree(staging, ignore_errors=True)
        return JSONResponse(
            status_code=422,
            content={
                "accepted": False,
                "stage": code,
                "reasons": [{"code": code, "message": message, **(detail or {})}],
            },
        )

    # --- parse tags only ---------------------------------------------------
    metas = []
    unreadable: list[int] = []
    not_dicom: list[int] = []
    for index, path in enumerate(staged):
        with open(path, "rb") as handle:
            head = handle.read(DICOM_HEAD_BYTES)
        if not looks_like_dicom(head):
            not_dicom.append(index)
            continue
        try:
            dataset = pydicom.dcmread(path, stop_before_pixels=True, force=True)
        except Exception:  # noqa: BLE001
            unreadable.append(index)
            continue
        metas.append(read_instance_metadata(dataset, index))

    if not_dicom:
        return rejection(
            "not_dicom",
            f"{len(not_dicom)} uploaded file(s) are not DICOM objects.",
            {"sourceIndexes": not_dicom[:20]},
        )
    if unreadable:
        return rejection(
            "unreadable",
            f"{len(unreadable)} DICOM object(s) could not be parsed.",
            {"sourceIndexes": unreadable[:20]},
        )

    # --- assemble, order, gate --------------------------------------------
    try:
        members, assembly = assemble(metas)
    except SeriesRejected as exc:
        return rejection(exc.code, exc.message, exc.detail)

    ordering = order_slices(members)
    gate = evaluate_ct_series(ordering.ordered, ordering)

    remapper = UidRemapper()
    first = ordering.ordered[0]
    manifest = {
        "accepted": gate.passed,
        "stage": "quality_gate",
        "uidMappingScope": remapper.scope,
        "assembly": assembly,
        "ordering": {
            "method": ordering.method,
            "trusted": ordering.trusted,
            "problems": ordering.problems,
            "warnings": ordering.warnings,
            "medianSpacingMm": round(abs(ordering.median_spacing), 4)
            if ordering.median_spacing is not None
            else None,
        },
        "qualityGate": gate.as_dict(),
        "instanceCount": len(ordering.ordered),
        # Remapped identity only. The originals are never in a response.
        "study": {"studyInstanceUid": remapper(first.study_instance_uid, kind="StudyInstanceUID")}
        if first.study_instance_uid
        else {"studyInstanceUid": None},
        "series": {
            "seriesInstanceUid": remapper(first.series_instance_uid, kind="SeriesInstanceUID"),
            "modality": first.modality,
            "rows": first.rows,
            "columns": first.columns,
            "pixelSpacingMm": list(first.pixel_spacing) if first.pixel_spacing else None,
            "sliceThicknessMm": first.slice_thickness,
            "manufacturer": first.manufacturer,
            "manufacturerModel": first.manufacturer_model,
            "convolutionKernel": first.convolution_kernel,
            "bodyPartExamined": first.body_part or None,
        },
    }

    if not gate.passed:
        shutil.rmtree(staging, ignore_errors=True)
        return JSONResponse(status_code=422, content=manifest)

    def stream():
        try:
            yield _series_event(manifest)
            for position, meta in enumerate(ordering.ordered):
                path = staged[meta.source_index]
                with open(path, "rb") as handle:
                    raw = handle.read()
                try:
                    _frame, acquisition, deidentified = dicom_to_model_frame(raw, remapper)
                except DicomRejected as exc:
                    yield _series_event(
                        {
                            "event": "instance_failed",
                            "index": position,
                            "reason": str(exc),
                        }
                    )
                    return
                uids = acquisition.get("deidentifiedUids", {})
                yield _series_event(
                    {
                        "event": "instance",
                        "index": position,
                        "sopInstanceUid": uids.get("sopInstanceUid"),
                        "seriesInstanceUid": uids.get("seriesInstanceUid"),
                        "studyInstanceUid": uids.get("studyInstanceUid"),
                        "positionMm": round(meta.projected_position, 4)
                        if meta.projected_position is not None
                        else None,
                        "object": base64.b64encode(deidentified).decode(),
                    }
                )
            yield _series_event({"event": "complete", "instanceCount": len(ordering.ordered)})
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.get("/healthz")
def healthz() -> Any:
    """Which models are resident, and which artifacts they came from.

    Reports per-model readiness rather than a single boolean: one modality being
    unavailable is a real state, and the Node server refuses only that modality
    rather than the whole service.
    """
    detector = lung_service.lung_cancer_detector
    nodule = lung_nodule_service.lung_nodule_characteriser
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
                # Resident for measurement only; the Node registry has it disabled.
                "withdrawn": True,
            },
            "lung_nodule": {
                "loaded": nodule.model is not None,
                "path": nodule.model_path,
                "version": f"resnet50v2-lung_nodule-{_artifact_digest(nodule.model_path)}",
                "threshold": nodule.threshold,
                "temperature": nodule.temperature,
                "input": "DICOM CT slice plus a marked centre (cx, cy); raster refused",
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

    nodule = lung_nodule_service.lung_nodule_characteriser
    if nodule.model is None:
        print(f"lung nodule model failed to load ({nodule.load_error})", file=sys.stderr)
    else:
        try:
            started = time.perf_counter()
            # The classifier graph and the feature-extraction graph both need
            # one trace. The pixel gate would refuse the noise frame before the
            # OOD graph is reached, so the extractor is traced directly.
            nodule.model.predict(blank, verbose=0)
            nodule._feature_extractor().predict(blank, verbose=0)
            elapsed = (time.perf_counter() - started) * 1000
            print(f"lung nodule model warm: {nodule.model_path} ({elapsed:.0f} ms)", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"lung nodule model warm-up failed ({exc})", file=sys.stderr)

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
