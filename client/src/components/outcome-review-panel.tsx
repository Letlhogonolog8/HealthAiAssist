/**
 * Recording what a scan turned out to be, and reading what that measures.
 *
 * This is the human-in-the-loop step the model cards insist on, made into an
 * actual workflow. Two halves, and the order on screen is deliberate: the
 * backlog of predictions still waiting on a confirmed answer comes first,
 * because it is the work; the measured performance comes second, because it is
 * the consequence of doing the work.
 *
 * The performance half never prints a bare percentage. A sensitivity of 100%
 * from one confirmed cancer and a sensitivity of 100% from four hundred are the
 * same number and completely different claims, so the denominator and the
 * confidence interval travel with every rate, and a sample too small to act on
 * says so in words rather than relying on the reader to check n.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, RefreshCw, Microscope } from 'lucide-react';

interface QueuedScan {
  id: number;
  patientId: number;
  patientName: string | null;
  scanType: string;
  predictedPositive: boolean;
  result: string | null;
  aiConfidence: string | null;
  modelVersion: string | null;
  createdAt: string;
  hasImage: boolean;
}

interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
  interval: { low: number; high: number } | null;
}

interface Performance {
  scanType: string;
  matrix: {
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
  };
  indeterminate: number;
  unadjudicated: number;
  adjudicated: number;
  sensitivity: Rate;
  specificity: Rate;
  positivePredictiveValue: Rate;
  negativePredictiveValue: Rate;
  balancedAccuracy: number | null;
  sufficientForInference: boolean;
  evidenceFloor: string;
  note: string;
}

/** Strongest evidence first — the order the server accepts them in. */
const METHODS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'histopathology', label: 'Histopathology', hint: 'Tissue examined after resection' },
  { value: 'biopsy', label: 'Biopsy', hint: 'Sample taken and examined' },
  { value: 'specialist_review', label: 'Specialist review', hint: 'A second clinician read the image' },
  { value: 'imaging_followup', label: 'Imaging follow-up', hint: 'A later scan settled it' },
  { value: 'clinical_followup', label: 'Clinical follow-up', hint: 'Course of illness settled it' },
];

const OUTCOMES: Array<{ value: string; label: string; tone: string }> = [
  { value: 'malignant', label: 'Malignant', tone: 'bg-red-900/50 text-red-200 border-red-700' },
  { value: 'benign', label: 'Benign', tone: 'bg-emerald-900/50 text-emerald-200 border-emerald-700' },
  { value: 'indeterminate', label: 'Indeterminate', tone: 'bg-amber-900/50 text-amber-200 border-amber-700' },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * A rate, always with its denominator and interval.
 *
 * There is no code path here that renders `value` on its own. That is the whole
 * design of this component.
 */
function RateReadout({ label, rate }: { label: string; rate: Rate }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      {rate.value === null ? (
        <p className="text-slate-500 italic text-sm">no confirmed cases yet</p>
      ) : (
        <>
          <p className="text-2xl font-semibold text-white tabular-nums">{pct(rate.value)}</p>
          <p className="text-xs text-slate-400 tabular-nums">
            {rate.numerator}/{rate.denominator}
            {rate.interval && (
              <> · 95% CI {pct(rate.interval.low)}–{pct(rate.interval.high)}</>
            )}
          </p>
        </>
      )}
    </div>
  );
}

