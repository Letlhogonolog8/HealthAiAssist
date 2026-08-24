/**
 * The analysis tools, and which of them can actually run.
 *
 * This page existed but was never routed. Wiring it up as it stood would have
 * reintroduced, on a new page, most of what the rest of the application was
 * cleaned of — so the route and the honesty went in together.
 *
 * ── What it claimed ────────────────────────────────────────────────────────
 *
 * Ten selectable "detection types", including Breast, Prostate and Cervical.
 * Two of those have no model, no analyser component and no endpoint. Selecting
 * one fell through `getAnalyzerComponent`'s `default:` branch and silently
 * rendered the multi-cancer uploader instead — a menu that quietly fails, which
 * is the exact thing the Coverage section on the home page promises this system
 * does not do. Availability is now read from /api/models/cards, the same source
 * Coverage uses, so a modality cannot be offered here unless the server will
 * analyse it.
 *
 * Each card also listed capability bullets — "TNM Staging", "BI-RADS Scoring",
 * "PI-RADS Scoring", "Biomarker Analysis", "HPV Detection". The platform's own
 * "What it will not do" says: no tumour stage, no grade, no biomarker panel, no
 * lesion dimensions. An image classifier returns a label and a probability.
 * Those bullets described a product that does not exist; they now describe what
 * each tool does.
 *
 * ── The blood test analyser ────────────────────────────────────────────────
 *
 * Removed from the menu rather than gated. It has no backend at all: it scored
 * cancer risk in the browser from hand-written weights (`riskScore += cea > 10
 * ? 30 : 15`), bucketed the total into low/medium/high/critical, and emitted
 * findings like "Strongly indicates ovarian or pancreatic cancer" and "Highly
 * suspicious for pancreatic cancer". No model, no evaluation, no validation —
 * the thresholds and the weights were typed by hand. That is a cancer-type
 * determination produced by a formula nobody measured, which is a more direct
 * version of the defect removed from the clinical dashboards.
 *
 * The component is left in the tree rather than deleted, because deleting it is
 * a separate decision, but nothing routes to it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Navigation from '@/components/navigation';
import Footer from '@/components/footer';
import LoginDialog from '@/components/login-dialog';
import {
  Wind,
  Target,
  Eye,
  Brain,
  Image as ImageIcon,
  Check,
  Minus,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import SkinCancerAnalyzer from '@/components/skin-cancer-analyzer';
import LungCancerAnalyzer from '@/components/lung-cancer-analyzer';
import MultiCancerDetectionSystem from '@/components/multi-cancer-detection-system';
import CancerRiskQuestionnaire from '@/components/cancer-risk-questionnaire';
import MedicalImageViewer from '@/components/medical-image-viewer';
import RealTimeSkinScanner from '@/components/real-time-skin-scanner';

interface ModelCard {
  scanType: string;
  enabled: boolean;
  evaluation: { sensitivity: number; specificity: number } | null;
}

/**
 * Rendered in two places, so both are supported explicitly.
 *
 * The dashboard has embedded this as a tab all along — it was the page's only
 * reachable form, since no route pointed at it. There the surrounding chrome
 * already exists and a user is always present. As a standalone route it needs
 * its own navigation and footer, and has to cope with nobody being signed in.
 */
interface CancerDetectionProps {
  user?: any;
  onLoginSuccess?: (user: any) => void;
  /** Draws the page's own navigation and footer. Off inside the dashboard. */
  standalone?: boolean;
}

/**
 * A tool on this page.
 *
 * `requiresModel` names the modality whose classifier the tool depends on. A
 * tool with no `requiresModel` does not run a model at all — the questionnaire
 * asks questions, the viewer displays an image — and is always available, so
 * long as it is not presented as producing a diagnosis.
 */
interface Tool {
  id: string;
  name: string;
  description: string;
  icon: typeof Brain;
  /** What it does. Not what a product brochure would like it to do. */
  does: string[];
  /**
   * The modality whose classifier this tool needs.
   *
   * Absent means the tool runs no model — the questionnaire, the viewer — or,
   * for the scan uploader, that it reads the registry itself and refuses per
   * modality on the server side.
   */
  requiresModel?: 'skin' | 'lung';
}

