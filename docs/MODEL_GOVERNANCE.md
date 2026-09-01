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
| `re_measured` | `scripts/evaluate-model.py` was run against this exact artifact and the published figures reproduced. |
| `asserted_at_introduction` | The binding was recorded from whatever was deployed when governance was introduced. The figures were inherited, not re-derived. |

A governance record that cannot tell "checked" from "assumed" is not a
governance record, so the weaker level says so in the API response as well as
in the source.

### Current state

- **skin** — `re_measured` on 2026-09-01. Re-running the evaluation against the
  deployed artifact reproduced sensitivity 0.9133, specificity 0.8139 and
  balanced accuracy 0.8636 exactly as published.
- **lung** — `asserted_at_introduction`. The model card cites a held-out split
  of 554 images (282 cancer / 272 no_cancer) which **is not present in this
  working copy** — only `train/` and `validate/` are. The published figures
  therefore cannot be reproduced here, and the `reproduce` command on
  `/api/models/cards` will not work for lung until the split is restored. The
  binding records what is deployed so that future drift is detectable; it does
  not confirm the figures describe this file.

Restoring the lung test split and re-measuring is the single highest-value
governance task outstanding.

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
