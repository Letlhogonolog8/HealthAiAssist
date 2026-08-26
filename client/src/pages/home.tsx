/**
 * Public homepage.
 *
 * Rewritten to remove claims the system cannot support. What was here before:
 * "97.5% Detection Accuracy", "10,000+ Scans Analyzed", "500+ Healthcare
 * Providers", "30% Earlier Detection", "FDA Compliant", "HIPAA compliant
 * infrastructure", "HIPAA & SOC 2 compliant", "Trusted by 500+ Healthcare
 * Institutions", federated learning, an offline mobile app, multi-language
 * support, 24/7 clinical assistance, and a free trial. None of it was true, and
 * the compliance claims are regulatory assertions the project does not hold.
 *
 * The sections below take their numbers from the API so the page cannot drift
 * away from the system again.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import EnhancedHeroSection from "@/components/enhanced-hero-section";
import AIFeaturesSection from "@/components/ai-features-section";
import CancerDetectionSection from "@/components/cancer-detection-section";
import Footer from "@/components/footer";
import LoginDialog from "@/components/login-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";
import { Dna, Scale, Lock, Ban, ArrowRight, AlertTriangle } from "lucide-react";

interface HomeProps {
  onLoginSuccess: (user: any) => void;
}

interface TransferabilityGroup {
  group: string;
  approximateRelativeAccuracy: number;
  percentileReported: boolean;
}

const prettyGroup = (group: string) =>
  group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Things the system declines to do. Stated positively, because each one is a
 * design decision rather than a missing feature.
 */
const REFUSALS = [
  {
    title: "It will not guess when a model is unavailable",
    body:
      "If no validated model can analyse a scan, the response carries no diagnostic content at all and the scan is queued for a human. An earlier version filled that gap with random values.",
  },
  {
    title: "It will not rank you against a population that is not yours",
    body:
      "Polygenic scores are derived overwhelmingly from European-ancestry cohorts. Where that reference does not describe you, no percentile is shown and the genomic component is dropped from the result entirely.",
  },
  {
    title: "It will not report what it did not measure",
    body:
      "No tumour stage, no grade, no biomarker panel, no lesion dimensions. An image classifier produces a label and a probability; anything beyond that would be invented.",
  },
  {
    title: "It will not treat a missing answer as a negative one",
    body:
      "Un-genotyped positions are reported as unknown, not as absent variants. A clean screen is not a clearance, and the interface says so.",
  },
];

