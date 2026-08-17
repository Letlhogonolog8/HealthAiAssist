/**
 * Measured model performance, read live from /api/models/cards.
 *
 * Replaces a grid of capability claims that were not true: "reducing false
 * negatives by up to 30%", an offline mobile app that does not exist,
 * multi-language support that does not exist, and federated learning that does
 * not exist. What is here instead is the evaluation output for each model,
 * including the ones that failed and are switched off.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

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

export default function AIFeaturesSection() {
  const { data, isLoading } = useQuery<{ models: ModelCard[]; reproduce: string }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  return (
    <section id="performance" className="bg-slate-900 py-20 border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold text-white">Measured performance</h2>
          <p className="mt-3 text-slate-300">
            Read live from the API, not written into this page. Balanced accuracy is
            the headline rather than raw accuracy: on an imbalanced set, a model that
            answers "negative" every time scores well on accuracy while detecting
            nothing.
          </p>
        </div>

        {isLoading && <p className="mt-8 text-slate-400">Loading evaluation results…</p>}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {data?.models.map((model) => (
            <Card
              key={model.scanType}
              className={`bg-slate-800/60 ${
                model.enabled ? "border-slate-700" : "border-red-900/60"
              }`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-xl font-semibold text-white capitalize">
                    {model.scanType}
                  </h3>
                  {model.enabled ? (
                    <Badge className="bg-green-500/15 text-green-300 border border-green-600/40">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Serving
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-300 border border-red-600/40">
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Disabled
                    </Badge>
                  )}
                </div>

                {model.evaluation ? (
                  <>
                    <div className="mt-5 grid grid-cols-3 gap-4">
                      {[
                        { label: "Balanced acc.", value: model.evaluation.balancedAccuracy },
                        { label: "Sensitivity", value: model.evaluation.sensitivity },
                        { label: "Specificity", value: model.evaluation.specificity },
                      ].map((metric) => (
                        <div key={metric.label}>
                          <div className="text-2xl font-semibold text-white tabular-nums">
                            {pct(metric.value)}
                          </div>
                          <div className="text-xs text-slate-400">{metric.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Chance is 0.5 for balanced accuracy; the marker makes a
                        near-chance model visually obvious rather than a number
                        the reader has to interpret. */}
                    <div className="mt-4">
                      <div className="relative h-2 rounded bg-slate-700">
                        <div
                          className={`h-full rounded ${
                            model.evaluation.balancedAccuracy >= 0.8
                              ? "bg-green-500"
                              : model.evaluation.balancedAccuracy >= 0.65
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                          style={{ width: `${model.evaluation.balancedAccuracy * 100}%` }}
                        />
                        <div
                          className="absolute top-[-3px] h-3.5 w-px bg-slate-300"
                          style={{ left: "50%" }}
                          title="chance"
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        marker at 50% = chance
                      </div>
                    </div>

                    <p className="mt-4 text-xs text-slate-400">
                      {model.evaluation.dataset}
                    </p>
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                      {model.evaluation.caveats}
                    </p>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-slate-400">
                    No evaluation recorded, so this model is not served.
                  </p>
                )}

                {!model.enabled && model.disabledReason && (
                  <Alert className="mt-4 border-red-900/60 bg-red-950/40">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-red-200 text-xs">
                      {model.disabledReason}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {data?.reproduce && (
          <p className="mt-8 text-sm text-slate-400">
            Reproduce these figures:{" "}
            <code className="rounded bg-slate-800 px-2 py-1 text-cyan-300">
              {data.reproduce}
            </code>
          </p>
        )}
      </div>
    </section>
  );
}
