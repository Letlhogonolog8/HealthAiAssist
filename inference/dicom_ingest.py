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

from uid_remap import UidRemapper

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


# UIDs that identify a class of object or an encoding, not an instance. Kept.
_UID_KEEP = frozenset((
    "SOPClassUID",
    "MediaStorageSOPClassUID",
    "TransferSyntaxUID",
    "ImplementationClassUID",
    "ReferencedSOPClassUID",
    "CodingSchemeUID",
))
# Instance UIDs a conformant object must carry, plus the references that hold
# the study/series/instance tree together. Remapped, not removed: randomising
# them is safe but destroys the grouping that makes a series a series, and a
# series cannot be assembled from objects whose SeriesInstanceUID was thrown
# away on the way in. See inference/uid_remap.py for why the mapping is keyed.
_UID_REMAP = frozenset((
    "SOPInstanceUID",
    "MediaStorageSOPInstanceUID",
    "StudyInstanceUID",
    "SeriesInstanceUID",
    "FrameOfReferenceUID",
    "SynchronizationFrameOfReferenceUID",
    "ReferencedSOPInstanceUID",
    "ReferencedFrameOfReferenceUID",
    "SourceImageSequence",
    "IrradiationEventUID",
    "ConcatenationUID",
))


def _scrub_uids(dataset: Any, remap: Any) -> None:
    """Applies the three-way UID policy, recursing into sequences.

    keep    class and transfer-syntax UIDs, which identify a kind of thing
            rather than a particular one
    remap   the instance identity and the references between instances, so
            the study/series/instance tree survives de-identification
    delete  every other UI element. An unrecognised UID is vendor-defined,
            undocumented and unreasonable to keep: there is no way to know
            what it points at or who can resolve it.
    """
    for element in list(dataset):
        if element.VR == "SQ":
            for item in element.value:
                _scrub_uids(item, remap)
            continue
        if element.VR != "UI":
            continue
        keyword = element.keyword
        if keyword in _UID_KEEP:
            continue
        if keyword in _UID_REMAP and element.value:
            dataset[element.tag].value = remap(str(element.value), kind=keyword)
        else:
            del dataset[element.tag]


def deidentify(dataset: Any, remapper: Any = None) -> Any:
    """Removes direct identifiers in place and returns the dataset.

    Private tags go wholesale. Their meaning is vendor-defined and undocumented,
    they routinely carry copies of the patient name, accession number and
    institution, and there is no way to reason about an unknown tag's contents —
    so the only defensible treatment is removal.

    UIDs are remapped through a keyed, salted function rather than randomised
    or hashed in the clear. Randomising is safe and destroys series grouping;
    hashing in the clear preserves grouping and reintroduces a join key back
    to the source PACS, because the UID space a site emits is small enough to
    enumerate. A salted HMAC gives both properties at once — see
    inference/uid_remap.py, including what happens when no salt is configured.

    `remapper` lets one ingestion share a context across every object in a
    series. Passing none creates a fresh one, which is equivalent for a single
    object because the mapping is deterministic under a configured salt.
    """
    remap = remapper if remapper is not None else UidRemapper()
    dataset.remove_private_tags()

    for keyword in _IDENTIFYING_KEYWORDS:
        if keyword in dataset:
            delattr(dataset, keyword)

    # Every UID that could join this object back to its source, wherever it
    # sits — top level or nested in a sequence such as ReferencedImageSequence.
    # Study, series and instance UIDs are remapped rather than deleted, so the
    # study/series/instance tree survives and a series can still be assembled;
    # the rest are deleted. Which is which is _UID_REMAP below.
    _scrub_uids(dataset, remap)
    if hasattr(dataset, "file_meta") and dataset.file_meta is not None:
        _scrub_uids(dataset.file_meta, remap)

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


# The conventional chest window: about -1350 to +150 HU. Aerated lung sits near
# -800 and the parenchyma spreads across most of the scale.
CT_LUNG_WINDOW = (-600.0, 1500.0)


