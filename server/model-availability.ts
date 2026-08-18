/**
 * Signals that no validated model was able to produce a result for a scan.
 *
 * The rule this enforces: when a model cannot run, or has not been shown to
 * work, the system produces NO diagnostic output. It does not guess, average, or
 * default. A fabricated "no malignancy detected" is indistinguishable from a real
 * negative once it reaches a patient record, so the only safe behaviour is to
 * fail loudly and route the scan to a human reviewer.
 *
 * Callers should catch this, persist the scan with status
 * `pending_manual_review`, and return HTTP 503.
 */
export class ModelUnavailableError extends Error {
  /** Modality that was requested, e.g. "lung", "skin". */
  readonly scanType: string;
  /** Machine-readable reason, surfaced in the API response. */
  readonly reason: string;

  constructor(scanType: string, reason: string) {
    super(`No validated model available for "${scanType}": ${reason}`);
    this.name = 'ModelUnavailableError';
    this.scanType = scanType;
    this.reason = reason;
  }
}

/**
 * Signals that the submitted image is not something the model can assess.
 *
 * Distinct from `ModelUnavailableError`: the model is fine, the input is not.
 * A classifier answers whatever it is given — fed a chest X-ray, the skin model
 * returns a confident melanoma verdict — so inputs are screened before
 * classification. The remedy is different too: submit a usable image, rather
 * than wait for a model to come back.
 */
export class InputRejectedError extends Error {
  readonly scanType: string;
  /** Human-readable reasons, safe to show the person who uploaded the image. */
  readonly reasons: string[];

  constructor(scanType: string, reasons: string[]) {
    super(`Input rejected for "${scanType}": ${reasons.join(' ')}`);
    this.name = 'InputRejectedError';
    this.scanType = scanType;
    this.reasons = reasons;
  }
}

export interface ModelRegistryEntry {
  /** Whether this model may serve predictions to users. */
  enabled: boolean;
  /** Why it is disabled, if it is. Surfaced in the 503 response. */
  disabledReason?: string;
  /**
   * Measured performance on a labelled evaluation set. Reproduce with:
   *   python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>
   * `null` means not yet measured — which is itself a reason to stay disabled.
   */
  evaluation: {
    dataset: string;
    /** Mean of sensitivity and specificity. 0.5 == chance. */
    balancedAccuracy: number;
    /** Recall on the disease-positive class. */
    sensitivity: number;
    /** Recall on the disease-negative class. */
    specificity: number;
    preprocessing: string;
    caveats: string;
  } | null;
}

/**
 * Every image model this server can serve, and whether it is allowed to.
 *
 * A modality is enabled only when a trained artifact exists AND its measured
 * balanced accuracy beats chance. Both models here were previously advertised
 * with hardcoded accuracy figures (skin 96%, lung 91%) that were never measured
 * from anything; the numbers below are from actual evaluation runs.
 */
export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  lung: {
    enabled: true,
    evaluation: {
      dataset:
        'Held-out test split, 554 images (282 cancer / 272 no_cancer), never used ' +
        'in training or model selection',
      balancedAccuracy: 0.785,
      sensitivity: 0.8121,  // cancer correctly flagged, at the deployed threshold
      specificity: 0.757,   // no_cancer correctly cleared
      preprocessing: 'raw RGB 0-255 — normalisation is fused into the model graph',
      caveats:
        'Retrained 2026-08-18 with a genuine three-way split. The previous figures ' +
        '(0.75 balanced accuracy) came from the directory used as the validation ' +
        'generator during that model\'s own training, so they were optimistic; no ' +
        'untouched data existed, which is why retraining was necessary rather than ' +
        'just splitting off a test set. Test AUC 0.88. ' +
        'Calibration measured: expected calibration error 0.019, improved to 0.017 ' +
        'by temperature scaling (T=1.125), which IS applied here — unlike the skin ' +
        'model, it improved validation ECE enough to deploy. ' +
        'The decision threshold is 0.30 on the calibrated P(cancer), not argmax: ' +
        'argmax scores a higher balanced accuracy (0.838) but misses 86 of 282 ' +
        'cancers, against 53 at the deployed threshold. That trade is deliberate for ' +
        'screening and is configurable via LUNG_CANCER_THRESHOLD. Even so, roughly ' +
        '1 in 5 cancers is missed and 1 in 4 healthy scans is flagged. ' +
        'Inputs are screened before classification: skin images flag at 100%, ' +
        'held-out chest images at 0.8%. ' +
        'Demographic composition of the training data is unrecorded. ' +
        'Screening triage only; not clinically validated or regulator-cleared.'
    }
  },
  skin: {
    enabled: true,
    evaluation: {
      dataset: 'dataset/dataset/data/test (360 benign / 300 malignant), held out from training',
      balancedAccuracy: 0.8636,
      sensitivity: 0.9133,
      specificity: 0.8139,
      preprocessing: 'raw RGB 0-255 — normalisation is fused into the model graph',
      caveats:
        'Calibration measured on the held-out set: expected calibration error 0.024, '
        + 'Brier 0.098. Temperature scaling was fitted and deliberately NOT applied — '
        + 'it did not improve validation ECE, so the raw output is already usable as a '
        + 'probability. Inputs are screened before classification: images unlike the '
        + 'training distribution are refused rather than classified (chest images flag '
        + 'at 100%, held-out lesions at 0.8%). '
        + 'Retrained 2026-08-13 (frozen ResNet50V2 + trained head); the previous ' +
        'artifact scored at chance. Figures above are at argmax. The service uses ' +
        'banded thresholds (>0.70 malignant, 0.30-0.70 uncertain, <=0.30 benign), ' +
        'at which 10 of 300 malignant lesions (3.3%) receive an outright benign ' +
        'result, 96.7% are flagged or escalated, and 17% of all scans land in the ' +
        'uncertain band. ' +
        'Skin-tone performance was measured using Individual Typology Angle on 511 ' +
        'of 660 test images. Only 4.3% are brown or darker, and only the Light and ' +
        'Very light bins hold enough data to be reliable, so THIS DATASET CANNOT ' +
        'ESTABLISH performance on darker skin. The Dark bin holds 4 images and no ' +
        'benign controls. Absence of a measured disparity is evidence of an ' +
        'unrepresentative test set, not of fairness. ' +
        'Screening triage only; not clinically validated.'
    }
  }
};

/** Modalities that have a trained artifact and are cleared to serve predictions. */
export const SUPPORTED_SCAN_TYPES = Object.keys(MODEL_REGISTRY).filter(
  (key) => MODEL_REGISTRY[key].enabled
);

/**
 * Maps a free-text scan type onto a registry key.
 * Returns the key even when disabled, so callers can report *why* it is refused
 * rather than the less useful "no such modality".
 */
export function resolveScanType(scanType: string): string | null {
  const normalized = (scanType || '').toLowerCase();
  return Object.keys(MODEL_REGISTRY).find((key) => normalized.includes(key)) ?? null;
}

/**
 * Throws unless `scanType` maps to a model cleared to serve predictions.
 * Call this before running inference, not after.
 */
export function assertModelEnabled(scanType: string): string {
  const key = resolveScanType(scanType);

  if (!key) {
    throw new ModelUnavailableError(
      scanType,
      `No model exists for this modality. Available: ${SUPPORTED_SCAN_TYPES.join(', ') || 'none'}.`
    );
  }

  const entry = MODEL_REGISTRY[key];
  if (!entry.enabled) {
    throw new ModelUnavailableError(key, entry.disabledReason ?? 'Model is disabled.');
  }

  return key;
}
