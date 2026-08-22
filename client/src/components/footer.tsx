/**
 * Site footer.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 *
 * It published a personal mobile number and a personal email address on a public
 * page, as the contact route for a medical platform. Those belong to a person,
 * not to the project, and a phone number on a public page is scraped within
 * days.
 *
 * Eight of the nine links were `href="#"`. Two of the labels described things
 * that do not exist: "Mobile Access" (there is no mobile app — the claim was
 * removed from the rest of the site for that reason) and "Clinical Studies"
 * (none have been run; the platform holds no clinical validation at all).
 * Advertising them here reintroduced, in the footer, exactly the claims the
 * homepage was rewritten to remove.
 *
 * The copyright read 2024.
 *
 * What is left links to routes that exist, names only what the project actually
 * has, and repeats the status line — because the footer is the part of a page
 * people scroll to when they are trying to work out what something is.
 */
import { Link } from "wouter";
import { Activity, Github, ShieldAlert } from "lucide-react";

const SECTIONS = [
  {
    title: "Platform",
    links: [
      { label: "Measured performance", href: "/#performance", anchor: "performance" },
      { label: "Coverage", href: "/#detection", anchor: "detection" },
      { label: "Genomics", href: "/genomics" },
      { label: "About the models", href: "/about" },
    ],
  },
];

export default function Footer() {
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <footer className="bg-slate-950 border-t border-slate-800">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* ── Identity ── */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                <Activity className="h-4 w-4 text-cyan-400" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-white">
                Health<span className="text-cyan-400">AI</span>
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-400 leading-relaxed max-w-sm">
              Screening triage for two imaging modalities, with a consented genomics
              pipeline. Every figure traces to an evaluation you can reproduce.
            </p>
          </div>

          {/* ── Navigation ── */}
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {section.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.anchor ? (
                      <button
                        onClick={() => scrollTo(link.anchor!)}
                        className="text-sm text-slate-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-slate-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* ── Reproducing the work ── */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Evaluation
            </h4>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              <li className="flex items-start gap-2">
                <Github className="w-3.5 h-3.5 mt-1 shrink-0 text-slate-600" />
                <span>
                  Model cards, evaluation scripts and thresholds are in the repository.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 mt-1 shrink-0 text-slate-600" />
                <span>
                  Contact runs through the operating institution. No support channel is
                  published here.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} HealthAI. A research prototype.
          </p>
          <p className="text-xs text-slate-500">
            Not a registered medical device · No regulatory clearance · Not for clinical
            decisions
          </p>
        </div>
      </div>
    </footer>
  );
}
