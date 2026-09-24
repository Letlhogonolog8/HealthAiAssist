"""
Fixtures for the training harness tests.

Everything here is synthetic. The phantom is a chest-shaped arrangement of
Hounsfield values — soft-tissue body, two aerated lungs, one solid sphere —
built in memory so the tests run without LIDC, without patient data and
without a GPU. It is shaped to pass the service's own quality gate (at least
40 slices, at least a 256 matrix, body part CHEST), because the harness
refuses anything that does not, and a fixture the harness refuses tests only
the refusal.

Nothing produced from these fixtures is a measurement of anything.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for path in (ROOT, os.path.join(ROOT, "inference")):
    if path not in sys.path:
        sys.path.insert(0, path)

# Phantom geometry, in voxels. Spacing 0.7 mm in plane, 2.5 mm through plane.
ROWS = COLS = 256
SLICES = 44
PIXEL_MM = 0.7
SLICE_MM = 2.5
START_Z = -100.0
LUNG_CENTRES = ((128, 80), (128, 176))       # (row, col)
LUNG_RADII = (70, 36)                        # (rows, cols)
NODULE = {"k": 22, "row": 128, "col": 80, "radius_mm": 5.0}
SMALL_MARK = {"k": 10, "row": 100, "col": 176}


def phantom_hu() -> np.ndarray:
    """(slices, rows, cols) HU: air -1000, body 40, lung -850, nodule 40."""
    r, c = np.mgrid[0:ROWS, 0:COLS].astype(np.float64)
    body = ((r - 128) / 110.0) ** 2 + ((c - 128) / 120.0) ** 2 <= 1.0
    lungs = np.zeros((ROWS, COLS), dtype=bool)
    for centre in LUNG_CENTRES:
        lungs |= ((r - centre[0]) / LUNG_RADII[0]) ** 2 + ((c - centre[1]) / LUNG_RADII[1]) ** 2 <= 1.0

    plane = np.full((ROWS, COLS), -1000.0)
    plane[body] = 40.0
    plane[lungs] = -850.0
    volume = np.repeat(plane[None], SLICES, axis=0)

    k, j, i = np.mgrid[0:SLICES, 0:ROWS, 0:COLS].astype(np.float64)
    distance_mm = np.sqrt(((k - NODULE["k"]) * SLICE_MM) ** 2 + ((j - NODULE["row"]) * PIXEL_MM) ** 2
                          + ((i - NODULE["col"]) * PIXEL_MM) ** 2)
    volume[distance_mm <= NODULE["radius_mm"]] = 40.0
    return volume


def phantom_datasets(order: str = "ascending"):
    """pydicom datasets for the phantom, in upload order."""
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid

    hu = phantom_hu()
    study, series, frame = generate_uid(), generate_uid(), generate_uid()
    datasets = []
    for index in range(SLICES):
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
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame
        ds.Modality = "CT"
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = ROWS, COLS
        ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 16, 15
        ds.PixelRepresentation = 1
        ds.SamplesPerPixel = 1
        ds.RescaleSlope, ds.RescaleIntercept = 1.0, -1024.0
        ds.PixelSpacing = [PIXEL_MM, PIXEL_MM]
        ds.SliceThickness = SLICE_MM
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [0.0, 0.0, START_Z + index * SLICE_MM]
        ds.SliceLocation = START_Z + index * SLICE_MM
        ds.InstanceNumber = index + 1
        ds.BodyPartExamined = "CHEST"
        ds.Manufacturer = "SYNTHETIC"
        ds.ManufacturerModelName = "Phantom"
        ds.PixelData = np.round(hu[index] + 1024).astype(np.int16).tobytes()
        datasets.append(ds)
    if order == "descending":
        datasets = list(reversed(datasets))
    return datasets


@pytest.fixture(scope="session")
def training_config():
    from training import config

    return config.load()


@pytest.fixture(scope="session")
def phantom():
    """A loaded phantom series: volume, lung mask, one labelled nodule, one small mark."""
    from training import series_loader as sl

    datasets = phantom_datasets()
    by_z = dict((round(float(ds.ImagePositionPatient[2]), 3), ds.SOPInstanceUID) for ds in datasets)
    nodule_z = START_Z + NODULE["k"] * SLICE_MM
    small_z = START_Z + SMALL_MARK["k"] * SLICE_MM
    label = {"patient": "LIDC-IDRI-9001", "series_uid": datasets[0].SeriesInstanceUID,
             "nodule_index": "0", "sop_uid": by_z[round(nodule_z, 3)],
             "cx": str(NODULE["col"]), "cy": str(NODULE["row"]), "z": str(nodule_z)}
    exclusions = [
        {"series_uid": label["series_uid"], "sop_uid": label["sop_uid"], "z": str(nodule_z),
         "x": str(NODULE["col"]), "y": str(NODULE["row"]), "kind": "nodule_rated"},
        {"series_uid": label["series_uid"], "sop_uid": by_z[round(small_z, 3)], "z": str(small_z),
         "x": str(SMALL_MARK["col"]), "y": str(SMALL_MARK["row"]), "kind": "nodule_small"},
    ]

    volume, ordering, gate = sl.volume_from_datasets(datasets)
    from lung_mask import build_lung_mask

    mask = build_lung_mask(volume)

    class Loaded(object):
        pass

    loaded = Loaded()
    loaded.series_uid = label["series_uid"]
    loaded.volume = volume
    loaded.lung_mask = mask
    loaded.ordering = ordering
    loaded.gate = gate
    loaded.label = label
    loaded.exclusion_rows = exclusions
    loaded.datasets = datasets

    targets = []
    point = sl.resolve_point(ordering, volume, label["sop_uid"], float(label["cx"]), float(label["cy"]),
                             float(label["z"]))
    i, j, k = point
    x_mm, y_mm, z_mm = volume.voxel_to_patient(i, j, k)
    targets.append(sl.NoduleTarget(key="0:0", i=i, j=j, k=k, x_mm=x_mm, y_mm=y_mm, z_mm=z_mm))
    loaded.targets = targets
    points = []
    for row in exclusions:
        p = sl.resolve_point(ordering, volume, row["sop_uid"], float(row["x"]), float(row["y"]), float(row["z"]))
        points.append(volume.voxel_to_patient(*p))
    loaded.exclusion_points_mm = np.asarray(points, dtype=np.float64)
    loaded.unresolved_labels = []
    loaded.unresolved_exclusions = 0
    return loaded


@pytest.fixture(autouse=True)
def _restore_torch_determinism():
    """The trainer turns deterministic algorithms on globally; put it back."""
    yield
    try:
        import torch

        torch.use_deterministic_algorithms(False)
    except Exception:  # noqa: BLE001
        pass
