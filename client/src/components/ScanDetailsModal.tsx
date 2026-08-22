/**
 * The detail view for a stored scan.
 *
 * This component used to compose a complete radiology report out of literals.
 * None of the following came from the model, the scan, or any measurement:
 *
 *   - clinicalMetrics: sensitivity 94.2% / specificity 97.8% / accuracy 96.1% /
 *     NPV 99.1% / PPV 87.3%, selected by matching the scan type string. The same
 *     figures were removed from the hero section, the admin dashboard and
 *     /api/ai/models/status for being unmeasured; this copy survived.
 *   - detailedFindings: "Irregular tissue density patterns identified",
 *     "Vascular enhancement patterns require evaluation", "No focal lesions or
 *     mass effects detected". The classifier emits one label and one
 *     probability. The server pipeline refuses to synthesise descriptors like
 *     these — there is a comment in performLungCancerAnalysis saying so — and
 *     the UI was writing them anyway, chosen by whether the word "abnormal"
 *     appeared in a result string.
 *   - technicalDetails: a processing time of "2.847 seconds", an image
 *     resolution of "224x224 pixels (High Definition)", "DICOM-compliant image
 *     preprocessing" (the pipeline accepts JPEG and PNG, not DICOM) and
 *     "Automated QA protocols passed".
 *   - A confidence that fell back to 85 when the scan carried none.
 *
 * What is shown now is what the row holds: the model's verdict, its calibrated
 * probability, the model version that produced it, the measured processing time,
 * and the findings string the server actually wrote. Anything absent is shown as
 * absent.
 *
 * Per-model performance figures are deliberately not shown here. They belong to
 * the model, not to one scan, and they live behind /api/models/cards where they
 * carry their dataset and caveats with them.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Brain, AlertTriangle, CheckCircle, Clock, Stethoscope, Info } from 'lucide-react';

interface ScanDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  scan: any;
}

interface ModelCard {
  scanType: string;
  enabled: boolean;
  evaluation: {
    dataset: string;
    balancedAccuracy: number;
    sensitivity: number;
    specificity: number;
    caveats: string;
  } | null;
}

/** Renders a value, or a visible "not recorded" rather than a plausible stand-in. */
const Value: React.FC<{ children?: React.ReactNode }> = ({ children }) =>
  children === null || children === undefined || children === '' ? (
    <span className="text-slate-500 italic">not recorded</span>
  ) : (
    <span className="text-slate-200">{children}</span>
  );

