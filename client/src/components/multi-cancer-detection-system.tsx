import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  Upload, 
  Eye, 
  AlertTriangle, 
  CheckCircle, 
  Heart, 
  Wind, 
  Activity,
  Target,
  Brain,
  Zap
} from "lucide-react";

/**
 * Mirrors what the analysis API actually returns.
 *
 * `stage`, `biomarkers`, `imaging` and `followUpPeriod` used to live here and
 * were filled in client-side with random values. A binary image classifier
 * cannot produce a tumour stage or a biomarker panel, so those fields have no
 * honest source and are gone.
 */
interface CancerAnalysisResult {
  cancerType: string;
  hasCancer: boolean;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  findings: string[];
  recommendations: string[];
  urgency: 'routine' | 'expedited' | 'urgent' | 'routine_followup';
  requiresHumanReview: boolean;
}

/** A modality the server will actually analyse, from /api/models/cards. */
interface ModelCapability {
  scanType: string;
  enabled: boolean;
  disabledReason: string | null;
  evaluation: {
    balancedAccuracy: number;
    sensitivity: number;
    specificity: number;
    caveats: string;
  } | null;
}

const cancerTypes = [
  {
    id: 'breast',
    name: 'Breast Cancer',
    description: 'Mammography and breast imaging analysis',
    icon: Heart,
    color: 'bg-pink-500',
    acceptedFiles: 'Mammograms, ultrasound, MRI'
  },
  {
    id: 'lung',
    name: 'Lung Cancer',
    description: 'Chest X-ray and CT scan analysis',
    icon: Wind,
    color: 'bg-blue-500',
    acceptedFiles: 'Chest X-rays, CT scans, PET scans'
  },
  {
    id: 'prostate',
    name: 'Prostate Cancer',
    description: 'MRI and ultrasound analysis with PI-RADS scoring',
    icon: Target,
    color: 'bg-purple-500',
    acceptedFiles: 'Prostate MRI, ultrasound, biopsy images'
  },
  {
    id: 'skin',
    name: 'Skin Cancer',
    description: 'Dermatoscopy and lesion analysis using ABCDE criteria',
    icon: Eye,
    color: 'bg-orange-500',
    acceptedFiles: 'Dermatoscope images, clinical photos'
  },
  {
    id: 'cervical',
    name: 'Cervical Cancer',
    description: 'Pap smear and colposcopy analysis',
    icon: Activity,
    color: 'bg-green-500',
    acceptedFiles: 'Pap smear images, colposcopy'
  }
];

