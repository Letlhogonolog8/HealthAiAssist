/**
 * What an AI result is, presented as the numbers it is made of.
 *
 * Replaces the "HIGH RISK" badge. A threshold applied to one probability is
 * not a clinical risk stratum, and rendering it as one told a reader more than
 * the model knows. What the model actually produced is a probability, the
 * threshold it was compared to, the calibration that shaped it, the screen it
 * passed, and the evidence class of the artifact — so that is what is shown,
 * each with the word that says what it means.
 *
 * Everything here comes from `analysis.detail` on the server's response.
 * Nothing is computed or defaulted in this component: a field the server did
 * not send renders as "not recorded".
 */
import { AlertTriangle, ShieldCheck, FlaskConical, UserCheck } from "lucide-react";

export interface ResultDetail {
  probability: number | null;
  threshold: number | null;
  thresholdChosenOn: string | null;
  temperature: number | null;
  calibrationApplied: boolean | null;
  calibrationEce: number | null;
  oodScore: number | null;
  oodThreshold: number | null;
  oodStatus: "PASS" | "SKIPPED";
  qualityGate: string | null;
  inputSource: "dicom" | "raster";
  modelVersion: string;
  modelClass: string;
  evaluation: {
    sensitivity: number;
    specificity: number;
    balancedAccuracy: number;
    dataset: string;
  } | null;
  clinicalValidation: string;
  humanReview: string;
  inferenceAt: string;
}

interface Props {
  detail: ResultDetail;
  /** The registry key, for the model line. */
  scanType: string;
  /** The model's call, as the server made it. */
  flagged: boolean;
  /** 'CURRENT' | 'VALIDATION' from the model card, when known. */
  capabilityStatus?: string | null;
  /** Optional: what the probability is a probability OF, in the model's words. */
  answers?: string | null;
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "not recorded" : v.toFixed(digits);

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-0.5 py-2 border-b border-border/60 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground self-start pt-0.5">{label}</dt>
      <dd className="text-sm text-foreground tabular-nums">
        {value}
        {note && <span className="block text-xs text-muted-foreground mt-0.5">{note}</span>}
      </dd>
    </div>
  );
}

export function AiResultSummary({ detail, scanType, flagged, capabilityStatus, answers }: Props) {
  const classLabel = detail.modelClass.replace(/_/g, " ");
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="AI result, as numbers">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {flagged ? "Flagged for priority review" : "Not flagged"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-prose">
            {answers ??
              "A calibrated probability from an image classifier, compared to an operating threshold. It orders a review queue; it is not a diagnosis."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <UserCheck className="w-3.5 h-3.5" />
          Clinician review {detail.humanReview.toLowerCase()}
        </span>
      </div>

      <dl className="mt-4">
        <Row
          label="AI probability"
          value={<span className="text-lg font-semibold">{fmt(detail.probability)}</span>}
          note={detail.thresholdChosenOn ? `Threshold chosen on ${detail.thresholdChosenOn}` : undefined}
        />
        <Row
          label="Operating threshold"
          value={fmt(detail.threshold)}
          note={
            detail.probability !== null && detail.threshold !== null
              ? detail.probability >= detail.threshold
                ? "Probability is at or above the threshold."
                : "Probability is below the threshold. This does not rule anything out."
              : undefined
          }
        />
        <Row
          label="Calibration"
          value={
            detail.calibrationApplied === null
              ? "not recorded"
              : detail.calibrationApplied
                ? `APPLIED (temperature ${fmt(detail.temperature, 3)})`
                : `NOT APPLIED (temperature ${fmt(detail.temperature, 3)})`
          }
          note={
            detail.calibrationEce !== null
              ? `Expected calibration error ${fmt(detail.calibrationEce, 3)} on the held-out set: stated probability and observed frequency agree to within about ${Math.round(detail.calibrationEce * 100)} percentage points.`
              : undefined
          }
        />
        <Row
          label="Out-of-distribution"
          value={
            detail.oodStatus === "PASS" ? (
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" /> PASS
                <span className="text-muted-foreground">
                  ({fmt(detail.oodScore, 1)} against {fmt(detail.oodThreshold, 1)})
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> SKIPPED — no reference installed
              </span>
            )
          }
          note="Checks that the input resembles what the model was trained on. It does not check that the input is the right thing to ask about."
        />
        <Row label="Quality gate" value={detail.qualityGate ?? "not recorded"} />
        <Row label="Input" value={detail.inputSource === "dicom" ? "DICOM object (de-identified before storage)" : "Raster image"} />
        <Row
          label="Model"
          value={<code className="text-xs">{detail.modelVersion}</code>}
          note={`${scanType} · fingerprint of the artifact that produced this result`}
        />
        <Row
          label="Model status"
          value={
            <span className="inline-flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-cyan-500" />
              {capabilityStatus ?? "—"} · {classLabel}
            </span>
          }
          note={
            detail.evaluation
              ? `Held-out: sensitivity ${(detail.evaluation.sensitivity * 100).toFixed(1)}%, specificity ${(detail.evaluation.specificity * 100).toFixed(1)}% — ${detail.evaluation.dataset}`
              : undefined
          }
        />
        <Row
          label="Clinical validation"
          value={<span className="font-medium text-amber-600 dark:text-amber-400">{detail.clinicalValidation}</span>}
          note="No clinical study, no prospective data, no regulatory clearance in any jurisdiction."
        />
        <Row label="Inference at" value={new Date(detail.inferenceAt).toLocaleString()} />
      </dl>
    </section>
  );
}

export default AiResultSummary;
