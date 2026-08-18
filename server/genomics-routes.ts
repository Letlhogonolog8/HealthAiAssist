/**
 * Genomics API.
 *
 * Every route that touches genomic data goes through `requireConsent`, which
 * both checks the scope and writes an audit entry. Routes that only describe the
 * system (panels, transferability table) are open, because publishing what the
 * system can and cannot do is the point.
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireMedicalAccess, type AuthenticatedRequest } from './security-config';
import { storage } from './storage';
import { parseGenotypeFile, GenotypeParseError } from './genomics/parsers';
import {
  loadPanels,
  findPanel,
  computePrs,
  loadReferenceDistribution,
  MIN_COVERAGE_PCT,
  type PrsResult,
} from './genomics/prs';
import {
  loadActionablePanel,
  screenActionableVariants,
  type ActionableScreenResult,
} from './genomics/actionable-variants';
import { getTransferability, percentileInterval, transferabilityTable } from './genomics/ancestry';
import { fuseRisk, type ImagingSignal } from './genomics/fusion';
import {
  CONSENT_SCOPES,
  CONSENT_DESCRIPTIONS,
  CURRENT_CONSENT_VERSION,
  ConsentDeniedError,
  type ConsentScope,
  getAllConsents,
  recordConsent,
  requireConsent,
  logAccess,
} from './genomics/consent';
import * as genomicStore from './genomics/storage';

const router = Router();

// Genotype files are large but bounded; 64MB covers a consumer array comfortably.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

function actor(req: AuthenticatedRequest) {
  return {
    actorUserId: (req.session as any)?.user?.id ?? null,
    actorRole: (req.session as any)?.user?.role ?? null,
    ipAddress: req.ip ?? null,
  };
}

/** Patients may act on themselves; medical staff and admins on anyone. */
function canActFor(req: AuthenticatedRequest, patientId: number): boolean {
  const user = (req.session as any)?.user;
  if (!user) return false;
  if (user.id === patientId) return true;
  return ['admin', 'doctor', 'radiologist'].includes(user.role);
}

