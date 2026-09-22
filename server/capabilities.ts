/**
 * The capability manifest: what this deployment can do, decided by the server.
 *
 * ── Why the server and not the page ────────────────────────────────────────
 *
 * Every misleading claim this project has removed from its interface had the
 * same shape: a page said something the backend could not do. "94% accuracy"
 * for breast. Five modalities on a menu with two models behind them. A lung
 * card that read "refuses every CT" while the model behind it was answering
 * CT. Each was written into a component, and each outlived the fact it
 * described.
 *
 * So the page no longer decides. It asks GET /api/capabilities and renders
 * whatever comes back. A capability appears as CURRENT only when the model
 * registry says a model is enabled AND governance says the deployed artifact is
 * the measured one; everything else is stated at the weaker status it has
 * actually reached, with the evidence for that status beside it. A component
 * that wants to claim more has nowhere to write the claim.
 *
 * ── The vocabulary ─────────────────────────────────────────────────────────
 *
 *   CURRENT         in the request path and working. For a model that means
 *                   measured on a held-out set and bound to the deployed
 *                   artifact by fingerprint; for a pipeline stage it means
 *                   implemented and covered by tests. Neither is a claim of
 *                   clinical validation, and neither ever becomes one here.
 *   VALIDATION      serving under research / internal-validation terms: the
 *                   evidence is real but small, and every figure carries an
 *                   interval wide enough to say so. Reviewed by a clinician as
 *                   every result is; must not be relied on alone.
 *   IN_DEVELOPMENT  engineering has started in this repository — code, data
 *                   pipeline or artifacts exist — and nothing serves yet.
 *   PLANNED         scheduled in docs/AUDIT_AND_ROADMAP_2026-09-20.md with a
 *                   named phase, and no implementation exists.
 *   FUTURE          named as a direction only. No model, no data, no timeline.
 *   DISABLED        a model exists and has been switched off. The reason is
 *                   published; the figures stay on the card.
 *
 * "Clinically validated" is not a status here because nothing has reached it.
 * When something does, add EXTERNAL_VALIDATION / CLINICAL_VALIDATION classes to
 * the registry first and derive from there — a status that can be typed into
 * this file without evidence is the defect this file exists to remove.
 */
import { MODEL_REGISTRY, type ModelClass } from './model-availability';
import { allGovernanceStatuses } from './model-governance';

export type CapabilityStatus =
  | 'CURRENT'
  | 'VALIDATION'
  | 'IN_DEVELOPMENT'
  | 'PLANNED'
  | 'FUTURE'
  | 'DISABLED';

