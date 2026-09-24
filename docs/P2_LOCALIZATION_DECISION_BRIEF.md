# P2 localisation methodology — decision brief

24 September 2026. HEAD at time of writing: `c7e8880`.

> **STATUS: PENDING DECISION.** This brief does not choose a rule, does not
> rank the options, and does not change the pending state recorded in
> `docs/P2_LOCALIZATION_METHODOLOGY.md` or `docs/bars/p2.json`
> (`metrics.localisationTolerance.status = BLOCKED`). It exists so that
> whoever owns the decision can see what each choice commits the project to.

No FROC curve, sensitivity or false-positives-per-scan figure was produced for
this brief. None can be: there is no detector checkpoint, and the evaluator
refuses without an approved rule.

---

## 1. What is being decided

A detector proposes **points**: `voxel_i/j/k` and `x/y/z_mm` in DICOM patient
(LPS) space. A reference nodule is **a point plus reader-drawn size
measurements** (`dataset/lidc-labels.csv` centroid; sizes from
`scripts/lidc_extract_diameters.py`). The rule decides when a proposed point
*is* a reference nodule. Every downstream number — per-nodule sensitivity,
false positives per scan, the FROC curve, the operating point — depends on it.

A rule is complete only when all of the following are fixed. The repository
already enforces this: `inference/detection_eval.MatchRule` has no default for
any of them and refuses a bare number.

| # | Dimension | Current state |
|---|---|---|
| 1 | Distance basis: fixed radius, or half of which measured diameter | undecided |
| 2 | Aggregation of size across readers | median is the existing convention for ratings; not decided for size |
| 3 | Floor and ceiling on the tolerance | undecided |
| 4 | Assignment method when candidates and nodules compete | **implemented as greedy nearest-first; not ratified** (§4) |
| 5 | Duplicate policy — second hit on one nodule: false positive or ignored | undecided; both implemented |
| 6 | Reader-agreement threshold for a reference to count | undecided |
| 7 | Size inclusion — smallest reference that counts | undecided |
| 8 | Exclusions from the denominator | undecided |
| 9 | Distance metric: isotropic 3-D, or separate in-plane/through-plane | 3-D Euclidean implemented; option D would change it |

---

## 2. The options the repository documents

Taken from `docs/P2_LOCALIZATION_METHODOLOGY.md`. Order is the order there;
it is not a ranking.

### A. Fixed radius

| | |
|---|---|
| Definition | Match if the candidate centre is within a constant *r* mm (3-D) of the reference centroid |
| Required inputs | Centroid in mm; *r* |
| Advantages | One number; independent of size measurement quality; nodules with no contour can still be references |
| Limitations | A 3 mm nodule and a 30 mm mass get the same tolerance: generous to small nodules, strict on large ones. A candidate on the rim of a large nodule can be a "miss" while inside it |
| Effect on matching | Tolerance does not depend on the nodule; crowding matters more where nodules are closer than 2*r* |
| Effect on FROC | Sensitivity on large nodules depends on where on the nodule the detector fires; sensitivity on small nodules is inflated relative to a size-aware rule if *r* exceeds their radius |
| Edge cases | Two nodules closer than *r*: one candidate is admissible for both (§4) |
| Reproducibility | Highest — no dependence on contour extraction or pixel spacing |

### B. Nodule radius

| | |
|---|---|
| Definition | Match if the candidate centre is within half of a measured diameter |
| Required inputs | Centroid; per-nodule diameter in mm; **which** diameter |
| Advantages | Conventional in LIDC/LUNA16-style work; tolerance scales with the object |
| Limitations | Choice of diameter matters: `max_in_plane_diameter_mm` and `equivalent_area_diameter_mm` differ by about 1.6 mm at the median over 995 measured nodules (7.92 vs 6.28). Nodules without a contour of ≥ 3 points have no diameter and must be excluded explicitly — the evaluator raises rather than substitute one |
| Effect on matching | Small nodules (2.59 mm minimum max-diameter) demand ~1.3 mm localisation; large ones tolerate tens of mm |
| Effect on FROC | Small-nodule sensitivity is penalised heavily for sub-voxel-scale errors; slice spacing of 2.5 mm alone can exceed the tolerance for a small nodule |
| Edge cases | The labelled centroid is **one reader's** contour centroid on that reader's middle slice (`scripts/lidc_build_labels.py:310`), not a consensus centre; for small nodules the offset between readers can be comparable to the tolerance |
| Reproducibility | Depends on the diameter extraction and on PixelSpacing, both deterministic and committed |

### C. Nodule radius with a floor

| | |
|---|---|
| Definition | As B, but the tolerance is `max(diameter/2, floor)` (optionally capped) |
| Required inputs | As B, plus the floor (and ceiling, if any) |
| Advantages | Removes B's sub-millimetre demand on the smallest nodules |
| Limitations | Two choices to justify; the floor is itself a tolerance for small nodules |
| Effect on matching / FROC | Between A and B: size-aware above the floor, fixed below it |
| Edge cases | A ceiling limits credit for firing on the rim of a very large mass |
| Reproducibility | As B |

### D. Slice-aware

