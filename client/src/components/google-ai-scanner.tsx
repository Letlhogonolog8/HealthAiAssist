import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Upload, Brain, AlertTriangle, CheckCircle, FileImage, Zap, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
// import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import MedicalImageViewer from './medical-image-viewer';
import { AnalysisResultsDisplay } from './AnalysisResultsDisplay';

/**
 * The response shape /api/scans/analyze actually returns.
 *
 * This interface used to declare four more fields: `metastasisDetected`,
 * `metastasisStage` ('early' | 'intermediate' | 'advanced' | 'none'), a
 * `bloodMarkersAnalysis` object of tumour markers and suggested blood tests, and
 * a `cancerType` union covering breast, prostate and cervical.
 *
 * The server returns none of them, and could not: the pipeline runs a binary
 * image classifier per modality, and only skin and lung have one. Staging a
 * metastasis, reading a tumour marker panel and classifying a cervical or
 * prostate lesion are four separate capabilities that do not exist here.
 *
 * A type that describes a richer response than the server sends is not
 * harmless. It is the shape the next person writing UI will render against, and
 * every optional field reads as "sometimes present" rather than "never".
 */
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
    /** Only the modalities with a trained classifier. */
    cancerType?: 'lung' | 'skin' | 'unknown';
  };
}

export default function GoogleAIScannerFixed() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanType, setScanType] = useState<string>('');

  /**
   * What the server will actually analyse.
   *
   * Read from the registry rather than written into this file, so the options
   * and the resolver cannot drift apart again.
   */
  const { data: modelCards, isLoading: modelsLoading } = useQuery<{
    models: Array<{ scanType: string; enabled: boolean }>;
  }>({
    queryKey: ['/api/models/cards'],
    queryFn: async () => (await fetch('/api/models/cards')).json(),
  });

  const availableScanTypes = (modelCards?.models ?? []).filter((m) => m.enabled);

  /** What each registry key accepts, for the option label. */
  const ACCEPTS: Record<string, string> = {
    lung: 'Chest X-ray or CT',
    skin: 'Dermoscopy or clinical photograph',
  };
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
            credentials: 'include',
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
      default: return 'bg-slate-100 dark:bg-slate-700 text-foreground border-slate-300 dark:border-slate-600';
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
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center space-y-4">
            {selectedFile ? (
              <div className="space-y-4">
                <FileImage className="w-16 h-16 mx-auto text-green-600" />
                <div>
                  <p className="font-medium text-lg">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p className="text-sm text-muted-foreground">
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
                  <p className="text-muted-foreground">
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
            <Select value={scanType} onValueChange={setScanType} disabled={modelsLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Choose the type of medical scan" />
              </SelectTrigger>
              <SelectContent>
                {availableScanTypes.map((model) => (
                  <SelectItem key={model.scanType} value={model.scanType}>
                    <span className="capitalize">{model.scanType}</span>
                    {ACCEPTS[model.scanType] && (
                      <span className="text-muted-foreground"> — {ACCEPTS[model.scanType]}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!modelsLoading && availableScanTypes.length === 0 && (
              <p className="text-sm text-amber-600">
                No imaging model is currently being served. An upload would be queued
                for a human rather than analysed.
              </p>
            )}

            {/*
              Named, not hidden. This dropdown used to list mammography, prostate
              MRI, cervical screening, ultrasound, PET and CT — none of which has
              a classifier. Selecting one uploaded the image and then failed.
            */}
            {!modelsLoading && availableScanTypes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Only these have a trained model. Breast, prostate and cervical imaging
                are not analysed by this platform.
              </p>
            )}
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
                  {/* A "Professional Grade" badge sat here. This platform holds
                      no regulatory clearance and has had no clinical validation;
                      the model cards say so on every other screen. */}
                  <span>Start AI Analysis</span>
                </div>
              )}
            </Button>
            
            {/* Analysis Progress */}
            {analyzeImageMutation.isPending && (
              <div className="text-center space-y-2">
                <Progress value={65} className="w-full" />
                <p className="text-sm text-muted-foreground">
                  Analyzing medical image with advanced Health AI algorithms...
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Analysis Results */}
      {analysisResult && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={resetAnalysis}>
              <X className="w-4 h-4 mr-2" />
              New Analysis
            </Button>
          </div>
          <AnalysisResultsDisplay 
            analysisData={{
              title: "Analysis Results",
              subtitle: "Health AI-powered medical image analysis completed",
              confidence: analysisResult.analysis.confidence,
              riskLevel: analysisResult.analysis.riskLevel,
              primaryFinding: analysisResult.analysis.hasCancer ? 'Abnormal findings detected' : 'Normal',
              cancerType: analysisResult.analysis.cancerType ? `${analysisResult.analysis.cancerType} Cancer` : 'No abnormal findings detected',
              scanType: analysisResult?.scan?.scanType || scanType || 'mri',
              analysisDate: analysisResult?.scan?.createdAt ? new Date(analysisResult.scan.createdAt).toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }) : new Date().toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }),
              // An absent scan id used to be replaced with a random four-digit
              // number, giving the patient an identifier that matches no record
              // and that a clinician cannot look up.
              scanId: analysisResult?.scan?.id
                ? `#${analysisResult.scan.id.toString().padStart(4, '0')}`
                : 'Not recorded',

              // Empty findings and recommendations were padded with sentences
              // that sound like results but describe nothing measured —
              // "Anatomical structures clearly identified and analyzed",
              // "Continue routine screening as recommended". An empty list
              // means the analysis produced no findings, and saying so is the
              // only accurate rendering of that.
              detailedFindings: analysisResult.analysis.findings,
              recommendations: analysisResult.analysis.recommendations,
              additionalInfo: undefined
            }}
          />
        </div>
      )}
    </div>
  );
}