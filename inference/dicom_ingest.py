"""
DICOM in, model input out — and the patient's identity left behind.

Radiology hardware already emits DICOM. A CT or CR unit installed in a district
hospital speaks this protocol today, to a PACS that may not be read for days.
Accepting DICOM is what lets an AI triage queue sit behind existing equipment
without replacing any of it, which is the modernisation the Challenge problem
statement describes.

Three jobs here, in this order, and the order matters:

  1. Recognise a DICOM object from its bytes, not from a filename or a
     client-declared MIME type.
  2. Strip the identity. Before anything is stored, before anything leaves the
     clinic network.
  3. Render the pixels into what the model expects, applying the windowing the
     tags actually specify rather than a guess.

── What this does NOT do, stated plainly ──────────────────────────────────

It does not remove **burned-in annotation**: text rendered into the pixel data
itself, which is common on ultrasound, secondary captures and anything that
passed through a workstation. No tag edit can remove those, and detecting them
reliably needs OCR. The Basic Profile's own answer is the `BurnedInAnnotation`
tag, so this refuses any object that declares `YES` — but that tag is frequently
absent or wrong, so its absence is not evidence of anything.

It is a best-effort implementation of the PS3.15 Basic Application Level
Confidentiality Profile tag list, not a validated or certified one. It has not
been assessed against a reference implementation. Anything leaving a clinic
under a data-sharing agreement needs a de-identification step somebody has
actually tested, and this is not yet that.
"""
from __future__ import annotations

import io
from typing import Any

import numpy as np

DICOM_MAGIC_OFFSET = 128
DICOM_MAGIC = b"DICM"


class DicomRejected(Exception):
    """The object is DICOM, and is not something that should be classified."""


def looks_like_dicom(data: bytes) -> bool:
    """True when the bytes carry the DICM preamble marker.

    Checked against the bytes rather than a filename or the Content-Type the
    client sent, both of which are attacker-controlled and, more mundanely,
    frequently just wrong — modalities and PACS exports use .dcm, .dic, no
    extension at all, and application/octet-stream.
    """
    return len(data) > DICOM_MAGIC_OFFSET + 4 and (
        data[DICOM_MAGIC_OFFSET : DICOM_MAGIC_OFFSET + 4] == DICOM_MAGIC
    )


# PS3.15 Table E.1-1, Basic Application Level Confidentiality Profile.
#
# Kept as explicit keywords rather than a wildcard sweep, because a sweep
# removes tags the pipeline needs — Modality, PhotometricInterpretation,
# RescaleSlope — and produces an object no longer readable as an image.
_IDENTIFYING_KEYWORDS = (
    "AccessionNumber",
    "AcquisitionComments",
    "AdditionalPatientHistory",
    "AdmissionID",
    "AdmittingDiagnosesDescription",
    "Allergies",
    "BranchOfService",
    "CountryOfResidence",
    "CurrentPatientLocation",
    "DeviceSerialNumber",
    "EthnicGroup",
    "FillerOrderNumberImagingServiceRequest",
    "InstitutionAddress",
    "InstitutionName",
    "InstitutionalDepartmentName",
    "InsurancePlanIdentification",
    "IssuerOfPatientID",
    "MedicalRecordLocator",
    "MilitaryRank",
    "NameOfPhysiciansReadingStudy",
    "Occupation",
    "OtherPatientIDs",
    "OtherPatientNames",
    "PatientAddress",
    "PatientBirthDate",
    "PatientBirthTime",
    "PatientComments",
    "PatientID",
    "PatientInsurancePlanCodeSequence",
    "PatientMotherBirthName",
    "PatientName",
    "PatientReligiousPreference",
    "PatientTelephoneNumbers",
    "PerformingPhysicianName",
    "PersonName",
    "PhysiciansOfRecord",
    "ReferringPhysicianAddress",
    "ReferringPhysicianName",
    "ReferringPhysicianTelephoneNumbers",
    "RegionOfResidence",
    "RequestingPhysician",
    "ResponsibleOrganization",
    "ResponsiblePerson",
    "StationName",
    "StudyID",
)

# Kept, and why: each one changes how the pixels must be read, or describes the
# acquisition rather than the person.
_KEEP = (
    "Modality",
    "PhotometricInterpretation",
    "RescaleSlope",
    "RescaleIntercept",
    "WindowCenter",
    "WindowWidth",
    "BitsAllocated",
    "BitsStored",
    "PixelRepresentation",
    "SamplesPerPixel",
    "Rows",
    "Columns",
    "Manufacturer",
    "ManufacturerModelName",
)


def deidentify(dataset: Any) -> Any:
    """Removes direct identifiers in place and returns the dataset.

    Private tags go wholesale. Their meaning is vendor-defined and undocumented,
    they routinely carry copies of the patient name, accession number and
    institution, and there is no way to reason about an unknown tag's contents —
    so the only defensible treatment is removal.

    UIDs are removed rather than remapped. Remapping preserves the ability to
    group a study, which is genuinely useful and is what a research pipeline
    would do; it also preserves a join key back to the source PACS. Since
    nothing here needs study grouping yet, the safer option costs nothing.
    """
    dataset.remove_private_tags()

    for keyword in _IDENTIFYING_KEYWORDS:
        if keyword in dataset:
            delattr(dataset, keyword)

    for keyword in ("StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID", "FrameOfReferenceUID"):
        if keyword in dataset:
            delattr(dataset, keyword)

    # Dates and times are quasi-identifiers: a study date plus a modality plus a
    # postal district is frequently enough to re-identify. Kept only to the year.
    for keyword in ("StudyDate", "SeriesDate", "AcquisitionDate", "ContentDate"):
        value = getattr(dataset, keyword, None)
        if value and len(str(value)) >= 4:
            setattr(dataset, keyword, f"{str(value)[:4]}0101")

    for keyword in ("StudyTime", "SeriesTime", "AcquisitionTime", "ContentTime"):
        if keyword in dataset:
            delattr(dataset, keyword)

    dataset.PatientIdentityRemoved = "YES"
    # VR LO caps at 64 characters. A longer value is written but is
    # non-conformant, and pydicom warns about it — the full description of what
    # this method does and does not cover is in this module's docstring, which is
    # where it belongs anyway.
    dataset.DeidentificationMethod = "HealthAI best-effort PS3.15 Basic Profile"
    return dataset


