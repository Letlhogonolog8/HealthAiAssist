/**
 * Where the model looked, for a scan it has already scored.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * inference/server.py has produced Grad-CAM overlays behind an `explain` form
 * field since the service was written, and nothing on this side ever sent it.
 * A radiologist deciding whether to trust a flag was given a probability and no
 * way to check it against the image — which is the difference between a tool
 * and a black box, and the standard way of catching a dermatology model keying
 * on a ruler or dermoscope vignetting rather than the lesion.
 *
 * ── Why on demand, not at submission ───────────────────────────────────────
 *
 * A heatmap is tens of kilobytes of PNG and a second forward-and-backward pass.
 * Most scans are never opened with the question "where did it look?", and the
 * submission path is a patient waiting. Generating it when a clinician asks
 * keeps the patient's request fast and the scans table small. It also means
 * the explanation is always of the model *currently deployed* — which is why
 * the fingerprint check below is not optional.
 *
 * ── What it refuses to explain ─────────────────────────────────────────────
 *
 * - A scan with no model result. The model declined, or never ran; a heatmap
 *   over it would suggest it had an opinion. Nothing was assessed, and the
 *   refusal says so in the same words the rest of the platform uses.
 * - A result from a different artifact. If the deployed model's fingerprint is
 *   not the one recorded on the scan, re-running it would explain a decision
 *   nobody made. Refused, with both fingerprints, rather than caveated.
 * - A patient who has since withdrawn consent. The original result was produced
 *   under consent that was live at the time; running their image through the
 *   model again is new processing, and it does not happen without it.
 *
 * The heatmap's own caveat — that it is not a lesion boundary and a plausible
 * heatmap is not confirmation — is generated alongside the image in
 * inference/gradcam.py and passed through unedited. It travels with the image
 * because a heatmap shown without it becomes evidence in someone's memory.
 */
import fs from 'node:fs';
import path from 'node:path';

import { infer, isInferenceServerConfigured, InferenceBusyError } from './inference-client';
import { governanceStatus } from './model-governance';
import { modelVersionFor, type Modality } from './model-fingerprint';
import { getSignedScanUrl } from './google-cloud-service';
import { hasAiAnalysisConsent } from './privacy/ai-analysis-consent';

/** The columns this needs from a medical_scans row. */
export interface ExplainableScan {
  id: number;
  patientId: number;
  scanType: string;
  imagePath: string | null;
  modelVersion: string | null;
  predictedPositive: boolean | null;
}

export type ExplanationRefusal =
  | 'no_model_result'
  | 'unsupported_modality'
  | 'explanations_unavailable'
  | 'model_not_serving'
  | 'model_changed'
  | 'consent_withdrawn'
  | 'image_missing'
  | 'inference_busy'
  | 'explanation_failed';

export type ExplanationResult =
  | {
      ok: true;
      scanId: number;
      modality: Modality;
      modelVersion: string;
      explanation: { heatmapPng: string; method: string; caveat: string };
      /**
       * Whether the re-run reproduced the stored call. Same bytes through the
       * same artifact should be deterministic; a disagreement is reported, not
       * hidden, because it would mean the stored result and this heatmap are
       * about different decisions.
       */
      agreesWithStoredResult: boolean;
      rerunPrediction: string;
    }
  | {
      ok: false;
      status: number;
      code: ExplanationRefusal;
      message: string;
      detail?: Record<string, unknown>;
    };

/**
 * Reads a stored scan image back as bytes.
 *
 * The image route redirects the browser to a signed URL; here the bytes are
 * needed server-side, so the same short-lived URL is fetched directly. The
 * local-disk branch mirrors the containment check in the image route: the path
 * is generated server-side, but resolving and checking it costs nothing.
 */
