/**
 * Triage wording for the queue's ordering signal.
 *
 * `riskLevel` on a scan is the level the review queue orders on: HIGH first.
 * It is a threshold applied to one probability, and for years of clinical AI
 * it has been rendered as "HIGH RISK" — which reads as a clinical stratum, a
 * claim no image classifier can make. Every badge in the interface now goes
 * through this one function, so the wording says what the level does.
 */
export type TriageLevel = 'high' | 'medium' | 'low' | string | null | undefined;

export function triageLabel(level: TriageLevel): string {
  switch (String(level ?? '').toLowerCase()) {
    case 'high':
      return 'Priority review';
    case 'medium':
      return 'Indeterminate — review';
    case 'low':
      return 'Routine review';
    default:
      return 'Awaiting review';
  }
}

/** Tailwind classes for the badge, by level. Colour carries urgency, not diagnosis. */
export function triageClass(level: TriageLevel): string {
  switch (String(level ?? '').toLowerCase()) {
    case 'high':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800/50';
    case 'medium':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/50';
    case 'low':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800/50';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}