export default function Home({ onLoginSuccess }: HomeProps & { userId?: number }) {
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const { data: transferability } = useQuery<{
    citation: string;
    groups: TransferabilityGroup[];
  }>({
    queryKey: ["/api/genomics/transferability"],
    queryFn: async () => (await fetch("/api/genomics/transferability")).json(),
  });

  const withheld = transferability?.groups.filter((g) => !g.percentileReported) ?? [];

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Both the navigation's Sign-in button and the hero's Access-platform
          button open the same dialog. Navigation used to mount its own, so this
          page carried two LoginDialog instances with separate form state. */}
      <Navigation
        onLoginSuccess={onLoginSuccess}
        onLoginClick={() => setShowLoginDialog(true)}
      />
      <EnhancedHeroSection onLoginClick={() => setShowLoginDialog(true)} />

      <AIFeaturesSection />
      <CancerDetectionSection />

      {/* ---------------- Equity: the differentiator ---------------- */}
      <section className="bg-slate-900/40 py-20 lg:py-24 border-y border-slate-800">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
                <Scale className="w-3.5 h-3.5" />
                Who this works for
              </div>
              <h2 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-white">
                Most genomic research describes a minority of the world
              </h2>
              <p className="mt-5 text-slate-400 leading-relaxed">
                Around 80–90% of genome-wide association study participants are of
                European ancestry. A risk score built there does not transfer intact
                elsewhere — and the failure is quiet. The score keeps producing a
                confident-looking number that means considerably less than it appears
                to.
              </p>
              <p className="mt-4 text-slate-400 leading-relaxed">
                This platform measures that gap and acts on it. Where a score does not
                transfer, the percentile is withheld rather than shown with a footnote,
                and the genomic component is excluded from the result instead of being
                quietly down-weighted.
              </p>
              {transferability?.citation && (
                <p className="mt-4 text-xs text-slate-400">{transferability.citation}</p>
              )}
              <Link href="/genomics">
                <Button
                  variant="outline"
                  className="mt-7 border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800 hover:text-white"
                >
                  See the full transferability table
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>

            <Card className="bg-slate-900/70 border-slate-800 rounded-2xl">
              <CardContent className="p-6 sm:p-7">
                <h3 className="text-sm font-semibold text-white">
                  Accuracy retained, relative to the discovery population
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  A bar at 100% means the score transfers intact. Anything lower means
                  it does not.
                </p>

                <div className="mt-6 space-y-3.5">
                  {transferability?.groups.map((group) => {
                    const value = group.approximateRelativeAccuracy;
                    const tone =
                      value >= 0.8
                        ? "bg-emerald-500"
                        : value >= 0.5
                          ? "bg-amber-500"
                          : "bg-rose-500";
                    return (
                      <div key={group.group}>
                        <div className="flex items-baseline justify-between text-sm gap-3">
                          <span
                            className={
                              group.percentileReported ? "text-slate-200" : "text-slate-400"
                            }
                          >
                            {prettyGroup(group.group)}
                          </span>
                          <span className="text-slate-400 tabular-nums text-[13px]">
                            ~{Math.round(value * 100)}%
                            {!group.percentileReported && (
                              <span className="ml-2 text-[11px] text-slate-400">withheld</span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${tone} transition-[width] duration-700`}
                            style={{ width: `${value * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {withheld.length > 0 && (
                  <p className="mt-6 pt-5 border-t border-slate-800 text-xs text-slate-400 leading-relaxed">
                    No percentile is reported for{" "}
                    <span className="text-slate-400">
                      {withheld.map((g) => prettyGroup(g.group)).join(", ")}
                    </span>{" "}
                    — the reference distribution does not describe those populations.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ---------------- Refusals ---------------- */}
      <section className="bg-slate-950 py-20 lg:py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
              <Ban className="w-3.5 h-3.5" />
              Deliberate limits
            </div>
            <h2 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-white">
              What it will not do
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              A screening tool is only as trustworthy as its willingness to say
              nothing. These are enforced in code and covered by tests.
            </p>
          </div>

          <div className="mt-10 grid gap-px md:grid-cols-2 bg-slate-800 border border-slate-800 rounded-2xl overflow-hidden">
            {REFUSALS.map((refusal, index) => (
              <div key={refusal.title} className="bg-slate-900/70 p-6 sm:p-7">
                <span className="text-[11px] font-semibold tabular-nums text-cyan-400/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2.5 font-semibold text-white leading-snug">
                  {refusal.title}
                </h3>
                <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
                  {refusal.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Genomics + governance ---------------- */}
      <section className="bg-slate-900/40 py-20 lg:py-24 border-y border-slate-800">
        <div className="max-w-6xl mx-auto px-6 grid gap-6 md:grid-cols-2">
          <Card className="bg-slate-900/70 border-slate-800 rounded-2xl">
            <CardContent className="p-7">
              <span className="grid place-items-center w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
                <Dna className="w-5 h-5 text-cyan-400" />
              </span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-white">Genomics</h3>
              <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
                Consumer genotype exports and single-sample VCFs, scored against a
                published PGS Catalog panel and screened against a ClinVar-derived
                list of pathogenic variants in hereditary cancer genes. No effect
                size or classification is authored here — everything traces to a
                dated release.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/70 border-slate-800 rounded-2xl">
            <CardContent className="p-7">
              <span className="grid place-items-center w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
                <Lock className="w-5 h-5 text-cyan-400" />
              </span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-white">
                Consent and audit
              </h3>
              <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
                Three revocable consent scopes, checked at every access rather than at
                upload, so withdrawal applies to data already stored. Every access is
                logged including refusals, and deleting your genome keeps the log —
                who read it is the part you most need afterwards.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---------------- Status ---------------- */}
      <section className="bg-slate-950 py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-6">
          <Alert className="border-amber-700/40 bg-amber-950/20 rounded-2xl p-6">
            <AlertTriangle className="h-4 w-4 !text-amber-400" />
            <AlertDescription className="text-amber-100/80 text-sm leading-relaxed pl-2">
              <strong className="block mb-1.5 text-amber-200 text-[13px] font-semibold uppercase tracking-[0.12em]">
                Current status
              </strong>
              A research prototype. It is not a registered medical device, holds no
              regulatory clearance in any jurisdiction, and has not been clinically or
              prospectively validated. It must not be used to make decisions about
              anyone's care. Model performance across skin tones is unmeasured, and the
              training data's demographic composition is unrecorded.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <Footer />

      <LoginDialog
        open={showLoginDialog}
        onOpenChange={setShowLoginDialog}
        onLoginSuccess={onLoginSuccess}
      />
    </div>
  );
}
