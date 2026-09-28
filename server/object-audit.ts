/**
 * Which stored objects no database row points at — computed from two lists,
 * never from live access, and never acted on.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Until 2026-09-28 (`4acae2d`) an erasure deleted each `medical_scans` row and
 * left the image it pointed at in storage. Any erasure executed on a live
 * system before then left images with nothing referring to them: unerased,
 * and unfindable from the database. Whether that ever happened is unknown to
 * this repository; this is the tool for finding out.
 *
 * ── What it deliberately cannot do ─────────────────────────────────────────
 *
 * Delete. There is no delete code here or in the CLI, not behind a flag and
 * not in a "real" mode. An object this reports is a candidate for a human to
 * examine, because "no row points at it" has innocent explanations: an upload
 * between its write and its row insert, an object from another application
 * sharing the bucket, a row in a database the reference list was not taken
 * from. Deleting on the strength of a set difference would turn any of those
 * into data loss.
 *
 * It takes no credentials and opens no connection. The operator exports the
 * references with one read-only query and lists the bucket with the storage
 * provider's own tool; see docs/ERASURE_ORPHAN_AUDIT.md.
 */

export interface InventoryEntry {
  uri: string;
  /** When the object was written, if the inventory said. */
  updated: Date | null;
}

export interface ObjectAuditReport {
  label: string;
  referencesRead: number;
  inventoryRead: number;
  /** Schemes and buckets the inventory covers; references elsewhere are out of scope. */
  scopes: string[];
  matched: number;
  /** In the inventory, referenced by no row, and old enough to judge. */
  unreferencedObjects: string[];
  /** Unreferenced but written within the minimum age: possibly mid-upload. */
  tooRecentToJudge: string[];
  /** Referenced by a row, absent from the inventory, within the inventory's scope. */
  referencesWithoutObjects: string[];
  /** References to storage the inventory does not cover. Not judged. */
  referencesOutOfScope: number;
}

export const REPORT_LABEL =
  'OBJECT AUDIT — REPORT ONLY. Nothing was deleted, and this tool cannot delete. ' +
  'Every listed object is a candidate for human review, not a confirmed orphan.';

/**
 * The storage location in the form rows store it: `gs://bucket/name` or
 * `file://name` relative to uploads/, forward slashes, no surrounding space.
 */
export function normaliseUri(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('gs://')) return trimmed;
  if (trimmed.startsWith('file://')) {
    return 'file://' + trimmed.slice('file://'.length).replace(/\\/g, '/').replace(/^\/+/, '');
  }
  return null;
}

/** The scope a URI belongs to: `gs://<bucket>` or `file://`. */
export function scopeOf(uri: string): string {
  const gs = /^gs:\/\/([^/]+)\//.exec(uri);
  if (gs) return `gs://${gs[1]}`;
  return uri.startsWith('file://') ? 'file://' : 'unknown';
}

/** One URI per line; blank lines and `#` comments ignored. */
export function parseReferences(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const uri = normaliseUri(line);
    if (uri) out.add(uri);
  }
  return out;
}

/**
 * A storage inventory. Accepts plain URIs, one per line, or `gsutil ls -l`
 * output (`<size>  <timestamp>  gs://…`). Directory lines, bucket headings and
 * the TOTAL line are skipped.
 */
export function parseInventory(text: string): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('TOTAL:')) continue;
    const parts = line.split(/\s+/);
    const candidate = parts[parts.length - 1];
    if (candidate.endsWith('/') || candidate.endsWith(':')) continue;
    const uri = normaliseUri(candidate);
    if (!uri) continue;
    let updated: Date | null = null;
    if (parts.length >= 3) {
      const parsed = new Date(parts[parts.length - 2]);
      if (!Number.isNaN(parsed.getTime())) updated = parsed;
    }
    out.push({ uri, updated });
  }
  return out;
}

export function compareObjects(
  references: Set<string>,
  inventory: InventoryEntry[],
  options: { now: Date; minAgeHours: number }
): ObjectAuditReport {
  const scopes = new Set(inventory.map((entry) => scopeOf(entry.uri)));
  const present = new Set(inventory.map((entry) => entry.uri));
  const cutoff = options.now.getTime() - options.minAgeHours * 3_600_000;

  const unreferenced: string[] = [];
  const recent: string[] = [];
  let matched = 0;
  for (const entry of inventory) {
    if (references.has(entry.uri)) {
      matched += 1;
      continue;
    }
    // No timestamp means age unknown: judged, because an inventory without
    // dates is the operator's choice and the list is for review anyway.
    if (entry.updated && entry.updated.getTime() > cutoff) recent.push(entry.uri);
    else unreferenced.push(entry.uri);
  }

  const missing: string[] = [];
  let outOfScope = 0;
  for (const uri of references) {
    if (!scopes.has(scopeOf(uri))) {
      outOfScope += 1;
      continue;
    }
    if (!present.has(uri)) missing.push(uri);
  }

  return {
    label: REPORT_LABEL,
    referencesRead: references.size,
    inventoryRead: inventory.length,
    scopes: [...scopes].sort(),
    matched,
    unreferencedObjects: unreferenced.sort(),
    tooRecentToJudge: recent.sort(),
    referencesWithoutObjects: missing.sort(),
    referencesOutOfScope: outOfScope,
  };
}
