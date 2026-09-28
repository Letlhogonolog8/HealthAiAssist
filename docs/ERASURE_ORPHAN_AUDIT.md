# Erasure follow-ups: the historical orphan check, and retrying failed deletions

28 September 2026. DPIA R-23.

## Background

Before `4acae2d` (28 September 2026) an erasure deleted each `medical_scans`
row and **left the image it pointed at in storage**. If any erasure was
executed on a live system before that commit, its scan images are still
stored with no row pointing at them.

**Status: the historical orphan check has NOT been performed.** This
repository cannot tell whether any live erasure happened. The check below
must be run by someone with access to the live database and storage, and only
if erasures were executed there before `4acae2d`.

---

## 1. Historical orphan check

**Tool:** `scripts/audit-stored-objects.ts`, with the logic in
`server/object-audit.ts`.

**What it does.** It compares two lists and reports the difference:

- stored objects that no row points at, which are candidates for review;
- rows whose object is missing.

**What it cannot do.** It cannot delete anything; it contains no deletion
code at all, and a test pins that. It also opens no database connection and
needs no credentials. It works only on files you give it.

### Inputs

**1. References**: every stored location the database knows about. Run this
read-only query against the live database and save one location per line:

```sql
\copy (
  SELECT image_path  FROM medical_scans     WHERE image_path  IS NOT NULL
  UNION
  SELECT object_path FROM imaging_instances WHERE object_path IS NOT NULL
  UNION
  SELECT mask_path   FROM scan_regions      WHERE mask_path   IS NOT NULL
) TO 'references.txt'
```

(`scan_regions.mask_path` is written by nothing today; it is included so the
check stays correct if that changes.)

**2. Inventory**: what is actually stored. Either:

- **Cloud Storage:** `gsutil ls -l -r gs://<bucket>/** > inventory.txt`
  (the `-l` timestamps let the tool set aside recent uploads); or
- **local disk:** pass the `uploads/` directory with `--uploads-dir`.

Take both lists at about the same time, and preferably when no uploads are
in progress.

### Running it

```bash
npx tsx scripts/audit-stored-objects.ts \
  --references references.txt --inventory inventory.txt \
  --out orphan-report.json --min-age-hours 24
```

Exit 0 means nothing is unreferenced. Exit 1 means there are candidates to
review. Exit 2 means the arguments or inputs were bad.

### Reading the report

| Section | Meaning | What to do |
|---|---|---|
| `unreferencedObjects` | Stored, older than the minimum age, and no row points at it | **Review each one by hand.** A pre-fix erasure is one explanation. Others are a different application sharing the bucket, a reference list taken from the wrong database, or an ingestion that crashed between writing and rolling back |
| `tooRecentToJudge` | Unreferenced, but written within `--min-age-hours` | Possibly mid-upload. Re-run later |
| `referencesWithoutObjects` | A row points at an object that is not stored | A different defect; report it rather than delete the row |
| `referencesOutOfScope` | Rows pointing at storage the inventory does not cover | Not judged; list that storage too if it matters |

Deleting a confirmed orphan is a manual, recorded administrative action. It is
deliberately outside this tool, and it should be entered in the erasure
records and the audit trail with the reason.

---

## 2. Retrying objects an erasure could not remove

**Implemented 28 September 2026:**
`POST /api/admin/erasure-requests/:id/retry-objects`.

When an object cannot be removed (for example, the bucket's delete
permission is missing), the first execution keeps the row that points at it,
reports the category as `retained`, and records the location in an
`ERASURE_OBJECTS_RETAINED` audit event. The retry exists for once the cause
is fixed.

| Guarantee | How |
|---|---|
| Administrators only | Same `requireAuth` and `requireAdmin` chain as execution; a patient gets 403 (tested) |
| Only executed requests | Status must be `partially_completed`; anything else gets 409 (tested). An executed request still cannot be executed twice |
| Retention still applies | The patient is re-assessed first, and a category is retried only if it is erasable now |
| Never an arbitrary object | Only the objects the patient's own remaining scan and CT rows point at |
| One deletion path | It calls the same `eraseScanRows` and `eraseImagingRows` that execution uses: object first, row only once its object has gone |
| Never marks deletion complete falsely | An object that still fails keeps its row and stays `retained` (tested) |
| Audit evidence kept | Each retry writes `ERASURE_RETRY_COMPLETED`; failures write `ERASURE_OBJECTS_RETAINED` again; nothing is removed from the audit trail |

The request status becomes `completed` only if no category remains retained.
Categories held by statute (for example, the audit trail) keep a request at
`partially_completed`, as they do after execution.

**Not implemented:** automatic or scheduled retries. A retry is always an
administrator's deliberate action.