def training_window(dataset: Any) -> tuple[float, float] | None:
    """The window a MODEL must see, overriding the display preset in the tags.

    WindowCenter and WindowWidth are a **display preference** — whatever preset
    was active when somebody exported the study. The stored pixel data is
    identical either way. A human reader re-windows at the workstation without
    thinking about it; a model cannot, and gets whatever was saved.

    That is not hypothetical. Across the 97 LIDC series downloaded so far, 40
    carry a soft-tissue window (WC 40/WW 400, 55/500, 45/400). Those clip
    everything below about -160 HU to black, and aerated lung is around -800 —
    so the entire lung field, nodule included, renders as featureless black. In
    38 of 97 series more than half the frame is near-black.

    Honouring the tags would therefore have trained the nodule model on solid
    black patches for roughly 40% of the collection, and the black-versus-not
    split follows the scanner and the site, so it would have been available to
    the model as a shortcut correlated with nothing clinical.

    Every caller that renders CT for a model must use this, training and serving
    alike. It lives here, in the module both import, so the two cannot drift.
    """
    modality = str(getattr(dataset, "Modality", "") or "").upper()
    return CT_LUNG_WINDOW if modality == "CT" else None


def _window(frame: np.ndarray, dataset: Any,
            force_window: tuple[float, float] | None = None) -> np.ndarray:
    """Maps stored values to 0-255 using the windowing the object specifies.

    Order is fixed by the standard: the modality LUT (slope and intercept, which
    for CT produces Hounsfield units) before the VOI LUT (window centre and
    width). Applying them the other way round, or skipping the rescale, gives an
    image that looks plausible and is wrong — which is the failure mode that
    matters, because nothing downstream can detect it.

    `force_window` overrides the tags entirely — see `training_window` for why
    any model-facing caller should pass one for CT.
    """
    frame = frame.astype(np.float64)

    slope = float(getattr(dataset, "RescaleSlope", 1) or 1)
    intercept = float(getattr(dataset, "RescaleIntercept", 0) or 0)
    frame = frame * slope + intercept

    if force_window is not None:
        centre, width = float(force_window[0]), float(force_window[1])
        low = centre - width / 2.0
        scaled = np.clip((frame - low) / width, 0.0, 1.0) * 255.0
        if str(getattr(dataset, "PhotometricInterpretation", "")).strip() == "MONOCHROME1":
            scaled = 255.0 - scaled
        return scaled.astype(np.uint8)

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
        # No VOI LUT in the object, which is common — many CT exports carry none.
        #
        # This used to fall back to the full stored range. For CT that is
        # radiologically wrong: the range runs from about -1000 HU (air) to
        # +3000 (bone), so mapping all of it onto 0-255 compresses lung
        # parenchyma into roughly the bottom fifth of the scale. The result is a
        # flat grey image in which the anatomy a chest reader looks at is nearly
        # black. No radiologist views a chest that way.
        #
        # A modality-appropriate default is not "inventing an acquisition
        # parameter" — it is applying the presentation the anatomy is
        # conventionally read at, which is what the absent tag would have
        # specified. Lung window for CT, because this pipeline's CT interest is
        # chest.
        #
        # The windowing is fixed because it was wrong, not because of what any
        # model does with the result. (An earlier version of this comment
        # reported that the legacy lung model refused a CT at either window,
        # 22.9 and 25.0 against 16.51. Those figures came from pydicom's small
        # 1990s test object; on LIDC-IDRI chest CT the same model accepts the
        # image at either window — see MODEL_CARDS.md — which is why it no
        # longer serves. The windowing question and the model question are
        # separate, and this function answers only the first.)
        modality = str(getattr(dataset, "Modality", "") or "").upper()
        if modality == "CT":
            centre, width = CT_LUNG_WINDOW
        else:
            # For MR and everything else there is no universal window: signal
            # intensity is sequence-dependent and has no absolute scale the way
            # Hounsfield units do. Percentiles rather than min/max, so a single
            # bright artefact does not wash out the rest of the image.
            low = float(np.percentile(frame, 1))
            high = float(np.percentile(frame, 99))
            centre = (high + low) / 2.0
            width = max(high - low, 1.0)

    low = centre - width / 2.0
    scaled = np.clip((frame - low) / width, 0.0, 1.0) * 255.0

    # MONOCHROME1 stores minimum as white. Left uninverted, a chest image arrives
    # as its own photographic negative.
    if str(getattr(dataset, "PhotometricInterpretation", "")).strip() == "MONOCHROME1":
        scaled = 255.0 - scaled

    return scaled.astype(np.uint8)


def _first_float(value: Any, default: float | None = None) -> float | None:
    """A DICOM value that may be a scalar or a multi-value, as one float."""
    try:
        if value is None:
            return default
        if hasattr(value, "__iter__") and not isinstance(value, (str, bytes)):
            value = list(value)
            if not value:
                return default
            value = value[0]
        return float(value)
    except (TypeError, ValueError):
        return default


