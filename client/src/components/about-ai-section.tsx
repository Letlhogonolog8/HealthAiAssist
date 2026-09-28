import { ShieldCheck, Users, Globe, Ban } from "lucide-react";

/**
 * The "about" section.
 *
 * Rewritten on 2026-09-28. The previous version called the platform
 * production-ready with clinical-grade models, promised "advanced cancer
 * detection today", quoted 0.785 for a lung model that had been withdrawn on
 * 2026-09-20, advertised multi-language support that the translation audit
 * found inert, a dermatologist finder that does not exist, and two buttons with
 * no action behind them. tests/capability-claims.test.ts now sweeps every
 * client file for this, not three named ones.
 *
 * No performance figure is written here: figures belong to the model cards,
 * which carry the test set and the interval, and a number copied into a page
 * goes stale the day a model changes.
 */
interface Section {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  color: string;
  items: string[];
}

const SECTIONS: Section[] = [
  {
    icon: ShieldCheck,
    title: "Triage, with a clinician in the loop",
    color: "text-blue-500",
    items: [
      "Skin: a dermoscopic image classifier whose output orders a clinician's review queue.",
      "Lung CT: a clinician marks a nodule and receives the characteriser's assessment, under validation terms.",
      "Every result is reviewed and signed off by a clinician. The system does not diagnose.",
      "Measured performance, with its test set and its limitations, is published on the model cards.",
    ],
  },
  {
    icon: Users,
    title: "Clinical workflow",
    color: "text-green-500",
    items: [
      "Separate views for patients, doctors, radiologists and administrators.",
      "A review queue, clinician sign-off and a record of each confirmed outcome.",
      "Messaging with clinicians and appointment scheduling.",
    ],
  },
  {
    icon: Globe,
    title: "Access",
    color: "text-cyan-500",
    items: [
      "Runs in a web browser; no special hardware.",
      "Images can be captured offline and upload when a connection returns. Nothing is analysed offline.",
      "English only at present.",
    ],
  },
];

const LIMITS = [
  "It is not clinically validated and holds no regulatory clearance.",
  "Breast, colon and prostate have no model and are not analysed.",
  "Skin performance on darker skin types cannot yet be established from the available data.",
  "An image outside what a model was measured on is refused and sent to a clinician, not guessed at.",
];

export default function AboutAISection() {
  return (
    <section id="about" className="bg-slate-900 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            HealthAI Assistant: AI-assisted triage for clinician review
          </h2>
          <p className="text-xl text-slate-400 max-w-4xl mx-auto">
            It helps clinicians decide what to read first. It does not decide what a scan shows.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-8">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <div
                  key={section.title}
                  className="bg-gradient-to-br from-slate-800 to-slate-700 p-8 rounded-xl border border-slate-600"
                >
                  <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
                    <Icon className={`${section.color} mr-3 w-8 h-8`} />
                    {section.title}
                  </h3>
                  <ul className="space-y-4 text-slate-300">
                    {section.items.map((item) => (
                      <li key={item} className="flex items-start space-x-3">
                        <span
                          aria-hidden="true"
                          className={`w-2 h-2 ${section.color.replace("text-", "bg-")} rounded-full mt-2 flex-shrink-0`}
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-800 p-8 rounded-xl border border-amber-500/60">
            <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
              <Ban className="text-amber-400 mr-3 w-8 h-8" />
              What it does not do
            </h3>
            <ul className="space-y-4 text-slate-300">
              {LIMITS.map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span aria-hidden="true" className="w-2 h-2 bg-amber-400 rounded-full mt-2 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
