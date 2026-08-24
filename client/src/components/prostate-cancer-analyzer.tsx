import { useState, useRef } from 'react';
import { Upload, FileImage, AlertTriangle, CheckCircle, Activity, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface ProstateAnalysisResult {
  hasCancer: boolean;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  findings: string[];
  recommendations: string[];
  prostateAnalysis?: {
    piradsScore: number;
    prostateVolume: string;
    psaCorrelation: {
      estimatedPSA: string;
      psaDensity: string;
      interpretation: string;
    };
    zones: {
      peripheralZone: string;
      transitionZone: string;
      centralZone: string;
    };
    mriFindings: {
      diffusionWeighting: string;
      dynamicContrast: string;
      spectroscopy: string;
    };
  };
  bloodMarkers?: {
    tumorMarkers: string[];
    suggestedBloodTests: string[];
  };
}

interface PSAData {
  totalPSA: string;
  freePSA: string;
  age: string;
  prostateVolume: string;
  familyHistory: string;
  symptoms: string[];
}

export default function ProstateCancerAnalyzer() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ProstateAnalysisResult | null>(null);
  const [psaData, setPsaData] = useState<PSAData>({
    totalPSA: '',
    freePSA: '',
    age: '',
    prostateVolume: '',
    familyHistory: 'no',
    symptoms: []
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const analyzeMutation = useMutation({
    mutationFn: async ({ file, psaData }: { file: File; psaData: PSAData }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('scanType', 'prostate-mri');
      formData.append('psaData', JSON.stringify(psaData));

      const response = await fetch('/api/scans/analyze', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setAnalysisResult(data.analysis);
      toast({
        title: "Analysis Complete",
        description: "Prostate MRI analysis completed successfully",
      });
    },
    onError: (error) => {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: "Please try again with a valid MRI image",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAnalysisResult(null);
    }
  };

  const handleAnalyze = () => {
    if (!selectedFile) {
      toast({
        title: "No Image Selected",
        description: "Please select a prostate MRI image to analyze",
        variant: "destructive",
      });
      return;
    }

    analyzeMutation.mutate({ file: selectedFile, psaData });
  };

  const getPiradsColor = (score: number) => {
    if (score >= 4) return 'bg-red-100 text-red-800 border-red-300';
    if (score === 3) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-green-100 text-green-800 border-green-300';
    }
  };

  const handleSymptomChange = (symptom: string, checked: boolean) => {
    setPsaData(prev => ({
      ...prev,
      symptoms: checked 
        ? [...prev.symptoms, symptom]
        : prev.symptoms.filter(s => s !== symptom)
    }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Prostate Cancer AI Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="upload" className="space-y-4">
            <TabsList>
              <TabsTrigger value="upload">MRI Upload</TabsTrigger>
              <TabsTrigger value="psa">PSA Data</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                <div className="text-center space-y-4">
                  <FileImage className="w-12 h-12 mx-auto text-gray-400" />
                  <div>
                    <h3 className="text-lg font-medium">Upload Prostate MRI</h3>
                    <p className="text-sm text-muted-foreground">
                      Support for T2-weighted, DWI, DCE, and multiparametric MRI
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button 
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Select MRI Image
                  </Button>
                </div>
              </div>

              {selectedFile && (
                <Alert>
                  <CheckCircle className="w-4 h-4" />
                  <AlertDescription>
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="psa" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="totalPSA">Total PSA (ng/mL)</Label>
                  <Input
                    id="totalPSA"
                    type="number"
                    value={psaData.totalPSA}
                    onChange={(e) => setPsaData(prev => ({ ...prev, totalPSA: e.target.value }))}
                    placeholder="e.g., 4.2"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="freePSA">Free PSA (%)</Label>
                  <Input
                    id="freePSA"
                    type="number"
                    value={psaData.freePSA}
                    onChange={(e) => setPsaData(prev => ({ ...prev, freePSA: e.target.value }))}
                    placeholder="e.g., 18"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="age">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    value={psaData.age}
                    onChange={(e) => setPsaData(prev => ({ ...prev, age: e.target.value }))}
                    placeholder="e.g., 65"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="familyHistory">Family History</Label>
                  <Select 
                    value={psaData.familyHistory} 
                    onValueChange={(value) => setPsaData(prev => ({ ...prev, familyHistory: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No family history</SelectItem>
                      <SelectItem value="father">Father had prostate cancer</SelectItem>
                      <SelectItem value="brother">Brother had prostate cancer</SelectItem>
                      <SelectItem value="multiple">Multiple relatives</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Current Symptoms</Label>
                <div className="grid grid-cols-2 gap-2">
                  {['Urinary frequency', 'Weak stream', 'Nocturia', 'Urgency', 'Incomplete emptying', 'Pain'].map((symptom) => (
                    <label key={symptom} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={psaData.symptoms.includes(symptom)}
                        onChange={(e) => handleSymptomChange(symptom, e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">{symptom}</span>
                    </label>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Button 
            onClick={handleAnalyze} 
            disabled={!selectedFile || analyzeMutation.isPending}
            className="w-full"
          >
            {analyzeMutation.isPending ? (
              <>
                <Activity className="w-4 h-4 mr-2 animate-spin" />
                Analyzing MRI...
              </>
            ) : (
              <>
                <Target className="w-4 h-4 mr-2" />
                Analyze Prostate MRI
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {analysisResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Prostate Analysis Results
              <Badge className={getRiskColor(analysisResult.riskLevel)}>
                {analysisResult.riskLevel.toUpperCase()} RISK
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold">AI Confidence</h4>
                <div className="flex items-center gap-2">
                  <Progress value={analysisResult.confidence} className="flex-1" />
                  <span className="text-sm font-medium">{analysisResult.confidence}%</span>
                </div>
              </div>

              {analysisResult.prostateAnalysis && (
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    PI-RADS Score
                    <Badge className={getPiradsColor(analysisResult.prostateAnalysis.piradsScore)}>
                      {analysisResult.prostateAnalysis.piradsScore}/5
                    </Badge>
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {analysisResult.prostateAnalysis.piradsScore >= 4 
                      ? 'Clinically significant cancer likely'
                      : analysisResult.prostateAnalysis.piradsScore === 3
                      ? 'Equivocal - consider biopsy'
                      : 'Clinically significant cancer unlikely'
                    }
                  </p>
                </div>
              )}
            </div>

            {analysisResult.prostateAnalysis && (
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">PSA Correlation</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Estimated PSA:</span>
                      <p className="font-medium">{analysisResult.prostateAnalysis.psaCorrelation.estimatedPSA}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">PSA Density:</span>
                      <p className="font-medium">{analysisResult.prostateAnalysis.psaCorrelation.psaDensity}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Volume:</span>
                      <p className="font-medium">{analysisResult.prostateAnalysis.prostateVolume}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Prostate Zones</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <span className="font-medium">Peripheral Zone:</span>
                      <p>{analysisResult.prostateAnalysis.zones.peripheralZone}</p>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <span className="font-medium">Transition Zone:</span>
                      <p>{analysisResult.prostateAnalysis.zones.transitionZone}</p>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <span className="font-medium">Central Zone:</span>
                      <p>{analysisResult.prostateAnalysis.zones.centralZone}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h4 className="font-semibold mb-2">Clinical Findings</h4>
              <ul className="space-y-1">
                {analysisResult.findings.map((finding, index) => (
                  <li key={index} className="text-sm flex items-start gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Recommendations</h4>
              <ul className="space-y-1">
                {analysisResult.recommendations.map((rec, index) => (
                  <li key={index} className="text-sm flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>

            {analysisResult.bloodMarkers && (
              <div>
                <h4 className="font-semibold mb-2">Suggested Blood Tests</h4>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.bloodMarkers.suggestedBloodTests.map((test, index) => (
                    <Badge key={index} variant="outline">{test}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysisResult.riskLevel === 'high' && (
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  High-risk findings detected. Immediate urological consultation recommended.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}