def dicom_to_model_frame(data: bytes, remapper: Any = None) -> tuple[np.ndarray, dict, bytes]:
    """DICOM bytes to the frame a model sees, the acquisition record, and the
    de-identified object.

    Three things come back, and the order they are produced in is the point:

      1. The 8-bit frame, rendered with `training_window()` for the modality —
         for CT that is the lung window regardless of the display preset saved
         in the tags. Every model in this repository that reads CT was trained
         on frames rendered by this function with this override, and a serving
         path that honoured the tags instead would hand the model a black lung
         field on roughly 40% of series (see `training_window`). This used to be
         exactly what `dicom_to_png_bytes` did; found and fixed 2026-09-21.

      2. What was learned about the acquisition — modality, geometry, scanner,
         and the window actually applied — so the caller can record which
         scanner and which rendering produced a result. Kept free of identity.

      3. The de-identified object, serialised, so that the caller can persist
         THAT rather than the upload. Until this existed the only de-identified
         copy was transient, and the bytes written to storage were the ones
         that arrived — patient name and all (DPIA R-19).
    """
    import pydicom

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
    forced = training_window(dataset)
    windowed = _window(frame, dataset, force_window=forced)

    # Geometry, read before de-identification only because de-identification
    # does not touch it; recorded so a later series pipeline can validate it.
    spacing = getattr(dataset, "PixelSpacing", None)
    acquisition = {
        "modality": modality,
        "rows": int(getattr(dataset, "Rows", frame.shape[0])),
        "columns": int(getattr(dataset, "Columns", frame.shape[1])),
        "manufacturer": str(getattr(dataset, "Manufacturer", "") or ""),
        "manufacturerModel": str(getattr(dataset, "ManufacturerModelName", "") or ""),
        "photometricInterpretation": str(getattr(dataset, "PhotometricInterpretation", "") or ""),
        "bodyPartExamined": str(getattr(dataset, "BodyPartExamined", "") or ""),
        "sliceThicknessMm": _first_float(getattr(dataset, "SliceThickness", None)),
        "pixelSpacingMm": (
            [float(spacing[0]), float(spacing[1])]
            if spacing is not None and len(spacing) >= 2 else None
        ),
        "convolutionKernel": str(getattr(dataset, "ConvolutionKernel", "") or ""),
        "windowApplied": (
            {"center": forced[0], "width": forced[1], "source": "training_window"}
            if forced is not None
            else {"center": _first_float(getattr(dataset, "WindowCenter", None)),
                  "width": _first_float(getattr(dataset, "WindowWidth", None)),
                  "source": "tags_or_percentile"}
        ),
        "patientIdentityRemoved": True,
        "frames": int(pixels.shape[0]) if pixels.ndim >= 3 and pixels.shape[-1] not in (3, 4) else 1,
    }

    deidentify(dataset, remapper)

    # Read back AFTER de-identification, so what the caller receives is the
    # remapped identity and the original can never be returned by this path.
    acquisition["deidentifiedUids"] = {
        "studyInstanceUid": str(getattr(dataset, "StudyInstanceUID", "") or ""),
        "seriesInstanceUid": str(getattr(dataset, "SeriesInstanceUID", "") or ""),
        "sopInstanceUid": str(getattr(dataset, "SOPInstanceUID", "") or ""),
    }

    out = io.BytesIO()
    try:
        # write_like_original=False rewrites a conformant Part 10 file with the
        # preamble and meta group, which is what a downstream reader expects.
        dataset.save_as(out, write_like_original=False)
        deidentified = out.getvalue()
    except Exception as exc:  # noqa: BLE001
        # A dataset that cannot be re-serialised cannot be stored de-identified,
        # and storing the original instead is the one thing this must not do.
        raise DicomRejected(f"The de-identified object could not be written: {exc}") from exc

    return windowed, acquisition, deidentified


def dicom_to_png_bytes(data: bytes) -> tuple[bytes, dict]:
    """DICOM bytes to PNG bytes, plus what was learned about the acquisition.

    Returns PNG rather than a numpy array so the result flows through exactly
    the same preprocessing as an uploaded photograph — one code path to the
    model, not two. The rendering is `dicom_to_model_frame`'s, so it carries
    the same windowing guarantee.
    """
    from PIL import Image

    windowed, acquisition, _deidentified = dicom_to_model_frame(data)
    image = Image.fromarray(windowed).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue(), acquisition
