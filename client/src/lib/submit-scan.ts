/**
 * The one place that decides whether a scan is uploaded now or queued.
 *
 * Six components posted a scan before this existed — the multi-cancer uploader,
 * the skin and lung analysers, the real-time skin scanner, the Google scanner
 * and the scan simulator — each building its own FormData and calling fetch
 * directly. Adding offline support to six call sites means six chances to get
 * the rule wrong, and the rule here is one a mistake would badly undermine:
 *
 *   **Queued means queued. It never means "assume benign".**
 *
 * Centralising it also fixes an inconsistency that was already there: three
 * components posted to /api/scan/upload and two to /api/scans/analyze. Both
 * routes run the same handler, so nothing was broken, but two names for one
 * operation is how they drift apart later.
 */
import { enqueue, queueAvailable, flushQueue } from './scan-queue';

export type SubmitOutcome =
  | { kind: 'analysed'; body: any }
  | { kind: 'queued'; queuedId: string; reason: 'offline' }
  | { kind: 'rejected'; status: number; body: any };

export interface SubmitInput {
  image: Blob;
  fileName: string;
  scanType: string;
  patientId?: number;
}

/** Best available guess at whether a request can reach the server. */
function probablyOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Submits a scan, queueing it if there is no connection.
 *
 * Returns a discriminated union rather than throwing on a refusal, because the
 * three outcomes need three different presentations and none of them is an
 * error in the programming sense:
 *
 *   analysed — a model ran and produced a finding.
 *   queued   — nothing has been analysed. Say so plainly.
 *   rejected — the server declined: the image was not assessable (422), no
 *              validated model was available (503), the rate limit was reached
 *              (429). A 503 in particular is NOT a negative result, and the
 *              caller must not render it as one.
 */
export async function submitScan(input: SubmitInput): Promise<SubmitOutcome> {
  if (probablyOffline() && queueAvailable()) {
    const queued = await enqueue({
      scanType: input.scanType,
      image: input.image,
      fileName: input.fileName,
      patientId: input.patientId,
    });
    return { kind: 'queued', queuedId: queued.id, reason: 'offline' };
  }

  const form = new FormData();
  form.append('image', input.image, input.fileName);
  form.append('scanType', input.scanType);
  if (input.patientId !== undefined) {
    form.append('patientId', String(input.patientId));
  }

  let response: Response;
  try {
    response = await fetch('/api/scan/upload', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
  } catch {
    // navigator.onLine was optimistic — it reports link state, not reachability,
    // so it says true on a captive portal or a dead uplink. The request failing
    // is the more reliable signal, and queueing here is what makes the feature
    // work on the connections it is actually for.
    if (queueAvailable()) {
      const queued = await enqueue({
        scanType: input.scanType,
        image: input.image,
        fileName: input.fileName,
        patientId: input.patientId,
      });
      return { kind: 'queued', queuedId: queued.id, reason: 'offline' };
    }
    throw new Error('No connection, and this browser cannot hold the scan for later.');
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!response.ok) {
    return { kind: 'rejected', status: response.status, body };
  }

  // A successful upload is a good moment to drain anything left over from an
  // earlier outage, since the connection is demonstrably working.
  void flushQueue();

  return { kind: 'analysed', body };
}

/**
 * The message to show for a refusal.
 *
 * Kept here so every caller says the same thing, and so the 503 wording stays
 * unambiguous. "No result" and "a negative result" are different, and the
 * difference is the whole point.
 */
export function describeRejection(status: number, body: any): { title: string; description: string } {
  if (status === 422) {
    const reasons: string[] = Array.isArray(body?.reasons) ? body.reasons : [];
    return {
      title: 'Image could not be assessed',
      description:
        reasons[0] ??
        'This image is not something the model can assess. Submit a clearer image of the right type.',
    };
  }

  if (status === 503) {
    return {
      title: 'No analysis was produced',
      description:
        body?.message ??
        'No validated model could analyse this scan, so nothing was assessed. This is not a negative result — the scan has been queued for a clinician to review.',
    };
  }

  if (status === 429) {
    return {
      title: 'Too many scans',
      description: 'Please wait a little before submitting another scan.',
    };
  }

  if (status === 401) {
    return {
      title: 'Sign in required',
      description: 'Your session has expired. Sign in and try again.',
    };
  }

  return {
    title: 'Upload failed',
    description: body?.error ?? `The server returned ${status}.`,
  };
}
