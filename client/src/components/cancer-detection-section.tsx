/**
 * What the platform can and cannot analyse — as the server states it.
 *
 * This component used to carry its own list of five modalities and decide the
 * wording for each. Now it renders GET /api/capabilities and nothing else: the
 * names, the inputs, the statuses and the evidence sentences all arrive from
 * the server, which derives them from the model registry and the governance
 * check. There is no string in this file that asserts a capability exists.
 *
 * Statuses are grouped so the reader sees the shape of the system at a glance:
 * what serves, what serves under validation terms, what was switched off and
 * why, and what is only a plan. The unavailable cards are styled legibly on
 * purpose — the reason a gap is shown rather than hidden is so a clinician sees
 * it.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Minus, FlaskConical, Hammer, CalendarClock, Compass, Ban } from "lucide-react";

type CapabilityStatus =
  | "CURRENT"
  | "VALIDATION"
  | "IN_DEVELOPMENT"
  | "PLANNED"
  | "FUTURE"
  | "DISABLED";

interface Capability {
  id: string;
  name: string;
  input: string;
  status: CapabilityStatus;
  evidence: string;
  phase: string | null;
  scanType: string | null;
  modelClass: string | null;
}

interface Manifest {
  statuses: Record<CapabilityStatus, string>;
  capabilities: Capability[];
}

interface ModelCard {
  scanType: string;
  evaluation: { sensitivity: number; specificity: number } | null;
}

const ORDER: CapabilityStatus[] = [
  "CURRENT",
  "VALIDATION",
  "DISABLED",
  "IN_DEVELOPMENT",
  "PLANNED",
  "FUTURE",
];

const LABEL: Record<CapabilityStatus, string> = {
  CURRENT: "Current",
  VALIDATION: "Validation",
  IN_DEVELOPMENT: "In development",
  PLANNED: "Planned",
  FUTURE: "Future",
  DISABLED: "Withdrawn",
};

const STYLE: Record<CapabilityStatus, { badge: string; edge: string; Icon: typeof Check }> = {
  CURRENT: {
    badge: "border-emerald-600/30 bg-emerald-500/10 text-emerald-300",
    edge: "bg-emerald-500/70",
    Icon: Check,
  },
  VALIDATION: {
    badge: "border-cyan-600/30 bg-cyan-500/10 text-cyan-300",
    edge: "bg-cyan-500/70",
    Icon: FlaskConical,
  },
  DISABLED: {
    badge: "border-rose-800/50 bg-rose-950/30 text-rose-300",
    edge: "bg-rose-600/70",
    Icon: Ban,
  },
  IN_DEVELOPMENT: {
    badge: "border-amber-700/40 bg-amber-950/30 text-amber-200",
    edge: "bg-amber-500/60",
    Icon: Hammer,
  },
  PLANNED: {
    badge: "border-slate-700 bg-slate-800/60 text-slate-300",
    edge: "bg-slate-600",
    Icon: CalendarClock,
  },
  FUTURE: {
    badge: "border-slate-700 bg-slate-800/40 text-slate-400",
    edge: "bg-slate-700",
    Icon: Compass,
  },
};

/** The first sentence of a longer evidence string; the card links to the rest. */
const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0];

export default function CancerDetectionSection() {
  const { data: manifest, isLoading } = useQuery<Manifest>({
    queryKey: ["/api/capabilities"],
    queryFn: async () => (await fetch("/api/capabilities")).json(),
  });
  const { data: cards } = useQuery<{ models: ModelCard[] }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });

  const evaluationFor = (scanType: string | null) =>
    scanType ? cards?.models.find((m) => m.scanType === scanType)?.evaluation ?? null : null;

  const groups = ORDER.map((status) => ({
    status,
    items: manifest?.capabilities.filter((c) => c.status === status) ?? [],
  })).filter((g) => g.items.length > 0);

  const serving = manifest?.capabilities.filter(
    (c) => c.status === "CURRENT" || c.status === "VALIDATION"
  ).length ?? 0;
  const total = manifest?.capabilities.length ?? 0;

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
              Every status on this page is decided by the server from the model registry
              and its governance check, and each carries the evidence for it. Nothing
              here is written into the page. A gap is listed rather than hidden, because
              a gap you can see is more useful than a menu that quietly fails.
            </p>
          </div>

          {!isLoading && manifest && (
            <div className="text-sm text-slate-400 tabular-nums">
              <span className="text-white font-semibold text-base">{serving}</span>
              {" of "}
              {total} serving
            </div>
          )}
        </div>

        {manifest && (
          <dl className="mt-8 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-xs text-slate-400">
            {ORDER.map((status) => (
              <div key={status} className="flex gap-2">
                <dt className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STYLE[status].badge}`}>
                  {LABEL[status]}
                </dt>
                <dd className="leading-relaxed">{manifest.statuses[status]}</dd>
              </div>
            ))}
          </dl>
        )}

        {groups.map((group) => {
          const { badge, edge, Icon } = STYLE[group.status];
          return (
            <div key={group.status} className="mt-10">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
                {LABEL[group.status]}
              </h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((cap) => {
                  const evaluation =
                    cap.status === "CURRENT" || cap.status === "VALIDATION"
                      ? evaluationFor(cap.scanType)
                      : null;
                  return (
                    <div
                      key={cap.id}
                      className={`relative rounded-xl border p-5 pl-6 overflow-hidden ${
                        cap.status === "CURRENT" || cap.status === "VALIDATION"
                          ? "border-slate-800 bg-slate-900/70"
                          : "border-slate-800/80 bg-slate-900/30"
                      }`}
                    >
                      <span aria-hidden className={`absolute left-0 inset-y-0 w-[3px] ${edge}`} />

                      <div className="flex items-start justify-between gap-3">
                        <span className="font-semibold text-white leading-snug">{cap.name}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${badge}`}
                        >
                          {group.status === "CURRENT" ? <Check className="w-3 h-3" /> : group.status === "FUTURE" || group.status === "PLANNED" ? <Minus className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                          {LABEL[cap.status]}
                        </span>
                      </div>

                      <p className="mt-3 text-xs text-slate-400">{cap.input}</p>

                      {evaluation && (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                          <span className="text-slate-300">
                            <span className="text-white font-semibold">
                              {(evaluation.sensitivity * 100).toFixed(1)}%
                            </span>{" "}
                            <span className="text-slate-400">sensitivity</span>
                          </span>
                          <span className="text-slate-300">
                            <span className="text-white font-semibold">
                              {(evaluation.specificity * 100).toFixed(1)}%
                            </span>{" "}
                            <span className="text-slate-400">specificity</span>
                          </span>
                        </div>
                      )}

                      <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                        {firstSentence(cap.evidence)}
                        {cap.modelClass && (
                          <span className="block mt-1.5 text-[11px] uppercase tracking-wide text-slate-500">
                            Evidence class: {cap.modelClass.replace(/_/g, " ")} · not clinically validated
                          </span>
                        )}
                        {cap.phase && !cap.modelClass && (
                          <span className="block mt-1.5 text-[11px] uppercase tracking-wide text-slate-500">
                            Roadmap {cap.phase}
                          </span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
