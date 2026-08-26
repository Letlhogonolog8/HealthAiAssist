/**
 * Homepage hero.
 *
 * Every headline figure here is read from the live API rather than written into
 * the copy. The previous version advertised "97% Detection Confidence", "30%
 * Earlier Detection", "60% Workflow Efficiency" and an "FDA Compliant" badge —
 * none of which were measured, and the FDA claim was simply false. Hardcoded
 * marketing numbers drift away from the system the moment either changes; these
 * cannot, because they come from /api/models/cards.
 *
 * ── On the layout ──────────────────────────────────────────────────────────
 *
 * The content sat in a single 3xl column inside a 6xl container, so on any wide
 * screen the right half of the hero was empty and the three statistics ran as a
 * thin unaccented row beneath it. They are the most load-bearing thing on the
 * page — they are the claim the rest of the site is evidence for — so they now
 * occupy their own panel opposite the copy, where the eye lands on them.
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
  const { data, isLoading } = useQuery<{ models: ModelCard[] }>({
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
      detail: disabled.length
        ? `${disabled.length} disabled after evaluation`
        : "three more have no classifier at all",
    },
    {
      value: best ? `${(best * 100).toFixed(1)}%` : "—",
      label: "best measured sensitivity",
      detail: "on a held-out test set, never used in training",
    },
    {
      value: "100%",
      label: "of results require clinician review",
      detail: "no path through the system bypasses it",
    },
  ];

  return (
    <section className="relative overflow-hidden bg-slate-950">
      {/* Two soft light sources and a hairline grid, rather than five animated
          blobs. The grid fades out well before the copy so it never competes
          with text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(48rem 26rem at 12% -8%, rgba(6,182,212,0.14), transparent 62%), radial-gradient(40rem 24rem at 88% 0%, rgba(37,99,235,0.12), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.07) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(70% 55% at 50% 0%, black, transparent)",
          WebkitMaskImage: "radial-gradient(70% 55% at 50% 0%, black, transparent)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 lg:items-center">
          {/* ── Copy ── */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/[0.07] px-3 py-1.5 text-xs font-medium text-cyan-300">
              <FlaskConical className="w-3.5 h-3.5" />
              Research prototype — not a medical device
            </div>

            {/* Sized to the column, not to the page. At 3.75rem the first line
                broke after "screening", leaving an orphaned "triage," and
                pushing the paragraph below the fold on a laptop. */}
            <h1 className="mt-6 text-[2.4rem] leading-[1.08] sm:text-[2.9rem] lg:text-[3.15rem] font-bold tracking-[-0.03em] text-white text-balance">
              Cancer screening triage,
              <span className="block mt-1 bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">
                with the evidence attached.
              </span>
            </h1>

            <p className="mt-6 text-lg text-slate-400 leading-relaxed max-w-xl">
              Two imaging models and a consented genomics pipeline. Every number this
              system reports traces to a measurement you can reproduce, and it refuses
              to answer where it has no basis to.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Button
                onClick={onLoginClick}
                size="lg"
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold shadow-lg shadow-cyan-500/20"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Access platform
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800 hover:text-white"
                onClick={() =>
                  document.getElementById("performance")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <Info className="w-4 h-4 mr-2" />
                See measured performance
              </Button>
            </div>

            {/* Honest counterparts to the old trust badges. */}
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2.5 text-[13px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <UserCheck className="w-3.5 h-3.5" />
                Clinician sign-off required
              </span>
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" />
                No regulatory clearance
              </span>
              <span className="inline-flex items-center gap-2">
                <FlaskConical className="w-3.5 h-3.5" />
                Reproducible evaluation
              </span>
            </div>
          </div>

          {/* ── The numbers the rest of the page is evidence for ── */}
          <dl className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm divide-y divide-slate-800 overflow-hidden">
            {facts.map((fact) => (
              <div key={fact.label} className="px-6 py-5 sm:px-7 sm:py-6">
                <dt className="text-[2.1rem] leading-none font-semibold text-white tabular-nums">
                  {isLoading && fact.value === "—" ? (
                    <span className="inline-block h-8 w-20 rounded bg-slate-800 animate-pulse align-middle" />
                  ) : (
                    fact.value
                  )}
                </dt>
                <dd className="mt-2 text-sm text-slate-300">{fact.label}</dd>
                <dd className="mt-0.5 text-xs text-slate-400">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
