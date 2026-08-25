/**
 * Whether someone meets published criteria for lung cancer screening.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 *
 * An additive tally over self-reported answers with hand-chosen weights — age
 * ≥50 adds 3, current smoker adds 3, poor diet adds 2 — summed, bucketed into
 * low/moderate/high, and used to set appointment urgency. It was labelled
 * honestly in the code and in the response, and it was still a cancer risk level
 * shown to a patient, produced by a formula nobody had fitted to or evaluated
 * against any outcome.
 *
 * ── Why eligibility rather than a risk score ───────────────────────────────
 *
 * A risk model outputs a probability, and a probability is only worth anything
 * if it has been calibrated against observed outcomes. Eligibility criteria are
 * different in kind: they are a published, citable rule about who benefits from
 * screening, agreed by a body that reviewed the trial evidence. Applying a
 * threshold correctly is checkable; estimating a probability is not, unless you
 * have the data to check it against.
 *
 * So this answers "do you meet the criteria for low-dose CT screening?" — which
 * is also the more actionable question. A patient who meets USPSTF criteria has
 * a concrete next step. A patient told they are "moderate risk" has nothing.
 *
 * ── Sources ────────────────────────────────────────────────────────────────
 *
 * USPSTF (2021), Lung Cancer: Screening, Grade B recommendation.
 *   Adults 50–80 with a ≥20 pack-year history who currently smoke or have quit
 *   within the past 15 years. JAMA. 2021;325(10):962-970.
 *
 * NLST (2011), the trial the recommendation rests on, whose enrolment criteria
 *   were narrower: 55–74, ≥30 pack-years, same quit window.
 *   N Engl J Med. 2011;365:395-409.
 *
 * Both are reported, because a patient outside USPSTF is outside the evidence
 * entirely, while a patient inside USPSTF but outside NLST is inside a
 * recommendation extrapolated beyond the trial population — a distinction a
 * clinician may want and a patient is entitled to see.
 */

export interface SmokingHistory {
  /** Years. */
  age: number;
  status: 'never' | 'former' | 'current';
  /** Mean cigarettes per day while smoking. */
  cigarettesPerDay?: number;
  /** Total years of smoking. */
  yearsSmoked?: number;
  /** Years since quitting. Former smokers only. */
  yearsSinceQuit?: number;
}

export interface EligibilityResult {
  /** Cigarettes per day ÷ 20 × years smoked. Null when the inputs are absent. */
  packYears: number | null;
  criteria: Array<{
    name: string;
    citation: string;
    meets: boolean;
    /** Which specific conditions failed, in plain words. */
    unmet: string[];
  }>;
  /** True when at least one published criterion is met. */
  eligibleForScreening: boolean;
  /**
   * What to do. Never a risk level, and never a probability.
   */
  guidance: string;
}

export function packYears(history: SmokingHistory): number | null {
  if (history.status === 'never') return 0;
  const perDay = history.cigarettesPerDay;
  const years = history.yearsSmoked;
  if (typeof perDay !== 'number' || typeof years !== 'number') return null;
  if (perDay < 0 || years < 0) return null;
  return (perDay / 20) * years;
}

