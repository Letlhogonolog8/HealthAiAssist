/**
 * Binds published performance figures to the artifact they were measured on.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 *
 * MODEL_REGISTRY publishes sensitivity, specificity and balanced accuracy, and
 * GET /api/models/cards serves them beside a reproduce command. Nothing tied
 * those numbers to a file. Replace the .h5 and the endpoint keeps publishing
 * the old figures about a model that no longer exists — the scan rows would
 * correctly record the new fingerprint, while the model card described the old
 * one, and the two would disagree with nobody watching.
 *
 * That is the same defect as the hardcoded accuracy figures this project
 * already removed, one level up: not a fabricated number, but a real number
 * silently reattached to the wrong thing. It is also the failure a deployment
 * process is most likely to produce, because retraining a model and updating a
 * TypeScript literal are done by different people at different times.
 *
 * ── What drift means, and what it does not ────────────────────────────────
 *
 * A fingerprint mismatch does not mean the deployed model is bad. It means it
 * is *unmeasured*, and MODEL_REGISTRY's own rule is that a modality serves only
 * when its measured performance beats chance. An unmeasured model serving
 * clinical triage is precisely the state that rule exists to prevent, so drift
 * disables the modality: scans are stored and queued for a human, which is the
 * same safe path a missing artifact already takes.
 *
 * The remedy is not to loosen this. It is to re-run the evaluation against the
 * new artifact and update the registry — which is the governance step, and the
 * reason this refuses rather than warns.
 *
 * ── Verification levels are stated, not implied ───────────────────────────
 *
 * `re_measured` means someone ran scripts/evaluate-model.py against this exact
 * file and the figures reproduced. `asserted_at_introduction` means the binding
 * was recorded from whatever was deployed when this module was written, and the
 * figures were inherited rather than re-derived. The second is weaker and says
 * so, because a governance record that cannot distinguish "checked" from
 * "assumed" is not a governance record.
 */
import { modelVersionFor, type Modality } from './model-fingerprint';
import { MODEL_REGISTRY } from './model-availability';

export type VerificationLevel =
  /** scripts/evaluate-model.py was run against this artifact and reproduced the figures. */
  | 're_measured'
  /** Recorded from the deployed state when governance was introduced; not re-derived. */
  | 'asserted_at_introduction';

export interface MeasurementBinding {
  /** The 12-hex digest from model-fingerprint, without the family prefix. */
  artifactFingerprint: string;
  /** ISO date the binding was established. */
  boundAt: string;
  verification: VerificationLevel;
  /** Why this level and not a stronger one. */
  note: string;
}

/**
 * What each modality's published figures were measured on.
 *
 * Kept here rather than inside MODEL_REGISTRY so that the performance claim and
 * the provenance of that claim are edited in different places — changing one
 * without the other should be visible in a diff, not buried in the same object
 * literal.
 */
export const MEASUREMENT_BINDINGS: Record<string, MeasurementBinding> = {
  skin: {
    artifactFingerprint: 'ed06b8a0468e',
    boundAt: '2026-09-01',
    verification: 're_measured',
    note:
      'scripts/evaluate-model.py re-run against this artifact on the held-out ' +
      'set named in the model card (360 benign / 300 malignant), at the ' +
      'raw_0_255 preprocessing the serving path uses.',
  },
  lung: {
    artifactFingerprint: '31315d6a059a',
    boundAt: '2026-09-01',
    verification: 'asserted_at_introduction',
    note:
      'NOT re-measured. The model card cites a held-out split of 554 images ' +
      '(282 cancer / 272 no_cancer) which is not present in this working copy — ' +
      'only the train and validate splits are — so the published figures cannot ' +
      'be reproduced here. The binding records what is deployed now, which makes ' +
      'future drift detectable; it does not confirm the figures describe this ' +
      'file. Re-measuring requires restoring the test split.',
  },
};

