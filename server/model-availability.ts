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
      dataset: 'dataset/dataset/lung_cancer_MRI_dataset/validate (752 cancer / 492 no_cancer)',
      balancedAccuracy: 0.75,
      sensitivity: 0.904,  // cancer correctly flagged
      specificity: 0.596,  // no_cancer correctly cleared
      preprocessing: 'RGB, resize 224x224, divide by 255',
      caveats:
        'Measured on the validation split, which was likely seen during training — ' +
        'these figures are optimistic. No held-out test set exists for this model. ' +
        'Specificity of 0.596 means roughly 4 in 10 healthy scans are flagged. ' +
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
        'Retrained 2026-08-13 (frozen ResNet50V2 + trained head); the previous ' +
        'artifact scored at chance. Figures above are at argmax. The service uses ' +
        'banded thresholds (>0.70 malignant, 0.30-0.70 uncertain, <=0.30 benign), ' +
        'at which 10 of 300 malignant lesions (3.3%) receive an outright benign ' +
        'result, 96.7% are flagged or escalated, and 17% of all scans land in the ' +
        'uncertain band. Training data provenance and demographic composition are ' +
        'unrecorded, so performance across skin tones is UNKNOWN and must not be ' +
        'assumed uniform. Screening triage only; not clinically validated.'
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
