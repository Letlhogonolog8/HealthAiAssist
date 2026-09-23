/**
 * Removing a stored medical object, and saying honestly whether it went.
 *
 * Ingestion already has a cleanup path (`removeObjects` in dicom-series.ts),
 * but it exists to roll back a failed upload and it treats a leftover cloud
 * object as harmless — which it is, in that context, because a rolled-back
 * ingestion leaves no row pointing at it and nobody ever consented to it being
 * there in the first place.
 *
 * Erasure is not that. When a data subject asks to be forgotten, an object
 * left in a bucket is the pixel data they asked to have deleted, still
 * present. Reporting the erasure as complete while it sits there would be the
 * exact failure mode `server/erasure.ts` was written to avoid: a deletion that
 * did not happen, reported as one.
 *
 * So this returns an outcome instead of swallowing the error, and the caller
 * is expected to carry a failure into what the data subject is told.
 */
import fs from 'fs';
import path from 'path';

export type RemovalOutcome =
  | { removed: true; uri: string }
  | { removed: false; uri: string; reason: string };

/**
 * Deletes one object by the URI stored in the database.
 *
 * Two schemes exist in the data: `file://<name>` for the local `uploads/`
 * tree, and `gs://<bucket>/<name>` for Cloud Storage. A local file that is
 * already gone counts as removed — the goal is its absence, not the act.
 */
export async function removeStoredObject(uri: string | null): Promise<RemovalOutcome> {
  if (!uri) {
    return { removed: true, uri: '' };
  }

  if (uri.startsWith('file://')) {
    const name = uri.slice('file://'.length);
    // Refuse a path that escapes the uploads tree rather than deleting
    // whatever it resolves to.
    const uploads = path.join(process.cwd(), 'uploads');
    const absolute = path.resolve(uploads, name);
    if (!absolute.startsWith(uploads + path.sep)) {
      return { removed: false, uri, reason: 'stored path escapes the uploads directory' };
    }
    try {
      await fs.promises.unlink(absolute);
      return { removed: true, uri };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return { removed: true, uri };
      }
      return { removed: false, uri, reason: error?.message ?? 'unlink failed' };
    }
  }

  if (uri.startsWith('gs://')) {
    try {
      const { deleteScanObject } = await import('./google-cloud-service');
      return await deleteScanObject(uri);
    } catch (error: any) {
      return { removed: false, uri, reason: error?.message ?? 'cloud delete failed' };
    }
  }

  return { removed: false, uri, reason: `unrecognised storage scheme` };
}

/**
 * Removes many objects, reporting what did not go.
 *
 * Never throws: one unreachable object must not abandon the rest of an
 * erasure half-done. The survivors are returned so they can be recorded.
 */
export async function removeStoredObjects(uris: Array<string | null>): Promise<{
  removed: number;
  failed: RemovalOutcome[];
}> {
  let removed = 0;
  const failed: RemovalOutcome[] = [];
  for (const uri of uris) {
    const outcome = await removeStoredObject(uri);
    if (outcome.removed) {
      removed += 1;
    } else {
      failed.push(outcome);
    }
  }
  return { removed, failed };
}