export function assessScreeningEligibility(history: SmokingHistory): EligibilityResult {
  const packs = packYears(history);
  const quit = history.yearsSinceQuit;

  // "Quit within 15 years" is a condition on former smokers. A current smoker
  // satisfies the recency requirement by definition; a never-smoker cannot be
  // eligible under either criterion regardless of anything else.
  const quitRecently =
    history.status === 'current' ||
    (history.status === 'former' && typeof quit === 'number' && quit <= 15);

  function evaluate(
    name: string,
    citation: string,
    minAge: number,
    maxAge: number,
    minPackYears: number
  ) {
    const unmet: string[] = [];

    if (history.status === 'never') {
      unmet.push('These criteria apply to people with a history of smoking.');
    }
    if (history.age < minAge || history.age > maxAge) {
      unmet.push(`Age is outside ${minAge}–${maxAge}.`);
    }
    if (packs === null) {
      unmet.push('Smoking history is incomplete — cigarettes per day and years smoked are needed.');
    } else if (packs < minPackYears) {
      unmet.push(
        `Smoking history is ${packs.toFixed(1)} pack-years; these criteria require at least ${minPackYears}.`
      );
    }
    if (!quitRecently) {
      unmet.push('These criteria apply to people who currently smoke or quit within the past 15 years.');
    }

    return { name, citation, meets: unmet.length === 0, unmet };
  }

  const criteria = [
    evaluate(
      'USPSTF 2021 (Grade B)',
      'US Preventive Services Task Force. JAMA. 2021;325(10):962-970.',
      50,
      80,
      20
    ),
    evaluate(
      'NLST trial enrolment',
      'National Lung Screening Trial Research Team. N Engl J Med. 2011;365:395-409.',
      55,
      74,
      30
    ),
  ];

  const eligible = criteria.some((criterion) => criterion.meets);

  let guidance: string;
  if (eligible) {
    guidance =
      'You meet published criteria for annual low-dose CT lung screening. Discuss ' +
      'this with a clinician — screening has benefits and harms, including false ' +
      'positives and follow-up procedures, and the decision should be a shared one.';
  } else if (history.status === 'never') {
    guidance =
      'Lung cancer screening criteria apply to people with a history of smoking. ' +
      'Not meeting them does not mean you cannot develop lung cancer, and any ' +
      'persistent symptom should be discussed with a clinician regardless.';
  } else {
    guidance =
      'You do not currently meet published criteria for lung cancer screening. ' +
      'Criteria are population rules and are not a statement about you ' +
      'individually — discuss any symptoms or concerns with a clinician.';
  }

  return { packYears: packs, criteria, eligibleForScreening: eligible, guidance };
}

// ---------------------------------------------------------------------------
// PLCOm2012 — scaffolded, disabled, and deliberately without coefficients
// ---------------------------------------------------------------------------

/**
 * The PLCOm2012 six-year lung cancer risk model.
 *
 * Tammemägi MC et al. "Selection Criteria for Lung-Cancer Screening."
 * N Engl J Med 2013;368:728-736. Coefficients in Table 2 and the supplementary
 * appendix.
 *
 * ── Why the coefficients are null ──────────────────────────────────────────
 *
 * Because nobody has checked them against the paper.
 *
 * This is the same rule `server/model-availability.ts` applies to the image
 * models: a model with `evaluation: null` is disabled, and "not yet measured" is
 * itself the reason to stay disabled. Transcribing fifteen logistic-regression
 * coefficients from memory and shipping them behind a flag would produce a
 * number that looks exactly like a real risk estimate and could be wrong in a
 * way no test here would catch — which is the precise failure this codebase
 * exists to avoid, applied to a patient's cancer risk rather than to a model
 * accuracy figure.
 *
 * The structure is here so the remaining work is bounded and obvious: fill in
 * the coefficients from Table 2, check the worked example in the supplementary
 * appendix reproduces, record who checked it and against which printing, and
 * set `verified: true`. Until then `plcoAvailable()` is false and nothing calls
 * it.
 */
export interface PlcoCoefficients {
  /** Set true only once a person has checked these against the publication. */
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  intercept: number | null;
  /** Each is a per-unit log-odds weight, applied to the centred variable. */
  terms: Record<string, { centre: number | null; weight: number | null }>;
}

export const PLCOM2012: PlcoCoefficients = {
  verified: false,
  intercept: null,
  terms: {
    age: { centre: 62, weight: null },
    educationLevel: { centre: 4, weight: null },
    bodyMassIndex: { centre: 27, weight: null },
    copd: { centre: 0, weight: null },
    personalHistoryOfCancer: { centre: 0, weight: null },
    familyHistoryOfLungCancer: { centre: 0, weight: null },
    currentSmoker: { centre: 0, weight: null },
    smokingIntensity: { centre: null, weight: null },
    smokingDuration: { centre: 27, weight: null },
    yearsSinceQuit: { centre: 10, weight: null },
    raceEthnicity: { centre: 0, weight: null },
  },
};

/** Whether a verified coefficient set is installed. */
export function plcoAvailable(): boolean {
  return (
    PLCOM2012.verified &&
    PLCOM2012.intercept !== null &&
    Object.values(PLCOM2012.terms).every((term) => term.weight !== null)
  );
}