function handleConsentError(error: unknown, res: any): boolean {
  if (error instanceof ConsentDeniedError) {
    res.status(403).json({
      error: 'Consent required',
      scope: error.scope,
      message: error.message,
      remedy: `Record consent for "${error.scope}" via POST /api/genomics/consent.`,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Transparency endpoints — deliberately public
// ---------------------------------------------------------------------------

/** What panels are installed, and whether they are real. */
router.get('/panels', (_req, res) => {
  const panels = loadPanels();
  const actionable = loadActionablePanel();

  res.json({
    polygenicPanels: panels.map((p) => ({
      id: p.id,
      condition: p.condition,
      provenance: p.provenance,
      pgsId: p.pgsId,
      genomeBuild: p.genomeBuild,
      variantCount: p.variants.length,
      citation: p.citation,
      hasReferenceDistribution: loadReferenceDistribution(p.condition) !== null,
      clinicalUseAllowed: p.provenance === 'pgs_catalog',
    })),
    actionablePanel: actionable
      ? {
          source: actionable.source,
          version: actionable.version,
          synthetic: actionable.synthetic,
          variantCount: actionable.variants.length,
          clinicalUseAllowed: !actionable.synthetic,
        }
      : null,
    minimumCoveragePct: MIN_COVERAGE_PCT,
    note:
      'Panels are not authored in this repository. Synthetic panels are test ' +
      'fixtures and are refused for clinical presentation.',
  });
});

/**
 * The equity dashboard: how well polygenic scores transfer across ancestry
 * groups, and where this system therefore declines to give an answer.
 */
router.get('/transferability', (_req, res) => {
  res.json({
    background:
      'Most published polygenic scores were derived in cohorts that are ' +
      'overwhelmingly European-ancestry. A score does not transfer intact ' +
      'between populations, so its accuracy varies by who you are.',
    citation: 'Martin et al., Nature Genetics 2019, 51:584-591',
    groups: transferabilityTable().map((t) => ({
      group: t.group,
      approximateRelativeAccuracy: t.factor,
      confidence: t.confidence,
      percentileReported: t.percentileReportable,
      guidance: t.guidance,
    })),
    policy:
      'Where a score does not transfer, no percentile is shown and the ' +
      'polygenic component is excluded from the fused band entirely rather ' +
      'than down-weighted.',
  });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

router.get('/consent/options', (_req, res) => {
  res.json({
    version: CURRENT_CONSENT_VERSION,
    scopes: CONSENT_SCOPES.map((scope) => ({
      scope,
      description: CONSENT_DESCRIPTIONS[scope],
      required: scope === 'clinical_care',
    })),
    revocable: true,
    note: 'Consent is checked at every access, so revocation takes effect immediately.',
  });
});

router.get('/consent/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  const ctx = { patientId, action: 'read_consent' as const, ...actor(req) };
  await logAccess(ctx, true, null);

  res.json({ patientId, version: CURRENT_CONSENT_VERSION, consents: await getAllConsents(patientId) });
});

router.post('/consent', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { patientId: rawId, scope, granted } = req.body ?? {};
  const patientId = Number.parseInt(rawId, 10);

  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!CONSENT_SCOPES.includes(scope)) {
    return res.status(400).json({ error: `scope must be one of: ${CONSENT_SCOPES.join(', ')}` });
  }
  if (typeof granted !== 'boolean') {
    return res.status(400).json({ error: 'granted must be a boolean' });
  }
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  await recordConsent({
    patientId,
    scope: scope as ConsentScope,
    granted,
    recordedByUserId: (req.session as any)?.user?.id ?? null,
    notes: typeof req.body?.notes === 'string' ? req.body.notes : '',
  });

  res.json({
    patientId,
    scope,
    granted,
    version: CURRENT_CONSENT_VERSION,
    consents: await getAllConsents(patientId),
  });
});

// ---------------------------------------------------------------------------
// Profile upload
// ---------------------------------------------------------------------------

router.post(
  '/profile/upload',
  requireAuth,
  upload.single('genotypeFile'),
  async (req: AuthenticatedRequest, res) => {
    const patientId = Number.parseInt(req.body?.patientId, 10);
    if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
    if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });
    if (!req.file) return res.status(400).json({ error: 'No genotype file provided' });

    const patient = await storage.getUser(patientId);
    if (!patient) return res.status(400).json({ error: 'Unknown patient' });

    const ctx = { patientId, action: 'upload' as const, ...actor(req) };

    try {
      await requireConsent(ctx, 'clinical_care', { selfAccess: true });
    } catch (error) {
      if (handleConsentError(error, res)) return;
      throw error;
    }

    let parsed;
    try {
      parsed = parseGenotypeFile(req.file.buffer.toString('utf-8'));
    } catch (error) {
      if (error instanceof GenotypeParseError) {
        return res.status(400).json({ error: 'Could not parse genotype file', detail: error.message });
      }
      throw error;
    }

    // Self-reported ancestry is optional and never inferred from the genotype
    // data here. Inferring it would be a separate, consequential claim.
    const selfReportedAncestry =
      typeof req.body?.selfReportedAncestry === 'string' && req.body.selfReportedAncestry.trim()
        ? req.body.selfReportedAncestry.trim()
        : null;

    const profile = await genomicStore.createProfile({
      patientId,
      source: parsed.source,
      genomeBuild: parsed.genomeBuild,
      variantCount: parsed.genotypes.length,
      selfReportedAncestry,
    });

    // Persist only what an installed panel can actually use.
    const needed = new Set<string>();
    for (const panel of loadPanels()) {
      for (const v of panel.variants) needed.add(v.rsid);
    }
    for (const v of loadActionablePanel()?.variants ?? []) needed.add(v.rsid);

    const stored = await genomicStore.storeVariants(profile.id, parsed.genotypes, needed);
    await genomicStore.setProfileStatus(profile.id, 'ready');

    res.json({
      profileId: profile.id,
      source: parsed.source,
      genomeBuild: parsed.genomeBuild,
      variantsInFile: parsed.genotypes.length,
      variantsStored: stored,
      skippedLines: parsed.skipped,
      selfReportedAncestry,
      warnings: [
        ...parsed.warnings,
        ...(selfReportedAncestry
          ? []
          : ['No ancestry recorded. Polygenic percentiles will be withheld, because ' +
             'how well a score applies cannot be assessed without it.']),
        `Only the ${stored} variants used by installed panels were retained; the ` +
        'rest of the file was discarded rather than stored.',
      ],
    });
  }
);

router.get('/profile/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  const ctx = { patientId, action: 'read_variants' as const, ...actor(req) };
  try {
    await requireConsent(ctx, 'clinical_care', { selfAccess: true });
  } catch (error) {
    if (handleConsentError(error, res)) return;
    throw error;
  }

  const profiles = await genomicStore.getProfiles(patientId);
  res.json({
    patientId,
    profiles: profiles.map((p) => ({
      id: p.id,
      source: p.source,
      genomeBuild: p.genomeBuild,
      variantCount: p.variantCount,
      selfReportedAncestry: p.selfReportedAncestry,
      status: p.status,
      uploadedAt: p.uploadedAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

router.post('/risk/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  const condition = typeof req.body?.condition === 'string' ? req.body.condition : 'melanoma';
  const ctx = { patientId, action: 'compute_risk' as const, purpose: condition, ...actor(req) };

  try {
    await requireConsent(ctx, 'clinical_care', { selfAccess: true });
  } catch (error) {
    if (handleConsentError(error, res)) return;
    throw error;
  }

  const profile = await genomicStore.getLatestProfile(patientId);
  const transferability = getTransferability(profile?.selfReportedAncestry ?? null);

  // ---- polygenic component ----
  const panels = loadPanels();
  const panel = findPanel(panels, condition);
  let prs: PrsResult | null = null;
  let interval: { low: number; high: number; widthPct: number } | null = null;

  if (panel && profile) {
    const genotypes = await genomicStore.getGenotypeMap(
      profile.id,
      panel.variants.map((v) => v.rsid)
    );
    prs = computePrs(
      panel,
      genotypes,
      loadReferenceDistribution(condition),
      profile.genomeBuild
    );

    // A percentile is only released when the score also transfers to this ancestry.
    if (prs.percentile !== null && !transferability.percentileReportable) {
      prs = {
        ...prs,
        percentile: null,
        percentileWithheldReason:
          `Withheld: the reference distribution does not describe the recorded ` +
          `ancestry group ("${transferability.group}").`,
      };
    } else if (prs.percentile !== null) {
      interval = percentileInterval(prs.percentile, transferability.factor);
    }
  }

  // ---- actionable variants ----
  let actionable: ActionableScreenResult | null = null;
  if (profile) {
    const actionablePanel = loadActionablePanel();
    const rsids = actionablePanel?.variants.map((v) => v.rsid) ?? [];
    const genotypes = rsids.length
      ? await genomicStore.getGenotypeMap(profile.id, rsids)
      : new Map<string, string>();
    actionable = screenActionableVariants(genotypes, actionablePanel);
  }

  // ---- imaging component ----
  let imaging: ImagingSignal | null = null;
  const scans = await storage.getScans(patientId);
  const relevant = scans
    .filter((s) => (s.scanType || '').toLowerCase().includes(condition === 'melanoma' ? 'skin' : condition))
    .filter((s) => s.status !== 'pending_manual_review')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (relevant.length) {
    const scan = relevant[0];
    const confidence = Number.parseFloat(String(scan.aiConfidence ?? '0').replace('%', '')) || 0;
    imaging = {
      scanId: scan.id,
      flagged: !/no abnormal|no malignancy/i.test(scan.result ?? ''),
      confidence,
      riskLevel: scan.riskLevel ?? 'low',
    };
  }

  const patient = await storage.getUser(patientId);
  const fused = fuseRisk({
    condition,
    imaging,
    prs,
    transferability,
    actionable,
    clinical: {
      age: patient?.age ?? null,
      familyHistory: req.body?.familyHistory === true,
      knownRiskFactors: Array.isArray(req.body?.riskFactors) ? req.body.riskFactors : [],
    },
  });

  const saved = await genomicStore.saveRiskAssessment({
    patientId,
    condition,
    profileId: profile?.id ?? null,
    scanId: imaging?.scanId ?? null,
    panelId: panel?.id ?? null,
    prsRawScore: prs ? String(prs.rawScore) : null,
    prsPercentile: prs?.percentile ?? null,
    panelCoveragePct: prs?.coveragePct ?? null,
    transferabilityPct: Math.round(transferability.factor * 100),
    riskBand: fused.band,
    contributions: JSON.stringify(fused.contributions),
    caveats: fused.caveats.join(' | '),
    requiresClinicianReview: true,
  });

  res.json({
    assessmentId: saved.id,
    patientId,
    condition,
    band: fused.band,
    requiresClinicianReview: true,
    // Refuses to be mistaken for a clinical result when any input was synthetic.
    clinicalUseAllowed: !fused.containsSyntheticData,
    containsSyntheticData: fused.containsSyntheticData,

    imaging: imaging
      ? { scanId: imaging.scanId, flagged: imaging.flagged, confidence: imaging.confidence }
      : null,

    polygenic: prs
      ? {
          panelId: prs.panelId,
          provenance: prs.provenance,
          coveragePct: prs.coveragePct,
          matchedVariants: prs.matchedVariants,
          panelSize: prs.panelSize,
          percentile: prs.percentile,
          percentileInterval: interval,
          percentileWithheldReason: prs.percentileWithheldReason,
          warnings: prs.warnings,
        }
      : null,

    ancestry: {
      selfReported: profile?.selfReportedAncestry ?? null,
      group: transferability.group,
      approximateRelativeAccuracy: transferability.factor,
      confidence: transferability.confidence,
      guidance: transferability.guidance,
      citation: transferability.citation,
    },

    actionableVariants: actionable
      ? {
          screened: actionable.screened,
          synthetic: actionable.synthetic,
          findings: actionable.findings,
          assayedNegative: actionable.assayedNegative,
          notAssayedCount: actionable.notAssayed.length,
        }
      : null,

    contributions: fused.contributions,
    missingInputs: fused.missingInputs,
    caveats: fused.caveats,
  });
});

router.get('/risk/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  const ctx = { patientId, action: 'compute_risk' as const, ...actor(req) };
  try {
    await requireConsent(ctx, 'clinical_care', { selfAccess: true });
  } catch (error) {
    if (handleConsentError(error, res)) return;
    throw error;
  }

  res.json({ patientId, assessments: await genomicStore.getRiskAssessments(patientId) });
});

// ---------------------------------------------------------------------------
// Patient rights
// ---------------------------------------------------------------------------

/** Who has touched this patient's genomic data. Patients can read their own. */
router.get('/access-log/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  res.json({ patientId, entries: await genomicStore.getAccessLog(patientId) });
});

router.delete('/profile/:patientId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const patientId = Number.parseInt(req.params.patientId, 10);
  if (Number.isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });
  if (!canActFor(req, patientId)) return res.status(403).json({ error: 'Not permitted' });

  const ctx = { patientId, action: 'delete' as const, ...actor(req) };
  await logAccess(ctx, true, 'clinical_care');

  const result = await genomicStore.deleteGenomicData(patientId);
  res.json({
    patientId,
    profilesDeleted: result.profiles,
    note:
      'Genotype data deleted. The access log is retained deliberately, so you can ' +
      'still see who read your data while it existed. Past risk assessments are ' +
      'kept but no longer linked to a genomic profile.',
  });
});

/** Aggregate equity reporting. Medical staff only — it is operational data. */
router.get('/equity-report', requireAuth, requireMedicalAccess, async (_req, res) => {
  const table = transferabilityTable();
  res.json({
    statement:
      'Where this system is weakest, and for whom. Published for the same reason ' +
      'model cards are: a limitation that is not stated will be assumed absent.',
    polygenicTransferability: table.map((t) => ({
      group: t.group,
      approximateRelativeAccuracy: t.factor,
      percentileReported: t.percentileReportable,
    })),
    measuredGaps: {
      skinToneCoverage: {
        method: 'Individual Typology Angle estimated from perilesional skin',
        imagesAssessed: 511,
        imagesTotal: 660,
        brownOrDarkerShare: 0.043,
        binsWithEnoughDataToJudge: ['light', 'very_light'],
        finding:
          'The evaluation set is 96% light-skinned. Only two tone bins hold enough ' +
          'images to support a reliable estimate, and both are light skin. This ' +
          'dataset cannot establish how the model performs on darker skin — the ' +
          'Dark bin contains four images and no benign controls.',
        doNotMisread:
          'No disparity was detected among light tones. That is not evidence of ' +
          'fairness; it is evidence of an unrepresentative test set.',
        remedy:
          'Requires data, not modelling: a test set with meaningful Fitzpatrick ' +
          'V-VI representation, ideally labelled rather than estimated.',
        reproduce: 'python scripts/measure-skin-tone-performance.py',
      },
    },
    knownGaps: [
      'Lung imaging model: demographic composition of training data unrecorded.',
      'Polygenic scores: derived predominantly in European-ancestry cohorts. ' +
      'Percentiles are withheld for groups where the reference population does ' +
      'not apply.',
    ],
  });
});

export default router;
