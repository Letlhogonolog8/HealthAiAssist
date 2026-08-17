/**
 * Homepage hero.
 *
 * Every headline figure here is read from the live API rather than written into
 * the copy. The previous version advertised "97% Detection Confidence", "30%
 * Earlier Detection", "60% Workflow Efficiency" and an "FDA Compliant" badge —
 * none of which were measured, and the FDA claim was simply false. Hardcoded
 * marketing numbers drift away from the system the moment either changes; these
 * cannot, because they come from /api/models/cards.
 */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LogIn, Info, ShieldAlert, FlaskConical, UserCheck } from "lucide-react";

interface EnhancedHeroSectionProps {
  onLoginClick: () => void;
}

interface ModelCard {
  scanType: string;
  enabled: boolean;
  evaluation: {
    balancedAccuracy: number;
    sensitivity: number;
    specificity: number;
  } | null;
}

export default function EnhancedHeroSection({ onLoginClick }: EnhancedHeroSectionProps) {
  const { data } = useQuery<{ models: ModelCard[] }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  const enabled = data?.models.filter((m) => m.enabled) ?? [];
  const disabled = data?.models.filter((m) => !m.enabled) ?? [];
  const best = enabled
    .map((m) => m.evaluation?.sensitivity ?? 0)
    .reduce((max, value) => Math.max(max, value), 0);

  const facts = [
    {
      value: enabled.length ? String(enabled.length) : "—",
      label: "modalities with a working model",
      detail: disabled.length ? `${disabled.length} disabled after evaluation` : "",
    },
    {
      value: best ? `${(best * 100).toFixed(1)}%` : "—",
      label: "best measured sensitivity",
      detail: "on a held-out test set",
    },
    {
      value: "100%",
      label: "of results require clinician review",
      detail: "no path bypasses it",
    },
  ];

  return (
    <section className="relative overflow-hidden bg-slate-950 border-b border-slate-800">
      {/* One soft light source rather than five animated blobs. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60rem 30rem at 20% -10%, rgba(37,99,235,0.25), transparent 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 py-20 lg:py-28">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
            <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
            Research prototype — not a medical device
          </div>

          <h1 className="mt-6 text-4xl lg:text-6xl font-bold tracking-tight text-white">
            Cancer screening triage,
            <span className="block text-cyan-400">with the evidence attached.</span>
          </h1>

          <p className="mt-6 text-lg text-slate-300 leading-relaxed">
            Two imaging models and a consented genomics pipeline. Every number this
            system reports traces to a measurement you can reproduce, and it refuses
            to answer where it has no basis to.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              onClick={onLoginClick}
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
            >
              <LogIn className="w-4 h-4 mr-2" />
              Access platform
            </Button>
            <Button
              variant="outline"
              className="border-slate-700 text-slate-200 hover:bg-slate-800"
              onClick={() => document.getElementById("performance")?.scrollIntoView({ behavior: "smooth" })}
            >
              <Info className="w-4 h-4 mr-2" />
              See measured performance
            </Button>
          </div>

          {/* Honest counterparts to the old trust badges. */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
            <span className="inline-flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-500" />
              Clinician sign-off required
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-500" />
              No regulatory clearance
            </span>
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-slate-500" />
              Reproducible evaluation
            </span>
          </div>
        </div>

        <dl className="mt-14 grid gap-6 sm:grid-cols-3 border-t border-slate-800 pt-10">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-3xl font-semibold text-white tabular-nums">{fact.value}</dt>
              <dd className="mt-1 text-sm text-slate-300">{fact.label}</dd>
              {fact.detail && <dd className="text-xs text-slate-500">{fact.detail}</dd>}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
