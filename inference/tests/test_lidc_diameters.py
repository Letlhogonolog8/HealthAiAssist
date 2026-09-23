"""
scripts/lidc_extract_diameters.py: size from the boundaries readers drew.

Every fixture here is SYNTHETIC XML built in the test, shaped like the LIDC
annotation format. No real patient data is used, and no clinical value is
asserted as correct — the assertions are about geometry the test itself
defines (a 10-pixel square is 10 pixels across), never about what a nodule
ought to measure.

The measurements are reader-derived. They come from boundaries radiologists
drew by eye, not from a validated segmentation, and the tests check that the
output says so.
"""
from __future__ import annotations

import importlib.util
import math
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load():
    path = os.path.join(ROOT, "scripts", "lidc_extract_diameters.py")
    spec = importlib.util.spec_from_file_location("lidc_extract_diameters", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diameters = _load()


# ── synthetic XML, clearly labelled as such ────────────────────────────────

def _roi(z, sop, points):
    edges = "".join(f"<edgeMap><xCoord>{x}</xCoord><yCoord>{y}</yCoord></edgeMap>"
                    for x, y in points)
    return (f"<roi><imageZposition>{z}</imageZposition>"
            f"<imageSOP_UID>{sop}</imageSOP_UID>{edges}</roi>")


def _nodule(malignancy, rois):
    return (f"<unblindedReadNodule><noduleID>syn</noduleID>"
            f"<characteristics><malignancy>{malignancy}</malignancy></characteristics>"
            f"{''.join(rois)}</unblindedReadNodule>")


def _xml(sessions, series_uid="1.2.3.4.5.synthetic"):
    """A synthetic LidcReadMessage. Not real patient data."""
    body = "".join(f"<readingSession>{''.join(n)}</readingSession>" for n in sessions)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<LidcReadMessage xmlns="http://www.nih.gov">'
        f"<ResponseHeader><SeriesInstanceUid>{series_uid}</SeriesInstanceUid></ResponseHeader>"
        f"{body}</LidcReadMessage>"
    )


def _write(tmp_path, xml, name="synthetic.xml"):
    path = tmp_path / name
    path.write_text(xml, encoding="utf-8")
    return str(path)


def square(size, origin=(100, 100), points_per_side=1):
    """A closed square contour. Its longest chord is the diagonal."""
    x0, y0 = origin
    return [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size)]


# ── the geometry, checked against shapes the test defines ──────────────────

def test_the_area_of_a_square_contour_is_the_square_of_its_side():
    assert diameters.polygon_area_px(square(10)) == pytest.approx(100.0)


def test_area_is_independent_of_the_direction_the_reader_drew_in():
    clockwise = square(10)
    assert diameters.polygon_area_px(list(reversed(clockwise))) == pytest.approx(100.0)


def test_the_longest_chord_of_a_square_is_its_diagonal():
    assert diameters.max_pairwise_distance(square(10)) == pytest.approx(10 * math.sqrt(2))


def test_a_contour_of_fewer_than_three_points_has_no_area():
    assert diameters.polygon_area_px([(1, 1), (2, 2)]) == 0.0
    assert diameters.polygon_area_px([(1, 1)]) == 0.0


def test_anisotropic_pixels_scale_the_two_axes_separately():
    """A pixel 0.5 mm tall and 1.0 mm wide makes a horizontal 10-pixel run
    10 mm and a vertical one 5 mm. Applying a single spacing would get one of
    them wrong by a factor of two."""
    horizontal = [(0, 0), (10, 0)]
    vertical = [(0, 0), (0, 10)]
    assert diameters.max_pairwise_distance(horizontal, row_mm=0.5, col_mm=1.0) == pytest.approx(10.0)
    assert diameters.max_pairwise_distance(vertical, row_mm=0.5, col_mm=1.0) == pytest.approx(5.0)


# ── one reader ─────────────────────────────────────────────────────────────

