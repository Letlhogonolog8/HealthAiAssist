# Disaster Recovery

What this deployment is made of, what a restore actually recovers, and where
the gaps are.

**Nothing here has been rehearsed.** No restore has been performed, no RTO or
RPO has been measured, and the targets below are proposals rather than
commitments. A DR plan that has never been executed is a document, not a
capability — and saying so is the point of this section rather than a
disclaimer at the end of it.

---

## 1. State lives in four places, not one

This is the fact that makes recovery non-trivial, and it is not obvious from
any single file.

| Store | Holds | Backed up by |
|---|---|---|
| **Postgres (Supabase)** | Everything relational: users, scans, appointments, `audit_events`, `scan_outcomes`, `adverse_events`, consents, care relationships | Supabase's own snapshots — **not verified by us** |
| **Object storage (Google Cloud Storage)** | Scan images | GCS bucket policy — **not verified by us** |
| **Local disk (`uploads/`)** | Scan images, whenever object storage is unconfigured *or* fails | **Nothing.** Ephemeral on a container |
| **`dataset/`** | Model weights, calibration, thresholds, OOD references, split manifests | `npm run backup:models` |

**A restore of one without the others is not a restore.** The database holds
`image_path`; the bytes live elsewhere. Recovering the rows alone gives every
scan a pointer to an image that no longer exists, and the failure surfaces to a
radiologist as a blank viewer rather than as an error.

### The `file://` trap

`persistScanImage` writes to object storage when configured, and **falls back
to local disk when object storage is configured but fails.** That fallback is
deliberate and correct — losing the image is worse than storing it in the wrong
place — but it means `image_path` can hold `file://…`, and on a container that
path does not survive a restart, never mind a disaster.

Production refuses to start without object storage unless
`ALLOW_EPHEMERAL_SCAN_STORAGE=true`, so this should be rare. It is not
impossible: the fallback fires on a *runtime* failure, after startup checks
have passed.

Check for it:

```sql
SELECT count(*) FILTER (WHERE image_path LIKE 'file://%') AS on_local_disk,
       count(*) FILTER (WHERE image_path IS NULL)         AS image_already_lost,
       count(*)                                           AS total
  FROM medical_scans;
```

Anything in the first two columns is a scan whose image will not come back.
`image_path IS NULL` means it was already lost at write time — the result was
kept without it, by design, but there is nothing to restore.

---

## 2. Losing `dataset/` takes both modalities offline

`dataset/` is gitignored, so a clean checkout gives you the code and no models.
Because of the governance gate, an unmeasured model does not serve — so the
recovery path is not "copy any model back", it is:

1. Restore the artifact, **or** retrain it.
2. Re-measure it (`npm run fairness:measure`, `evaluate-model.py`,
   `verify-lung-operating-point.py`).
3. Update `MEASUREMENT_BINDINGS` with the new fingerprint.
4. Only then does the modality serve again.

Restoring a backup skips steps 2–4 entirely, because the fingerprint still
matches. **Retraining does not** — a retrained model is a different artifact
with a different fingerprint, and the modality stays off until re-measured.

That asymmetry is the whole argument for `npm run backup:models`: both models
are rebuildable, and rebuilding is still far more expensive than restoring.

### What the backup covers

Eleven artifacts, not just the two `.h5` files. The weights alone do not
reproduce deployed behaviour — each of these fails *quietly* when absent:

- `lung_model_calibration.json` — temperature 1.125. Absent, the service falls
  back to 1.0 and **the operating point moves with no error raised**.
- `lung_splits.json` — the 554 held-out test paths. Absent, the published lung
  figures become unverifiable again.
- `*_model_ood.json`, `skin_ood_reference.npz` — the out-of-distribution screen.
  Absent, wrong-modality images reach the classifier.
- `skin_tone_performance.json` — the fairness measurement, fingerprint-bound.

Run it, verify it, and get it off the machine:

```
npm run backup:models -- <destination>
npm run backup:models -- --verify
```

The script warns when the destination is on the same volume as the source,
which protects against an accidental delete and not against a disk failure.

---

## 3. Proposed targets

Proposals. Not agreed, not measured, not met.

| | Target | Rationale |
|---|---|---|
| **RPO** | 1 hour | A lost hour of scans is a morning clinic re-uploading. A lost day is a clinical record with holes in it. |
| **RTO** | 4 hours | The platform is triage, not life support: a clinician can read scans without it. Longer than a day and the queue becomes the emergency. |

**Degraded operation is the thing to protect.** Losing automated analysis is
survivable — every scan already routes to a human. Losing the *audit trail* or
the *adverse event record* is not, because both are evidence about care that
already happened and cannot be reconstructed.

---

## 4. Recovery procedure

Untested. Read as a draft to rehearse, not a procedure to trust.

1. **Establish what is lost.** Database, images, models, or the host. The four
   stores fail independently and mostly need different responses.

2. **Turn automated analysis off first.**
   ```ts
   // server/model-availability.ts
   lung: { enabled: false, disabledReason: 'DR in progress: <incident>' }
   ```
   Scans then store and queue for a human. Do this before restoring anything:
   a half-restored system that is still serving predictions is worse than one
   that is honestly refusing.

3. **Restore Postgres** from the Supabase snapshot. Then verify the schema is
   whole — the CI step lists the tables that must exist:
   ```
   psql "$DATABASE_URL" -c "SELECT 'users'::regclass, 'medical_scans'::regclass,
     'audit_events'::regclass, 'adverse_events'::regclass, 'session'::regclass;"
   ```

4. **Restore images**, and then reconcile them against the rows. A row whose
   `image_path` resolves to nothing is not an error the application raises; it
   is a blank viewer for a radiologist. Count them before declaring success.

5. **Restore `dataset/`** and check the fingerprints match `MEASUREMENT_BINDINGS`.
   The startup log says whether each modality will serve. Anything other than
   `matches its measurement binding` means it will not, and that is correct.

6. **Re-enable analysis** only after the startup log is clean — and record the
   whole thing as an adverse event if any patient scan was affected, which is
   what the `system_failure` category is for.

---

## 5. What has not been done

Stated plainly because a DR document that omits its own gaps is worse than none.

- **No restore has ever been performed.** Not from Supabase, not from GCS, not
  from a model backup into a clean checkout.
- **Supabase's backup configuration has not been verified.** Retention,
  frequency and point-in-time recovery are assumed, not checked.
- **The GCS bucket has no verified lifecycle or versioning policy.**
- **RTO and RPO are unmeasured**, so §3 is a proposal.
- **Development and production share one database** (DPIA R-15). A destructive
  recovery action would affect both.
- **No off-host copy of `dataset/` is known to exist.** The backup script warns
  about this; nothing enforces it.

The cheapest meaningful next step is a rehearsal: restore into a scratch
database and a clean checkout, time it, and replace §3 with measured numbers.
