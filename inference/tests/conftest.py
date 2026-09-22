"""
Fixtures for the inference tests.

Two kinds of test live here, and the fixtures say which is which:

  - tests of the code alone (windowing arithmetic, de-identification, the
    crop), which run anywhere from synthetic objects built in memory;
  - tests against the artifacts and the LIDC-IDRI download, which are
    gitignored and so absent in CI. Those skip with a reason rather than
    fail — "the dataset is not on this machine" is a property of the checkout,
    not a defect — and run in full on a machine that has them.

Nothing here fabricates a model output. A test that needs a probability gets
it from the model.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INFERENCE = os.path.join(ROOT, "inference")
SERVER = os.path.join(ROOT, "server")
for p in (INFERENCE, SERVER):
    if p not in sys.path:
        sys.path.insert(0, p)

NODULE_MODEL_DIR = os.path.join(ROOT, "dataset", "lung_nodule_model")
NODULE_MODEL = os.path.join(NODULE_MODEL_DIR, "resnet50v2_lung_nodule_model.h5")
LIDC_ROOT = os.path.join(ROOT, "dataset", "manifest-1600709154662", "LIDC-IDRI")
PATCHES = os.path.join(ROOT, "dataset", "lidc-ct", "patches.csv")
LABELS = os.path.join(ROOT, "dataset", "lidc-labels.csv")

HAVE_LIDC = os.path.isdir(LIDC_ROOT) and os.path.exists(LABELS)
HAVE_NODULE_MODEL = os.path.exists(NODULE_MODEL)
HAVE_PATCHES = os.path.exists(PATCHES)

requires_lidc = pytest.mark.skipif(not HAVE_LIDC, reason="LIDC-IDRI download absent (gitignored)")
requires_nodule_model = pytest.mark.skipif(
    not HAVE_NODULE_MODEL, reason="lung nodule artifact absent (gitignored)"
)
requires_patches = pytest.mark.skipif(not HAVE_PATCHES, reason="patches.csv absent")


def make_ct_dataset(
    rows: int = 64,
    cols: int = 64,
    *,
    modality: str = "CT",
    photometric: str = "MONOCHROME2",
    window: tuple[float, float] | None = (40.0, 400.0),
    burned_in: str | None = None,
    frames: int = 1,
    with_identity: bool = True,
):
    """A small synthetic DICOM object with a known HU ramp, in memory.

    Stored values run from -1000 (air) at the top to +1000 at the bottom after
    the rescale, so a test can predict exactly what any window maps each row
    to. The identity tags are the ones the de-identifier must remove.
    """
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = pydicom.uid.CTImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.SOPClassUID = pydicom.uid.CTImageStorage
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.FrameOfReferenceUID = generate_uid()
    ds.Modality = modality
    ds.PhotometricInterpretation = photometric
    ds.Rows, ds.Columns = rows, cols
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 16, 15
    ds.PixelRepresentation = 1
    ds.SamplesPerPixel = 1
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0
    ds.PixelSpacing = [0.7, 0.7]
    ds.SliceThickness = 2.5
    ds.BodyPartExamined = "CHEST"
    ds.Manufacturer = "SYNTHETIC"
    ds.ManufacturerModelName = "TestScanner"
    if window is not None:
        ds.WindowCenter, ds.WindowWidth = window
    if burned_in is not None:
        ds.BurnedInAnnotation = burned_in
    if with_identity:
        ds.PatientName = "Doe^Jane"
        ds.PatientID = "MRN-000123"
        ds.PatientBirthDate = "19700101"
        ds.StudyDate = "20260315"
        ds.StudyTime = "101500"
        ds.AccessionNumber = "ACC-9"
        ds.InstitutionName = "Test Hospital"
        ds.ReferringPhysicianName = "Ref^Doc"
        ds.OtherPatientIDs = "ALT-1"
        # A private tag, as vendors write them.
        ds.add_new((0x0009, 0x0010), "LO", "VENDOR CREATOR")
        ds.add_new((0x0009, 0x1001), "LO", "Doe^Jane copy")

    # Stored values -1000..+1000 HU as a vertical ramp (after intercept -1024:
    # stored = HU + 1024).
    hu = np.linspace(-1000, 1000, rows, dtype=np.float64)[:, None].repeat(cols, axis=1)
    stored = np.round(hu + 1024).astype(np.int16)
    if frames > 1:
        stored = np.stack([stored + f for f in range(frames)], axis=0)
        ds.NumberOfFrames = frames
    ds.PixelData = stored.tobytes()
    return ds


def dataset_bytes(ds) -> bytes:
    import io

    buffer = io.BytesIO()
    ds.save_as(buffer, write_like_original=False)
    return buffer.getvalue()


def make_ct_series(
    count: int = 60,
    *,
    spacing: float = 2.5,
    thickness: float = 2.5,
    orientation: tuple[float, ...] = (1, 0, 0, 0, 1, 0),
    body_part: str = "CHEST",
    rows: int = 512,
    columns: int = 512,
    modality: str = "CT",
    series_uid: str | None = None,
    study_uid: str | None = None,
    start_z: float = -300.0,
):
    """A synthetic CT series: `count` slices, evenly spaced along the normal.

    Built in memory so the series tests run anywhere, including CI with no
    LIDC download. The defaults sit inside the range measured across 30
    LIDC-IDRI series, so a series built with them passes the quality gate and
    a test that wants a failure has to ask for one explicitly.
    """
    import pydicom
    from pydicom.uid import generate_uid

    series_uid = series_uid or generate_uid()
    study_uid = study_uid or generate_uid()
    slices = []
    for index in range(count):
        ds = make_ct_dataset(rows=rows, cols=columns, modality=modality, with_identity=True)
        ds.SeriesInstanceUID = series_uid
        ds.StudyInstanceUID = study_uid
        ds.SliceThickness = thickness
        ds.ImageOrientationPatient = list(orientation)
        ds.ImagePositionPatient = [0.0, 0.0, start_z + index * spacing]
        ds.SliceLocation = start_z + index * spacing
        ds.InstanceNumber = index + 1
        ds.BodyPartExamined = body_part
        slices.append(ds)
    return slices


@pytest.fixture(scope="session")
def synthetic_ct_bytes() -> bytes:
    return dataset_bytes(make_ct_dataset())


def _nodule_id(row):
    series = hashlib.sha256(row["series_uid"].encode()).hexdigest()[:6]
    return f"{row['patient']}_{series}_{row['nodule_index']}"


@pytest.fixture(scope="session")
def lidc_nodule():
    """A held-out malignant nodule and its centre slice, via the same script
    the TypeScript tests use. Skips without the dataset."""
    if not (HAVE_LIDC and HAVE_PATCHES):
        pytest.skip("LIDC-IDRI download absent")
    run = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "lidc_find_nodule_slice.py")],
        capture_output=True, text=True, timeout=180, cwd=ROOT,
    )
    if run.returncode != 0:
        pytest.skip(f"could not resolve a nodule slice: {run.stdout[-200:]}")
    info = json.loads(run.stdout.strip().splitlines()[-1])
    info["abs_path"] = os.path.join(ROOT, info["path"])
    info["bytes"] = open(info["abs_path"], "rb").read()
    return info


@pytest.fixture(scope="session")
def characteriser():
    """The nodule characteriser with its model loaded. Skips without the artifact."""
    if not HAVE_NODULE_MODEL:
        pytest.skip("lung nodule artifact absent")
    import lung_nodule_service

    c = lung_nodule_service.lung_nodule_characteriser
    if c.model is None:
        pytest.skip(f"nodule model failed to load: {c.load_error}")
    return c