def test_a_single_reader_contour_is_measured():
    reading = {"contours": [{"z": -100.0, "points": square(10)}]}
    result = diameters.measure_reading(reading)

    assert result["max_in_plane_diameter_px"] == pytest.approx(10 * math.sqrt(2), abs=1e-3)
    assert result["equivalent_area_diameter_px"] == pytest.approx(
        2 * math.sqrt(100 / math.pi), abs=1e-3
    )
    assert result["contour_slices"] == 1
    assert result["max_in_plane_diameter_mm"] is None, "no spacing supplied, so no millimetres"


def test_millimetres_appear_only_when_spacing_is_supplied():
    reading = {"contours": [{"z": -100.0, "points": [(0, 0), (10, 0), (10, 1), (0, 1)]}]}
    result = diameters.measure_reading(reading, row_mm=0.5, col_mm=0.5)

    assert result["max_in_plane_diameter_mm"] is not None
    assert result["max_in_plane_diameter_mm"] == pytest.approx(
        result["max_in_plane_diameter_px"] * 0.5, abs=1e-3
    )


def test_the_largest_slice_is_the_one_measured():
    reading = {"contours": [
        {"z": -102.0, "points": square(4)},
        {"z": -100.0, "points": square(12)},
        {"z": -98.0, "points": square(6)},
    ]}
    result = diameters.measure_reading(reading)

    assert result["max_in_plane_diameter_px"] == pytest.approx(12 * math.sqrt(2), abs=1e-3)
    assert result["contour_slices"] == 3
    assert result["slice_span_mm"] == pytest.approx(4.0)


# ── missing, malformed, degenerate ─────────────────────────────────────────

def test_a_reader_with_no_contour_is_unmeasurable_not_zero():
    """A nodule under 3 mm is marked as a single point in LIDC. Zero is a
    number somebody will later average; None is not."""
    assert diameters.measure_reading({"contours": []}) is None
    assert diameters.measure_reading({"contours": [{"z": 1.0, "points": [(5, 5)]}]}) is None


def test_a_degenerate_contour_with_no_enclosed_area_is_unmeasurable():
    """Three collinear points enclose nothing. A diameter from that is not a
    measurement."""
    collinear = {"contours": [{"z": 1.0, "points": [(0, 0), (5, 0), (10, 0)]}]}
    assert diameters.measure_reading(collinear) is None


def test_no_measurement_is_ever_non_positive():
    reading = {"contours": [{"z": 1.0, "points": square(3)}]}
    result = diameters.measure_reading(reading)
    assert result["max_in_plane_diameter_px"] > 0
    assert result["equivalent_area_diameter_px"] > 0


# ── multiple readers ───────────────────────────────────────────────────────

def test_the_aggregate_is_the_median_across_readers():
    """The convention lidc_build_labels.py already uses for malignancy."""
    measurements = [
        {"max_in_plane_diameter_px": 10.0},
        {"max_in_plane_diameter_px": 12.0},
        {"max_in_plane_diameter_px": 40.0},
    ]
    assert diameters.aggregate(measurements, "max_in_plane_diameter_px") == 12.0


def test_a_reader_who_drew_nothing_does_not_drag_the_aggregate_down():
    measurements = [
        {"max_in_plane_diameter_mm": 8.0},
        {"max_in_plane_diameter_mm": None},
        {"max_in_plane_diameter_mm": 10.0},
    ]
    assert diameters.aggregate(measurements, "max_in_plane_diameter_mm") == 9.0


def test_an_aggregate_of_nothing_is_none():
    assert diameters.aggregate([{"max_in_plane_diameter_mm": None}], "max_in_plane_diameter_mm") is None


# ── parsing, identity and provenance ───────────────────────────────────────

def test_contours_survive_the_parse(tmp_path):
    xml = _xml([[_nodule(4, [_roi(-100.0, "1.2.840.sop", square(10))])]])
    series_uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))

    assert series_uid == "1.2.3.4.5.synthetic"
    assert len(readings) == 1
    assert readings[0]["malignancy"] == 4
    assert readings[0]["contours"][0]["points"] == square(10)


