/**
 * Measured model performance, read live from /api/models/cards.
 *
 * Replaces a grid of capability claims that were not true: "reducing false
 * negatives by up to 30%", an offline mobile app that does not exist,
 * multi-language support that does not exist, and federated learning that does
 * not exist. What is here instead is the evaluation output for each model,
 * including the ones that failed and are switched off.
 *
 * ── On presenting the caveats ──────────────────────────────────────────────
 *
 * `evaluation.caveats` is around a thousand characters of dense prose per model,
 * and it was rendered as one undifferentiated paragraph at 12px in slate-500 —
 * the lowest-contrast text on the page, in the smallest size, for the most
 * important content. It was, in practice, unread. Text nobody reads is not
 * disclosure; it is the appearance of disclosure, which is worse, because it
 * lets everyone believe the limitation was communicated.
 *
 * So the prose is split on sentence boundaries and laid out as a list. Nothing
 * is summarised, reworded or dropped — the transform is presentational, and the
 * source string is still the model card's own text. Sentences naming a hard
 * limit (a miss rate, an unmeasurable subgroup, the absence of clinical
 * validation) are marked, because those are the ones a reader skimming must not
 * skip. The panel is a `<details open>`: collapsible for someone comparing
 * metrics across cards, open by default so no caveat is hidden from anyone who
 * did not think to look.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle, Database, ChevronDown, Terminal } from "lucide-react";

interface ModelCard {
  scanType: string;
  enabled: boolean;
  disabledReason: string | null;
  evaluation: {
    dataset: string;
    balancedAccuracy: number;
    sensitivity: number;
    specificity: number;
    caveats: string;
  } | null;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * Splits the caveat prose into sentences.
 *
 * The lookbehind matches a full stop followed by whitespace and a capital, which
 * leaves decimals intact — "Test AUC 0.88. Calibration measured" splits once,
 * and "error 0.019, improved to 0.017" not at all.
 */
function toSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Limits a reader must not skim past. Matched on the model card's own wording. */
const HARD_LIMIT =
  /\bmiss(es|ed)\b|CANNOT ESTABLISH|not clinically validated|regulator-cleared|unrecorded|unrepresentative/i;

function MetricBar({ value }: { value: number }) {
  const tone =
    value >= 0.8 ? "bg-emerald-500" : value >= 0.65 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-700`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      {/* Chance is 0.5 for balanced accuracy. The marker makes a near-chance
          model visually obvious rather than a number the reader must interpret. */}
      <div className="relative h-3">
        <div className="absolute top-0 h-2 w-px bg-slate-600" style={{ left: "50%" }} />
        <span
          className="absolute top-2 -translate-x-1/2 text-[10px] text-slate-600 whitespace-nowrap"
          style={{ left: "50%" }}
        >
          chance
        </span>
      </div>
    </div>
  );
}

export default function AIFeaturesSection() {
  const { data, isLoading } = useQuery<{ models: ModelCard[]; reproduce: string }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  return (
    <section
      id="performance"
      className="scroll-mt-16 bg-slate-900/40 py-20 lg:py-24 border-y border-slate-800"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
            Evidence
          </span>
          <h2 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-white">
            Measured performance
          </h2>
          <p className="mt-4 text-slate-400 leading-relaxed">
            Read live from the API, not written into this page. Balanced accuracy is
            the headline rather than raw accuracy: on an imbalanced set, a model that
            answers "negative" every time scores well on accuracy while detecting
            nothing.
          </p>
        </div>

        {isLoading && (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-72 rounded-2xl border border-slate-800 bg-slate-900/60 animate-pulse"
              />
            ))}
          </div>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-2 items-start">
          {data?.models.map((model) => {
            const sentences = model.evaluation ? toSentences(model.evaluation.caveats) : [];

            return (
              <article
                key={model.scanType}
                className={`rounded-2xl border bg-slate-900/60 overflow-hidden transition-colors ${
                  model.enabled
                    ? "border-slate-800 hover:border-slate-700"
                    : "border-rose-900/50"
                }`}
              >
                {/* ── Header ── */}
                <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-800">
                  <h3 className="text-lg font-semibold text-white capitalize tracking-tight">
                    {model.scanType}
                  </h3>
                  {model.enabled ? (
                    <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-600/30 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Serving
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-500/10 text-rose-300 border border-rose-600/30 font-medium">
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Disabled
                    </Badge>
                  )}
                </div>

                {model.evaluation ? (
                  <>
                    {/* ── Metrics ── */}
                    <div className="grid grid-cols-3 divide-x divide-slate-800 border-b border-slate-800">
                      {[
                        { label: "Balanced acc.", value: model.evaluation.balancedAccuracy },
                        { label: "Sensitivity", value: model.evaluation.sensitivity },
                        { label: "Specificity", value: model.evaluation.specificity },
                      ].map((metric) => (
                        <div key={metric.label} className="px-5 py-4">
                          <div className="text-[1.6rem] leading-none font-semibold text-white tabular-nums">
                            {pct(metric.value)}
                          </div>
                          <div className="mt-1.5 text-[11px] uppercase tracking-wide text-slate-500">
                            {metric.label}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="px-6 pt-5">
                      <MetricBar value={model.evaluation.balancedAccuracy} />
                    </div>

                    {/* ── What it was measured on ── */}
                    <div className="px-6 pt-4">
                      <div className="flex gap-2.5 rounded-lg border border-slate-800 bg-slate-950/50 p-3.5">
                        <Database className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Evaluated on
                          </div>
                          <p className="mt-1 text-[13px] text-slate-300 leading-relaxed">
                            {model.evaluation.dataset}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ── Caveats, as a readable list ── */}
                    {sentences.length > 0 && (
                      <details open className="group px-6 pt-4 pb-6">
                        <summary className="flex items-center gap-2 cursor-pointer list-none select-none text-[11px] font-semibold uppercase tracking-wide text-amber-400/90 hover:text-amber-300 transition-colors">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Limitations
                          <span className="text-slate-600 font-normal normal-case tracking-normal">
                            ({sentences.length})
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 ml-auto text-slate-600 transition-transform group-open:rotate-180" />
                        </summary>

                        <ul className="mt-3 space-y-2.5">
                          {sentences.map((sentence, index) => {
                            const critical = HARD_LIMIT.test(sentence);
                            return (
                              <li key={index} className="flex gap-2.5">
                                <span
                                  aria-hidden
                                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                                    critical ? "bg-amber-400" : "bg-slate-600"
                                  }`}
                                />
                                <span
                                  className={`text-[13px] leading-relaxed ${
                                    critical ? "text-amber-100/90" : "text-slate-400"
                                  }`}
                                >
                                  {sentence}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="px-6 py-6 text-sm text-slate-400">
                    No evaluation recorded, so this model is not served.
                  </p>
                )}

                {!model.enabled && model.disabledReason && (
                  <div className="mx-6 mb-6 flex gap-2.5 rounded-lg border border-rose-900/50 bg-rose-950/30 p-3.5">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-rose-200 leading-relaxed">
                      {model.disabledReason}
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {data?.reproduce && (
          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4">
            <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-sm text-slate-400">Reproduce these figures:</span>
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-slate-950 border border-slate-800 px-3 py-1.5 text-[12.5px] text-cyan-300 whitespace-nowrap">
              {data.reproduce}
            </code>
          </div>
        )}
      </div>
    </section>
  );
}
