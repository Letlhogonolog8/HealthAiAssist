"""
Which end of an ordered series is the patient's head.

Ordering by the projection onto the slice normal puts slices in anatomical
order and says nothing about the direction that order runs in — the normal is
a cross product, so its sign follows how the acquisition described itself.
Reverse the two direction cosines and the identical anatomy orders the other
way round.

A volume built with the polarity inverted is a superior-inferior mirror of the
patient. Every slice in it is individually valid, the spacing is uniform, and
a candidate reported in the right upper lobe is shown in the right lower lobe.
Nothing downstream can detect that, which is why it is settled here and
recorded rather than left to whichever convention the data happened to use.

The convention: index 0 is the most inferior slice, the index increases
towards the head, and whether that required reversing the raw order is
reported.
"""
from __future__ import annotations

import pytest

from conftest import make_ct_series

from series import (
    POLARITY_FEET_TO_HEAD,
    POLARITY_INDETERMINATE,
    order_slices,
    read_instance_metadata,
)


def metas(datasets):
    return [read_instance_metadata(ds, index) for index, ds in enumerate(datasets)]


def ordered_positions(result):
    return [m.projected_position for m in result.ordered]


# ── the ordinary case ──────────────────────────────────────────────────────

def test_a_standard_axial_series_runs_feet_to_head_untouched():
    """IOP (1,0,0,0,1,0) gives a normal of +z, which already points at the
    head, so nothing is reversed. Every LIDC series is this case."""
    result = order_slices(metas(make_ct_series(count=40, spacing=2.5)))

    assert result.polarity == POLARITY_FEET_TO_HEAD
    assert result.polarity_normalised is False
    assert result.normal == pytest.approx((0.0, 0.0, 1.0))
    assert result.trusted
    assert ordered_positions(result) == sorted(ordered_positions(result))


def test_the_first_slice_is_the_most_inferior():
    """The convention, stated as an assertion about patient anatomy rather
    than about array order."""
    series = make_ct_series(count=20, spacing=2.5, start_z=-300.0)
    result = order_slices(metas(series))

    first, last = result.ordered[0], result.ordered[-1]
    assert first.image_position[2] < last.image_position[2], "index 0 is nearer the feet"


# ── the case the convention exists for ─────────────────────────────────────

def _feet_first(count=20, spacing=2.5):
    """A series whose normal points at the feet.

    Swapping the two direction cosines negates the cross product, which is
    exactly how a real acquisition ends up described this way. The anatomy is
    identical; only the description differs.
    """
    series = make_ct_series(count=count, spacing=spacing, orientation=(0, 1, 0, 1, 0, 0))
    return series


def test_a_feet_pointing_normal_is_reversed_and_says_so():
    series = _feet_first()
    result = order_slices(metas(series))

    assert result.polarity == POLARITY_FEET_TO_HEAD, "normalised to the convention"
    assert result.polarity_normalised is True, "and the reversal is recorded"
    assert result.normal[2] > 0, "the normal was oriented towards the head"
    assert any("towards the feet" in w for w in result.warnings)


def test_the_reversal_actually_puts_the_inferior_slice_first():
    """Not merely a flag: the ordering itself has to change."""
    series = _feet_first(count=20, spacing=2.5)
    result = order_slices(metas(series))

    z_values = [m.image_position[2] for m in result.ordered]
    assert z_values == sorted(z_values), "ascending towards the head in patient space"


def test_the_same_anatomy_orders_the_same_way_under_either_description():
    """The point of the whole exercise. Two descriptions of one acquisition
    must produce the same anatomical order."""
    head_first = make_ct_series(count=20, spacing=2.5, orientation=(1, 0, 0, 0, 1, 0))
    feet_first = make_ct_series(count=20, spacing=2.5, orientation=(0, 1, 0, 1, 0, 0))
    for source, target in zip(head_first, feet_first):
        target.ImagePositionPatient = list(source.ImagePositionPatient)

    a = order_slices(metas(head_first))
    b = order_slices(metas(feet_first))

    assert [m.image_position[2] for m in a.ordered] == [m.image_position[2] for m in b.ordered]
    assert a.polarity == b.polarity == POLARITY_FEET_TO_HEAD
    assert a.polarity_normalised is False and b.polarity_normalised is True


# ── when there is no head end to find ──────────────────────────────────────

