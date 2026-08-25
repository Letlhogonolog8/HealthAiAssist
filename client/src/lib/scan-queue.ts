/**
 * Scans captured while offline, waiting for a connection.
 *
 * ── The rule this file exists to enforce ───────────────────────────────────
 *
 * **The queue holds an upload. It never holds a result.**
 *
 * That is not a simplification to be revisited later. This platform's entire
 * position is that it refuses rather than guesses: it returns 503 with no
 * diagnostic content when no validated model can run, it rejects images unlike
 * its training distribution instead of classifying them, and it withholds a
 * polygenic percentile where the reference population does not describe the
 * patient. An offline mode that showed a cached, estimated or optimistic
 * result would contradict all of that in the one situation where a patient is
 * least able to check — no connection, no clinician, no second opinion.
 *
 * So a queued scan has exactly two visible states: waiting to upload, and
 * uploaded. There is no third state in which it means anything clinically.
 *
 * ── Why IndexedDB rather than localStorage ─────────────────────────────────
 *
 * localStorage is synchronous, string-only and capped at a few megabytes. A
 * scan is a binary blob up to 10 MB. Storing it would mean base64 (a 33% size
 * penalty on top of an already tight budget) written synchronously on the main
 * thread. IndexedDB stores Blobs natively and asynchronously.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type QueuedScanStatus = 'pending' | 'uploading' | 'failed';

export interface QueuedScan {
  id: string;
  scanType: string;
  /** The image itself. Stored as a Blob, not base64. */
  image: Blob;
  fileName: string;
  /** Whose scan this is. Staff may capture on a patient's behalf. */
  patientId?: number;
  capturedAt: number;
  status: QueuedScanStatus;
  attempts: number;
  /** Why the last attempt failed, if it did. Never a clinical statement. */
  lastError?: string;
}

interface ScanQueueDB extends DBSchema {
  scans: {
    key: string;
    value: QueuedScan;
    indexes: { 'by-captured': number };
  };
}

const DB_NAME = 'healthai-scan-queue';
const DB_VERSION = 1;
const STORE = 'scans';

let dbPromise: Promise<IDBPDatabase<ScanQueueDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<ScanQueueDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by-captured', 'capturedAt');
      },
    });
  }
  return dbPromise;
}

/**
 * Whether this browser can queue at all.
 *
 * IndexedDB is absent or unusable in a few real situations — Firefox private
 * browsing historically, some embedded webviews, and any context where the user
 * has blocked site data. Callers check this and fall back to telling the user
 * the upload cannot be held, rather than silently accepting a scan that is
 * going nowhere.
 */
export function queueAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

export async function enqueue(entry: {
  scanType: string;
  image: Blob;
  fileName: string;
  patientId?: number;
}): Promise<QueuedScan> {
  const queued: QueuedScan = {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scanType: entry.scanType,
    image: entry.image,
    fileName: entry.fileName,
    patientId: entry.patientId,
    capturedAt: Date.now(),
    status: 'pending',
    attempts: 0,
  };

  const database = await db();
  await database.put(STORE, queued);
  notify();
  return queued;
}

/** Oldest first: a queue that reorders itself is a queue nobody can predict. */
export async function listQueued(): Promise<QueuedScan[]> {
  const database = await db();
  return database.getAllFromIndex(STORE, 'by-captured');
}

export async function countQueued(): Promise<number> {
  const database = await db();
  return database.count(STORE);
}

export async function remove(id: string): Promise<void> {
  const database = await db();
  await database.delete(STORE, id);
  notify();
}

async function update(id: string, patch: Partial<QueuedScan>): Promise<void> {
  const database = await db();
  const existing = await database.get(STORE, id);
  if (!existing) return;
  await database.put(STORE, { ...existing, ...patch });
  notify();
}

// ---------------------------------------------------------------------------
// Change notification
//
// A plain event target rather than a React store, so that the flush loop — which
// runs outside React, triggered by an `online` event or the service worker — can
// tell the UI something moved without either side importing the other.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a broken listener must not stop the flush */
    }
  });
}

// ---------------------------------------------------------------------------
// Flushing
// ---------------------------------------------------------------------------

export interface FlushResult {
  uploaded: number;
  failed: number;
  remaining: number;
}

let flushing = false;

/**
 * Uploads everything queued, oldest first.
 *
 * Sequential, not parallel. The server meters scan submission at twelve per
 * five minutes and each inference occupies a resident model for around half a
 * second; firing a reconnected queue at it in parallel would collect 429s and
 * count them as failures. One at a time also means a queue that partially
 * uploads leaves a coherent record rather than an interleaved one.
 *
 * Re-entrant calls are ignored: `online` can fire more than once, and the
 * service worker may trigger a sync at the same moment.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing || !queueAvailable()) {
    return { uploaded: 0, failed: 0, remaining: await safeCount() };
  }

  flushing = true;
  let uploaded = 0;
  let failed = 0;

  try {
    const pending = await listQueued();

    for (const scan of pending) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;

      await update(scan.id, { status: 'uploading' });

      try {
        const form = new FormData();
        form.append('image', scan.image, scan.fileName);
        form.append('scanType', scan.scanType);
        if (scan.patientId !== undefined) {
          form.append('patientId', String(scan.patientId));
        }

        const response = await fetch('/api/scan/upload', {
          method: 'POST',
          body: form,
          credentials: 'include',
        });

        if (response.ok) {
          await remove(scan.id);
          uploaded += 1;
          continue;
        }

        // 4xx that is not 429 will not succeed on a retry: a rejected image, a
        // modality with no model, an expired session. Those come off the queue
        // and are surfaced, rather than being retried forever on every
        // reconnection.
        const permanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;

        let message = `Upload failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {
          /* non-JSON body */
        }

        if (permanent) {
          await update(scan.id, {
            status: 'failed',
            attempts: scan.attempts + 1,
            lastError: message,
          });
        } else {
          await update(scan.id, {
            status: 'pending',
            attempts: scan.attempts + 1,
            lastError: message,
          });
        }
        failed += 1;
      } catch (error) {
        // A transport failure means the connection went away again mid-flush.
        // Back to pending, and stop: the rest will not fare better.
        await update(scan.id, {
          status: 'pending',
          attempts: scan.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Network error',
        });
        failed += 1;
        break;
      }
    }
  } finally {
    flushing = false;
  }

  return { uploaded, failed, remaining: await safeCount() };
}

async function safeCount(): Promise<number> {
  try {
    return await countQueued();
  } catch {
    return 0;
  }
}

/**
 * Starts flushing whenever the browser regains a connection.
 *
 * Background Sync would be the better mechanism — it survives the tab being
 * closed — but it is Chromium-only, so this is the floor rather than the
 * ceiling. Registered alongside it, not instead: whichever fires first wins,
 * and `flushQueue` ignores the second.
 */
export function installQueueFlushOnReconnect(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => {
    void flushQueue();
  };

  window.addEventListener('online', handler);

  // Also on load, in case the connection returned while the tab was closed.
  if (navigator.onLine) void flushQueue();

  return () => window.removeEventListener('online', handler);
}
