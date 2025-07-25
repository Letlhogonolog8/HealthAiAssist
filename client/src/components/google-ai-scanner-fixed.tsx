import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Upload, Brain, AlertTriangle, CheckCircle, FileImage, Zap, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
// import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import MedicalImageViewer from './medical-image-viewer';

interface AnalysisResult {
  scan: {
    id: number;
    scanType: string;
    result: string;
    aiConfidence: string;
    notes: string;
    createdAt: string;
  };
  analysis: {
    hasCancer: boolean;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    findings: string[];
    recommendations: string[];
    cancerType?: 'breast' | 'prostate' | 'lung' | 'cervical' | 'skin' | 'unknown';
    metastasisDetected?: boolean;
    metastasisStage?: 'early' | 'intermediate' | 'advanced' | 'none';
    bloodMarkersAnalysis?: {
      tumorMarkers: string[];
      abnormalValues: number;
      suggestedBloodTests: string[];
    };
  };
}

export default function GoogleAIScannerFixed() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanType, setScanType] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analyzeImageMutation = useMutation({
    mutationFn: async ({ file, scanType }: { file: File; scanType: string }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('scanType', scanType);
      
      // Retry logic with timeout handling for production deployment
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout
          
          const response = await fetch('/api/scans/analyze', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
            headers: {
              'Connection': 'keep-alive',
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            if (response.status >= 500 && attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
              continue;
            }
            throw new Error(`Analysis failed with status ${response.status}`);
          }
          
          return response.json();
        } catch (error: any) {
          lastError = error;
          
          if (error.name === 'AbortError') {
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
            throw new Error('Analysis timed out. Please try with a smaller image.');
          }
          
          if (error.message?.includes('ERR_CONNECTION_RESET') || 
              error.message?.includes('fetch') || 
              error.message?.includes('network')) {
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
            throw new Error('Connection interrupted. Please check your network and try again.');
          }
          
          if (attempt === 3) {
            throw error;
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
      throw lastError || new Error('Analysis failed after multiple attempts');
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/scans'] });
      toast({
        title: "Analysis Complete",
        description: "Medical image has been analyzed using Google's AI",
      });
    },
    onError: (error) => {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze image",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const allowedTypes = [
        'image/jpeg', 
        'image/jpg', 
        'image/png', 
        'image/tiff', 
        'image/tif',
        'image/webp',
        'image/avif'
      ];
      
      if (allowedTypes.includes(file.type) || file.type.startsWith('image/')) {
        setSelectedFile(file);
      } else {
        toast({
          title: "Invalid File Type",
          description: "Please select a JPEG, PNG, TIFF, WEBP, or AVIF image file",
          variant: "destructive",
        });
      }
    }
  };

  const handleAnalyze = () => {
    if (!selectedFile || !scanType) {
      toast({
        title: "Missing Information",
        description: "Please select an image and scan type",
        variant: "destructive",
      });
      return;
    }

    analyzeImageMutation.mutate({ file: selectedFile, scanType });
  };

  const resetAnalysis = () => {
    setAnalysisResult(null);
    setSelectedFile(null);
    setScanType('');
    const input = document.getElementById('file-input') as HTMLInputElement;
    if (input) input.value = '';
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-blue-600" />
            HAI Medical Scanner
          </CardTitle>
          <CardDescription>
            Upload medical images for AI-powered cancer detection analysis using advanced medical imaging technology
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Simple File Upload Button */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center space-y-4">
            {selectedFile ? (
              <div className="space-y-4">
                <FileImage className="w-16 h-16 mx-auto text-green-600" />
                <div>
                  <p className="font-medium text-lg">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500">
                    Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p className="text-sm text-gray-500">
                    Type: {selectedFile.type}
                  </p>
                </div>
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedFile(null);
                      const input = document.getElementById('file-input') as HTMLInputElement;
                      if (input) input.value = '';
                    }}
                  >
                    <X className="w-4 h-4 mr-2" />
                    Remove
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('file-input')?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Choose Different File
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Upload className="w-16 h-16 mx-auto text-gray-400" />
                <div>
                  <h3 className="text-lg font-medium">Upload Medical Image</h3>
                  <p className="text-gray-500">
                    Select a medical scan image for AI analysis
                  </p>
                  <p className="text-sm text-gray-400 mt-2">
                    Supported formats: JPEG, PNG, TIFF, WEBP, AVIF • Max size: 50MB
                  </p>
                </div>
                <Button
                  onClick={() => document.getElementById('file-input')?.click()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Select Medical Image
                </Button>
              </div>
            )}
            
            <input
              id="file-input"
              type="file"
              accept=".jpg,.jpeg,.png,.tiff,.tif,.webp,.avif,image/jpeg,image/jpg,image/png,image/tiff,image/tif,image/webp,image/avif"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Scan Type Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Medical Scan Type</label>
            <Select value={scanType} onValueChange={setScanType}>
              <SelectTrigger>
                <SelectValue placeholder="Choose the type of medical scan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mammography">Mammography (Breast Cancer Screening)</SelectItem>
                <SelectItem value="chest_xray">Chest X-Ray (Lung Cancer Detection)</SelectItem>
                <SelectItem value="ct_scan">CT Scan (Comprehensive Imaging)</SelectItem>
                <SelectItem value="mri">MRI (Magnetic Resonance Imaging)</SelectItem>
                <SelectItem value="prostate">Prostate MRI (Prostate Cancer)</SelectItem>
                <SelectItem value="cervical">Cervical Screening (Cervical Cancer)</SelectItem>
                <SelectItem value="skin">Dermatological Imaging (Skin Cancer)</SelectItem>
                <SelectItem value="ultrasound">Ultrasound Imaging</SelectItem>
                <SelectItem value="pet_scan">PET Scan (Metabolic Imaging)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Analysis Button */}
          <div className="space-y-3">
            <Button 
              onClick={handleAnalyze}
              disabled={!selectedFile || !scanType || analyzeImageMutation.isPending}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
              size="lg"
            >
              {analyzeImageMutation.isPending ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Analyzing with Health AI...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center space-x-2">
                  <Brain className="w-5 h-5" />
                  <span>Start AI Analysis</span>
                  <Badge variant="secondary" className="ml-2 bg-white bg-opacity-20 text-white">
                    Professional Grade
                  </Badge>
                </div>
              )}
            </Button>
            
            {/* Analysis Progress */}
            {analyzeImageMutation.isPending && (
              <div className="text-center space-y-2">
                <Progress value={65} className="w-full" />
                <p className="text-sm text-gray-600">
                  Analyzing medical image with advanced Health AI algorithms...
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysisResult && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Analysis Results
              </CardTitle>
              <CardDescription>
                Health AI-powered medical image analysis completed
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={resetAnalysis}>
              <X className="w-4 h-4 mr-2" />
              New Analysis
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Primary Results */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold mb-2">
                    {analysisResult.analysis.confidence}%
                  </div>
                  <div className="text-sm text-gray-600">AI Confidence</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Badge 
                    className={`mb-2 ${getRiskColor(analysisResult.analysis.riskLevel)}`}
                  >
                    {analysisResult.analysis.riskLevel.toUpperCase()} RISK
                  </Badge>
                  <div className="text-sm text-gray-600">Risk Assessment</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className={`text-lg font-semibold mb-2 ${
                    analysisResult.analysis.hasCancer ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {analysisResult.analysis.hasCancer ? 'Abnormal' : 'Normal'}
                  </div>
                  <div className="text-sm text-gray-600">Primary Finding</div>
                </CardContent>
              </Card>
              {analysisResult.analysis.cancerType && (
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-lg font-semibold mb-2 text-red-600 capitalize">
                      {analysisResult.analysis.cancerType} Cancer
                    </div>
                    <div className="text-sm text-gray-600">Cancer Type</div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Metastasis Detection */}
            {analysisResult.analysis.metastasisDetected && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-red-800 mb-1">Metastasis Detected</h4>
                    <p className="text-red-700 text-sm">
                      Stage: <strong className="capitalize">{analysisResult.analysis.metastasisStage}</strong> - 
                      Immediate oncology consultation required for staging and treatment planning.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* Detailed Findings */}
            <div className="space-y-4">
              <h3 className="font-semibold">Detailed Findings</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <ul className="space-y-2">
                  {analysisResult.analysis.findings.map((finding, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                      <span className="text-sm">{finding}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Blood Marker Analysis */}
            {analysisResult.analysis.bloodMarkersAnalysis && (
              <div className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  Blood Test Analysis & Recommendations
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Tumor Markers */}
                  {analysisResult.analysis.bloodMarkersAnalysis.tumorMarkers.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-red-700">
                          Elevated Tumor Markers ({analysisResult.analysis.bloodMarkersAnalysis.abnormalValues})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <ul className="space-y-1">
                          {analysisResult.analysis.bloodMarkersAnalysis.tumorMarkers.map((marker, index) => (
                            <li key={index} className="text-sm flex items-start gap-2">
                              <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                              <span>{marker}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Suggested Blood Tests */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-blue-700">
                        Recommended Blood Tests
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <ul className="space-y-1">
                        {analysisResult.analysis.bloodMarkersAnalysis.suggestedBloodTests.map((test, index) => (
                          <li key={index} className="text-sm flex items-start gap-2">
                            <CheckCircle className="w-3 h-3 text-blue-500 mt-1 flex-shrink-0" />
                            <span>{test}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
                <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Blood Test Priority:</strong> These blood tests can detect cancer markers that may not be visible in imaging alone, 
                    enabling earlier detection and more comprehensive assessment.
                  </p>
                </div>
              </div>
            )}

            {/* Recommendations */}
            <div className="space-y-4">
              <h3 className="font-semibold">Clinical Recommendations</h3>
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <ul className="space-y-2">
                  {analysisResult.analysis.recommendations.map((rec, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Zap className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Scan Information */}
            <div className="space-y-2 text-sm text-gray-600">
              <p><strong>Scan Type:</strong> {analysisResult?.scan?.scanType || scanType || 'Medical Scan'}</p>
              <p><strong>Analysis Date:</strong> {analysisResult?.scan?.createdAt ? new Date(analysisResult.scan.createdAt).toLocaleString() : new Date().toLocaleString()}</p>
              <p><strong>Scan ID:</strong> #{analysisResult?.scan?.id || 'N/A'}</p>
            </div>

            {/* Important Notice */}
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 mb-1">Important Medical Notice</p>
                  <p className="text-yellow-700">
                    This Health AI analysis is for educational and reference purposes. Always consult with qualified medical professionals for proper diagnosis and treatment decisions.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}