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
  modality: 'skin' | 'lung',
  imageBuffer: Buffer,
  filename = 'scan'
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