const TOOLS: Tool[] = [
  {
    id: 'multi-cancer',
    name: 'Scan upload',
    description: 'Submit an image and have it routed to whichever classifier covers it',
    icon: Brain,
    does: ['Refuses modalities with no model', 'Queues refusals for a human', 'Records the model version used'],
  },
  {
    id: 'skin',
    name: 'Skin lesion analysis',
    description: 'Dermoscopy and clinical photographs',
    icon: Eye,
    does: ['Malignant / uncertain / benign band', 'Calibrated probability', 'Refuses images unlike its training set'],
    requiresModel: 'skin',
  },
  {
    id: 'skin-scanner',
    name: 'Live skin scanner',
    description: 'The same classifier, fed from the camera',
    icon: Eye,
    does: ['Camera capture', 'Same model and thresholds as above'],
    requiresModel: 'skin',
  },
  {
    id: 'lung',
    name: 'Chest imaging analysis',
    description: 'Chest images, screening triage only',
    icon: Wind,
    does: ['Cancer / no-cancer call at a screening threshold', 'Calibrated probability', 'Refuses images unlike its training set'],
    requiresModel: 'lung',
  },
  {
    id: 'risk-questionnaire',
    name: 'Risk questionnaire',
    description: 'Recorded history and lifestyle factors',
    icon: Target,
    does: ['Records what you report', 'No image, no model, no score claimed as clinical'],
  },
  {
    id: 'image-viewer',
    name: 'Image viewer',
    description: 'Inspect an image without analysing it',
    icon: ImageIcon,
    does: ['Zoom and pan', 'Contrast adjustment', 'Produces no finding of any kind'],
  },
];

/** Named so the gap is visible, exactly as the home page does it. */
const NO_MODEL = [
  { name: 'Breast', input: 'Mammography' },
  { name: 'Prostate', input: 'MRI' },
  { name: 'Cervical', input: 'Cytology' },
];

