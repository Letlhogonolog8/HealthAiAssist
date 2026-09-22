/**
 * DETECT → SEGMENT → LOCALIZE → CHARACTERIZE → UNDERSTAND → ASSIST, per modality.
 *
 * The conceptual workflow this platform is built toward, shown as a grid rather
 * than a diagram: one row per model-backed capability, one column per stage,
 * and in each cell the status the server reports for that stage. A stage shown
 * as CURRENT is current for the modality in that row and for nothing else —
 * the grid makes that impossible to misread, where a single arrow diagram with
 * "current" written under it would not.
 *
 * Everything rendered comes from GET /api/capabilities. Stages a modality does
 * not apply to are left blank, not filled in.
 */
import { useQuery } from "@tanstack/react-query";

type CapabilityStatus =
  | "CURRENT"
  | "VALIDATION"
  | "IN_DEVELOPMENT"
  | "PLANNED"
  | "FUTURE"
  | "DISABLED";
type Stage = "DETECT" | "SEGMENT" | "LOCALIZE" | "CHARACTERIZE" | "UNDERSTAND" | "ASSIST";

interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  scanType: string | null;
  stages: Partial<Record<Stage, CapabilityStatus>>;
}

interface Manifest {
  stages: Array<{ id: Stage; meaning: string }>;
  capabilities: Capability[];
}

const CELL: Record<CapabilityStatus, string> = {
  CURRENT: "bg-emerald-500/15 text-emerald-200 border-emerald-600/30",
  VALIDATION: "bg-cyan-500/15 text-cyan-200 border-cyan-600/30",
  DISABLED: "bg-rose-950/40 text-rose-300 border-rose-800/40",
  IN_DEVELOPMENT: "bg-amber-950/30 text-amber-200 border-amber-700/40",
  PLANNED: "bg-slate-800/60 text-slate-400 border-slate-700",
  FUTURE: "bg-slate-800/40 text-slate-500 border-slate-800",
};

const SHORT: Record<CapabilityStatus, string> = {
  CURRENT: "Current",
  VALIDATION: "Validation",
  DISABLED: "Withdrawn",
  IN_DEVELOPMENT: "In dev.",
  PLANNED: "Planned",
  FUTURE: "Future",
};

export default function PipelineStagesSection() {
  const { data } = useQuery<Manifest>({
    queryKey: ["/api/capabilities"],
    queryFn: async () => (await fetch("/api/capabilities")).json(),
  });

  // Only rows that have at least one stage to report. Capabilities with no
  // stages (a viewer, a data pipeline) are described in Coverage instead.
  const rows = data?.capabilities.filter((c) => Object.keys(c.stages).length > 0) ?? [];
  const stages = data?.stages ?? [];

  if (!data || rows.length === 0) return null;

  return (
    <section className="bg-slate-900/40 py-20 lg:py-24 border-y border-slate-800">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
            Workflow
          </span>
          <h2 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-white">
            Detect, segment, localize, characterize, understand, assist
          </h2>
          <p className="mt-4 text-slate-400 leading-relaxed">
            The computer-vision workflow this platform is built toward, and how far each
            modality has actually got along it. A cell is current for its row only. Blank
            cells are stages that do not apply.
          </p>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-slate-400">
                <th className="pr-4 font-semibold">Modality</th>
                {stages.map((s) => (
                  <th key={s.id} className="px-2 font-semibold" title={s.meaning}>
                    {s.id.charAt(0) + s.id.slice(1).toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="pr-4 py-1 text-slate-200 font-medium whitespace-nowrap">
                    {row.name}
                  </td>
                  {stages.map((s) => {
                    const status = row.stages[s.id];
                    return (
                      <td key={s.id} className="px-2 py-1">
                        {status ? (
                          <span
                            className={`inline-block w-full rounded-md border px-2 py-1.5 text-center text-xs font-medium ${CELL[status]}`}
                          >
                            {SHORT[status]}
                          </span>
                        ) : (
                          <span className="inline-block w-full rounded-md border border-dashed border-slate-800 px-2 py-1.5 text-center text-xs text-slate-700">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3 text-xs text-slate-400">
          {stages.map((s) => (
            <div key={s.id} className="flex gap-2">
              <dt className="shrink-0 font-semibold text-slate-300 w-28">
                {s.id.charAt(0) + s.id.slice(1).toLowerCase()}
              </dt>
              <dd className="leading-relaxed">{s.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