export default function OutcomeReviewPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<QueuedScan | null>(null);
  const [outcome, setOutcome] = useState('');
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [evidenceFloor, setEvidenceFloor] = useState('any');

  const {
    data: queue,
    isLoading: queueLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useQuery<QueuedScan[]>({
    queryKey: ['/api/radiologist/awaiting-outcome'],
    queryFn: async () => {
      const res = await fetch('/api/radiologist/awaiting-outcome', { credentials: 'include' });
      if (!res.ok) throw new Error(`Could not load the outcome queue (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: performance, refetch: refetchPerformance } = useQuery<{ models: Performance[] }>({
    queryKey: ['/api/models/performance', evidenceFloor],
    queryFn: async () => {
      const query = evidenceFloor === 'any' ? '' : `?evidence=${evidenceFloor}`;
      const res = await fetch(`/api/models/performance${query}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Could not load measured performance (${res.status})`);
      return res.json();
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No scan selected');
      const res = await fetch(`/api/scans/${selected.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ outcome, method, notes }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Could not record the outcome (${res.status})`);
      return body;
    },
    onSuccess: (body) => {
      // Said plainly, because finding out is the point of collecting these.
      const verdict =
        body?.modelWasCorrect === true
          ? 'The model agreed with this.'
          : body?.modelWasCorrect === false
            ? 'The model disagreed with this.'
            : 'Not counted towards accuracy.';
      toast({ title: 'Outcome recorded', description: verdict });

      setSelected(null);
      setOutcome('');
      setMethod('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/awaiting-outcome'] });
      queryClient.invalidateQueries({ queryKey: ['/api/models/performance'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not record outcome', description: error.message, variant: 'destructive' });
    },
  });

  const rows = queue ?? [];

  return (
    <div className="space-y-4">
      {/* ── The work ─────────────────────────────────────────────────────── */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-blue-400" />
                Awaiting confirmed outcome
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Predictions with no confirmed answer yet. Flagged scans are listed first: a
                missed cancer costs more than a false alarm, so confirming those is what
                surfaces the failures worth knowing about.
              </p>
            </div>
            <Button
              onClick={() => refetchQueue()}
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-300 shrink-0"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {queueError ? (
            <div className="text-center py-8">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
              <p className="text-red-400">{(queueError as Error).message}</p>
            </div>
          ) : queueLoading ? (
            <p className="text-slate-400 py-6 text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
              <p className="text-slate-300">Nothing waiting.</p>
              <p className="text-sm text-slate-500 mt-1">
                Every prediction has a confirmed outcome recorded against it.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((scan) => (
                <div
                  key={scan.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-900/50 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white">
                        {scan.patientName ?? `Patient ${scan.patientId}`}
                      </span>
                      <Badge
                        className={
                          scan.predictedPositive
                            ? 'bg-red-900/50 text-red-200 border-red-700'
                            : 'bg-slate-700 text-slate-200 border-slate-600'
                        }
                      >
                        {scan.predictedPositive ? 'Model flagged' : 'Model cleared'}
                      </Badge>
                      <span className="text-xs text-slate-500 font-mono">{scan.scanType}</span>
                    </div>
                    <p className="text-sm text-slate-400 mt-0.5 truncate">
                      {scan.result ?? 'No result recorded'}
                      {scan.aiConfidence && <> · confidence {scan.aiConfidence}</>}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(scan.createdAt).toLocaleString()}
                      {scan.modelVersion && <> · {scan.modelVersion}</>}
                      {!scan.hasImage && <> · no image stored</>}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 shrink-0"
                    onClick={() => {
                      setSelected(scan);
                      setOutcome('');
                      setMethod('');
                      setNotes('');
                    }}
                  >
                    Record outcome
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── The consequence ──────────────────────────────────────────────── */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <Microscope className="w-5 h-5 text-blue-400" />
                Measured on these patients
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Computed from the outcomes recorded above — not the held-out evaluation on
                the model card, which describes a different dataset and a different question.
              </p>
            </div>
            <div className="w-56">
              <Label className="text-xs text-slate-400">Evidence admitted</Label>
              <Select
                value={evidenceFloor}
                onValueChange={(value) => {
                  setEvidenceFloor(value);
                  refetchPerformance();
                }}
              >
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-700 border-slate-600">
                  <SelectItem value="any" className="text-white">Any confirmation</SelectItem>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-white">
                      {m.label} or stronger
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(performance?.models ?? []).length === 0 ? (
            <p className="text-slate-400 py-4 text-center">
              No modality has a prediction to measure yet.
            </p>
          ) : (
            performance!.models.map((model) => (
              <div key={model.scanType} className="rounded-md border border-slate-700 p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-white font-medium capitalize">{model.scanType}</h4>
                  <Badge
                    className={
                      model.sufficientForInference
                        ? 'bg-emerald-900/50 text-emerald-200 border-emerald-700'
                        : 'bg-amber-900/50 text-amber-200 border-amber-700'
                    }
                  >
                    {model.sufficientForInference ? 'Sample adequate' : 'Sample too small'}
                  </Badge>
                </div>

                {!model.sufficientForInference && (
                  <div className="flex gap-2 rounded border border-amber-700/60 bg-amber-950/40 p-2.5">
                    <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-100">{model.note}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <RateReadout label="Sensitivity" rate={model.sensitivity} />
                  <RateReadout label="Specificity" rate={model.specificity} />
                  <RateReadout label="PPV" rate={model.positivePredictiveValue} />
                  <RateReadout label="NPV" rate={model.negativePredictiveValue} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm border-t border-slate-700 pt-3">
                  <div>
                    <span className="text-slate-400">Correctly flagged </span>
                    <span className="text-white tabular-nums">{model.matrix.truePositives}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">False alarms </span>
                    <span className="text-white tabular-nums">{model.matrix.falsePositives}</span>
                  </div>
                  <div>
                    <span className="text-red-300">Missed cancers </span>
                    <span className="text-white tabular-nums">{model.matrix.falseNegatives}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Correctly cleared </span>
                    <span className="text-white tabular-nums">{model.matrix.trueNegatives}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  {model.adjudicated} adjudicated
                  {model.indeterminate > 0 && <> · {model.indeterminate} indeterminate, excluded</>}
                  {model.unadjudicated > 0 && <> · {model.unadjudicated} still awaiting confirmation</>}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Recording dialog ─────────────────────────────────────────────── */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent aria-describedby={undefined} className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Record confirmed outcome</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="rounded border border-slate-700 bg-slate-800 p-3 text-sm">
                <p className="text-white">
                  {selected.patientName ?? `Patient ${selected.patientId}`} ·{' '}
                  <span className="capitalize">{selected.scanType}</span>
                </p>
                <p className="text-slate-400 mt-1">
                  The model {selected.predictedPositive ? 'flagged' : 'cleared'} this scan
                  {selected.aiConfidence && <> at {selected.aiConfidence} confidence</>}.
                </p>
              </div>

              <div>
                <Label className="text-slate-300">What did it turn out to be?</Label>
                <div className="grid grid-cols-3 gap-2 mt-1.5">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setOutcome(o.value)}
                      className={`rounded border px-3 py-2 text-sm transition-colors ${
                        outcome === o.value
                          ? o.tone
                          : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-slate-300">How was it established?</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1.5">
                    <SelectValue placeholder="Select the evidence" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value} className="text-white">
                        {m.label} — {m.hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1.5">
                  Recorded with the outcome. Tissue and a second opinion are not equivalent
                  evidence, and performance can be recomputed against either.
                </p>
              </div>

              <div>
                <Label className="text-slate-300">Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything a later reader would need to interpret this."
                  className="bg-slate-800 border-slate-600 text-white mt-1.5"
                  rows={3}
                />
              </div>

              <p className="text-xs text-slate-500">
                Outcomes are append-only. Recording a different answer later keeps this one in
                the history rather than replacing it, and does not change the model's stored
                prediction.
              </p>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-slate-600 text-slate-300"
                  onClick={() => setSelected(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={!outcome || !method || record.isPending}
                  onClick={() => record.mutate()}
                >
                  {record.isPending ? 'Recording…' : 'Record outcome'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