def test_an_in_plane_normal_is_indeterminate_not_guessed():
    """A coronal acquisition: the through-plane direction is anterior-
    posterior, so there is no superior-inferior polarity to resolve. Rounding
    a near-zero component into a decision would be a guess."""
    slices = make_ct_series(count=20, orientation=(1, 0, 0, 0, 0, 1))
    for index, ds in enumerate(slices):
        ds.ImagePositionPatient = [0.0, index * 2.5, 0.0]

    result = order_slices(metas(slices))

    assert result.polarity == POLARITY_INDETERMINATE
    assert result.polarity_normalised is False
    assert any("no superior-inferior direction" in w for w in result.warnings)


def test_an_indeterminate_polarity_does_not_by_itself_untrust_the_ordering():
    """Ordering and polarity are different questions. A coronal series can be
    ordered perfectly well; it just cannot become a volume with a known head
    end. Conflating them would refuse a correctly ordered series."""
    slices = make_ct_series(count=20, orientation=(0, 1, 0, 0, 0, 1))
    for index, ds in enumerate(slices):
        ds.ImagePositionPatient = [index * 2.5, 0.0, 0.0]

    result = order_slices(metas(slices))

    assert result.trusted, result.problems
    assert result.method == "image_position_patient"
    assert result.polarity == POLARITY_INDETERMINATE


def test_a_degenerate_orientation_has_no_polarity_and_is_untrusted():
    result = order_slices(metas(make_ct_series(count=20, orientation=(1, 0, 0, 1, 0, 0))))

    assert not result.trusted
    assert result.polarity == POLARITY_INDETERMINATE
    assert result.normal is None


def test_the_slice_location_fallback_claims_no_polarity():
    """SliceLocation is a scalar whose sign convention the object does not
    state, so an ordering derived from it cannot assert an anatomical
    direction."""
    series = make_ct_series(count=20)
    for ds in series:
        del ds.ImageOrientationPatient

    result = order_slices(metas(series))

    assert result.method == "slice_location"
    assert result.polarity == POLARITY_INDETERMINATE
    assert result.normal is None


def test_no_spatial_metadata_has_no_polarity():
    series = make_ct_series(count=20)
    for ds in series:
        del ds.ImageOrientationPatient
        del ds.ImagePositionPatient
        del ds.SliceLocation

    result = order_slices(metas(series))

    assert result.method == "instance_number"
    assert not result.trusted
    assert result.polarity == POLARITY_INDETERMINATE


# ── input order must not matter ────────────────────────────────────────────

def test_reversed_input_gives_the_same_polarity_and_the_same_order():
    series = make_ct_series(count=30, spacing=2.0)
    forward = order_slices(metas(series))
    backward = order_slices(metas(list(reversed(series))))

    assert forward.polarity == backward.polarity
    assert forward.polarity_normalised == backward.polarity_normalised
    assert [m.image_position[2] for m in forward.ordered] == [
        m.image_position[2] for m in backward.ordered
    ]


@pytest.mark.parametrize("seed", [1, 7, 13, 99])
def test_shuffled_input_gives_the_same_polarity_and_the_same_order(seed):
    import random

    series = make_ct_series(count=30, spacing=2.0)
    shuffled = series[:]
    random.Random(seed).shuffle(shuffled)

    reference = order_slices(metas(series))
    result = order_slices(metas(shuffled))

    assert result.polarity == reference.polarity
    assert result.normal == reference.normal
    assert [m.image_position[2] for m in result.ordered] == [
        m.image_position[2] for m in reference.ordered
    ]


def test_inconsistent_orientation_is_still_detected():
    """The existing guard must survive the polarity work."""
    series = make_ct_series(count=20)
    series[9].ImageOrientationPatient = [0, 1, 0, 0, 0, 1]
    result = order_slices(metas(series))

    assert not result.trusted
    assert any("orientation" in p for p in result.problems)


def test_duplicate_positions_are_still_detected():
    series = make_ct_series(count=20, spacing=2.5)
    series[10].ImagePositionPatient = list(series[9].ImagePositionPatient)
    result = order_slices(metas(series))

    assert not result.trusted
    assert any("same position" in p for p in result.problems)


# ── determinism ────────────────────────────────────────────────────────────

def test_repeated_assembly_of_one_series_is_byte_identical():
    """The normal is persisted and compared, so it must not wobble in the last
    bit between two runs over the same objects."""
    series = make_ct_series(count=25, spacing=2.5)
    results = [order_slices(metas(series)) for _ in range(4)]

    assert len({r.normal for r in results}) == 1
    assert len({r.polarity for r in results}) == 1
    assert len({tuple(m.sop_instance_uid for m in r.ordered) for r in results}) == 1