/** The conceptual computer-vision workflow, left to right. */
export const PIPELINE_STAGES = [
  'DETECT',
  'SEGMENT',
  'LOCALIZE',
  'CHARACTERIZE',
  'UNDERSTAND',
  'ASSIST',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_MEANING: Record<PipelineStage, string> = {
  DETECT: 'Find candidate findings in a study without anyone pointing at them.',
  SEGMENT: 'Outline a finding or an organ so it can be measured.',
  LOCALIZE: 'Say where in the image the model\'s evidence lies.',
  CHARACTERIZE: 'Estimate what a marked finding is, as a calibrated probability.',
  UNDERSTAND: 'Combine the image with clinical context the clinician supplied.',
  ASSIST: 'Order a review queue and present the result with its evidence attached.',
};

export const STATUS_MEANING: Record<CapabilityStatus, string> = {
  CURRENT:
    'Serving. Measured on a held-out set and bound to the deployed artifact by fingerprint. ' +
    'Not clinically validated.',
  VALIDATION:
    'Serving under research / internal-validation terms. The evidence is real and small; ' +
    'every figure carries an interval wide enough to say so. Reviewed by a clinician, never relied on alone.',
  IN_DEVELOPMENT:
    'Engineering has started in this repository. Nothing serves.',
  PLANNED: 'Scheduled with a named phase in the roadmap. No implementation exists.',
  FUTURE: 'A direction only. No model, no data, no timeline.',
  DISABLED: 'A model exists and has been switched off. The reason is published.',
};

export interface Capability {
  id: string;
  name: string;
  /** What this capability takes in, in the words a clinician would use. */
  input: string;
  status: CapabilityStatus;
  /** The specific evidence for the status — a file, a figure, a phase. */
  evidence: string;
  /** Roadmap phase, where one applies. */
  phase: string | null;
  /** Which model in MODEL_REGISTRY backs it, if any. */
  scanType: string | null;
  modelClass: ModelClass | null;
  /** Per stage, how far this capability has got. Absent stages are not applicable. */
  stages: Partial<Record<PipelineStage, CapabilityStatus>>;
}

/**
 * Registry-backed capabilities take their status from the registry and
 * governance; the declared status below is a ceiling, never a floor.
 */
interface ModelBackedDeclaration {
  id: string;
  name: string;
  input: string;
  scanType: string;
  /** The status this modality holds WHEN it serves. */
  servingStatus: 'CURRENT' | 'VALIDATION';
  phase: string | null;
  stages: Partial<Record<PipelineStage, CapabilityStatus>>;
}

const MODEL_BACKED: ModelBackedDeclaration[] = [
  {
    id: 'skin-lesion-classification',
    name: 'Skin lesion classification',
    input: 'Dermoscopic or clinical photograph of a single lesion',
    scanType: 'skin',
    servingStatus: 'CURRENT',
    phase: 'P5 (fairness and validation)',
    stages: {
      LOCALIZE: 'CURRENT', // Grad-CAM on request, with its caveat
      CHARACTERIZE: 'CURRENT',
      ASSIST: 'CURRENT',
      UNDERSTAND: 'PLANNED',
    },
  },
  {
    id: 'lung-classification-legacy',
    name: 'Lung classification (legacy, web-trained)',
    input: 'Chest image (PNG/JPEG); not CT',
    scanType: 'lung',
    servingStatus: 'CURRENT',
    phase: 'P0 (withdrawn)',
    stages: { CHARACTERIZE: 'DISABLED', ASSIST: 'DISABLED' },
  },
  {
    id: 'lung-nodule-characterisation',
    name: 'Lung nodule characterisation',
    input: 'One CT slice (DICOM or raster) with a nodule marked by a clinician',
    scanType: 'lung_nodule',
    servingStatus: 'VALIDATION',
    phase: 'P1a',
    stages: {
      DETECT: 'PLANNED', // P2: a detector proposes the candidates a clinician marks today
      SEGMENT: 'PLANNED',
      LOCALIZE: 'VALIDATION', // the clinician's mark, plus Grad-CAM over the crop
      CHARACTERIZE: 'VALIDATION',
      UNDERSTAND: 'PLANNED',
      ASSIST: 'VALIDATION',
    },
  },
];

/** Capabilities with no model behind them. Their status is what they are. */
const DECLARED: Capability[] = [
  {
    id: 'dicom-ingest',
    name: 'DICOM ingest',
    input: 'A single DICOM object, or one CT series as a set of objects',
    // Not CURRENT, deliberately. CURRENT is a claim about a model — measured on
    // a held-out set and fingerprint-bound — and this is file handling with no
    // model in it. Calling it CURRENT would put it on the homepage beside the
    // skin classifier as though the two claims were the same kind of thing.
    // The evidence below is where the detail belongs.
    status: 'IN_DEVELOPMENT',
    evidence:
      'A single object is read, rendered at the training window and de-identified before the ' +
      'analysis path persists it. A CT series is assembled by SeriesInstanceUID, ordered by ' +
      'projecting ImagePositionPatient onto the slice normal, put through a quality gate whose ' +
      'bars were measured on the LIDC-IDRI collection, and stored de-identified with the ' +
      'study/series/instance tree intact through a salted UID remap; mixed-series uploads, ' +
      'untrustworthy ordering and unsuitable series are refused and nothing is stored. That ' +
      'path is implemented and covered by tests (roadmap P1b, 2026-09-22). It ingests what is ' +
      'uploaded: it does not receive from a PACS, it does not build a volume, and it does not ' +
      'interpret anything — no model reads a series, so an ingested study carries no ' +
      'finding about the patient.',
    phase: 'P1b',
    scanType: null,
    modelClass: null,
    stages: {},
  },
  {
    id: 'dicom-network-receive',
    name: 'DICOM network receive (C-STORE / DICOMweb)',
    input: 'A study pushed or pulled from a PACS',
    status: 'PLANNED',
    evidence:
      'Series ingestion takes an upload. Nothing listens for a C-STORE association or queries ' +
      'a DICOMweb endpoint, so a study still reaches this platform because somebody exported ' +
      'it. See docs/DEVICE_INTEGRATION.md, Track B.',
    phase: 'P1b+',
    scanType: null,
    modelClass: null,
    stages: {},
  },
  {
    id: 'lung-nodule-detection',
    name: 'Lung nodule detection',
    input: 'A whole CT study',
    status: 'PLANNED',
    evidence:
      'No detector exists. The LIDC-IDRI series, label pipeline and whole-slice OOD sets that ' +
      'a detector would be validated against are on disk. Roadmap P2: adopt a pretrained ' +
      'detector and re-validate per nodule against a pre-registered bar.',
    phase: 'P2',
    scanType: null,
    modelClass: null,
    stages: { DETECT: 'PLANNED' },
  },
  {
    id: 'lung-nodule-segmentation',
    name: 'Lung nodule and organ segmentation',
    input: 'A CT study, or a detected candidate',
    status: 'PLANNED',
    evidence: 'No segmenter and no mask storage exist. Roadmap P3.',
    phase: 'P3',
    scanType: null,
    modelClass: null,
    stages: { SEGMENT: 'PLANNED' },
  },
  {
    id: 'ct-volume',
    name: '3D CT (volume assembly, asynchronous inference, volume viewer)',
    input: 'A CT series',
    status: 'PLANNED',
    evidence:
      'An ingested series is ordered and its spacing is known, which is what a volume needs — ' +
      'but nothing resamples one, holds one, or renders one. Inference is still per slice and ' +
      'synchronous. Roadmap P4.',
    phase: 'P4',
    scanType: null,
    modelClass: null,
    stages: {},
  },
  {
    id: 'structured-clinician-review',
    name: 'Structured clinician review and disagreement monitoring',
    input: 'A radiologist\'s read of an AI-scored scan',
    status: 'IN_DEVELOPMENT',
    evidence:
      'Free-text findings, sign-off and an adjudicated outcome are recorded today ' +
      '(scan_outcomes). Agreement / override fields and a disagreement metric are ' +
      'roadmap P6.',
    phase: 'P6',
    scanType: null,
    modelClass: null,
    stages: { ASSIST: 'CURRENT' },
  },
  {
    id: 'multimodal-clinical-context',
    name: 'Multimodal clinical context',
    input: 'Image plus structured clinical context',
    status: 'PLANNED',
    evidence:
      'The lung questionnaire never leaves the browser and nothing fuses it with an image. ' +
      'Roadmap P7, gated on a validated nodule measurement.',
    phase: 'P7',
    scanType: null,
    modelClass: null,
    stages: { UNDERSTAND: 'PLANNED' },
  },
  {
    id: 'promptable-segmentation',
    name: 'Promptable segmentation',
    input: 'A click or box on a volume',
    status: 'PLANNED',
    evidence:
      'No interactive segmentation model exists and there is no volume to prompt on. ' +
      'Roadmap P8, gated on segmentation (P3) and the volume viewer (P4).',
    phase: 'P8',
    scanType: null,
    modelClass: null,
    stages: { SEGMENT: 'PLANNED' },
  },
  {
    id: 'longitudinal-comparison',
    name: 'Longitudinal comparison',
    input: 'Two studies of the same patient',
    status: 'PLANNED',
    evidence: 'No prior lookup, registration or change measurement exists. Roadmap P9.',
    phase: 'P9',
    scanType: null,
    modelClass: null,
    stages: {},
  },
  ...(
    [
      ['breast-imaging', 'Breast imaging', 'Mammography', 'P10'],
      ['colon-gi-imaging', 'Colon / gastrointestinal imaging', 'Endoscopic or CT colonography images', 'P11'],
      ['prostate-imaging', 'Prostate imaging', 'Multiparametric MRI', 'P12'],
      ['medical-video', 'Medical video, ultrasound and endoscopy', 'Video or cine sequences', 'P13'],
    ] as const
  ).map(([id, name, input, phase]): Capability => ({
    id,
    name,
    input,
    status: 'FUTURE',
    evidence: 'No model, no dataset, no timeline. Named as a direction only.',
    phase,
    scanType: null,
    modelClass: null,
    stages: {},
  })),
];

/**
 * The manifest, computed now — never cached — so a model switched off between
 * two requests is reported as off by the second.
 */
export async function capabilityManifest(): Promise<{
  generatedAt: string;
  statuses: Record<CapabilityStatus, string>;
  stages: Array<{ id: PipelineStage; meaning: string }>;
  capabilities: Capability[];
  /** Convenience for headline counts: registry modalities by status. */
  modalities: Array<{ scanType: string; status: CapabilityStatus; reason: string | null }>;
}> {
  const governance = Object.fromEntries(
    (await allGovernanceStatuses()).map((g) => [g.modality, g])
  );

  const modelBacked: Capability[] = MODEL_BACKED.map((d) => {
    const entry = MODEL_REGISTRY[d.scanType];
    const gov = governance[d.scanType];

    let status: CapabilityStatus;
    let evidence: string;
    if (!entry) {
      // Declared here before it is registered: nothing serves.
      status = 'IN_DEVELOPMENT';
      evidence = `No MODEL_REGISTRY entry for "${d.scanType}"; nothing serves.`;
    } else if (!entry.enabled) {
      status = 'DISABLED';
      evidence = entry.disabledReason ?? 'Switched off in MODEL_REGISTRY.';
    } else if (!gov || !gov.mayServe) {
      // Enabled but not serving: the deployed artifact is not the measured one.
      // Reported as DISABLED because that is what a request will meet.
      status = 'DISABLED';
      evidence = gov?.explanation ?? 'No governance status; the modality does not serve.';
    } else {
      status = d.servingStatus;
      const e = entry.evaluation;
      evidence = e
        ? `Held-out: sensitivity ${e.sensitivity}, specificity ${e.specificity}, ` +
          `balanced accuracy ${e.balancedAccuracy} on ${e.dataset}. Artifact ${gov.deployedFingerprint} ` +
          `bound (${gov.verification}).`
        : 'Serving with no evaluation recorded — which MODEL_REGISTRY should have prevented.';
    }

    // A stage cannot be healthier than the capability it belongs to.
    const cap = (s: CapabilityStatus): CapabilityStatus =>
      status === 'DISABLED' || status === 'IN_DEVELOPMENT' ? status : s;
    const stages = Object.fromEntries(
      Object.entries(d.stages).map(([stage, s]) => [stage, cap(s as CapabilityStatus)])
    ) as Partial<Record<PipelineStage, CapabilityStatus>>;

    return {
      id: d.id,
      name: d.name,
      input: d.input,
      status,
      evidence,
      phase: d.phase,
      scanType: d.scanType,
      modelClass: entry?.modelClass ?? null,
      stages,
    };
  });

  const modalities = Object.entries(MODEL_REGISTRY).map(([scanType, entry]) => {
    const declared = modelBacked.find((c) => c.scanType === scanType);
    return {
      scanType,
      status: declared?.status ?? (entry.enabled ? 'CURRENT' : 'DISABLED'),
      reason: entry.enabled ? null : (entry.disabledReason ?? null),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    statuses: STATUS_MEANING,
    stages: PIPELINE_STAGES.map((id) => ({ id, meaning: STAGE_MEANING[id] })),
    capabilities: [...modelBacked, ...DECLARED],
    modalities,
  };
}
