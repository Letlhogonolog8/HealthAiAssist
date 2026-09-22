/**
 * Talks to the long-running inference service, when one is configured.
 *
 * Set INFERENCE_URL to use it. Leave it unset and the callers fall back to
 * spawning Python per request, which is how local development works without a
 * second process running.
 *
 * ── Why the fallback stays ─────────────────────────────────────────────────
 *
 * Not out of caution — out of correctness. `scripts/evaluate-model.py` and the
 * reproduction commands printed in MODEL_CARDS.md invoke the same modules
 * directly on the command line, and those have to keep working or the published
 * figures stop being checkable by anyone. Since the CLI path must exist anyway,
 * keeping the server able to use it costs nothing and means a misconfigured
 * INFERENCE_URL degrades to slow rather than to broken.
 *
 * It is logged loudly, once, because slow-and-working is exactly the sort of
 * thing that survives to production unnoticed.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 *
 * It does not interpret results. The service returns the same JSON the Python
 * modules produce on the command line — including the refusal shapes,
 * `rejected_input` and `unavailable` — and the callers already know how to read
 * those. A transport that reshapes payloads is a transport that can disagree
 * with the thing it is transporting.
 */

/** Configured endpoint, without a trailing slash. Empty when not configured. */
function baseUrl(): string {
  return (process.env.INFERENCE_URL || '').replace(/\/$/, '');
}

export function isInferenceServerConfigured(): boolean {
  return baseUrl().length > 0;
}

/**
 * How long to wait for a verdict.
 *
 * Generous relative to the ~500 ms a warm inference takes, because the service
 * serialises work behind a lock: a request arriving during a burst waits for
 * the ones ahead of it, and timing that out would convert a queue into a
 * failure. Short enough that a wedged service is noticed rather than holding
 * request handlers open indefinitely.
 */
const TIMEOUT_MS = Number.parseInt(process.env.INFERENCE_TIMEOUT_MS ?? '', 10) || 30_000;

/**
 * In-flight cap on this side of the wire.
 *
 * The service has its own bounded queue and answers 503 past it. This exists so
 * that Node does not sit on hundreds of open sockets and half-read request
 * bodies waiting to find that out — backpressure is cheaper applied early. Kept
 * a little above the service's own depth so the service's limit is the one that
 * actually governs.
 */
const MAX_IN_FLIGHT = Number.parseInt(process.env.INFERENCE_MAX_IN_FLIGHT ?? '', 10) || 24;

/**
 * How long a whole series may take.
 *
 * A 300-slice study is 300 de-identifications and 300 re-serialisations, and
 * the work is proportional to the study rather than to one request. Ten
 * minutes is generous for the largest series the limits allow and still short
 * enough that a wedged service is noticed.
 */
const SERIES_TIMEOUT_MS =
  Number.parseInt(process.env.INFERENCE_SERIES_TIMEOUT_MS ?? '', 10) || 600_000;
let inFlight = 0;

/** Raised when the local cap is hit. Distinct so callers can answer 503, not 500. */
export class InferenceBusyError extends Error {
  constructor() {
    super('Inference service is saturated');
    this.name = 'InferenceBusyError';
  }
}

let fallbackWarned = false;

/** Says once, per process, that the slow path is in use. */
export function warnIfFallingBack(modality: string): void {
  if (isInferenceServerConfigured() || fallbackWarned) return;
  fallbackWarned = true;
  console.warn(
    `⚠️  INFERENCE_URL is not set. Falling back to spawning Python per ${modality} ` +
      'scan: roughly 8-14 s each, one TensorFlow process per request, and no ' +
      'concurrency ceiling. Acceptable in development; set INFERENCE_URL in ' +
      'production (see inference/server.py).'
  );
}

/**
 * POSTs an image to the service and returns the parsed body.
 *
 * Throws on transport failure so the caller can decide what that means — for
 * both current callers it means ModelUnavailableError, because a scan that
 * could not be analysed must not become a scan that was analysed and found
 * nothing.
 */
