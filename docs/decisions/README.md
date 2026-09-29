# Recording a P2 training decision

This folder holds `p2-training-authorisation.json`, the record the training
harness reads before it will train the lung nodule detector. The questions,
evidence and options for each decision are in
`docs/P2_TRAINING_GATE_DECISION_REGISTER.md`. This file covers only **how a
decision is recorded**.

**Current state: all nine decisions PENDING. No decision owner is assigned.
Training is refused.**

---

## Who may record a decision

The decision owner: a person assigned, in writing, by the director of
Novaryx Technologie. They must have authority over dataset methodology,
evaluation criteria and training methodology. The assignment itself is
recorded first, as a dated entry in the register's "Required decision owner"
section, naming the person and their role.

A developer does not record decisions. The engineering defaults in the
register are proposals, and writing them into this record without the owner
is not approval.

## What a sign-off must contain

For each decision, in `p2-training-authorisation.json`:

| Field | Required | Rule enforced by `training/authorisation.py` |
|---|---|---|
| `status` | yes | `APPROVED`, `REJECTED` or `DEFERRED`. Only `APPROVED` counts towards training |
| `owner` | yes | A person's name. Placeholders such as "OWNER NOT YET ASSIGNED", "TBD", "N/A" or "unknown" are refused |
| `role` | yes | Non-empty |
| `decidedOn` | yes | A real calendar date, `YYYY-MM-DD`, not in the future |
| `decision` | yes | What was decided, specifically enough to implement (at least 10 characters; in practice a sentence or more) |
| `rationale` | optional | Why |
| `conditions` | optional | Anything the approval depends on. A condition binds any run that relies on the approval |

The harness also refuses an approval that disagrees with the evidence it
depends on:

- `performance-criterion` APPROVED needs `docs/bars/p2.json` to record the
  gate as approved, signed (`approvedBy`) by a named person, not a
  placeholder, on a real, past `approvedOn` date.
- `localisation` APPROVED needs `docs/bars/p2.json` to carry the tolerance as
  `APPROVED`, signed the same way, with a machine-readable `rule` that
  `inference/detection_eval.py` itself accepts: a known `basis`, a
  `duplicatePolicy`, `fixedRadiusMm` only for a fixed radius, and a sane
  floor and ceiling. The gate builds the rule exactly as the evaluator does.
- `lung-mask-v4` APPROVED covers `lung-threshold-v4` only. If the code moves
  to another mask version, the approval stops applying.

## How to record it

In **one commit**, reviewed before merge:

1. Update the entry in `p2-training-authorisation.json`.
2. Fill the matching boxes in the register's "Decision Sign-Off" block with
   the same name, role, date and decision.
3. For `performance-criterion` and `localisation`, update `docs/bars/p2.json`
   and `docs/P2_LOCALIZATION_METHODOLOGY.md` so that they agree.
4. Edit
   `training/tests/test_authorisation.py::test_every_decision_in_the_repository_is_still_pending`.
   It fails on purpose when any decision leaves PENDING, so an approval can
   never arrive unnoticed inside an unrelated change.
5. Run `python scripts/train_lung_detector.py --dry-run`. The `authorisation`
   gate lists everything still missing.

Writing APPROVED in a document, an email or a chat message authorises nothing.
Only this record does, and only when it is complete.

## What approval does not do

- It does not train anything. Training is a separate, deliberate command on a
  machine that passes the environment check.
- It does not register a model. A trained checkpoint is `TRAINED_UNVALIDATED`
  and serves nothing. Registration needs the evaluation, OOD, calibration and
  model-card evidence required by `docs/ML_CHANGE_PROCESS.md`.
- It is not clinical validation.

## What the gate cannot detect

It checks that an owner is named, not that the name is a real person with
the authority claimed. It checks that a date is real and past, not that the
decision was made on it. Those are assured by review of the commit that
records the decision, which is why every decision is recorded in one reviewed
change, together with the register's sign-off block.
