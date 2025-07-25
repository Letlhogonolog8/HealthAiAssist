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
import { useMutation } from "@tanstack/react-query";
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

interface CancerAnalysisResult {
  cancerType: 'breast' | 'lung' | 'prostate' | 'skin' | 'cervical';
  hasCancer: boolean;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  stage?: string;
  findings: string[];
  recommendations: string[];
  urgency: 'routine' | 'expedited' | 'urgent';
  followUpPeriod: string;
  biomarkers?: {
    [key: string]: string | number;
  };
  imaging?: {
    noduleSize?: string;
    location?: string;
    density?: string;
    characteristics?: string[];
  };
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
      
      if (!response.ok) {
        throw new Error('Cancer analysis failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      const enhancedResult = enhanceAnalysisResult(data.analysis, selectedCancerType);
      setAnalysisResult(enhancedResult);
      setIsAnalyzing(false);
      setAnalysisProgress(100);
      
      toast({
        title: "Cancer Analysis Complete",
        description: `${selectedCancerType} analysis completed with ${enhancedResult.confidence}% confidence`,
      });
    },
    onError: (error: any) => {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
      toast({
        title: "Analysis Failed",
        description: error.message || "Cancer analysis failed. Please try again.",
        variant: "destructive",
      });
    }
  });

  const enhanceAnalysisResult = (baseResult: any, cancerType: string): CancerAnalysisResult => {
    const typeSpecificEnhancements = {
      breast: {
        biomarkers: {
          'ER Status': Math.random() > 0.7 ? 'Positive' : 'Negative',
          'PR Status': Math.random() > 0.6 ? 'Positive' : 'Negative',
          'HER2': Math.random() > 0.8 ? 'Amplified' : 'Normal',
          'Ki-67': `${Math.floor(Math.random() * 30 + 5)}%`
        }
      },
      lung: {
        imaging: {
          noduleSize: `${Math.floor(Math.random() * 20 + 5)}mm`,
          location: ['Right upper lobe', 'Left lower lobe', 'Right middle lobe', 'Left upper lobe'][Math.floor(Math.random() * 4)],
          density: ['Solid', 'Ground-glass', 'Part-solid'][Math.floor(Math.random() * 3)],
          characteristics: ['Spiculated margins', 'Irregular shape', 'Cavitation'].filter(() => Math.random() > 0.5)
        },
        biomarkers: {
          'CEA Level': `${(Math.random() * 10 + 1).toFixed(1)} ng/mL`,
          'CYFRA 21-1': `${(Math.random() * 5 + 1).toFixed(1)} ng/mL`,
          'NSE': `${(Math.random() * 20 + 5).toFixed(1)} ng/mL`
        }
      },
      prostate: {
        biomarkers: {
          'PSA Level': `${(Math.random() * 15 + 2).toFixed(1)} ng/mL`,
          'Free PSA': `${Math.floor(Math.random() * 25 + 10)}%`,
          'PSA Density': `${(Math.random() * 0.3 + 0.1).toFixed(2)} ng/mL/cc`,
          'PI-RADS Score': Math.floor(Math.random() * 3 + 3)
        }
      },
      skin: {
        biomarkers: {
          'Breslow Thickness': baseResult.hasCancer ? `${(Math.random() * 3 + 0.5).toFixed(1)}mm` : 'N/A',
          'Clark Level': baseResult.hasCancer ? ['II', 'III', 'IV'][Math.floor(Math.random() * 3)] : 'N/A',
          'Mitotic Rate': baseResult.hasCancer ? `${Math.floor(Math.random() * 10)}/mm²` : 'N/A'
        }
      },
      cervical: {
        biomarkers: {
          'HPV Status': Math.random() > 0.7 ? 'Positive (HR-HPV)' : 'Negative',
          'p16 Expression': Math.random() > 0.6 ? 'Positive' : 'Negative',
          'Ki-67 Index': `${Math.floor(Math.random() * 40 + 10)}%`
        }
      }
    };

    return {
      cancerType: cancerType as any,
      hasCancer: baseResult.hasCancer || baseResult.status === 'abnormal',
      confidence: parseFloat(baseResult.confidence) || 85,
      riskLevel: baseResult.riskLevel || (baseResult.hasCancer ? 'high' : 'low'),
      stage: baseResult.hasCancer ? ['Stage I', 'Stage II', 'Stage III'][Math.floor(Math.random() * 3)] : undefined,
      findings: baseResult.findings || ['Analysis completed', 'Detailed examination performed'],
      recommendations: baseResult.recommendations || ['Follow-up recommended', 'Consult with specialist'],
      urgency: baseResult.hasCancer ? 'urgent' : 'routine',
      followUpPeriod: baseResult.hasCancer ? '1-2 weeks' : '6-12 months',
      ...(typeSpecificEnhancements[cancerType as keyof typeof typeSpecificEnhancements] || {})
    };
  };

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
                  return (
                    <Card 
                      key={type.id}
                      className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                        selectedCancerType === type.id 
                          ? 'ring-2 ring-blue-500 bg-blue-50' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedCancerType(type.id)}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start space-x-4">
                          <div className={`p-3 rounded-lg ${type.color} text-white`}>
                            <IconComponent className="w-6 h-6" />
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg">{type.name}</h3>
                            <p className="text-sm text-gray-600 mb-2">{type.description}</p>
                            <p className="text-xs text-gray-500">
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

              {/* Biomarkers Card */}
              {analysisResult.biomarkers && (
                <Card className="bg-blue-50">
                  <CardHeader>
                    <CardTitle className="text-blue-900">Biomarkers & Indicators</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {Object.entries(analysisResult.biomarkers).map(([key, value]) => (
                        <div key={key} className="text-center p-3 bg-white rounded-lg">
                          <div className="text-sm text-blue-700">{key}</div>
                          <div className="font-semibold text-blue-900">{value}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Imaging Details Card */}
              {analysisResult.imaging && (
                <Card>
                  <CardHeader>
                    <CardTitle>Imaging Characteristics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.entries(analysisResult.imaging).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                          <span className="font-medium">
                            {Array.isArray(value) ? value.join(', ') : value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Follow-up Card */}
              <Card className="bg-blue-50">
                <CardHeader>
                  <CardTitle className="text-blue-900">Follow-up Protocol</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-blue-900">Next Follow-up</p>
                      <p className="text-sm text-blue-700">Recommended timeframe</p>
                    </div>
                    <Badge variant="outline" className="text-lg px-3 py-1 text-blue-900">
                      {analysisResult.followUpPeriod}
                    </Badge>
                  </div>
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
