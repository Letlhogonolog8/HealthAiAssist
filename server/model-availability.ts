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

/**
 * How far a model's evidence reaches. The classes CLAUDE.md requires, in
 * ascending order. Nothing here has reached the last three, and a class can
 * only move up by adding the evidence the next one names — an external test
 * set, a clinical study, a regulator.
 */
export type ModelClass =
  | 'RESEARCH'
  | 'EXPERIMENTAL'
  | 'INTERNAL_VALIDATION'
  | 'EXTERNAL_VALIDATION'
  | 'CLINICAL_VALIDATION'
  | 'PRODUCTION';

export interface ModelRegistryEntry {
  /** Whether this model may serve predictions to users. */
  enabled: boolean;
  /** Why it is disabled, if it is. Surfaced in the 503 response. */
  disabledReason?: string;
  /** Evidence class. Published on the card and in the capability manifest. */
  modelClass: ModelClass;
  /** One line: what this model answers, and for whom. */
  intendedUse: string;
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
  /**
   * Withdrawn 2026-09-20. The figures below are still true of the artifact on
   * its own test set; they were never true of real CT, and the artifact was
   * found to answer real CT anyway.
   *
   * The model card had said this model "refuses every clinical acquisition"
   * because a real CT scored 22.9 against the 16.51 out-of-distribution
   * threshold. That figure came from pydicom's bundled test object —
   * `CT_small.dcm`, a 128×128 GE acquisition from the 1990s — not from chest
   * CT as a scanner produces it today. Measured against the LIDC-IDRI series
   * in `dataset/` on 2026-09-20, through the serving code:
   *
   *   87 whole CT slices at the lung window   median 12.26   flagged 3.4%
   *   12 real DICOMs via dicom_to_png_bytes    median 14.2    11 of 12 accepted
   *   its own web-PNG test set                 median 11.3    (for comparison)
   *
   * Real CT sits inside this model's training distribution in feature space,
   * so the screen cannot separate it and a higher threshold would be tuning
   * the safety check to defeat itself. Only the explicit DICOM-file gate in
   * inference/server.py stopped a DICOM; a PNG export of the same slice — the
   * ordinary way an image leaves a PACS viewer — received a cancer / no_cancer
   * verdict from a model with no measured performance on CT.
   *
   * That is a guess dressed as a result, and the rule is to refuse rather than
   * guess. The record is `scripts/build-ood-reference.py lung --measure-only`,
   * which now exits non-zero, and `lung_model_ood.json`, which records the
   * failed domain. The replacement is the LIDC-IDRI nodule characteriser in
   * `dataset/lung_nodule_model/`, which serves only once it has a binding.
   */
  lung: {
    enabled: false,
    modelClass: 'INTERNAL_VALIDATION',
    intendedUse:
      'Was: triage of chest images shaped like its web-sourced training set. Withdrawn; ' +
      'has no intended use.',
    disabledReason:
      'Withdrawn 2026-09-20. This model was trained on web-sourced PNG images of ' +
      'unrecorded provenance and has no measured performance on CT. It was found to ' +
      'accept real chest CT — 84 of 87 LIDC-IDRI slices passed its out-of-distribution ' +
      'screen (median 12.26 against a 16.51 threshold) and received verdicts. A verdict ' +
      'with no measured basis is not a result. Lung scans are stored and queued for a ' +
      'radiologist until a CT-trained model is bound. See MODEL_CARDS.md.',
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
        'held-out chest images at 0.8% — and real CT slices at only 3.4%, which is ' +
        'the reason it no longer serves. ' +
        'Demographic composition of the training data is unrecorded. ' +
        'Screening triage only; not clinically validated or regulator-cleared.'
    }
  },
  /**
   * The LIDC-IDRI nodule characteriser. Route 1: a clinician marks a nodule
   * on one CT slice and asks how likely a radiologist would be to rate it
   * malignant. It does not find nodules, does not read a whole slice (its
   * OOD reference refuses one at 90.8%), and does not check that the marked
   * region contains a nodule — it characterises what it is pointed at.
   *
   * Served under VALIDATION terms: the evidence is 97 held-out nodules of
   * which 29 are malignant, labels are radiologist ratings rather than
   * histology, and LIDC records almost no demographics. Each figure below
   * carries the interval that sample size implies, and the card says so.
   */
  lung_nodule: {
    enabled: true,
    modelClass: 'INTERNAL_VALIDATION',
    intendedUse:
      'Research / internal validation. Characterise ONE nodule a clinician has marked on ' +
      'a chest CT slice (DICOM), as the probability a radiologist would rate it malignant, ' +
      'to inform the order of review. Not a detector, not a diagnosis, not clinically validated.',
    evaluation: {
      dataset:
        'LIDC-IDRI held-out test split: 97 nodules (29 malignant) from 29 patients, split by ' +
        'patient before extraction; 485 patches of 5 slices each. Labels are the median ' +
        'radiologist malignancy rating (median 3 excluded), not histology.',
      balancedAccuracy: 0.7767,
      sensitivity: 0.8621,  // 25 of 29 malignant nodules flagged, 95% CI 0.69–0.95
      specificity: 0.6912,  // 47 of 68 benign nodules cleared, 95% CI 0.57–0.79
      preprocessing:
        'DICOM CT slice rendered at the lung window (WC -600 / WW 1500) by ' +
        'inference/dicom_ingest.training_window, 64 px crop centred on the mark ' +
        '(inference/nodule_patch.crop), bicubic to 224 px, raw RGB 0-255',
      caveats:
        'Per-nodule figures (mean over each nodule’s slices) on a SMALL held-out set: 29 ' +
        'malignant nodules give a sensitivity interval of 0.69-0.95, and 68 benign a specificity ' +
        'interval of 0.57-0.79. Serving takes ONE marked slice, not five; scored per patch the ' +
        'same set gives sensitivity 0.841 and specificity 0.662, whose interval is optimistic ' +
        'by construction. The reference standard is a radiologist’s rating, so the ceiling is ' +
        'inter-reader agreement, not truth. Calibration: ECE 0.040; temperature scaling fitted ' +
        '(T=1.265) and deliberately NOT applied. OOD reference validated in both directions: ' +
        'held-out benign patches accepted 96.7%, off-nodule parenchyma 99.2%, whole CT slices ' +
        'refused 90.8%, skin lesions 92.5%. Threshold 0.30 on P(malignant), chosen on ' +
        'validation nodules as the most specific point reaching 0.85 sensitivity. ' +
        'The OOD screen checks scale and modality, not that the marked region is a nodule: a ' +
        'clinician who marks soft tissue receives a probability about soft tissue. ' +
        'No demographic breakdown is possible (LIDC records sex for 29% of patients, age for ' +
        '20%, ethnic group for 4%). Raster input is refused; the DICOM object is required so ' +
        'the crop is at the native pixel scale the model was trained on. ' +
        'Research / internal validation only; not clinically validated or regulator-cleared.'
    }
  },
  skin: {
    enabled: true,
    modelClass: 'INTERNAL_VALIDATION',
    intendedUse:
      'Screening triage of a single dermoscopic or clinical lesion image, to prioritise ' +
      'clinician review. Not a diagnosis.',
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
 *
 * An exact match wins before any substring match. The substring rule exists
 * for free text like "lung scan"; without the exact-match step first, a key
 * that contains another key as a prefix (a `lung_nodule` entry beside `lung`)
 * would resolve to whichever came first in the registry — and a withdrawn
 * modality quietly absorbing requests meant for its replacement is exactly the
 * kind of routing mistake nothing downstream can see.
 */
export function resolveScanType(scanType: string): string | null {
  const normalized = (scanType || '').toLowerCase().trim();
  const keys = Object.keys(MODEL_REGISTRY);
  if (keys.includes(normalized)) return normalized;
  // Longest key first, so "lung_nodule" beats "lung" for "lung_nodule scan".
  return (
    [...keys].sort((a, b) => b.length - a.length).find((key) => normalized.includes(key)) ??
    null
  );
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
