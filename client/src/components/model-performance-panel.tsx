/**
 * Measured model performance, from the server's model registry.
 *
 * Replaces hardcoded tables that appeared in the admin dashboard and the
 * operator dashboard listing "Breast 96%, Lung 94%, Skin 92%, Colon 89%,
 * Prostate 91%". Three of those modalities have no classifier at all, and the
 * two real figures were both overstated — lung measures 0.785 balanced accuracy
 * and skin 0.864. The numbers were not derived from anything.
 *
 * Everything here comes from GET /api/models/cards, so a modality cannot show a
 * performance figure unless the server measured one. Balanced accuracy is the
 * headline rather than raw accuracy: on an imbalanced set a model that answers
 * "negative" every time scores the majority-class rate while detecting nothing,
 * and balanced accuracy scores that degenerate case at 0.5.
 */
import { useQuery } from "@tanstack/react-query";
import { Brain, CircleSlash } from "lucide-react";

export interface ModelCard {
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

/** Modalities the interface names, whether or not a model backs them. */
const MODALITIES = ["skin", "lung", "breast", "colon", "prostate"] as const;

const LABELS: Record<string, string> = {
  skin: "Skin",
  lung: "Lung",
  breast: "Breast",
  colon: "Colon",
  prostate: "Prostate",
};

export function useModelCards() {
  return useQuery<{ models: ModelCard[] }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });
}

export default function ModelPerformancePanel({
  variant = "light",
}: {
  variant?: "light" | "dark";
}) {
  const { data, isLoading } = useModelCards();
  const dark = variant === "dark";

  const cardFor = (id: string) => data?.models.find((m) => m.scanType === id);

  return (
    <div className="space-y-3">
      <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-600"}`}>
        Balanced accuracy on a held-out test set. Screening triage only — every
        result requires clinician review.
      </p>

      {isLoading && (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Loading measured performance…
        </p>
      )}

      {!isLoading &&
        MODALITIES.map((id) => {
          const card = cardFor(id);
          const measured = card?.enabled === true && card.evaluation;

          return (
            <div
              key={id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                dark
                  ? "border-slate-600 bg-slate-800"
                  : "border-slate-200 bg-slate-100"
              }`}
            >
              <div className="flex items-center gap-2">
                {measured ? (
                  <Brain
                    className={`w-4 h-4 ${dark ? "text-purple-400" : "text-purple-700"}`}
                  />
                ) : (
                  <CircleSlash className="w-4 h-4 text-slate-500" />
                )}
                <span
                  className={
                    measured
                      ? dark
                        ? "text-slate-200"
                        : "font-medium text-slate-900"
                      : "text-slate-500"
                  }
                >
                  {LABELS[id]}
                </span>
              </div>

              {measured ? (
                <div className="flex items-center gap-3 tabular-nums">
                  <span
                    className={`text-xs ${dark ? "text-slate-400" : "text-slate-600"}`}
                  >
                    sens {(card!.evaluation!.sensitivity * 100).toFixed(1)}% · spec{" "}
                    {(card!.evaluation!.specificity * 100).toFixed(1)}%
                  </span>
                  <span
                    className={`font-bold ${dark ? "text-cyan-300" : "text-slate-900"}`}
                  >
                    {(card!.evaluation!.balancedAccuracy * 100).toFixed(1)}%
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-500">
                  {card?.disabledReason ? "Disabled — failed evaluation" : "No model"}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}
