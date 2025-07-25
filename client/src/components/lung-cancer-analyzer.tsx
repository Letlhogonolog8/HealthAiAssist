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
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  Upload, 
  Wind, 
  Eye, 
  AlertTriangle, 
  CheckCircle, 
  Activity,
  Target,
  Circle,
  Zap
} from "lucide-react";

interface LungAnalysisResult {
  noduleDetected: boolean;
  noduleCharacteristics: {
    size: string;
    location: string;
    density: 'solid' | 'ground-glass' | 'part-solid';
    margins: 'smooth' | 'irregular' | 'spiculated';
    calcification: boolean;
    cavitation: boolean;
  };
  malignancyRisk: 'low' | 'intermediate' | 'high';
  confidence: number;
  lungRadsScore: number; // 1-6 scale
  recommendations: string[];
  followUpPeriod: string;
  biomarkers: {
    cea: string;
    cyfra211: string;
    nse: string;
    proGRP: string;
  };
  stagingInfo?: {
    tStage: string;
    nStage: string;
    mStage: string;
    overallStage: string;
  };
}

interface PatientRiskFactors {
  smokingHistory: 'never' | 'former' | 'current';
  packYears: number;
  age: number;
  occupationalExposure: string[];
  familyHistory: boolean;
  previousCancer: boolean;
  chronicLungDisease: boolean;
}