export async function infer(
  modality: 'skin' | 'lung' | 'lung_nodule',
  imageBuffer: Buffer,
  filename = 'scan',
  options: { explain?: boolean; region?: { cx: number; cy: number } | null } = {}
): Promise<any> {
  const base = baseUrl();
  if (!base) {
    throw new Error('INFERENCE_URL is not configured');
  }

  if (inFlight >= MAX_IN_FLIGHT) {
    throw new InferenceBusyError();
  }

  inFlight += 1;
  try {
    const form = new FormData();
    // Uint8Array rather than the Buffer directly: Blob copies from a typed
    // array without reinterpreting it, and Buffer's own view offset has caught
    // people out here before.
    form.append(
      'image',
      new Blob([new Uint8Array(imageBuffer)], { type: 'application/octet-stream' }),
      filename
    );
    // Opt-in only. A Grad-CAM pass is a second forward-and-backward run and a
    // PNG in the payload; the submission path never asks for it, and
    // scan-explanation.ts asks for it on a clinician's request.
    if (options.explain) {
      form.append('explain', 'true');
    }
    // The clinician's mark, for the nodule characteriser. Pixels of the
    // rendered frame; the service validates them against the frame.
    if (options.region) {
      form.append('cx', String(options.region.cx));
      form.append('cy', String(options.region.cy));
    }

    const response = await fetch(`${base}/infer/${modality}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 503) {
      throw new InferenceBusyError();
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Inference service returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
      );
    }

    return await response.json();
  } finally {
    inFlight -= 1;
  }
}

/**
 * De-identifies a DICOM object without running a model.
 *
 * For the paths that store an object but do not analyse it. Returns null when
 * the service is not configured — the caller then stores nothing rather than
 * the identified original.
 */
export async function deidentifyDicom(
  imageBuffer: Buffer
): Promise<{ deidentifiedObject: Buffer; acquisition: Record<string, any>; previewPng: string } | null> {
  const base = baseUrl();
  if (!base) return null;
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'application/dicom' }), 'object.dcm');
  const response = await fetch(`${base}/deidentify`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`De-identification failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }
  const body = await response.json();
  return {
    deidentifiedObject: Buffer.from(String(body.deidentifiedObject), 'base64'),
    acquisition: body.acquisition ?? {},
    previewPng: String(body.previewPng ?? ''),
  };
}

/** One event from the series ingestion stream. */
export type SeriesIngestEvent =
  | { kind: 'manifest'; manifest: SeriesManifest }
  | { kind: 'instance'; index: number; sopInstanceUid: string; positionMm: number | null; object: Buffer }
  | { kind: 'failed'; index: number; reason: string }
  | { kind: 'complete'; instanceCount: number };

export interface SeriesManifest {
  accepted: boolean;
  stage: string;
  uidMappingScope: 'deployment' | 'ingestion';
  assembly: { uploaded: number; unique: number; duplicatesDropped: number; modality: string };
  ordering: {
    method: string;
    trusted: boolean;
    problems: string[];
    warnings: string[];
    medianSpacingMm: number | null;
  };
  qualityGate: {
    passed: boolean;
    failures: Array<{ code: string; message: string; [key: string]: unknown }>;
    warnings: string[];
    measurements: Record<string, unknown>;
    anatomyVerified: boolean;
  };
  instanceCount: number;
  study: { studyInstanceUid: string | null };
  series: {
    seriesInstanceUid: string;
    modality: string;
    rows: number;
    columns: number;
    pixelSpacingMm: number[] | null;
    sliceThicknessMm: number | null;
    manufacturer: string;
    manufacturerModel: string;
    convolutionKernel: string;
    bodyPartExamined: string | null;
  };
}

/** A rejected series: the verdict arrives as a 422 body rather than a stream. */
export class SeriesRejectedError extends Error {
  readonly body: any;
  constructor(body: any) {
    // A refusal before the gate carries `reasons`; the gate's own verdict
    // carries `qualityGate.failures` instead. Reading only the first meant a
    // gated series logged "The series was rejected." with the reason sitting
    // in the body, unread — the message an operator sees first is the one
    // worth spending a line on.
    super(
      body?.reasons?.[0]?.message ??
        body?.qualityGate?.failures?.[0]?.message ??
        'The series was rejected.'
    );
    this.name = 'SeriesRejectedError';
    this.body = body;
  }
}

/**
 * Streams one CT series through assembly, ordering, the quality gate and
 * de-identification.
 *
 * ── Why this is a stream and not a call that returns a result ───────────
 *
 * A 133-slice chest CT is about 70 MB of pixel data, and every de-identified
 * object has to come back so it can be stored. As one JSON document that is
 * ~93 MB of base64 materialised whole on both sides; as a stream it is one
 * slice at a time on each. The service emits newline-delimited JSON — the
 * verdict first, then one event per slice in anatomical order — and this
 * yields them as they arrive so the caller can write each object and drop it.
 *
 * The files are opened as lazy Blobs rather than read into memory: undici
 * streams them from disk, so a 300-slice upload never exists in this process
 * as a buffer.
 *
 * A rejected series throws SeriesRejectedError carrying the structured
 * verdict, and no pixel data is sent at all — so a caller cannot half-store
 * something it was not allowed to store.
 */
export async function* ingestDicomSeries(
  filePaths: string[]
): AsyncGenerator<SeriesIngestEvent> {
  const base = baseUrl();
  if (!base) {
    throw new Error('INFERENCE_URL is not configured');
  }

  const { openAsBlob } = await import('node:fs');
  const form = new FormData();
  for (const [index, filePath] of filePaths.entries()) {
    form.append('files', await openAsBlob(filePath), `${index}.dcm`);
  }

  const response = await fetch(`${base}/ingest/series`, {
    method: 'POST',
    body: form,
    // Deliberately longer than the per-image timeout: a 300-slice series is
    // 300 de-identifications, and timing that out would convert slow into
    // broken.
    signal: AbortSignal.timeout(SERIES_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 422 && body) throw new SeriesRejectedError(body);
    const detail = body ? JSON.stringify(body).slice(0, 300) : await response.text().catch(() => '');
    throw new Error(`Series ingestion failed: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  if (!response.body) throw new Error('The inference service returned no stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let sawManifest = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;

      const payload = JSON.parse(line);
      if (!sawManifest) {
        sawManifest = true;
        if (!payload.accepted) throw new SeriesRejectedError(payload);
        yield { kind: 'manifest', manifest: payload as SeriesManifest };
        continue;
      }
      if (payload.event === 'instance') {
        yield {
          kind: 'instance',
          index: payload.index,
          sopInstanceUid: payload.sopInstanceUid,
          positionMm: payload.positionMm ?? null,
          object: Buffer.from(String(payload.object), 'base64'),
        };
      } else if (payload.event === 'instance_failed') {
        yield { kind: 'failed', index: payload.index, reason: payload.reason };
      } else if (payload.event === 'complete') {
        yield { kind: 'complete', instanceCount: payload.instanceCount };
      }
    }
  }

  if (!sawManifest) throw new Error('The inference service closed the stream without a verdict.');
}

/** Liveness and which artifacts are resident. Used by /api/ready. */
export async function inferenceHealth(): Promise<
  { configured: false } | { configured: true; reachable: boolean; detail: any }
> {
  const base = baseUrl();
  if (!base) return { configured: false };

  try {
    const response = await fetch(`${base}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { configured: true, reachable: false, detail: { status: response.status } };
    }
    return { configured: true, reachable: true, detail: await response.json() };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