def test_a_nodule_without_characteristics_is_skipped(tmp_path):
    """Mirrors the existing pipeline: an unread nodule is not a measurement."""
    xml = _xml([[
        "<unblindedReadNodule><noduleID>x</noduleID>"
        + _roi(-100.0, "sop", square(10))
        + "</unblindedReadNodule>"
    ]])
    _uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))
    assert readings == []


def test_a_malformed_edge_coordinate_is_dropped_not_guessed(tmp_path):
    xml = _xml([[_nodule(3, [
        "<roi><imageZposition>-100.0</imageZposition><imageSOP_UID>sop</imageSOP_UID>"
        "<edgeMap><xCoord>abc</xCoord><yCoord>100</yCoord></edgeMap>"
        "<edgeMap><xCoord>110</xCoord><yCoord>100</yCoord></edgeMap>"
        "<edgeMap><xCoord>110</xCoord><yCoord>110</yCoord></edgeMap>"
        "<edgeMap><xCoord>100</xCoord><yCoord>110</yCoord></edgeMap></roi>"
    ])]])
    _uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))

    assert len(readings) == 1
    assert len(readings[0]["contours"][0]["points"]) == 3, "the unparseable point is dropped"


def test_a_roi_with_no_z_position_does_not_produce_a_reading(tmp_path):
    xml = _xml([[_nodule(4, [
        "<roi><imageSOP_UID>sop</imageSOP_UID>"
        "<edgeMap><xCoord>100</xCoord><yCoord>100</yCoord></edgeMap></roi>"
    ])]])
    _uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))
    assert readings == []


def test_two_readers_of_one_nodule_are_kept_apart_before_aggregation(tmp_path):
    """Two reading sessions describing the same place. Both must reach the
    aggregate as separate readers rather than being merged at parse time."""
    xml = _xml([
        [_nodule(4, [_roi(-100.0, "sop-a", square(10))])],
        [_nodule(5, [_roi(-100.0, "sop-b", square(14))])],
    ])
    _uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))

    assert len(readings) == 2
    measurements = [diameters.measure_reading(r) for r in readings]
    assert measurements[0]["max_in_plane_diameter_px"] != measurements[1]["max_in_plane_diameter_px"]


def test_one_reader_marking_two_separate_nodules_yields_two_readings(tmp_path):
    xml = _xml([[
        _nodule(4, [_roi(-100.0, "sop-a", square(10, origin=(100, 100)))]),
        _nodule(2, [_roi(-100.0, "sop-b", square(8, origin=(300, 300)))]),
    ]])
    _uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))
    assert len(readings) == 2


def test_the_series_uid_travels_with_the_measurement(tmp_path):
    """Patient and series association is what makes a measurement joinable to
    the label table at all."""
    xml = _xml([[_nodule(4, [_roi(-100.0, "sop", square(10))])]], series_uid="1.9.9.9")
    series_uid, readings = diameters.parse_contour_readings(_write(tmp_path, xml))
    assert series_uid == "1.9.9.9"
    assert readings


# ── determinism ────────────────────────────────────────────────────────────

def test_repeated_measurement_of_one_reading_is_identical():
    reading = {"contours": [
        {"z": -100.0, "points": square(11, origin=(37, 41))},
        {"z": -97.5, "points": square(9, origin=(37, 41))},
    ]}
    results = [diameters.measure_reading(reading, 0.7, 0.7) for _ in range(5)]
    assert all(r == results[0] for r in results)


def test_repeated_parses_of_one_file_are_identical(tmp_path):
    xml = _xml([[_nodule(4, [_roi(-100.0, "sop", square(10))])]])
    path = _write(tmp_path, xml)
    first = diameters.parse_contour_readings(path)
    for _ in range(3):
        assert diameters.parse_contour_readings(path) == first