export default function MultiCancerDetectionSystem() {
  const { toast } = useToast();

  // Which modalities are actually backed by a model that passed evaluation.
  // Read from the server rather than hardcoded, so disabling a model in
  // MODEL_REGISTRY immediately stops the UI offering it.
  const { data: capabilities } = useQuery<{ models: ModelCapability[] }>({
    queryKey: ['/api/models/cards'],
    queryFn: async () => {
      const response = await fetch('/api/models/cards');
      if (!response.ok) throw new Error('Could not load model capabilities');
      return response.json();
    },
  });

  const capabilityFor = (id: string): ModelCapability | undefined =>
    capabilities?.models.find((m) => m.scanType === id);

  const isAvailable = (id: string): boolean => capabilityFor(id)?.enabled === true;

  const [selectedCancerType, setSelectedCancerType] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<CancerAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const cancerAnalysisMutation = useMutation({
    mutationFn: async (data: { file: File; cancerType: string }) => {
      const formData = new FormData();
      formData.append('image', data.file);
      formData.append('scanType', data.cancerType);
      
      const response = await fetch('/api/scan/upload', {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);

      // 503 means no validated model could analyse the scan. It is emphatically
      // not a negative result, and the message says so — surface the server's
      // wording rather than a generic failure.
      if (response.status === 503) {
        throw new Error(
          payload?.message ||
          'No validated model could analyse this scan. This is not a negative result.'
        );
      }

      if (!response.ok) {
        throw new Error(payload?.error || 'Cancer analysis failed');
      }

      return payload;
    },
    onSuccess: (data) => {
      const result = toViewModel(data.analysis, selectedCancerType);
      setAnalysisResult(result);
      setIsAnalyzing(false);
      setAnalysisProgress(100);

      toast({
        title: "Analysis complete",
        description:
          `${selectedCancerType} screening triage at ${result.confidence.toFixed(1)}% ` +
          'classifier confidence. Requires clinician review.',
      });
    },
    onError: (error: any) => {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
      setAnalysisResult(null);
      toast({
        title: "No result produced",
        description: error.message || "Analysis could not be completed.",
        variant: "destructive",
      });
    }
  });

  /**
   * Maps the API response onto the view model.
   *
   * This function previously invented biomarker panels per cancer type — PSA
   * levels, ER/PR/HER2 status, Breslow thickness, PI-RADS scores, CEA levels —
   * along with a cancer stage, all from Math.random() in the browser after the
   * response came back. None of it was ever computed from the image. It is
   * removed rather than reworked: the classifier outputs a binary label and a
   * probability, so a biomarker panel cannot be derived from it at all.
   *
   * Only fields the server actually returned are surfaced here.
   */
  const toViewModel = (baseResult: any, cancerType: string): CancerAnalysisResult => ({
    cancerType: cancerType as any,
    hasCancer: baseResult.hasCancer || baseResult.status === 'abnormal',
    confidence: parseFloat(baseResult.confidence) || 0,
    riskLevel: baseResult.riskLevel || (baseResult.hasCancer ? 'high' : 'low'),
    findings: baseResult.findings || [],
    recommendations: baseResult.recommendations || [],
    urgency: baseResult.urgency || (baseResult.hasCancer ? 'urgent' : 'routine'),
    requiresHumanReview: baseResult.requiresHumanReview !== false,
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif', 'image/webp', 'image/avif'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: "Please select a valid medical image file (JPEG, PNG, TIFF, WEBP, AVIF)",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Please select an image under 50MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const startAnalysis = () => {
    if (!selectedFile || !selectedCancerType) {
      toast({
        title: "Missing Requirements",
        description: "Please select both a cancer type and an image file",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisResult(null);

    // Simulate analysis progress
    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    cancerAnalysisMutation.mutate({ file: selectedFile, cancerType: selectedCancerType });
  };

  const resetAnalysis = () => {
    setSelectedFile(null);
    setPreviewUrl('');
    setAnalysisResult(null);
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setSelectedCancerType('');
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'medium': return 'bg-green-100 text-green-900 border-green-300';
      case 'high': return 'bg-red-100 text-red-900 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'routine': return 'bg-blue-100 text-blue-800';
      case 'expedited': return 'bg-yellow-100 text-yellow-800';
      case 'urgent': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Brain className="w-6 h-6" />
            Multi-Cancer Detection System
          </CardTitle>
          <CardDescription className="text-purple-100">
            Advanced AI-powered cancer detection across multiple organ systems
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="selection" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="selection">Cancer Type Selection</TabsTrigger>
          <TabsTrigger value="upload">Image Upload & Analysis</TabsTrigger>
          <TabsTrigger value="results">Results & Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="selection" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Cancer Type for Analysis</CardTitle>
              <CardDescription>
                Choose the specific cancer type based on your medical imaging modality
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cancerTypes.map((type) => {
                  const IconComponent = type.icon;
                  const capability = capabilityFor(type.id);
                  const available = isAvailable(type.id);

                  return (
                    <Card
                      key={type.id}
                      aria-disabled={!available}
                      className={`transition-all duration-200 ${
                        !available
                          ? 'opacity-60 cursor-not-allowed bg-gray-50'
                          : selectedCancerType === type.id
                            ? 'cursor-pointer ring-2 ring-blue-500 bg-blue-50'
                            : 'cursor-pointer hover:shadow-lg hover:bg-gray-50'
                      }`}
                      onClick={() => available && setSelectedCancerType(type.id)}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start space-x-4">
                          <div className={`p-3 rounded-lg ${available ? type.color : 'bg-gray-400'} text-white`}>
                            <IconComponent className="w-6 h-6" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-lg">{type.name}</h3>
                              {available ? (
                                <Badge variant="outline" className="text-green-700 border-green-300">
                                  Model available
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-600 border-gray-300">
                                  Not available
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{type.description}</p>

                            {available && capability?.evaluation ? (
                              // Measured performance, shown up front rather than buried.
                              // Sensitivity is what a patient is actually relying on.
                              <p className="text-xs text-gray-600">
                                Measured sensitivity{' '}
                                <strong>{(capability.evaluation.sensitivity * 100).toFixed(1)}%</strong>,
                                specificity{' '}
                                <strong>{(capability.evaluation.specificity * 100).toFixed(1)}%</strong>{' '}
                                on a held-out test set. Screening triage only.
                              </p>
                            ) : (
                              <p className="text-xs text-gray-600">
                                {capability?.disabledReason
                                  ? 'Disabled: this model did not pass evaluation.'
                                  : 'No trained model exists for this modality yet, so it cannot be analysed.'}
                              </p>
                            )}

                            <p className="text-xs text-gray-500 mt-1">
                              <strong>Accepted:</strong> {type.acceptedFiles}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Medical Image Upload
              </CardTitle>
              <CardDescription>
                {selectedCancerType 
                  ? `Upload ${cancerTypes.find(t => t.id === selectedCancerType)?.name} imaging for analysis`
                  : 'Please select a cancer type first'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedCancerType ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Please go back and select a cancer type before uploading images.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    {previewUrl ? (
                      <div className="space-y-4">
                        <img 
                          src={previewUrl} 
                          alt="Medical image preview" 
                          className="max-h-64 mx-auto rounded-lg shadow-md"
                        />
                        <div className="flex justify-center gap-2">
                          <Button variant="outline" onClick={resetAnalysis}>
                            Remove Image
                          </Button>
                          <Button onClick={startAnalysis} disabled={isAnalyzing}>
                            {isAnalyzing ? (
                              <>
                                <Zap className="w-4 h-4 mr-2 animate-spin" />
                                Analyzing...
                              </>
                            ) : (
                              <>
                                <Eye className="w-4 h-4 mr-2" />
                                Start Analysis
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Upload className="w-16 h-16 text-gray-400 mx-auto" />
                        <div>
                          <p className="text-lg font-medium text-gray-700">Upload Medical Image</p>
                          <p className="text-sm text-gray-500">
                            High-quality medical images provide the best analysis results
                          </p>
                        </div>
                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="cancer-image-upload"
                          />
                          <Label htmlFor="cancer-image-upload">
                            <Button variant="outline" className="cursor-pointer" asChild>
                              <span>
                                <Upload className="w-4 h-4 mr-2" />
                                Select Medical Image
                              </span>
                            </Button>
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>

                  {isAnalyzing && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Analysis Progress</span>
                        <span className="text-sm text-gray-500">{Math.round(analysisProgress)}%</span>
                      </div>
                      <Progress value={analysisProgress} className="w-full" />
                      <p className="text-sm text-gray-600 text-center">
                        AI is analyzing your {selectedCancerType} imaging...
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="space-y-6">
          {analysisResult ? (
            <div className="space-y-6">
              {/* Main Results Card */}
              <Card className={analysisResult.hasCancer ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-100'}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      {analysisResult.hasCancer ? (
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                      ) : (
                        <CheckCircle className="w-5 h-5 text-blue-700" />
                      )}
                      {analysisResult.cancerType.charAt(0).toUpperCase() + analysisResult.cancerType.slice(1)} Cancer Analysis
                    </CardTitle>
                    <Badge className={getRiskColor(analysisResult.riskLevel)}>
                      {analysisResult.riskLevel.toUpperCase()} RISK
                    </Badge>
                  </div>
                  <CardDescription>
                    <span className="text-blue-900">Confidence: {analysisResult.confidence}%</span> | 
                    Urgency: <Badge className={getUrgencyColor(analysisResult.urgency)} variant="outline">
                      {analysisResult.urgency.toUpperCase()}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold mb-2 text-blue-900">Clinical Findings</h4>
                      <ul className="space-y-1 text-blue-800">
                        {analysisResult.findings.map((finding, index) => (
                          <li key={index} className="text-sm flex items-start gap-2">
                            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mt-2 flex-shrink-0" />
                            {finding}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2 text-blue-900">Recommendations</h4>
                      <ul className="space-y-1 text-blue-800">
                        {analysisResult.recommendations.map((rec, index) => (
                          <li key={index} className="text-sm flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* What this result is not.
                  Panels for biomarkers, imaging characteristics and a follow-up
                  interval used to sit here, populated from client-side random
                  values. They are removed; the limits of the result are shown
                  instead, which is the honest content for this space. */}
              <Card className="border-amber-300 bg-amber-50">
                <CardHeader>
                  <CardTitle className="text-amber-900 text-base">
                    What this result does not tell you
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-amber-900 space-y-2">
                  <p>
                    This is a screening triage signal from an image classifier. It is
                    not a diagnosis, and it must be reviewed by a clinician.
                  </p>
                  <p>
                    It does not establish a tumour stage, grade, biomarker status or
                    lesion measurement. Those require laboratory testing and
                    specialist assessment — no image classifier can produce them.
                  </p>
                  <p>
                    A result of "no malignancy detected" is not a clearance. Model
                    sensitivity is below 100%, so some cancers are missed.
                  </p>
                </CardContent>
              </Card>

              <div className="flex justify-center">
                <Button onClick={resetAnalysis} variant="outline">
                  Start New Analysis
                </Button>
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Brain className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No analysis results yet. Please upload and analyze an image first.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
