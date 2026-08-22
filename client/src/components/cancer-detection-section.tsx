/**
 * What the platform can and cannot analyse.
 *
 * Previously this advertised five modalities with invented performance —
 * "94% accuracy" for breast, "nodules as small as 3mm" for lung, "reducing
 * unnecessary biopsies by 40%" for prostate — when only two have a model at all
 * and the lung classifier measures nothing dimensional. Availability now comes
 * from /api/models/cards, so a modality cannot appear as offered unless the
 * server will actually analyse it.
 *
 * ── On the styling of the gaps ─────────────────────────────────────────────
 *
 * The unavailable cards were rendered at slate-800-on-slate-900/40 with
 * slate-500 body text — close enough to the page background to read as disabled
 * chrome rather than as content. That undercuts the point of listing them: the
 * whole reason a gap is shown rather than hidden is so a clinician sees it. They
 * are now legible, and the distinction is carried by a state label and a
 * left-edge marker instead of by fading them out.
 */
import { useQuery } from "@tanstack/react-query";
import { Scan, Sun, Wind, HeartPulse, Microscope, Minus, Check } from "lucide-react";

interface ModelCard {
  scanType: string;
  enabled: boolean;
  disabledReason: string | null;
  evaluation: { sensitivity: number; specificity: number } | null;
}

/** Modalities the interface names. Availability is decided by the server. */
const MODALITIES = [
  { id: "skin", name: "Skin", icon: Sun, input: "Dermoscopy and clinical photographs" },
  { id: "lung", name: "Lung", icon: Wind, input: "Chest imaging" },
  { id: "breast", name: "Breast", icon: HeartPulse, input: "Mammography" },
  { id: "prostate", name: "Prostate", icon: Scan, input: "MRI" },
  { id: "cervical", name: "Cervical", icon: Microscope, input: "Cytology" },
];

export default function CancerDetectionSection() {
  const { data, isLoading } = useQuery<{ models: ModelCard[] }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  const cardFor = (id: string) => data?.models.find((m) => m.scanType === id);
  const availableCount = MODALITIES.filter((m) => cardFor(m.id)?.enabled === true).length;

  return (
    <section id="detection" className="scroll-mt-16 bg-slate-950 py-20 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
              Scope
            </span>
            <h2 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-white">
              Coverage
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Three of these have no trained model. They are listed rather than hidden,
              because a gap you can see is more useful than a menu that quietly fails.
              Requests for them return an explicit refusal and are queued for a human.
            </p>
          </div>

          {!isLoading && (
            <div className="text-sm text-slate-500 tabular-nums">
              <span className="text-white font-semibold text-base">{availableCount}</span>
              {" of "}
              {MODALITIES.length} available
            </div>
          )}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODALITIES.map((modality) => {
            const card = cardFor(modality.id);
            const available = card?.enabled === true;
            const Icon = modality.icon;

            return (
              <div
                key={modality.id}
                className={`relative rounded-xl border p-5 pl-6 overflow-hidden transition-colors ${
                  available
                    ? "border-slate-800 bg-slate-900/70 hover:border-slate-700"
                    : "border-slate-800/80 bg-slate-900/30"
                }`}
              >
                {/* A left-edge marker carries the state, so the unavailable cards
                    can stay legible instead of being dimmed into the background. */}
                <span
                  aria-hidden
                  className={`absolute left-0 inset-y-0 w-[3px] ${
                    available ? "bg-cyan-500/70" : "bg-slate-700"
                  }`}
                />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${
                        available
                          ? "bg-cyan-500/10 border border-cyan-500/25"
                          : "bg-slate-800/60 border border-slate-700/60"
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 ${available ? "text-cyan-400" : "text-slate-500"}`}
                      />
                    </span>
                    <span className="font-semibold text-white truncate">{modality.name}</span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                      available
                        ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700 bg-slate-800/60 text-slate-400"
                    }`}
                  >
                    {available ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {available ? "Available" : "No model"}
                  </span>
                </div>

                <p className="mt-3.5 text-xs text-slate-500">{modality.input}</p>

                {available && card?.evaluation ? (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                    <span className="text-slate-300">
                      <span className="text-white font-semibold">
                        {(card.evaluation.sensitivity * 100).toFixed(1)}%
                      </span>{" "}
                      <span className="text-slate-500">sensitivity</span>
                    </span>
                    <span className="text-slate-300">
                      <span className="text-white font-semibold">
                        {(card.evaluation.specificity * 100).toFixed(1)}%
                      </span>{" "}
                      <span className="text-slate-500">specificity</span>
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                    {card?.disabledReason
                      ? "Model failed evaluation and was switched off."
                      : "No classifier exists for this modality. Uploads are refused and queued for a human."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