# ── provenance is in the output, not only in the docstring ─────────────────

def test_the_output_columns_name_the_measurement_and_its_aggregation():
    for column in ("measurement_source", "aggregation", "unmeasurable_reason"):
        assert column in diameters.FIELDNAMES

    for column in ("max_in_plane_diameter_mm", "equivalent_area_diameter_mm",
                   "max_in_plane_diameter_px", "equivalent_area_diameter_px",
                   "slice_span_mm"):
        assert column in diameters.FIELDNAMES, column


def test_diameter_and_span_are_separate_columns():
    """A through-plane span is not a diameter and must not be readable as
    one."""
    assert "slice_span_mm" in diameters.FIELDNAMES
    assert "max_in_plane_diameter_mm" in diameters.FIELDNAMES
    assert not any("radius" in f for f in diameters.FIELDNAMES)
    assert not any("volume" in f for f in diameters.FIELDNAMES)


# ── the spacing index ──────────────────────────────────────────────────────
#
# The first version looked up each series by re-globbing the whole collection
# and reading objects until it matched, which is O(series x objects). Measured
# against the real 37,970-object collection, one lookup for a series near the
# end of the tree took 474 seconds; 217 series would have been roughly
# fourteen hours. Correct and unusable, and invisible to a synthetic fixture.

def test_the_spacing_index_reads_one_object_per_directory(tmp_path, monkeypatch):
    """Every series indexed from a single pass, reading one object per series
    directory rather than rescanning the collection for each series."""
    import pydicom

    root = tmp_path / "dicom"
    for series in ("a", "b", "c"):
        (root / series).mkdir(parents=True)
        for n in range(5):
            (root / series / f"{n}.dcm").write_bytes(b"synthetic")

    reads = []

    class FakeDataset:
        def __init__(self, uid):
            self.SeriesInstanceUID = uid
            self.PixelSpacing = [0.7, 0.8]

    def fake_dcmread(path, **kwargs):
        reads.append(path)
        return FakeDataset("uid-" + os.path.basename(os.path.dirname(path)))

    monkeypatch.setattr(pydicom, "dcmread", fake_dcmread)
    index = diameters.build_pixel_spacing_index(str(root))

    assert set(index) == {"uid-a", "uid-b", "uid-c"}, "every series indexed"
    assert index["uid-a"] == (0.7, 0.8), "row spacing then column spacing"
    assert len(reads) == 3, (
        f"one read per series directory, not per file or per lookup; got {len(reads)}"
    )


def test_a_directory_whose_objects_are_unreadable_is_skipped(tmp_path, monkeypatch):
    import pydicom

    root = tmp_path / "dicom"
    (root / "broken").mkdir(parents=True)
    (root / "broken" / "0.dcm").write_bytes(b"synthetic")

    def raising_dcmread(path, **kwargs):
        raise ValueError("not a DICOM object")

    monkeypatch.setattr(pydicom, "dcmread", raising_dcmread)
    assert diameters.build_pixel_spacing_index(str(root)) == {}


def test_an_absent_dicom_root_yields_an_empty_index_not_an_error():
    assert diameters.build_pixel_spacing_index(None) == {}
    assert diameters.build_pixel_spacing_index("/no/such/path") == {}


def test_a_series_missing_from_the_index_gets_blank_millimetres():
    """Blank, never an assumed spacing: LIDC in-plane spacing runs 0.5-0.9 mm
    and guessing would put a 30% error into the localisation tolerance."""
    reading = {"contours": [{"z": -100.0, "points": square(10)}]}
    row_mm, col_mm = {}.get("missing-uid", (None, None))
    result = diameters.measure_reading(reading, row_mm, col_mm)

    assert result["max_in_plane_diameter_px"] > 0
    assert result["max_in_plane_diameter_mm"] is None
    assert result["equivalent_area_diameter_mm"] is None
