"""
inference/lung_mask.py: the region a candidate is allowed to be proposed in.

Two things are being tested. That the constraint finds a lung-shaped region in
something lung-shaped, and — more importantly — that it says so out loud when
it cannot. An empty mask and a missing mask mean opposite things to a
detector, and once both are an array of False the difference is gone.

The fixtures here are synthetic phantoms built in the test: two low-density
discs in a dense block, at known Hounsfield values. Nothing asserts a clinical
property of a real lung.
"""
from __future__ import annotations

import numpy as np
import pytest

from lung_mask import (
    LUNG_HU_MAX,
    OUT_OF_FIELD_HU,
    LUNG_HU_MIN,
    MASK_VERSION,
    MAX_LUNG_FRACTION,
    MIN_LUNG_FRACTION,
    LungMask,
    LungMaskUnavailable,
    build_lung_mask,
)


class FakeVolume:
    """Just enough of CtVolume for the mask. Synthetic, not patient data."""

    def __init__(self, array):
        self.array = array
        self.slice_spacing_mm = 2.5
        self.shape = array.shape


def phantom(slices=6, size=64, lung_hu=-800.0, body_hu=40.0, air_hu=-1000.0, radius=12):
    """A dense block with two aerated discs in it, surrounded by air.

    The surrounding air reaches the frame edge, as it does in a real
    acquisition, so the border rule has something to exclude.
    """
    array = np.full((slices, size, size), air_hu, dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]

    # The patient: a dense square that does not touch the frame edge.
    body = (yy > 6) & (yy < size - 6) & (xx > 6) & (xx < size - 6)
    for k in range(slices):
        array[k][body] = body_hu

    for centre_x in (size // 2 - 14, size // 2 + 14):
        disc = (yy - size // 2) ** 2 + (xx - centre_x) ** 2 <= radius ** 2
        for k in range(slices):
            array[k][disc] = lung_hu
    return FakeVolume(array)


# ── the ordinary case ──────────────────────────────────────────────────────

def test_a_lung_shaped_phantom_produces_a_mask():
    result = build_lung_mask(phantom())

    assert isinstance(result, LungMask)
    assert result.version == MASK_VERSION
    assert result.voxel_count > 0
    assert MIN_LUNG_FRACTION <= result.lung_fraction <= MAX_LUNG_FRACTION


def test_the_mask_covers_the_aerated_regions_and_not_the_dense_block():
    volume = phantom(size=64)
    result = build_lung_mask(volume, dilation_voxels=0)

    # The discs specifically, not everything below the ceiling: the air
    # around the patient is in the same HU band and is correctly excluded.
    discs = (volume.array[0] >= LUNG_HU_MIN) & (volume.array[0] <= LUNG_HU_MAX)
    size = volume.array.shape[1]
    yy, xx = np.mgrid[0:size, 0:size]
    interior = (yy > 6) & (yy < size - 6) & (xx > 6) & (xx < size - 6)
    discs &= interior

    assert result.mask[0][discs].mean() > 0.9, "the aerated discs are kept"
    dense = volume.array[0] > 0
    assert result.mask[0][dense].mean() < 0.2, "the dense block is mostly excluded"


def test_the_air_around_the_patient_is_excluded():
    """Air outside the body is in the same HU band as lung; what separates
    them is that it reaches the edge of the frame."""
    volume = phantom(size=64)
    result = build_lung_mask(volume, dilation_voxels=0)

    assert not result.mask[0, 0, 0], "the frame corner is outside the patient"
    assert not result.mask[0, 0, :].any(), "nor is the top edge lung"


def test_the_mask_is_grown_so_a_nodule_against_the_pleura_survives():
    """A juxtapleural nodule is dense and touches the boundary, so a bare
    threshold cuts it out. Erring towards keeping a true finding."""
    volume = phantom()
    tight = build_lung_mask(volume, dilation_voxels=0)
    grown = build_lung_mask(volume, dilation_voxels=3)

    assert grown.voxel_count > tight.voxel_count
    assert any("not an organ boundary" in w for w in grown.warnings)


def test_contains_answers_for_a_voxel_and_refuses_to_go_out_of_bounds():
    volume = phantom(size=64)
    result = build_lung_mask(volume)
    slices, rows, columns = result.mask.shape

    somewhere_inside = np.argwhere(result.mask[0])[0]
    assert result.contains(float(somewhere_inside[1]), float(somewhere_inside[0]), 0)

    assert result.contains(-1, 10, 0) is False
    assert result.contains(10, -1, 0) is False
    assert result.contains(10, 10, slices + 5) is False
    assert result.contains(columns + 10, 10, 0) is False


# ── failure is explicit, never an empty mask ───────────────────────────────

def test_a_volume_with_no_aerated_region_is_unavailable_not_empty():
    """The difference that matters: a detector handed an empty mask finds
    nothing and looks like it worked."""
    solid = FakeVolume(np.full((5, 64, 64), 40.0, dtype=np.float32))
    solid.array[0, 0, 0] = -1000.0  # so the HU sanity check still passes

    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(solid)
    assert raised.value.code == "implausibly_small_lung_region"


def test_an_all_air_volume_is_unavailable():
    air = FakeVolume(np.full((5, 64, 64), -1000.0, dtype=np.float32))
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(air)
    assert raised.value.code in (
        "implausibly_small_lung_region",
        "implausibly_large_lung_region",
    )


def test_a_uniform_volume_in_the_lung_band_is_unavailable():
    """Every voxel in the band forms one region that reaches every edge, so
    the border rule treats it as the air around the patient and nothing is
    left. Reported, not returned empty."""
    mush = FakeVolume(np.full((5, 64, 64), -700.0, dtype=np.float32))
    mush.array[0, 0, 0] = -1000.0
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(mush)
    assert raised.value.code == "implausibly_small_lung_region"


def test_an_aerated_region_swallowing_the_patient_is_unavailable():
    """The ceiling: a huge interior region that does not reach the frame edge
    means the threshold has not separated the lungs from anything."""
    size = 64
    array = np.full((5, size, size), -1000.0, dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    interior = (yy > 2) & (yy < size - 2) & (xx > 2) & (xx < size - 2)
    for k in range(5):
        array[k][interior] = -700.0

    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(FakeVolume(array))
    assert raised.value.code == "implausibly_large_lung_region"


def test_an_already_normalised_volume_is_caught_rather_than_silently_empty():
    """Handing this the detector's [0, 1] input instead of HU would find
    nothing in the lung band. Loud beats silent."""
    normalised = FakeVolume(np.random.RandomState(0).rand(5, 64, 64).astype(np.float32))
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(normalised)
    assert raised.value.code == "not_hounsfield_units"


def test_a_two_dimensional_array_is_refused():
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(FakeVolume(np.zeros((64, 64), dtype=np.float32)))
    assert raised.value.code == "not_a_volume"


def test_an_empty_array_is_refused():
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(FakeVolume(np.zeros((0, 64, 64), dtype=np.float32)))
    assert raised.value.code in ("empty_volume", "not_a_volume", "implausibly_small_lung_region")


def test_an_unavailable_mask_carries_a_code_and_an_actionable_sentence():
    solid = FakeVolume(np.full((5, 64, 64), 40.0, dtype=np.float32))
    solid.array[0, 0, 0] = -1000.0
    with pytest.raises(LungMaskUnavailable) as raised:
        build_lung_mask(solid)

    error = raised.value
    assert error.code.islower()
    assert len(error.message) > 40
    assert "code" in error.as_dict()


# ── determinism ────────────────────────────────────────────────────────────

def test_the_mask_is_identical_across_repeated_builds():
    volume = phantom()
    results = [build_lung_mask(volume) for _ in range(3)]

    for other in results[1:]:
        assert np.array_equal(results[0].mask, other.mask)
        assert results[0].lung_fraction == other.lung_fraction


def test_the_mask_does_not_depend_on_numpy_iteration_order():
    """Two identical arrays built differently must mask identically."""
    a = phantom()
    b = FakeVolume(a.array.copy())
    assert np.array_equal(build_lung_mask(a).mask, build_lung_mask(b).mask)


def test_the_band_covers_emphysematous_and_consolidated_lung():
    """Wide on purpose: tuning it to normal parenchyma would exclude the
    patients most likely to be scanned."""
    assert LUNG_HU_MIN <= -900.0, "emphysema runs low"
    assert LUNG_HU_MAX >= -400.0, "consolidation runs high"


def test_the_record_says_what_it_is_without_claiming_a_segmentation():
    result = build_lung_mask(phantom())
    record = result.as_dict()

    assert record["version"] == MASK_VERSION
    assert "lungFraction" in record and "voxelCount" in record
    assert not any(k.lower().startswith("dice") for k in record), "no validation is claimed"


# ── out-of-field padding ───────────────────────────────────────────────────
#
# Found by auditing against a real LIDC series rather than a phantom: the
# threshold excludes the -2048 padding outside the reconstruction circle, and
# then the dilation grows back into it. 7,836 voxels on a 45-slice series.

def test_out_of_field_padding_is_not_dilated_into():
    """A candidate outside the reconstruction circle is anatomically
    impossible — nothing was measured there."""
    size = 64
    array = np.full((4, size, size), -2048.0, dtype=np.float32)  # padding everywhere
    yy, xx = np.mgrid[0:size, 0:size]
    body = (yy > 10) & (yy < size - 10) & (xx > 10) & (xx < size - 10)
    disc = (yy - size // 2) ** 2 + (xx - size // 2) ** 2 <= 10 ** 2
    for k in range(4):
        array[k][body] = 40.0
        array[k][disc] = -800.0

    result = build_lung_mask(FakeVolume(array), dilation_voxels=5)

    padding = array < OUT_OF_FIELD_HU
    assert int((result.mask & padding).sum()) == 0, "no padding voxel is inside the mask"


def test_removing_padding_does_not_cost_the_dilation_its_purpose():
    """The chest wall the dilation exists to include is dense, far above the
    floor, so the floor cannot remove it."""
    volume = phantom()
    tight = build_lung_mask(volume, dilation_voxels=0)
    grown = build_lung_mask(volume, dilation_voxels=3)

    assert grown.voxel_count > tight.voxel_count, "the dilation still grows the mask"


def test_the_floor_sits_below_any_real_air():
    """Air in the trachea and around the patient runs to about -1024. A floor
    above that would start removing real anatomy."""
    assert OUT_OF_FIELD_HU < -1024.0
    assert OUT_OF_FIELD_HU > -2048.0