| | |
|---|---|
| Definition | Separate in-plane and through-plane tolerances |
| Required inputs | Centroid; in-plane tolerance; through-plane tolerance (fixed, or in slices) |
| Advantages | Faithful to anisotropy: LIDC slice spacing runs 1.0–3.0 mm against ~0.7 mm in plane |
| Limitations | Two numbers to justify; not implemented — `distance_mm` is 3-D Euclidean. Adopting D is a code change to the evaluator, with tests, under change control |
| Effect on matching / FROC | A candidate one slice away on a 2.5 mm series is treated differently from 2.5 mm in plane |
| Edge cases | A tolerance in slices makes the same physical error count differently across series |
| Reproducibility | Deterministic, but series-dependent if expressed in slices |

---

## 3. What is not available to inform the choice

- No consensus segmentation, so no volumetric-overlap criterion.
- No histopathology: references are radiologist annotations.
- No local study of how closely LIDC readers agree on a nodule's location.
- The LUNA16 convention exists as a reference point; LUNA16 is not in this
  repository, and adopting its rule is a decision to record, not a default.

---

## 4. Findings from this audit that the decision must account for

**Assignment is greedy nearest-first, which is not a maximum matching.**
`match_scan` sorts every admissible pair by distance and takes them in order.
That is deterministic and independent of listing order (tested). It can also
find fewer nodules than the candidates allow: with candidate `a` 1 mm from n1
and 2 mm from n2, and candidate `b` 1.5 mm from n1 only, greedy gives n1 to
`a`, makes `b` a duplicate and misses n2; a maximum matching finds both.
`test_greedy_nearest_first_is_not_a_maximum_matching` pins the current
behaviour so that a change is deliberate. Which assignment the evaluation uses
is dimension 4 above.

**The previously corrected double-counting holds.** A candidate admissible for
two nodules that are both already matched is one false positive, not two
(`test_a_candidate_near_two_matched_nodules_is_one_false_positive_not_two`).
The matching cases this audit required are all covered by passing tests:

| Case | Test |
|---|---|
| One candidate / one nodule | `test_a_candidate_inside_the_tolerance_finds_the_nodule`, `test_the_boundary_is_inclusive` |
| One candidate / two nearby nodules | `test_one_candidate_between_two_nodules_is_claimed_by_the_nearer_one` |
| Two candidates / one nodule | `test_two_candidates_on_one_nodule_give_the_nodule_to_the_nearer_one` |
| Duplicate candidates | `test_the_duplicate_policy_decides_whether_the_second_one_costs_anything`, `test_two_candidates_at_the_same_point_are_one_hit_and_one_duplicate` (added) |
| Zero candidates | `test_zero_candidates_misses_every_nodule_and_costs_nothing` (added) |
| Zero references | `test_a_scan_with_no_nodules_makes_every_candidate_a_false_positive` (added) |
| Missed nodule | `test_a_candidate_just_outside_the_tolerance_is_a_miss_and_a_false_positive` |

**Reader counts in the label table overstate agreement for some nodules.**
`n_readers` counts readings in a cluster, not distinct readers. On the 207
series with annotation XML on disk, 5 label-table nodules hold two readings
from the same reading session — three of them are "2-reader" nodules that are
one reader (`docs/P2_DATASET_RATIFICATION_AUDIT.md` §5). A reader-agreement
threshold (dimension 6) applied to `n_readers` or `agreement` inherits that.

**The lung mask makes some misses structural.** A reference whose centre is
outside the search constraint is never scored by the service, whatever the
rule. On the audited sample, v3 excluded 2 of 74 centres
(`docs/P2_LUNG_MASK_VALIDATION.md`). Whether such nodules stay in the
denominator (and count as misses) or are reported separately is dimension 8.

---

## 5. Consequences, stated per dimension

| Choice | Consequence |
|---|---|
| Fixed vs size-derived basis | Decides whether sensitivity is comparable across nodule sizes, and whether unmeasurable nodules can be references at all |
| Which diameter | ~1.6 mm difference in tolerance at the median; larger for elongated nodules |
| Floor / ceiling | Sets the effective tolerance for the smallest and largest nodules |
| Greedy vs maximum matching | Greedy can only report equal or lower sensitivity on the same candidates |
| Duplicate as FP vs ignored | Changes FP/scan, not sensitivity |
| Reader-agreement threshold | Changes the denominator; a 1-reader threshold admits nodules only one of four radiologists marked |
| Size inclusion | Changes the denominator; LIDC marks < 3 mm nodules as points with no contour |
| Structural misses (outside the mask) | Counted: sensitivity reflects the whole system. Reported separately: sensitivity reflects the detector within its search region. Both are defensible; they are different claims |

---

## 6. Who decides, and how it is recorded

The decision belongs to a project or clinical-methodology owner, not to the
engineering work. It is recorded by filling in the decision block in
`docs/P2_LOCALIZATION_METHODOLOGY.md` (decided by, decided on, methodology,
justification) and by setting `metrics.localisationTolerance` in
`docs/bars/p2.json` to `APPROVED` with a machine-readable `rule` — the only
state in which `inference/detection_eval.rule_from_bar` returns a rule.
`docs/ML_CHANGE_PROCESS.md` requires this before any evaluation runs.

No approver is named here, because none exists yet.