export default function CancerDetection({
  user,
  onLoginSuccess,
  standalone = false,
}: CancerDetectionProps) {
  const [selectedId, setSelectedId] = useState('multi-cancer');
  const [showLogin, setShowLogin] = useState(false);

  const { data, isLoading } = useQuery<{ models: ModelCard[] }>({
    queryKey: ['/api/models/cards'],
    queryFn: async () => (await fetch('/api/models/cards')).json(),
  });

  const modelEnabled = (scanType: string) =>
    data?.models.find((m) => m.scanType === scanType)?.enabled === true;

  const isAvailable = (tool: Tool) =>
    !tool.requiresModel || modelEnabled(tool.requiresModel);

  const selected = TOOLS.find((t) => t.id === selectedId) ?? TOOLS[0];
  const selectedAvailable = isAvailable(selected);

  const renderAnalyzer = () => {
    if (!user) {
      return (
        <div className="text-center py-10">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
          <h3 className="mt-4 font-semibold text-foreground">Sign in to run an analysis</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Submitting a scan writes to your record and needs an account. Which tools
            exist, and which have no model behind them, is shown above without one.
          </p>
          <Button
            onClick={() => setShowLogin(true)}
            className="mt-5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
          >
            Sign in
          </Button>
        </div>
      );
    }

    // Belt and braces: the card is not selectable when the model is off, but the
    // registry can change under an open tab.
    if (!selectedAvailable) {
      return (
        <div className="flex gap-3 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-100/80 leading-relaxed">
            The model behind this tool is not currently being served, so it cannot
            produce a result. Submitting anyway would queue the scan for a human
            rather than analyse it.
          </p>
        </div>
      );
    }

    switch (selected.id) {
      case 'skin':
        return <SkinCancerAnalyzer />;
      case 'skin-scanner':
        return <RealTimeSkinScanner />;
      case 'lung':
        return <LungCancerAnalyzer />;
      case 'risk-questionnaire':
        return <CancerRiskQuestionnaire user={user} />;
      case 'image-viewer':
        return <MedicalImageViewer imageFile={null} />;
      case 'multi-cancer':
      default:
        return <MultiCancerDetectionSystem />;
    }
  };

  return (
    <div className={standalone ? 'min-h-screen bg-background' : ''}>
      {standalone && (
        <Navigation user={user} onLoginClick={() => setShowLogin(true)} solid />
      )}

      <div
        className={
          standalone
            ? 'max-w-6xl mx-auto px-6 py-14 lg:py-16 space-y-8'
            : 'space-y-8'
        }
      >
        {/* ── Header ── */}
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">
            Analysis
          </span>
          <h1 className="mt-3 text-3xl lg:text-[2.25rem] font-bold tracking-tight text-foreground">
            Screening tools
          </h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Each tool below either has a classifier behind it or says that it does
            not. Nothing here produces a diagnosis, and every result requires a
            clinician's sign-off before it means anything.
          </p>
        </div>

        {/* ── Tool picker ── */}
        <Card>
          <CardHeader>
            <CardTitle>Choose a tool</CardTitle>
            <CardDescription>
              Availability is read from the model registry, not written into this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                const available = isAvailable(tool);
                const active = selectedId === tool.id;

                return (
                  <button
                    key={tool.id}
                    type="button"
                    disabled={!available}
                    onClick={() => available && setSelectedId(tool.id)}
                    className={`text-left rounded-xl border p-5 transition-colors ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/[0.06]'
                        : available
                          ? 'border-border bg-card hover:border-slate-400 dark:hover:border-slate-600'
                          : 'border-border/60 bg-muted/40 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${
                          available
                            ? 'bg-cyan-500/10 border border-cyan-500/25'
                            : 'bg-muted border border-border'
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${available ? 'text-cyan-500' : 'text-muted-foreground'}`} />
                      </span>

                      {isLoading ? (
                        <span className="h-5 w-16 rounded-full bg-muted animate-pulse" />
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                            available
                              ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {available ? <Check className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                          {available ? 'Available' : 'Model off'}
                        </span>
                      )}
                    </div>

                    <h3 className="mt-4 font-semibold text-foreground">{tool.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {tool.description}
                    </p>

                    <ul className="mt-3 space-y-1">
                      {tool.does.map((item) => (
                        <li key={item} className="flex gap-2 text-xs text-muted-foreground">
                          <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>

            {/* ── The gaps, named ── */}
            <div className="mt-6 pt-5 border-t border-border">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                No classifier exists
              </h4>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                These are listed rather than hidden. A gap you can see is more useful
                than a menu that quietly fails — and this page used to substitute the
                scan uploader when one of them was picked.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {NO_MODEL.map((modality) => (
                  <span
                    key={modality.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                  >
                    <Minus className="w-3 h-3 text-muted-foreground" />
                    {modality.name}
                    <span className="text-muted-foreground/70">· {modality.input}</span>
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── The selected tool ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <selected.icon className="w-5 h-5 text-cyan-400" />
              {selected.name}
            </CardTitle>
            <CardDescription>{selected.description}</CardDescription>
          </CardHeader>
          <CardContent>{renderAnalyzer()}</CardContent>
        </Card>

        {/* ── Standing limits ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'No regulatory clearance',
              body:
                'Not a registered medical device in any jurisdiction. A research prototype for screening triage, not for clinical decisions.',
            },
            {
              title: 'Evaluation, not validation',
              body:
                'Measured retrospectively on held-out research images — 660 for skin, 1,244 for lung. No prospective study, no radiologist adjudication.',
            },
            {
              title: 'Every result reviewed',
              body:
                'A model output is a triage signal. It is queued for a clinician, and no path through the system bypasses that.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground text-sm">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </div>

      {standalone && <Footer />}

      {/* Only reachable from the standalone form; inside the dashboard there is
          always a session, so the sign-in prompt never renders. */}
      {onLoginSuccess && (
        <LoginDialog
          open={showLogin}
          onOpenChange={setShowLogin}
          onLoginSuccess={onLoginSuccess}
        />
      )}
    </div>
  );
}