def _select_frame(pixels: np.ndarray) -> np.ndarray:
    """One 2-D frame from whatever the object contained.

    Multi-frame objects take the middle slice. That is a placeholder, and an
    honest one: a real CT triage pipeline reads the whole volume and this model
    takes a single 224x224 image. The middle frame is the least-arbitrary single
    choice, and a volume-aware model is the actual answer.
    """
    if pixels.ndim == 2:
        return pixels
    if pixels.ndim == 3:
        # Colour (rows, cols, 3) versus multi-frame (frames, rows, cols).
        if pixels.shape[-1] in (3, 4):
            return pixels[..., 0]
        return pixels[pixels.shape[0] // 2]
    if pixels.ndim == 4:
        return pixels[pixels.shape[0] // 2][..., 0]
    raise DicomRejected(f"Unsupported pixel array shape {pixels.shape}")


def _window(frame: np.ndarray, dataset: Any) -> np.ndarray:
    """Maps stored values to 0-255 using the windowing the object specifies.

    Order is fixed by the standard: the modality LUT (slope and intercept, which
    for CT produces Hounsfield units) before the VOI LUT (window centre and
    width). Applying them the other way round, or skipping the rescale, gives an
    image that looks plausible and is wrong — which is the failure mode that
    matters, because nothing downstream can detect it.
    """
    frame = frame.astype(np.float64)

    slope = float(getattr(dataset, "RescaleSlope", 1) or 1)
    intercept = float(getattr(dataset, "RescaleIntercept", 0) or 0)
    frame = frame * slope + intercept

    centre = getattr(dataset, "WindowCenter", None)
    width = getattr(dataset, "WindowWidth", None)

    # Either may be multi-valued; the first is the default presentation.
    if isinstance(centre, (list, tuple)) or hasattr(centre, "__iter__") and not isinstance(centre, (str, bytes)):
        centre = list(centre)[0] if len(list(centre)) else None
    if isinstance(width, (list, tuple)) or hasattr(width, "__iter__") and not isinstance(width, (str, bytes)):
        width = list(width)[0] if len(list(width)) else None

    if centre is not None and width is not None and float(width) > 0:
        centre = float(centre)
        width = float(width)
    else:
        # No VOI LUT in the object. Full range rather than a modality-specific
        # guess: assuming a lung window on an object that never said so would be
        # inventing an acquisition parameter, and the OOD screen downstream is a
        # better place to catch an image the model cannot read.
        low, high = float(frame.min()), float(frame.max())
        centre = (high + low) / 2.0
        width = max(high - low, 1.0)

    low = centre - width / 2.0
    scaled = np.clip((frame - low) / width, 0.0, 1.0) * 255.0

    # MONOCHROME1 stores minimum as white. Left uninverted, a chest image arrives
    # as its own photographic negative.
    if str(getattr(dataset, "PhotometricInterpretation", "")).strip() == "MONOCHROME1":
        scaled = 255.0 - scaled

    return scaled.astype(np.uint8)


def dicom_to_png_bytes(data: bytes) -> tuple[bytes, dict]:
    """DICOM bytes to PNG bytes, plus what was learned about the acquisition.

    Returns PNG rather than a numpy array so the result flows through exactly
    the same preprocessing as an uploaded photograph — one code path to the
    model, not two.
    """
    import pydicom
    from PIL import Image

    try:
        dataset = pydicom.dcmread(io.BytesIO(data), force=True)
    except Exception as exc:  # noqa: BLE001
        raise DicomRejected(f"Could not read this as DICOM: {exc}") from exc

    if str(getattr(dataset, "BurnedInAnnotation", "")).strip().upper() == "YES":
        raise DicomRejected(
            "This object declares burned-in annotation, which may include patient "
            "identifiers rendered into the image. It was not accepted."
        )

    modality = str(getattr(dataset, "Modality", "") or "")

    try:
        pixels = dataset.pixel_array
    except Exception as exc:  # noqa: BLE001
        # Usually a compressed transfer syntax with no decoder installed.
        raise DicomRejected(
            f"The pixel data could not be decoded ({exc}). The transfer syntax may "
            "need an additional decoder."
        ) from exc

    frame = _select_frame(pixels)
    windowed = _window(frame, dataset)

    deidentify(dataset)

    image = Image.fromarray(windowed).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    return buffer.getvalue(), {
        "modality": modality,
        "rows": int(getattr(dataset, "Rows", frame.shape[0])),
        "columns": int(getattr(dataset, "Columns", frame.shape[1])),
        "manufacturer": str(getattr(dataset, "Manufacturer", "") or ""),
        "manufacturerModel": str(getattr(dataset, "ManufacturerModelName", "") or ""),
        "photometricInterpretation": str(getattr(dataset, "PhotometricInterpretation", "") or ""),
        "patientIdentityRemoved": True,
        "frames": int(pixels.shape[0]) if pixels.ndim >= 3 and pixels.shape[-1] not in (3, 4) else 1,
    }