export const ScanDetailsModal: React.FC<ScanDetailsModalProps> = ({ isOpen, onClose, scan }) => {
  // Fetched, not hardcoded: the evaluation figures for the model that produced
  // this result, with the dataset and caveats attached.
  const { data: cards } = useQuery<{ models: ModelCard[] }>({
    queryKey: ['/api/models/cards'],
    queryFn: async () => (await fetch('/api/models/cards')).json(),
    enabled: isOpen,
    staleTime: 60 * 60 * 1000,
  });

  if (!scan) return null;

  const getRiskColor = (risk: string) => {
    switch (risk?.toLowerCase()) {
      case 'high': return 'text-red-500 bg-red-100 border-red-300';
      case 'medium': return 'text-yellow-600 bg-yellow-100 border-yellow-300';
      case 'low': return 'text-green-600 bg-green-100 border-green-300';
      default: return 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600';
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'text-slate-400';
    if (confidence >= 90) return 'text-green-600';
    if (confidence >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const rawConfidence = scan.confidence ?? scan.aiConfidence;
  const confidence =
    typeof rawConfidence === 'number'
      ? rawConfidence
      : typeof rawConfidence === 'string' && rawConfidence.trim() !== ''
        ? Number.parseFloat(rawConfidence.replace('%', ''))
        : null;

  const scanType: string | undefined = scan.type ?? scan.scanType;
  const riskLevel: string | null = scan.riskLevel ?? null;
  const modelVersion: string | null = scan.modelVersion ?? null;
  const processingTimeMs: number | null =
    typeof scan.processingTime === 'number' ? scan.processingTime : null;

  // The findings the server wrote, not a list assembled from the result string.
  // `notes` is the joined findings array from the analysis pipeline.
  const findings: string[] = Array.isArray(scan.findings)
    ? scan.findings
    : typeof scan.notes === 'string' && scan.notes.trim() !== ''
      ? scan.notes.split('. ').filter(Boolean)
      : [];

  const scanDate = scan.date ?? scan.createdAt;
  const card = cards?.models.find((m) => m.scanType === scanType);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white text-xl">
            <Brain className="w-6 h-6 text-blue-400" />
            Scan Record
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* This banner is not decoration. An automated triage result read as a
              diagnosis is the failure mode these models are most likely to
              cause, and it must be on the same screen as the number. */}
          <div className="flex gap-3 rounded-md border border-amber-600/50 bg-amber-950/40 p-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-100">
              Screening triage only. This is a model output, not a diagnosis, and it
              requires review by a qualified clinician.
            </p>
          </div>

          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-white">
                    {scanType ? scanType.charAt(0).toUpperCase() + scanType.slice(1) : 'Scan'}
                    {scan.id ? <span className="ml-2 text-slate-400 text-sm">#{scan.id}</span> : null}
                  </CardTitle>
                  <p className="text-slate-400 text-xs mt-1">
                    {scanDate ? new Date(scanDate).toLocaleString() : 'Date not recorded'}
                  </p>
                </div>
                {riskLevel ? (
                  <Badge className={getRiskColor(riskLevel)}>{riskLevel.toUpperCase()} RISK</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide">Result</p>
                <p className="text-slate-100 text-lg"><Value>{scan.result}</Value></p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wide">
                    Model confidence
                  </p>
                  <p className={`text-2xl font-semibold ${getConfidenceColor(confidence)}`}>
                    {confidence === null ? '—' : `${Math.round(confidence)}%`}
                  </p>
                  <p className="text-slate-500 text-xs">
                    The model's own probability, not its accuracy.
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wide">Status</p>
                  <p className="text-slate-200 text-lg"><Value>{scan.status}</Value></p>
                </div>
              </div>
            </CardContent>
          </Card>

          {findings.length > 0 && (
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Stethoscope className="w-4 h-4 text-blue-400" />
                  Findings recorded by the analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {findings.map((finding, index) => (
                    <li key={index} className="flex gap-2 text-sm text-slate-300">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <span>{finding}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white text-base">
                <Clock className="w-4 h-4 text-blue-400" />
                Provenance
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide">Model version</p>
                <p className="font-mono"><Value>{modelVersion}</Value></p>
              </div>
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide">Processing time</p>
                <p><Value>{processingTimeMs !== null ? `${processingTimeMs} ms` : null}</Value></p>
              </div>
            </CardContent>
          </Card>

          {card?.evaluation && (
            <>
              <Separator className="bg-slate-700" />
              <Card className="bg-slate-800 border-slate-600">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white text-base">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    How this model performs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-slate-400 text-xs uppercase tracking-wide">Sensitivity</p>
                      <p className="text-slate-100 text-lg">
                        {Math.round(card.evaluation.sensitivity * 100)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs uppercase tracking-wide">Specificity</p>
                      <p className="text-slate-100 text-lg">
                        {Math.round(card.evaluation.specificity * 100)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs uppercase tracking-wide">
                        Balanced accuracy
                      </p>
                      <p className="text-slate-100 text-lg">
                        {Math.round(card.evaluation.balancedAccuracy * 100)}%
                      </p>
                    </div>
                  </div>
                  <p className="text-slate-400 text-xs">
                    Measured on: {card.evaluation.dataset}
                  </p>
                  <p className="text-slate-400 text-xs">{card.evaluation.caveats}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
