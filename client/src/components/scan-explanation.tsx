import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Eye, Loader2 } from "lucide-react";

/**
 * "Where did the model look?" for a scan under review.
 *
 * Fetches GET /api/scans/:id/explanation on request and shows the Grad-CAM
 * overlay with the caveat the inference service generated alongside it. The
 * caveat is rendered every time and cannot be dismissed: a heatmap without it
 * reads as a lesion boundary to anyone who has not been told otherwise, and
 * this panel is the one place a clinician meets the image.
 *
 * Nothing is requested until the button is pressed. The server regenerates the
 * overlay per request and refuses several cases (no model result, a changed
 * model, withdrawn consent); each refusal arrives as a message written for the
 * reader and is shown as-is rather than collapsed into "unavailable".
 */

interface Explanation {
  heatmapPng: string;
  method: string;
  caveat: string;
}

interface Success {
  success: true;
  modelVersion: string;
  explanation: Explanation;
  agreesWithStoredResult: boolean;
  rerunPrediction: string;
}

interface Refusal {
  success: false;
  code?: string;
  message: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'shown'; data: Success }
  | { kind: 'refused'; data: Refusal; status: number };

export default function ScanExplanation({
  scanId,
  /** False for a scan the model never scored; the button is replaced by a note. */
  hasModelResult,
}: {
  scanId: number;
  hasModelResult: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  // A different scan is a different question; do not carry one heatmap over
  // another scan's image.
  useEffect(() => setState({ kind: 'idle' }), [scanId]);

  async function load() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/scans/${scanId}/explanation`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success) {
        setState({ kind: 'shown', data: body as Success });
      } else {
        setState({
          kind: 'refused',
          status: res.status,
          data: {
            success: false,
            code: body?.code,
            message: body?.message ?? `The explanation could not be loaded (${res.status}).`,
          },
        });
      }
    } catch (error) {
      setState({
        kind: 'refused',
        status: 0,
        data: { success: false, message: error instanceof Error ? error.message : 'Network error' },
      });
    }
  }

  if (!hasModelResult) {
    return (
      <p className="text-xs text-slate-500">
        No model result on this scan, so there is nothing to show where it looked. Nothing was assessed.
      </p>
    );
  }

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={load}
          disabled={state.kind === 'loading'}
          className="border-slate-600 text-slate-200"
        >
          {state.kind === 'loading' ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Eye className="w-4 h-4 mr-2" />
          )}
          Where did the model look?
        </Button>
        <span className="text-xs text-slate-500">
          Renders a Grad-CAM overlay from the deployed model. Not a boundary or a measurement.
        </span>
      </div>
    );
  }

  if (state.kind === 'refused') {
    return (
      <div className="rounded border border-slate-600 bg-slate-900/60 p-3">
        <p className="text-sm text-slate-200">{state.data.message}</p>
        {state.status === 503 && (
          <p className="mt-1 text-xs text-slate-500">The stored result above is unaffected.</p>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setState({ kind: 'idle' })}
          className="mt-2 h-7 px-2 text-xs text-slate-400"
        >
          Dismiss
        </Button>
      </div>
    );
  }

  const { explanation, agreesWithStoredResult, rerunPrediction, modelVersion } = state.data;

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-600 bg-black overflow-hidden">
        <img
          src={explanation.heatmapPng}
          alt="Grad-CAM overlay showing the regions that most increased the model's score"
          className="w-full max-h-[45vh] object-contain"
        />
      </div>

      {!agreesWithStoredResult && (
        <div className="flex gap-2 rounded border border-red-700 bg-red-900/30 p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />
          <p className="text-sm text-red-200">
            The re-run did not reproduce the stored result (it now says “{rerunPrediction}”). This
            heatmap and the result above are about different decisions. Treat both with suspicion
            and report it.
          </p>
        </div>
      )}

      <div className="flex gap-2 rounded border border-amber-700 bg-amber-900/25 p-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
        <div className="text-sm text-amber-100 space-y-1">
          <p className="font-medium">What this is, and is not</p>
          <p className="whitespace-pre-line">{explanation.caveat}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {explanation.method} · model <code className="font-mono">{modelVersion}</code> · generated
        just now from the deployed artifact, not stored with the scan.
      </p>
    </div>
  );
}
