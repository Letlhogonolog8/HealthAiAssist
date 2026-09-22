/**
 * Route 1: a clinician marks a nodule on a CT slice and asks for a
 * characterisation.
 *
 * Three steps, in order, and none is skippable:
 *
 *   1. Upload the DICOM object. Not a PNG — the characteriser was trained on
 *      64 px crops at the CT's native pixel scale, and a rendered export
 *      carries no scale. The server renders the slice (lung window, the same
 *      render the crop is cut from) and returns it as a preview; nothing is
 *      stored at this step and no model runs.
 *   2. Click the nodule. The click is mapped from the displayed image to the
 *      frame's pixel grid, which is what the service takes. A 64 px box shows
 *      what will be cropped.
 *   3. Submit, for a named patient. The server de-identifies the object,
 *      stores THAT, runs the characteriser on the marked crop, records the
 *      mark and the structured result, and answers with both.
 *
 * What comes back is rendered by AiResultSummary as the numbers it is made
 * of. There is no risk badge and no "cancer detected" in this file.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Crosshair, Loader2, Upload } from "lucide-react";
import { AiResultSummary, type ResultDetail } from "./ai-result-summary";
import { submitScan, describeRejection, describeNotAnalysed } from "@/lib/submit-scan";

interface Preview {
  previewPng: string;
  frame: { rows: number; columns: number };
  acquisition: {
    modality: string;
    manufacturer: string;
    manufacturerModel: string;
    pixelSpacingMm: number[] | null;
    sliceThicknessMm: number | null;
    bodyPartExamined: string;
    windowApplied: { center: number; width: number; source: string };
  };
}

interface Analysis {
  detail: ResultDetail;
  region: { cx: number; cy: number; sizePx: number; sizeMm: number[] | null };
  findings: string[];
  recommendations: string[];
  analysis?: { answers?: string | null };
  summary: { triagePriority: string };
}

const CROP_PX = 64;

export default function LungNoduleTool() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [mark, setMark] = useState<{ cx: number; cy: number } | null>(null);
  const [patientId, setPatientId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ scanId: number; analysis: Analysis; scanType: string } | null>(null);
  const [refusal, setRefusal] = useState<{ title: string; description: string } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const { data: cards } = useQuery<{ models: Array<{ scanType: string; status: string; enabled: boolean }> }>({
    queryKey: ["/api/models/cards"],
    queryFn: async () => (await fetch("/api/models/cards")).json(),
  });
  const card = cards?.models.find((m) => m.scanType === "lung_nodule");

  // A new file resets everything downstream of it.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setMark(null);
    setResult(null);
    setRefusal(null);
    if (!file) return;
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      try {
        const form = new FormData();
        form.append("image", file, file.name);
        const res = await fetch("/api/dicom/preview", { method: "POST", body: form, credentials: "include" });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(body?.error ?? `The slice could not be rendered (${res.status}).`);
          return;
        }
        setPreview(body);
      } catch (error) {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : "The slice could not be rendered.");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  /** Displayed pixel → frame pixel. The image is shown scaled to fit. */
  function onImageClick(event: React.MouseEvent<HTMLImageElement>) {
    const img = imageRef.current;
    if (!img || !preview) return;
    const rect = img.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * preview.frame.columns;
    const y = ((event.clientY - rect.top) / rect.height) * preview.frame.rows;
    setMark({ cx: Math.round(x), cy: Math.round(y) });
    setResult(null);
    setRefusal(null);
  }

  async function submit() {
    if (!file || !mark) return;
    const patient = Number.parseInt(patientId, 10);
    if (!Number.isInteger(patient) || patient <= 0) {
      toast({ title: "Patient required", description: "Enter the patient's record number.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setResult(null);
    setRefusal(null);
    try {
      const outcome = await submitScan({
        image: file,
        fileName: file.name,
        scanType: "lung_nodule",
        patientId: patient,
        extra: { cx: String(mark.cx), cy: String(mark.cy) },
      });
      if (outcome.kind === "rejected") {
        setRefusal(describeRejection(outcome.status, outcome.body));
      } else if (outcome.kind === "not_analysed") {
        setRefusal(describeNotAnalysed(outcome.body));
      } else if (outcome.kind === "queued") {
        setRefusal({
          title: "Saved on this device",
          description: "You are offline, so nothing has been analysed yet. It will upload when there is a connection.",
        });
      } else {
        setResult({ scanId: outcome.body.scan.id, analysis: outcome.body.analysis, scanType: "lung_nodule" });
      }
    } catch (error) {
      setRefusal({ title: "Submission failed", description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSubmitting(false);
    }
  }

  // The 64 px crop box, in displayed coordinates, drawn over the image.
  const box = (() => {
    const img = imageRef.current;
    if (!img || !preview || !mark) return null;
    const scaleX = img.clientWidth / preview.frame.columns;
    const scaleY = img.clientHeight / preview.frame.rows;
    return {
      left: (mark.cx - CROP_PX / 2) * scaleX,
      top: (mark.cy - CROP_PX / 2) * scaleY,
      width: CROP_PX * scaleX,
      height: CROP_PX * scaleY,
    };
  })();

  const spacing = preview?.acquisition.pixelSpacingMm ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="w-5 h-5" />
            Lung nodule characterisation
          </CardTitle>
          <CardDescription>
            Mark one nodule on one CT slice. The model estimates the probability that a radiologist
            would rate the marked nodule malignant. It does not find nodules and does not read the
            rest of the slice.
            {card && (
              <span className="block mt-1">
                Model status: <strong>{card.status}</strong>
                {card.status === "VALIDATION" && " — research / internal validation on 97 held-out nodules; not clinically validated."}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {card && !card.enabled && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>The nodule characteriser is not serving. Uploads would be stored and queued for a radiologist.</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nodule-dicom">1. CT slice (DICOM object, .dcm)</Label>
              <Input
                id="nodule-dicom"
                type="file"
                accept=".dcm,application/dicom,application/octet-stream"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                A PNG or JPEG export is refused: the crop must be at the scanner's native pixel scale.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nodule-patient">3. Patient record number</Label>
              <Input
                id="nodule-patient"
                inputMode="numeric"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="e.g. 42"
              />
              <p className="text-xs text-muted-foreground">The result is filed against this patient and queued for review.</p>
            </div>
          </div>

          {loadingPreview && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Rendering the slice at the lung window…
            </p>
          )}
          {previewError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-3">
              <Label>2. Click the nodule</Label>
              <div className="relative inline-block max-w-full border border-border rounded-md overflow-hidden bg-black">
                <img
                  ref={imageRef}
                  src={preview.previewPng}
                  alt="CT slice rendered at the lung window"
                  className="block max-w-full h-auto cursor-crosshair select-none"
                  style={{ maxHeight: "70vh" }}
                  onClick={onImageClick}
                  draggable={false}
                />
                {box && (
                  <div
                    aria-hidden
                    className="absolute border-2 border-cyan-400 pointer-events-none"
                    style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {preview.acquisition.modality} · {preview.acquisition.manufacturer} {preview.acquisition.manufacturerModel} ·{" "}
                {preview.frame.columns}×{preview.frame.rows} px
                {spacing && ` · ${spacing[0].toFixed(2)} mm/px`}
                {preview.acquisition.sliceThicknessMm !== null && ` · slice ${preview.acquisition.sliceThicknessMm} mm`}
                {" · window "}
                {preview.acquisition.windowApplied.center}/{preview.acquisition.windowApplied.width}
              </p>
              {mark ? (
                <p className="text-sm text-foreground">
                  Marked at ({mark.cx}, {mark.cy}). The {CROP_PX} px crop
                  {spacing && ` (${(CROP_PX * spacing[0]).toFixed(0)} mm)`} shown will be characterised.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No mark yet.</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={!file || !mark || submitting || (card ? !card.enabled : false)}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Characterise the marked nodule
            </Button>
          </div>

          {refusal && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong className="block">{refusal.title}</strong>
                {refusal.description}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <AiResultSummary
            detail={result.analysis.detail}
            scanType={result.scanType}
            flagged={result.analysis.summary.triagePriority === "priority review"}
            capabilityStatus={card?.status ?? null}
            answers={result.analysis.analysis?.answers ?? null}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What the model said, in its own words</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {result.analysis.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Filed as scan #{result.scanId} and queued for radiologist review. The mark is recorded with it.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