export type BindingState =
  /** Deployed artifact is the one the figures were measured on. */
  | 'matched'
  /** Deployed artifact differs. The published figures are not about this file. */
  | 'drifted'
  /** The artifact could not be fingerprinted, so nothing can be concluded. */
  | 'unknown'
  /** No binding is recorded for this modality. */
  | 'unbound';

export interface GovernanceStatus {
  modality: string;
  state: BindingState;
  deployedFingerprint: string | null;
  measuredFingerprint: string | null;
  verification: VerificationLevel | null;
  /** True only when the modality may serve predictions. */
  mayServe: boolean;
  explanation: string;
}

/** Strips the `resnet50v2-lung-` style family prefix from a version string. */
function bareFingerprint(version: string): string {
  const parts = version.split('-');
  return parts[parts.length - 1];
}

export async function governanceStatus(modality: string): Promise<GovernanceStatus> {
  const binding = MEASUREMENT_BINDINGS[modality];

  if (!binding) {
    return {
      modality,
      state: 'unbound',
      deployedFingerprint: null,
      measuredFingerprint: null,
      verification: null,
      mayServe: false,
      explanation:
        'No measurement binding is recorded for this modality, so nothing ties ' +
        'its published figures to an artifact. It may not serve.',
    };
  }

  let deployed: string;
  try {
    deployed = bareFingerprint(await modelVersionFor(modality as Modality));
  } catch {
    deployed = 'unknown';
  }

  if (deployed === 'unknown') {
    return {
      modality,
      state: 'unknown',
      deployedFingerprint: null,
      measuredFingerprint: binding.artifactFingerprint,
      verification: binding.verification,
      mayServe: false,
      explanation:
        'The deployed artifact could not be fingerprinted, so it cannot be ' +
        'confirmed as the one the published figures describe. Inference would ' +
        'fail on this path in any case.',
    };
  }

  if (deployed !== binding.artifactFingerprint) {
    return {
      modality,
      state: 'drifted',
      deployedFingerprint: deployed,
      measuredFingerprint: binding.artifactFingerprint,
      verification: binding.verification,
      mayServe: false,
      explanation:
        `The deployed artifact (${deployed}) is not the one the published ` +
        `figures were measured on (${binding.artifactFingerprint}). This model ` +
        'is unmeasured, so it does not serve. Re-run scripts/evaluate-model.py ' +
        'against the new artifact and update MODEL_REGISTRY and ' +
        'MEASUREMENT_BINDINGS together. See docs/MODEL_GOVERNANCE.md.',
    };
  }

  return {
    modality,
    state: 'matched',
    deployedFingerprint: deployed,
    measuredFingerprint: binding.artifactFingerprint,
    verification: binding.verification,
    mayServe: true,
    explanation:
      binding.verification === 're_measured'
        ? 'The deployed artifact is the one the published figures were measured on, and that measurement was reproduced.'
        : 'The deployed artifact matches the recorded binding, but the figures were inherited rather than re-derived. See the binding note.',
  };
}

/** Status for every modality in the registry. */
export async function allGovernanceStatuses(): Promise<GovernanceStatus[]> {
  return Promise.all(Object.keys(MODEL_REGISTRY).map((m) => governanceStatus(m)));
}

/**
 * Logged once at boot, loudly on failure.
 *
 * A drifted model is a deployment mistake, and the moment to say so is before
 * it has served anything — not when someone eventually opens a dashboard.
 */
export async function reportGovernanceAtStartup(): Promise<void> {
  try {
    const statuses = await allGovernanceStatuses();
    for (const s of statuses) {
      if (s.state === 'matched') {
        console.log(
          `[governance] ${s.modality}: artifact ${s.deployedFingerprint} matches its ` +
            `measurement binding (${s.verification}).`
        );
      } else {
        console.error(
          `[governance] ${s.modality.toUpperCase()} WILL NOT SERVE — ${s.state}. ${s.explanation}`
        );
      }
    }
  } catch (error) {
    console.error('[governance] Could not evaluate model bindings:', error);
  }
}