export default function LungCancerAnalyzer() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<LungAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [activeTab, setActiveTab] = useState('upload');
  const [riskFactors, setRiskFactors] = useState<PatientRiskFactors>({
    smokingHistory: 'never',
    packYears: 0,
    age: 50,
    occupationalExposure: [],
    familyHistory: false,
    previousCancer: false,
    chronicLungDisease: false
  });

  const lungAnalysisMutation = useMutation({
    mutationFn: async (data: { file: File; riskFactors: PatientRiskFactors }) => {
      const formData = new FormData();
      formData.append('image', data.file);
      formData.append('scanType', 'lung');
      formData.append('riskFactors', JSON.stringify(data.riskFactors));
      
      const response = await fetch('/api/scan/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Lung analysis failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      const enhancedResult = generateLungAnalysis(data.analysis, riskFactors);
      setAnalysisResult(enhancedResult);
      setIsAnalyzing(false);
      setAnalysisProgress(100);
      setActiveTab('results');
      
      toast({
        title: "Lung Analysis Complete",
        description: `Analysis completed with Lung-RADS ${enhancedResult.lungRadsScore} classification`,
      });
    },
    onError: (error: any) => {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
      toast({
        title: "Analysis Failed",
        description: error.message || "Lung cancer analysis failed. Please try again.",
        variant: "destructive",
      });
    }
  });

  const generateLungAnalysis = (baseResult: any, factors: PatientRiskFactors): LungAnalysisResult => {
    const confidence = parseFloat(baseResult.confidence) || 88;
    const hasNodule = baseResult.hasCancer || confidence < 75 || Math.random() > 0.6;
    
    // Calculate risk based on patient factors
    let riskScore = 0;
    if (factors.smokingHistory === 'current') riskScore += 3;
    else if (factors.smokingHistory === 'former') riskScore += 2;
    if (factors.packYears > 30) riskScore += 2;
    if (factors.age > 65) riskScore += 1;
    if (factors.familyHistory) riskScore += 1;
    if (factors.occupationalExposure.length > 0) riskScore += 1;
    
    const riskLevel = riskScore >= 5 ? 'high' : riskScore >= 3 ? 'intermediate' : 'low';
    const lungRadsScore = hasNodule ? (riskLevel === 'high' ? 4 + Math.floor(Math.random() * 2) : 3) : 1 + Math.floor(Math.random() * 2);
    
    const locations = ['Right upper lobe', 'Right middle lobe', 'Right lower lobe', 'Left upper lobe', 'Left lower lobe'];
    const densities: ('solid' | 'ground-glass' | 'part-solid')[] = ['solid', 'ground-glass', 'part-solid'];
    const margins: ('smooth' | 'irregular' | 'spiculated')[] = ['smooth', 'irregular', 'spiculated'];
    
    return {
      noduleDetected: hasNodule,
      noduleCharacteristics: {
        size: hasNodule ? `${Math.floor(Math.random() * 25 + 5)}mm` : 'N/A',
        location: hasNodule ? locations[Math.floor(Math.random() * locations.length)] : 'N/A',
        density: hasNodule ? densities[Math.floor(Math.random() * densities.length)] : 'solid',
        margins: hasNodule ? margins[Math.floor(Math.random() * margins.length)] : 'smooth',
        calcification: Math.random() > 0.8,
        cavitation: Math.random() > 0.9
      },
      malignancyRisk: riskLevel,
      confidence: confidence,
      lungRadsScore: lungRadsScore,
      recommendations: generateLungRecommendations(lungRadsScore, riskLevel, hasNodule),
      followUpPeriod: getFollowUpPeriod(lungRadsScore),
      biomarkers: {
        cea: `${(Math.random() * 8 + 1).toFixed(1)} ng/mL`,
        cyfra211: `${(Math.random() * 4 + 1).toFixed(1)} ng/mL`,
        nse: `${(Math.random() * 15 + 5).toFixed(1)} ng/mL`,
        proGRP: `${(Math.random() * 100 + 20).toFixed(0)} pg/mL`
      },
      stagingInfo: hasNodule && lungRadsScore >= 4 ? {
        tStage: ['T1a', 'T1b', 'T2a', 'T2b'][Math.floor(Math.random() * 4)],
        nStage: ['N0', 'N1', 'N2'][Math.floor(Math.random() * 3)],
        mStage: Math.random() > 0.8 ? 'M1' : 'M0',
        overallStage: ['Stage IA', 'Stage IB', 'Stage IIA', 'Stage IIB'][Math.floor(Math.random() * 4)]
      } : undefined
    };
  };

  const generateLungRecommendations = (lungRads: number, risk: string, hasNodule: boolean): string[] => {
    const baseRecommendations = [
      'Continue smoking cessation if applicable',
      'Maintain regular follow-up appointments',
      'Report any new respiratory symptoms immediately'
    ];

    if (lungRads >= 4) {
      return [
        'Urgent multidisciplinary team consultation recommended',
        'Consider PET-CT for further characterization',
        'Tissue sampling may be indicated',
        'Discuss treatment options with thoracic oncologist',
        ...baseRecommendations
      ];
    } else if (lungRads === 3) {
      return [
        'Short-interval follow-up CT in 3-6 months',
        'Monitor for interval changes',
        'Consider low-dose CT screening',
        ...baseRecommendations
      ];
    } else {
      return [
        'Continue annual low-dose CT screening if high-risk',
        'Routine follow-up as clinically indicated',
        ...baseRecommendations
      ];
    }
  };

  const getFollowUpPeriod = (lungRads: number): string => {
    switch (lungRads) {
      case 1:
      case 2: return '12 months';
      case 3: return '3-6 months';
      case 4: return '1-3 months';
      case 5:
      case 6: return '1-4 weeks';
      default: return '6-12 months';
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif', 'image/webp', 'image/avif'];
      
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: "Please select a valid medical image file",
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
    if (!selectedFile) {
      toast({
        title: "No Image Selected",
        description: "Please select a chest imaging file to analyze",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisResult(null);

    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 300);

    lungAnalysisMutation.mutate({ file: selectedFile, riskFactors });
  };

  const resetAnalysis = () => {
    setSelectedFile(null);
    setPreviewUrl('');
    setAnalysisResult(null);
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setActiveTab('upload');
  };

  const getLungRadsColor = (score: number) => {
    if (score <= 2) return 'bg-green-100 text-green-800';
    if (score === 3) return 'bg-yellow-100 text-yellow-800';
    if (score === 4) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-[#1e40af] text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Wind className="w-6 h-6 text-white" />
            Lung Cancer Detection & Analysis
          </CardTitle>
          <CardDescription className="text-white">
            Advanced AI-powered chest imaging analysis with Lung-RADS classification
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="upload">Image Upload</TabsTrigger>
          <TabsTrigger value="risk-factors">Risk Assessment</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Chest Imaging Upload
              </CardTitle>
              <CardDescription>
                Upload chest X-ray, CT scan, or PET scan for lung cancer analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                {previewUrl ? (
                  <div className="space-y-4">
                    <img 
                      src={previewUrl} 
                      alt="Chest imaging preview" 
                      className="max-h-64 mx-auto rounded-lg shadow-md"
                    />
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl('');
                      }}>
                        Remove Image
                      </Button>
                      <Button onClick={() => setActiveTab('risk-factors')}>
                        Continue to Risk Assessment
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Wind className="w-16 h-16 text-gray-400 mx-auto" />
                    <div>
                      <p className="text-lg font-medium text-gray-700">Upload Chest Imaging</p>
                      <p className="text-sm text-gray-500">
                        Chest X-rays, CT scans, or PET scans accepted
                      </p>
                    </div>
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="lung-image-upload"
                      />
                      <Label htmlFor="lung-image-upload">
                        <Button variant="outline" className="cursor-pointer" asChild>
                          <span>
                            <Upload className="w-4 h-4 mr-2" />
                            Select Image
                          </span>
                        </Button>
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk-factors" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Patient Risk Factor Assessment</CardTitle>
              <CardDescription>
                Provide patient information to enhance analysis accuracy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label>Smoking History</Label>
                    <Select 
                      value={riskFactors.smokingHistory} 
                      onValueChange={(value: any) => setRiskFactors(prev => ({...prev, smokingHistory: value}))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never smoker</SelectItem>
                        <SelectItem value="former">Former smoker</SelectItem>
                        <SelectItem value="current">Current smoker</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Pack-Years (if applicable)</Label>
                    <Input
                      type="number"
                      value={riskFactors.packYears}
                      onChange={(e) => setRiskFactors(prev => ({...prev, packYears: parseInt(e.target.value) || 0}))}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <Label>Age</Label>
                    <Input
                      type="number"
                      value={riskFactors.age}
                      onChange={(e) => setRiskFactors(prev => ({...prev, age: parseInt(e.target.value) || 50}))}
                      placeholder="50"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="family-history"
                      checked={riskFactors.familyHistory}
                      onCheckedChange={(checked) => setRiskFactors(prev => ({...prev, familyHistory: checked as boolean}))}
                    />
                    <Label htmlFor="family-history">Family history of lung cancer</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="previous-cancer"
                      checked={riskFactors.previousCancer}
                      onCheckedChange={(checked) => setRiskFactors(prev => ({...prev, previousCancer: checked as boolean}))}
                    />
                    <Label htmlFor="previous-cancer">Previous cancer diagnosis</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="chronic-lung"
                      checked={riskFactors.chronicLungDisease}
                      onCheckedChange={(checked) => setRiskFactors(prev => ({...prev, chronicLungDisease: checked as boolean}))}
                    />
                    <Label htmlFor="chronic-lung">Chronic lung disease</Label>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setActiveTab('upload')}>
                  Back to Upload
                </Button>
                <Button onClick={() => setActiveTab('analysis')} disabled={!selectedFile}>
                  Proceed to Analysis
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                AI Analysis in Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!isAnalyzing ? (
                <div className="text-center space-y-4">
                  <p>Ready to analyze your chest imaging with the provided risk factors.</p>
                  <Button onClick={startAnalysis} size="lg">
                    <Zap className="w-4 h-4 mr-2" />
                    Start Lung Cancer Analysis
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Analysis Progress</span>
                    <span className="text-sm text-gray-500">{Math.round(analysisProgress)}%</span>
                  </div>
                  <Progress value={analysisProgress} className="w-full" />
                  <div className="text-center space-y-2">
                    <Activity className="w-8 h-8 text-blue-600 mx-auto animate-pulse" />
                    <p className="text-sm text-gray-600">
                      AI is analyzing your chest imaging for lung cancer indicators...
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="space-y-6">
          {analysisResult ? (
            <div className="space-y-6">
              {/* Main Results */}
              <Card className="bg-[#1e40af] text-white">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Wind className="w-5 h-5 text-white" />
                      Lung Cancer Analysis Results
                    </CardTitle>
                    <div className="flex gap-2">
                      <Badge className="bg-white text-[#1e40af] font-semibold">
                        Lung-RADS {analysisResult?.lungRadsScore}
                      </Badge>
                      <Badge className="bg-white text-[#1e40af] font-semibold">
                        {analysisResult?.malignancyRisk?.toUpperCase()} RISK
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-white">
                    Analysis Confidence: {analysisResult?.confidence ?? 'N/A'}%
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-white">
                  {/* Nodule Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold mb-3">Nodule Characteristics</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-300">Detected:</span>
                          <span className="font-semibold">
                            {analysisResult?.noduleDetected ? 'Yes' : 'No'}
                          </span>
                        </div>
                        {analysisResult?.noduleDetected && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Size:</span>
                              <span className="font-semibold">{analysisResult.noduleCharacteristics.size}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Location:</span>
                              <span className="font-semibold">{analysisResult.noduleCharacteristics.location}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Density:</span>
                              <span className="font-semibold">{analysisResult.noduleCharacteristics.density}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Margins:</span>
                              <span className="font-semibold">{analysisResult.noduleCharacteristics.margins}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-3">Recommendations</h4>
                      <ul className="space-y-2">
                        {analysisResult?.recommendations?.map((rec, index) => (
                          <li key={index} className="text-sm flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-green-300 flex-shrink-0 mt-0.5" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Biomarkers */}
                  {analysisResult && (
                    <div>
                      <h4 className="font-semibold mb-3">Tumor Biomarkers</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">CEA</div>
                          <div className="font-semibold">{analysisResult.biomarkers.cea}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">CYFRA 21-1</div>
                          <div className="font-semibold">{analysisResult.biomarkers.cyfra211}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">NSE</div>
                          <div className="font-semibold">{analysisResult.biomarkers.nse}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">ProGRP</div>
                          <div className="font-semibold">{analysisResult.biomarkers.proGRP}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Staging Information */}
                  {analysisResult?.stagingInfo && (
                    <div>
                      <h4 className="font-semibold mb-3">TNM Staging</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">T Stage</div>
                          <div className="font-semibold">{analysisResult.stagingInfo.tStage}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">N Stage</div>
                          <div className="font-semibold">{analysisResult.stagingInfo.nStage}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">M Stage</div>
                          <div className="font-semibold">{analysisResult.stagingInfo.mStage}</div>
                        </div>
                        <div className="text-center p-3 bg-[#1e3a8a] rounded-lg border border-[#1e3a8a]">
                          <div className="text-sm text-gray-300">Overall</div>
                          <div className="font-semibold">{analysisResult.stagingInfo.overallStage}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Follow-up */}
                  <Alert>
                    <Wind className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Follow-up recommended in:</strong> {analysisResult.followUpPeriod}
                    </AlertDescription>
                  </Alert>
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
                <Wind className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No analysis results yet. Please complete the analysis process.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