export async function readScanImageBytes(imagePath: string): Promise<Buffer | null> {
  if (imagePath.startsWith('gs://')) {
    const url = await getSignedScanUrl(imagePath, 2);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (imagePath.startsWith('file://')) {
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const absolute = path.resolve(uploadsRoot, imagePath.slice('file://'.length));
    if (!absolute.startsWith(uploadsRoot + path.sep)) return null;
    if (!fs.existsSync(absolute)) return null;
    return fs.promises.readFile(absolute);
  }

  return null;
}

/** Maps the inference service's label to the boolean the scans table stores. */
function isPositiveCall(modality: Modality, prediction: string): boolean {
  return modality === 'skin' ? prediction === 'malignant' : prediction === 'cancer';
}

const REFUSED_PREDICTIONS = new Set(['rejected_input', 'unavailable', 'Error', '']);

export async function explainScan(scan: ExplainableScan): Promise<ExplanationResult> {
  // 1. Was anything assessed? A null predicted_positive is the platform's
  //    record that the model did not produce a call — refused, unconsented, or
  //    unavailable. There is nothing to explain, and the response must not read
  //    as though there were.
  if (scan.predictedPositive === null || scan.predictedPositive === undefined || !scan.modelVersion) {
    return {
      ok: false,
      status: 409,
      code: 'no_model_result',
      message:
        'No model result was produced for this scan, so there is nothing to explain. ' +
        'This is NOT a negative finding: nothing was assessed.',
    };
  }

  const modality = scan.scanType as Modality;
  if (modality !== 'lung' && modality !== 'skin' && modality !== 'lung_nodule') {
    return {
      ok: false,
      status: 409,
      code: 'unsupported_modality',
      message: `No explanation is available for scan type "${scan.scanType}".`,
    };
  }

  // 2. Is this model allowed to run at all? Checked before the transport
  //    question, because the answer does not depend on it: a withdrawn model's
  //    result is not re-run over any transport, and the reason a clinician
  //    reads should be the withdrawal, not "the service is not configured".
  const governance = await governanceStatus(modality);
  if (!governance.mayServe) {
    return {
      ok: false,
      status: 409,
      code: 'model_not_serving',
      message: `The ${modality} model is not currently serving: ${governance.explanation}`,
      detail: { governanceState: governance.state },
    };
  }

  // 3. The subprocess fallback runs a plain classifier script; only the
  //    resident service renders heatmaps.
  if (!isInferenceServerConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'explanations_unavailable',
      message:
        'Explanations need the resident inference service (INFERENCE_URL). ' +
        'The stored result stands; only the heatmap is unavailable.',
    };
  }

  // Same artifact, or nothing. The governance gate above refuses to serve a
  // drifted model; this adds the tighter check that the model serving now is
  // the one that produced *this* result.

  const deployedVersion = await modelVersionFor(modality);
  if (deployedVersion !== scan.modelVersion) {
    return {
      ok: false,
      status: 409,
      code: 'model_changed',
      message:
        `The deployed ${modality} model is not the one that produced this result. ` +
        'A heatmap from it would explain a different decision.',
      detail: { deployedModelVersion: deployedVersion, scanModelVersion: scan.modelVersion },
    };
  }

  // 4. Consent as it stands now, not as it stood at submission.
  if (!(await hasAiAnalysisConsent(scan.patientId))) {
    return {
      ok: false,
      status: 409,
      code: 'consent_withdrawn',
      message:
        'The patient does not currently consent to automated image analysis. ' +
        'The image will not be run through the model again.',
    };
  }

  // 5. The bytes.
  if (!scan.imagePath) {
    return {
      ok: false,
      status: 404,
      code: 'image_missing',
      message: 'No image is stored for this scan, so nothing can be rendered over it.',
    };
  }
  const image = await readScanImageBytes(scan.imagePath);
  if (!image) {
    return {
      ok: false,
      status: 404,
      code: 'image_missing',
      message: 'The stored image for this scan could not be read.',
    };
  }

  // 6. Re-run with explain=true. The nodule characteriser is a question about
  //    a marked region, so the mark recorded with the result travels with the
  //    re-run; without it there is no region to explain.
  let region: { cx: number; cy: number } | null = null;
  if (modality === 'lung_nodule') {
    const { storage } = await import('./storage');
    const marks = (await storage.getScanRegions(scan.id)).filter((r) => r.source === 'clinician');
    if (!marks.length || marks[0].cx === null || marks[0].cy === null) {
      return {
        ok: false,
        status: 409,
        code: 'no_model_result',
        message:
          'No marked region is recorded for this scan, so the characterisation cannot be re-run. ' +
          'This is NOT a negative finding.',
      };
    }
    region = { cx: marks[0].cx, cy: marks[0].cy };
  }

  let result: any;
  try {
    result = await infer(modality, image, modality === 'lung_nodule' ? 'slice.dcm' : 'scan.jpg', {
      explain: true,
      region,
    });
  } catch (error) {
    if (error instanceof InferenceBusyError) {
      return {
        ok: false,
        status: 503,
        code: 'inference_busy',
        message: 'The inference service is at capacity. Try again shortly.',
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'explanation_failed',
      message: 'The inference service did not return a result.',
      detail: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  const prediction = String(result?.prediction ?? '');
  if (REFUSED_PREDICTIONS.has(prediction)) {
    // The model refused this time (an OOD screen or artifact problem). The
    // stored result is not retracted here — that is a separate question — but
    // there is no heatmap to show.
    return {
      ok: false,
      status: 409,
      code: 'explanation_failed',
      message: 'The model declined to score this image on re-run, so no heatmap was rendered.',
      detail: { rerunPrediction: prediction, reason: result?.reason ?? result?.message ?? null },
    };
  }

  if (!result?.explanation?.heatmapPng) {
    return {
      ok: false,
      status: 502,
      code: 'explanation_failed',
      message: result?.explanationError ?? 'The explanation could not be generated for this image.',
    };
  }

  return {
    ok: true,
    scanId: scan.id,
    modality,
    modelVersion: deployedVersion,
    explanation: {
      heatmapPng: String(result.explanation.heatmapPng),
      method: String(result.explanation.method ?? 'Grad-CAM'),
      caveat: String(result.explanation.caveat ?? ''),
    },
    agreesWithStoredResult: isPositiveCall(modality, prediction) === scan.predictedPositive,
    rerunPrediction: prediction,
  };
}
