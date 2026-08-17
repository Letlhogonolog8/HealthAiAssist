/**
 * What the platform can and cannot analyse.
 *
 * Previously this advertised five modalities with invented performance —
 * "94% accuracy" for breast, "nodules as small as 3mm" for lung, "reducing
 * unnecessary biopsies by 40%" for prostate — when only two have a model at all
 * and the lung classifier measures nothing dimensional. Availability now comes
 * from /api/models/cards, so a modality cannot appear as offered unless the
 * server will actually analyse it.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Scan, Sun, Wind, HeartPulse, Microscope, CircleSlash } from "lucide-react";

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
  const { data } = useQuery<{ models: ModelCard[] }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  const cardFor = (id: string) => data?.models.find((m) => m.scanType === id);

  return (
    <section id="detection" className="bg-slate-950 py-20 border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold text-white">Coverage</h2>
          <p className="mt-3 text-slate-300">
            Three of these have no trained model. They are listed rather than hidden,
            because a gap you can see is more useful than a menu that quietly fails.
            Requests for them return an explicit refusal and are queued for a human.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODALITIES.map((modality) => {
            const card = cardFor(modality.id);
            const available = card?.enabled === true;
            const Icon = available ? modality.icon : CircleSlash;

            return (
              <div
                key={modality.id}
                className={`rounded-xl border p-5 ${
                  available
                    ? "border-slate-700 bg-slate-900"
                    : "border-slate-800 bg-slate-900/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-5 h-5 ${available ? "text-cyan-400" : "text-slate-600"}`}
                    />
                    <span
                      className={`font-semibold ${available ? "text-white" : "text-slate-400"}`}
                    >
                      {modality.name}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      available
                        ? "border-green-700 text-green-300"
                        : "border-slate-700 text-slate-500"
                    }
                  >
                    {available ? "Available" : "No model"}
                  </Badge>
                </div>

                <p className="mt-3 text-xs text-slate-500">{modality.input}</p>

                {available && card?.evaluation ? (
                  <p className="mt-3 text-sm text-slate-300 tabular-nums">
                    {(card.evaluation.sensitivity * 100).toFixed(1)}% sensitivity ·{" "}
                    {(card.evaluation.specificity * 100).toFixed(1)}% specificity
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    {card?.disabledReason
                      ? "Model failed evaluation and was switched off."
                      : "Not offered — no classifier exists for this modality."}
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
