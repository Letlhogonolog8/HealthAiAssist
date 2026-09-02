# Model Deployment Governance

How a model gets from a training run to serving patients, and what stops it
getting there by accident.

## The rule

**A model serves only when its published figures describe the artifact that is
actually deployed.** Everything below exists to make that checkable rather than
assumed.

This is enforced in code, not by convention. `server/model-governance.ts`
compares the SHA-256 fingerprint of the deployed `.h5` against the fingerprint
recorded in `MEASUREMENT_BINDINGS`. A mismatch disables the modality: scans are
stored and queued for a human, and the API answers 503 with an explicit "this
is NOT a negative finding".

## Why fingerprints and not version strings

`medical_scans.model_version` was once a hardcoded string literal. Retraining
without editing the literal produced rows claiming to come from a model that no
longer existed — a wrong provenance label, which is worse than a missing one
because it is believed rather than investigated.

The same failure was available one level up: `MODEL_REGISTRY` publishes
sensitivity and specificity, and nothing tied those numbers to a file. Replace
the artifact and `/api/models/cards` keeps serving the old figures about a model
that is gone. A digest cannot drift from the file it describes.

## Verification levels

`MEASUREMENT_BINDINGS` records how strongly each binding is held. The
distinction matters and is published:

| Level | Meaning |
|---|---|
| `re_measured` | The published figures were reproduced against this exact artifact, by a named script, **at the operating point the service actually uses**. See the lung note below: reproducing argmax alone confirms the weights, not the deployed behaviour. |
| `asserted_at_introduction` | The binding was recorded from whatever was deployed when governance was introduced. The figures were inherited, not re-derived. |

A governance record that cannot tell "checked" from "assumed" is not a
governance record, so the weaker level says so in the API response as well as
in the source.

### Current state

- **skin** — `re_measured` on 2026-09-01. Re-running the evaluation against the
  deployed artifact reproduced sensitivity 0.9133, specificity 0.8139 and
  balanced accuracy 0.8636 exactly as published.
- **lung** — `re_measured` on 2026-09-02. The split was never lost: the images
  live in the original `train/` and `validate/` directories and
  `lung_splits.json` records exactly which 554 were held out. It simply had
  never been assembled into a directory the evaluator could read.
  `scripts/materialise-lung-test-split.py` rebuilds it (282 cancer / 272
  no_cancer, matching the published counts exactly), and both figures reproduce:
  argmax at balanced accuracy 0.8383 with 86 cancers missed, and the deployed
  operating point at sensitivity 0.8121, specificity 0.7574, 53 cancers missed.

**One limitation stands.** The manifest records only the test list, not the
train and val lists, so "the test entries were used only for final evaluation"
is asserted by the manifest rather than checkable by intersection. Recording all
three lists on the next retrain would close it.

### Verifying lung is not the same as verifying skin

`evaluate-model.py` scores at argmax — a threshold of 0.5, which implicitly says
a missed cancer and a false alarm cost the same. The lung model does not run
that way: it applies temperature scaling and thresholds calibrated P(cancer) at
0.30, and the figures in `MODEL_REGISTRY` are the figures at *that* point.

So argmax reproduction is necessary and not sufficient — it confirms the
weights, not the deployed behaviour.
`scripts/verify-lung-operating-point.py` reproduces the serving path end to end
(softmax, temperature, threshold) and fails if the result drifts from what
`MODEL_REGISTRY` publishes.

### A trap in the evaluator, for whoever runs it next

For lung, **index 0 is cancer**, the reverse of skin. `evaluate-model.py` treats
its `class1` argument as the positive class, so invoked as
`... test cancer no_cancer` it reports "sensitivity" as recall on *no_cancer*
and "specificity" as recall on *cancer* — the opposite of the clinical
convention. The numbers are correct; the labels are not. Read the confusion
matrix.

## Deploying a new model

Do these in order. Steps 2 and 3 are the ones that are skipped under time
pressure, and the fingerprint check exists because skipping them used to be
invisible.

1. **Train**, and keep the test split untouched by training and model
   selection. A figure measured on data the model chose against is not a
   held-out figure.

2. **Measure.**
   ```
   python scripts/evaluate-model.py <model.h5> <test_dir> <class0> <class1> raw_0_255
   ```
   Pass the preprocessing scheme explicitly. Models with normalisation fused
   into the graph must be evaluated at `raw_0_255`; sweeping schemes against
   one reports meaningless numbers for the other two.

3. **Check it beats the baseline.** `majorityClassBaseline` and
   `chanceBalancedAccuracy` are in the evaluation output for this reason. A
   model that does not beat chance is not a working model regardless of what
   the training logs said.

4. **Fingerprint the artifact.**
   ```
   node -e "const{createHash}=require('crypto'),{createReadStream}=require('fs');const h=createHash('sha256');createReadStream(process.argv[1]).on('data',c=>h.update(c)).on('end',()=>console.log(h.digest('hex').slice(0,12)))" <model.h5>
   ```

5. **Update both places, in the same commit.**
   - `MODEL_REGISTRY` in `server/model-availability.ts` — the figures and the
     caveats.
   - `MEASUREMENT_BINDINGS` in `server/model-governance.ts` — the fingerprint,
     the date, and the verification level.

   They live in different files deliberately: changing performance claims
   without changing their provenance should be visible in a diff rather than
   buried inside one object literal.

6. **Record it in `docs/MODEL_CHANGELOG.md`**, including what got worse. A
   changelog that lists only improvements is a marketing document.

7. **Deploy and read the startup log.** The server prints one line per
   modality. Anything other than `matches its measurement binding` means the
   modality is refusing to serve.

## Rollback

Put the previous artifact back and restore the previous
`MEASUREMENT_BINDINGS` entry. Because the binding is a content hash, a rollback
that restores the file without restoring the binding fails closed — the
modality refuses to serve rather than serving an old model under new figures.

Nothing needs to be migrated. Scans analysed by the withdrawn model keep their
own `model_version`, so what each result came from stays answerable.

## Who approves

This is not enforced in code and cannot be. It is the part that needs people.

- A model change needs a second reviewer who is not the person who trained it.
- Enabling a modality that has never served is a clinical decision, not an
  operational one, and needs whoever is accountable for the device.
- Disabling one is an operational decision anybody on call may take. The
  asymmetry is deliberate: turning a model off is safe and reversible, turning
  one on is neither.

## What this does not do

- It does not check that the *test data* was untouched by training. Nothing in
  the running system can see that. It is the reviewer's job in step 1.
- It does not detect a model that is correct on the test set and wrong in
  production. That is what adjudicated outcomes
  (`GET /api/models/performance`), `PredictionRateCollapsed` and the adverse
  event channel are for.
- It does not establish fitness for clinical use in any jurisdiction. See
  `docs/REGULATORY_PATHWAY.md`.
