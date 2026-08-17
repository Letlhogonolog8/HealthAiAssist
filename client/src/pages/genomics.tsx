/**
 * Genomics page.
 *
 * Deliberately leads with what the system gets wrong, and for whom. The
 * transferability table and the model cards are public endpoints, so this page
 * is readable without an account — publishing the limits is the point, and
 * hiding them behind a login would defeat it.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Dna, ShieldCheck, Scale, FileWarning, Info } from 'lucide-react';

interface TransferabilityGroup {
  group: string;
  approximateRelativeAccuracy: number;
  confidence: string;
  percentileReported: boolean;
  guidance: string;
}

interface RiskResponse {
  band: string;
  clinicalUseAllowed: boolean;
  containsSyntheticData: boolean;
  imaging: { scanId: number; flagged: boolean; confidence: number } | null;
  polygenic: {
    panelId: string;
    provenance: string;
    coveragePct: number;
    matchedVariants: number;
    panelSize: number;
    percentile: number | null;
    percentileInterval: { low: number; high: number; widthPct: number } | null;
    percentileWithheldReason: string | null;
  } | null;
  ancestry: {
    selfReported: string | null;
    group: string;
    approximateRelativeAccuracy: number;
    confidence: string;
    guidance: string;
    citation: string;
  };
  actionableVariants: {
    screened: boolean;
    synthetic: boolean;
    findings: Array<{ gene: string; classification: string; copies: number; condition: string }>;
    notAssayedCount: number;
  } | null;
  contributions: Array<{ source: string; effect: string; detail: string }>;
  missingInputs: string[];
  caveats: string[];
}

const prettyGroup = (group: string) =>
  group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const bandColour = (band: string) =>
  band === 'high' ? 'bg-red-600' :
  band === 'moderate' ? 'bg-amber-500' :
  band === 'low' ? 'bg-green-600' : 'bg-gray-500';

export default function GenomicsPage({ user }: { user?: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const patientId = user?.id;

  const [ancestry, setAncestry] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [risk, setRisk] = useState<RiskResponse | null>(null);

  const { data: transferability } = useQuery<{
    background: string; citation: string; policy: string; groups: TransferabilityGroup[];
  }>({
    queryKey: ['/api/genomics/transferability'],
    queryFn: async () => (await fetch('/api/genomics/transferability')).json(),
  });

  const { data: panels } = useQuery<any>({
    queryKey: ['/api/genomics/panels'],
    queryFn: async () => (await fetch('/api/genomics/panels')).json(),
  });

  const { data: consents } = useQuery<any>({
    queryKey: ['/api/genomics/consent', patientId],
    queryFn: async () => (await fetch(`/api/genomics/consent/${patientId}`)).json(),
    enabled: !!patientId,
  });

  const { data: consentOptions } = useQuery<any>({
    queryKey: ['/api/genomics/consent/options'],
    queryFn: async () => (await fetch('/api/genomics/consent/options')).json(),
  });

  const { data: accessLog } = useQuery<any>({
    queryKey: ['/api/genomics/access-log', patientId],
    queryFn: async () => (await fetch(`/api/genomics/access-log/${patientId}`)).json(),
    enabled: !!patientId,
  });

  const setConsent = useMutation({
    mutationFn: async ({ scope, granted }: { scope: string; granted: boolean }) => {
      const response = await fetch('/api/genomics/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, scope, granted }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not record consent');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/genomics/consent', patientId] });
      toast({ title: 'Consent updated', description: 'Applied immediately to stored data.' });
    },
    onError: (e: any) => toast({ title: 'Consent not updated', description: e.message, variant: 'destructive' }),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a genotype file first');
      const form = new FormData();
      form.append('patientId', String(patientId));
      form.append('genotypeFile', file);
      if (ancestry.trim()) form.append('selfReportedAncestry', ancestry.trim());

      const response = await fetch('/api/genomics/profile/upload', { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || payload?.message || payload?.error || 'Upload failed');
      return payload;
    },
    onSuccess: (data) => {
      toast({
        title: 'Genotype file processed',
        description: `${data.variantsStored} of ${data.variantsInFile} variants retained — only those an installed panel uses.`,
      });
    },
    onError: (e: any) => toast({ title: 'Upload failed', description: e.message, variant: 'destructive' }),
  });

  const computeRisk = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/genomics/risk/${patientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition: 'melanoma' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Could not compute risk');
      return payload as RiskResponse;
    },
    onSuccess: (data) => setRisk(data),
    onError: (e: any) => toast({ title: 'No assessment produced', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Dna className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Genomics</h1>
          <p className="text-sm text-gray-600">
            Polygenic risk, high-penetrance variant screening, and how well any of
            it actually applies to you.
          </p>
        </div>
      </div>

      <Tabs defaultValue="equity">
        <TabsList>
          <TabsTrigger value="equity">Who this works for</TabsTrigger>
          <TabsTrigger value="panels">Data sources</TabsTrigger>
          <TabsTrigger value="consent">Consent</TabsTrigger>
          <TabsTrigger value="profile">Your genome</TabsTrigger>
        </TabsList>

        {/* ---------------- Equity ---------------- */}
        <TabsContent value="equity" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="w-5 h-5" />
                Ancestry transferability
              </CardTitle>
              <CardDescription>{transferability?.background}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {transferability?.groups.map((group) => (
                <div key={group.group} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="font-semibold">{prettyGroup(group.group)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        ~{Math.round(group.approximateRelativeAccuracy * 100)}% of discovery-population accuracy
                      </span>
                      {group.percentileReported ? (
                        <Badge variant="outline" className="text-blue-700 border-blue-300">
                          Percentile shown
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-800 border-amber-400">
                          Percentile withheld
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Bar length is the retained accuracy. Short bars are the point. */}
                  <div className="w-full h-2 bg-gray-200 rounded overflow-hidden mb-2">
                    <div
                      className={group.approximateRelativeAccuracy >= 0.8 ? 'h-full bg-green-600'
                        : group.approximateRelativeAccuracy >= 0.5 ? 'h-full bg-amber-500'
                        : 'h-full bg-red-500'}
                      style={{ width: `${group.approximateRelativeAccuracy * 100}%` }}
                    />
                  </div>

                  <p className="text-sm text-gray-700">{group.guidance}</p>
                </div>
              ))}

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>Policy:</strong> {transferability?.policy}
                  <div className="mt-1 text-gray-600">Source: {transferability?.citation}</div>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Panels ---------------- */}
        <TabsContent value="panels" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Installed reference data</CardTitle>
              <CardDescription>{panels?.note}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {panels?.polygenicPanels?.map((panel: any) => (
                <div key={panel.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">{panel.condition}</div>
                    <div className="text-sm text-gray-600">
                      {panel.variantCount} variants
                      {panel.pgsId ? ` · ${panel.pgsId}` : ''}
                      {panel.genomeBuild ? ` · ${panel.genomeBuild}` : ''}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Reference distribution installed: {panel.hasReferenceDistribution ? 'yes' : 'no — percentiles withheld'}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={panel.clinicalUseAllowed
                      ? 'text-green-700 border-green-300'
                      : 'text-red-700 border-red-300'}
                  >
                    {panel.clinicalUseAllowed ? 'Sourced' : 'Synthetic — not clinical'}
                  </Badge>
                </div>
              ))}

              {panels?.actionablePanel && (
                <div className="border rounded-lg p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">Actionable variants</div>
                    <div className="text-sm text-gray-600">
                      {panels.actionablePanel.variantCount} positions · {panels.actionablePanel.source} ({panels.actionablePanel.version})
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={panels.actionablePanel.clinicalUseAllowed
                      ? 'text-green-700 border-green-300'
                      : 'text-red-700 border-red-300'}
                  >
                    {panels.actionablePanel.clinicalUseAllowed ? 'Sourced' : 'Synthetic — not clinical'}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Consent ---------------- */}
        <TabsContent value="consent" className="space-y-4 pt-4">
          {!patientId ? (
            <Alert><AlertDescription>Sign in to manage consent.</AlertDescription></Alert>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" />
                    What you allow
                  </CardTitle>
                  <CardDescription>
                    Checked at every access, so withdrawing consent takes effect
                    immediately — including on data already stored.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {consentOptions?.scopes?.map((scope: any) => (
                    <div key={scope.scope} className="flex items-start justify-between gap-4 border rounded-lg p-4">
                      <div className="flex-1">
                        <div className="font-medium">{prettyGroup(scope.scope)}</div>
                        <p className="text-sm text-gray-600">{scope.description}</p>
                      </div>
                      <Switch
                        checked={consents?.consents?.[scope.scope]?.granted === true}
                        onCheckedChange={(granted) => setConsent.mutate({ scope: scope.scope, granted })}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Who has accessed your genomic data</CardTitle>
                  <CardDescription>
                    Every access is recorded, including refused ones. This log is kept
                    even if you delete your genotype data.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {accessLog?.entries?.length ? (
                    <div className="space-y-1 text-sm max-h-72 overflow-y-auto">
                      {accessLog.entries.map((entry: any) => (
                        <div key={entry.id} className="flex items-center justify-between border-b py-2 gap-2">
                          <span className="font-mono text-xs">{new Date(entry.occurredAt).toLocaleString()}</span>
                          <span>{entry.action}</span>
                          <span className="text-gray-600">{entry.accessedByRole ?? 'unknown role'}</span>
                          <Badge variant="outline" className={entry.granted
                            ? 'text-green-700 border-green-300'
                            : 'text-red-700 border-red-300'}>
                            {entry.granted ? 'allowed' : 'refused'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">No access recorded yet.</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ---------------- Profile / risk ---------------- */}
        <TabsContent value="profile" className="space-y-4 pt-4">
          {!patientId ? (
            <Alert><AlertDescription>Sign in to upload a genotype file.</AlertDescription></Alert>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Upload a genotype file</CardTitle>
                  <CardDescription>
                    A 23andMe or AncestryDNA raw export, or a single-sample VCF. Only
                    the variants an installed panel needs are stored; the rest of the
                    file is discarded.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="genotype-file">Genotype file</Label>
                    <Input
                      id="genotype-file"
                      type="file"
                      accept=".txt,.tsv,.vcf,.csv"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ancestry">Self-reported ancestry (optional)</Label>
                    <Input
                      id="ancestry"
                      placeholder="e.g. Black South African, European, East Asian"
                      value={ancestry}
                      onChange={(e) => setAncestry(e.target.value)}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Used only to report how well a score transfers to you. It is never
                      inferred from your DNA, and leaving it blank does not default to
                      European — percentiles are withheld instead.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
                      {upload.isPending ? 'Processing…' : 'Upload'}
                    </Button>
                    <Button variant="outline" onClick={() => computeRisk.mutate()} disabled={computeRisk.isPending}>
                      {computeRisk.isPending ? 'Assessing…' : 'Assess melanoma risk'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {risk && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle>Melanoma risk assessment</CardTitle>
                      <Badge className={`${bandColour(risk.band)} text-white`}>
                        {risk.band.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!risk.clinicalUseAllowed && (
                      <Alert className="border-red-300 bg-red-50">
                        <FileWarning className="h-4 w-4" />
                        <AlertDescription className="text-red-900">
                          <strong>Not usable clinically.</strong> This assessment drew on
                          synthetic test panels, so the numbers carry no medical meaning.
                          Install real PGS Catalog and ClinVar data to change this.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Ancestry calibration */}
                    <div className="border rounded-lg p-4">
                      <div className="font-semibold mb-1">
                        How well this applies to you — {prettyGroup(risk.ancestry.group)}
                      </div>
                      <p className="text-sm text-gray-700">{risk.ancestry.guidance}</p>
                      <p className="text-xs text-gray-500 mt-2">{risk.ancestry.citation}</p>
                    </div>

                    {/* Polygenic component */}
                    <div className="border rounded-lg p-4">
                      <div className="font-semibold mb-2">Polygenic score</div>
                      {risk.polygenic ? (
                        risk.polygenic.percentile !== null ? (
                          <>
                            <div className="text-sm mb-2">
                              {risk.polygenic.percentile}th percentile
                              {risk.polygenic.percentileInterval && (
                                <span className="text-gray-600">
                                  {' '}(plausible range {risk.polygenic.percentileInterval.low}–
                                  {risk.polygenic.percentileInterval.high})
                                </span>
                              )}
                            </div>
                            {risk.polygenic.percentileInterval && (
                              // The band widens as transferability falls. A very wide
                              // band is meant to look uninformative, because it is.
                              <div className="relative w-full h-3 bg-gray-200 rounded">
                                <div
                                  className="absolute h-full bg-blue-400/60 rounded"
                                  style={{
                                    left: `${risk.polygenic.percentileInterval.low}%`,
                                    width: `${risk.polygenic.percentileInterval.widthPct}%`,
                                  }}
                                />
                                <div
                                  className="absolute h-full w-0.5 bg-blue-900"
                                  style={{ left: `${risk.polygenic.percentile}%` }}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-amber-800">
                            No percentile: {risk.polygenic.percentileWithheldReason}
                          </p>
                        )
                      ) : (
                        <p className="text-sm text-gray-600">
                          No polygenic score — no genotype profile or no panel installed.
                        </p>
                      )}
                      {risk.polygenic && (
                        <p className="text-xs text-gray-500 mt-2">
                          Panel coverage {risk.polygenic.coveragePct}% (
                          {risk.polygenic.matchedVariants}/{risk.polygenic.panelSize} variants)
                        </p>
                      )}
                    </div>

                    {/* Actionable findings */}
                    {risk.actionableVariants?.screened && (
                      <div className="border rounded-lg p-4">
                        <div className="font-semibold mb-2">High-penetrance variants</div>
                        {risk.actionableVariants.findings.length ? (
                          risk.actionableVariants.findings.map((finding, i) => (
                            <div key={i} className="text-sm text-red-800">
                              {finding.gene} — {finding.classification.replace(/_/g, ' ')} ({finding.copies} cop
                              {finding.copies === 1 ? 'y' : 'ies'}) · {finding.condition}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-gray-700">No reportable findings.</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          {risk.actionableVariants.notAssayedCount} panel positions were not
                          present in your file. Those are unknown, not negative.
                        </p>
                      </div>
                    )}

                    {/* How the band was reached */}
                    <div className="border rounded-lg p-4">
                      <div className="font-semibold mb-2">How this band was reached</div>
                      <ul className="space-y-2 text-sm">
                        {risk.contributions.map((contribution, i) => (
                          <li key={i}>
                            <span className="font-medium">{prettyGroup(contribution.source)}</span>
                            {' — '}
                            <span className="text-blue-800">{contribution.effect}</span>
                            <div className="text-gray-700">{contribution.detail}</div>
                          </li>
                        ))}
                      </ul>
                      {risk.missingInputs.length > 0 && (
                        <div className="mt-3 text-sm text-gray-600">
                          <div className="font-medium">Not available:</div>
                          <ul className="list-disc ml-5">
                            {risk.missingInputs.map((missing, i) => <li key={i}>{missing}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>

                    <Alert className="border-amber-300 bg-amber-50">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-amber-900 text-sm">
                        <ul className="list-disc ml-4 space-y-1">
                          {risk.caveats.map((caveat, i) => <li key={i}>{caveat}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
