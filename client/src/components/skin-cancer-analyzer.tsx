import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, Eye, AlertTriangle, CheckCircle, Info, Sun, Zap, Target, Heart } from "lucide-react";
import ScheduleDermatologistDialog from "./schedule-dermatologist-dialog";

interface SkinAnalysisResult {
  lesionType: string;
  malignancyRisk: 'low' | 'medium' | 'high';
  confidence: number;
  abcdeScore: {
    asymmetry: number;
    border: number;
    color: number;
    diameter: number;
    evolving: number;
    total: number;
  };
  recommendations: string[];
  urgency: 'routine' | 'expedited' | 'urgent';
  followUpPeriod: string;
  dermatoscopeFindings: string[];
  riskFactors: string[];
}

interface SkinLesionData {
  location: string;
  size: string;
  duration: string;
  changes: string[];
  symptoms: string[];
  familyHistory: boolean;
  skinType: string;
  sunExposure: string;
}

export default function SkinCancerAnalyzer() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<SkinAnalysisResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [lesionData, setLesionData] = useState<SkinLesionData>({
    location: '',
    size: '',
    duration: '',
    changes: [],
    symptoms: [],
    familyHistory: false,
    skinType: '',
    sunExposure: ''
  });
  const [activeTab, setActiveTab] = useState('upload');

  const skinAnalysisMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/scans/analyze', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Analysis failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setAnalysisResult(data.analysis);
      setShowResults(true);
      toast({
        title: "Skin Analysis Complete",
        description: `Risk level: ${data.analysis.malignancyRisk}. Check results for detailed recommendations.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze skin lesion. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = [
        'image/jpeg', 
        'image/jpg', 
        'image/png', 
        'image/tiff', 
        'image/tif',
        'image/webp',
        'image/avif'
      ];
      
      // Validate file type
      if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/')) {
        toast({
          title: "Invalid File Type",
          description: "Please select a JPEG, PNG, TIFF, WEBP, or AVIF image file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Please select an image under 50MB.",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleAnalyze = () => {
    if (!selectedFile) {
      toast({
        title: "No Image Selected",
        description: "Please select a skin lesion image to analyze.",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('scanType', 'skin-cancer');
    formData.append('lesionData', JSON.stringify(lesionData));

    skinAnalysisMutation.mutate(formData);
  };

  const handleLesionDataChange = (field: string, value: any) => {
    setLesionData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleChangesToggle = (change: string, checked: boolean) => {
    setLesionData(prev => ({
      ...prev,
      changes: checked 
        ? [...prev.changes, change]
        : prev.changes.filter(c => c !== change)
    }));
  };

  const handleSymptomsToggle = (symptom: string, checked: boolean) => {
    setLesionData(prev => ({
      ...prev,
      symptoms: checked 
        ? [...prev.symptoms, symptom]
        : prev.symptoms.filter(s => s !== symptom)
    }));
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'medium': return 'bg-green-100 text-green-900 border-green-300';
      case 'high': return 'bg-red-100 text-red-900 border-red-300';
      default: return 'bg-gray-100 text-gray-900 border-gray-300';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'routine': return 'bg-blue-100 text-blue-900';
      case 'expedited': return 'bg-yellow-100 text-yellow-900';
      case 'urgent': return 'bg-red-100 text-red-900';
      default: return 'bg-gray-100 text-gray-900';
    }
  };

  const getABCDEGrade = (score: number) => {
    if (score <= 2) return { grade: 'A', color: 'text-green-600' };
    if (score <= 4) return { grade: 'B', color: 'text-yellow-600' };
    if (score <= 6) return { grade: 'C', color: 'text-orange-600' };
    return { grade: 'D', color: 'text-red-600' };
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="w-5 h-5 text-orange-500" />
            Advanced Skin Cancer Detection
          </CardTitle>
          <CardDescription>
            AI-powered dermatological analysis using ABCDE criteria and advanced pattern recognition
            for melanoma, basal cell carcinoma, and squamous cell carcinoma detection
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Image Upload</TabsTrigger>
              <TabsTrigger value="details">Lesion Details</TabsTrigger>
              <TabsTrigger value="history">Medical History</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  {previewUrl ? (
                    <div className="space-y-4">
                      <img 
                        src={previewUrl} 
                        alt="Skin lesion preview" 
                        className="max-h-64 mx-auto rounded-lg shadow-md"
                      />
                      <div className="flex justify-center gap-2">
                        <Button variant="outline" onClick={() => {
                          setSelectedFile(null);
                          setPreviewUrl('');
                        }}>
                          Remove Image
                        </Button>
                        <Button onClick={handleAnalyze} disabled={skinAnalysisMutation.isPending}>
                          {skinAnalysisMutation.isPending ? (
                            <>
                              <Zap className="w-4 h-4 mr-2 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4 mr-2" />
                              Analyze Skin Lesion
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Camera className="w-16 h-16 text-gray-400 mx-auto" />
                      <div>
                        <p className="text-lg font-medium text-gray-700">Upload Skin Lesion Image</p>
                        <p className="text-sm text-gray-500">
                          High-quality, well-lit photos provide the best analysis results
                        </p>
                      </div>
                      <div>
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.tiff,.tif,.webp,.avif,image/jpeg,image/jpg,image/png,image/tiff,image/tif,image/webp,image/avif"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="skin-image-upload"
                        />
                        <Label htmlFor="skin-image-upload">
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

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Photography Tips:</strong> Use natural lighting, ensure the lesion fills the frame, 
                    include a ruler or coin for size reference, and capture any irregular borders clearly.
                  </AlertDescription>
                </Alert>
              </div>
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="location">Lesion Location</Label>
                  <Select value={lesionData.location} onValueChange={(value) => handleLesionDataChange('location', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="face">Face</SelectItem>
                      <SelectItem value="neck">Neck</SelectItem>
                      <SelectItem value="chest">Chest</SelectItem>
                      <SelectItem value="back">Back</SelectItem>
                      <SelectItem value="arms">Arms</SelectItem>
                      <SelectItem value="legs">Legs</SelectItem>
                      <SelectItem value="hands">Hands</SelectItem>
                      <SelectItem value="feet">Feet</SelectItem>
                      <SelectItem value="scalp">Scalp</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="size">Approximate Size</Label>
                  <Select value={lesionData.size} onValueChange={(value) => handleLesionDataChange('size', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<2mm">Less than 2mm</SelectItem>
                      <SelectItem value="2-6mm">2-6mm (pencil eraser)</SelectItem>
                      <SelectItem value="6-10mm">6-10mm</SelectItem>
                      <SelectItem value="10-15mm">10-15mm</SelectItem>
                      <SelectItem value=">15mm">Larger than 15mm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duration">How long have you noticed this lesion?</Label>
                  <Select value={lesionData.duration} onValueChange={(value) => handleLesionDataChange('duration', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<1month">Less than 1 month</SelectItem>
                      <SelectItem value="1-3months">1-3 months</SelectItem>
                      <SelectItem value="3-6months">3-6 months</SelectItem>
                      <SelectItem value="6-12months">6-12 months</SelectItem>
                      <SelectItem value=">12months">More than 1 year</SelectItem>
                      <SelectItem value="birth">Since birth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="skinType">Skin Type</Label>
                  <Select value={lesionData.skinType} onValueChange={(value) => handleLesionDataChange('skinType', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select skin type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="type1">Type I - Always burns, never tans</SelectItem>
                      <SelectItem value="type2">Type II - Usually burns, minimal tan</SelectItem>
                      <SelectItem value="type3">Type III - Sometimes burns, gradual tan</SelectItem>
                      <SelectItem value="type4">Type IV - Rarely burns, tans easily</SelectItem>
                      <SelectItem value="type5">Type V - Very rarely burns, dark tan</SelectItem>
                      <SelectItem value="type6">Type VI - Never burns, deeply pigmented</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Recent Changes (select all that apply):</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    'Size increase',
                    'Color change',
                    'Shape change',
                    'Border irregularity',
                    'Texture change',
                    'Elevation/thickness'
                  ].map((change) => (
                    <div key={change} className="flex items-center space-x-2">
                      <Checkbox
                        id={change}
                        checked={lesionData.changes.includes(change)}
                        onCheckedChange={(checked) => handleChangesToggle(change, !!checked)}
                      />
                      <Label htmlFor={change} className="text-sm">{change}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Associated Symptoms:</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    'Itching',
                    'Bleeding',
                    'Pain/tenderness',
                    'Crusting',
                    'Ulceration',
                    'No symptoms'
                  ].map((symptom) => (
                    <div key={symptom} className="flex items-center space-x-2">
                      <Checkbox
                        id={symptom}
                        checked={lesionData.symptoms.includes(symptom)}
                        onCheckedChange={(checked) => handleSymptomsToggle(symptom, !!checked)}
                      />
                      <Label htmlFor={symptom} className="text-sm">{symptom}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="familyHistory"
                    checked={lesionData.familyHistory}
                    onCheckedChange={(checked) => handleLesionDataChange('familyHistory', !!checked)}
                  />
                  <Label htmlFor="familyHistory">Family history of skin cancer</Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sunExposure">Sun Exposure History</Label>
                  <Select value={lesionData.sunExposure} onValueChange={(value) => handleLesionDataChange('sunExposure', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select exposure level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimal">Minimal - mostly indoor lifestyle</SelectItem>
                      <SelectItem value="moderate">Moderate - regular outdoor activities</SelectItem>
                      <SelectItem value="high">High - outdoor occupation or frequent sun exposure</SelectItem>
                      <SelectItem value="extreme">Extreme - extensive outdoor work/activities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Alert>
                  <Sun className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Risk Factors:</strong> Fair skin, family history, multiple moles, 
                    previous skin cancer, immunosuppression, and excessive UV exposure increase skin cancer risk.
                  </AlertDescription>
                </Alert>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Results Dialog */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Dermatological Analysis Results
            </DialogTitle>
          </DialogHeader>

          {analysisResult && (
              <div className="space-y-6">
              {/* Risk Assessment */}
              <div className={`p-4 rounded-lg border ${getRiskColor(analysisResult.malignancyRisk)} text-black`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">Malignancy Risk</span>
                  <Badge className={`${getRiskColor(analysisResult.malignancyRisk)} text-black`}>
                    {analysisResult.malignancyRisk.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">AI Confidence</span>
                  <span className="text-sm font-medium">{analysisResult.confidence}%</span>
                </div>
                <Progress value={analysisResult.confidence} className="mt-2" />
              </div>

              {/* ABCDE Analysis. Rendered only when the backend actually supplies
                  scores. The classifier does not measure ABCDE criteria, so the
                  panel stays hidden rather than showing 0/2 across the board,
                  which reads as a measured result of zero. */}
              {analysisResult.abcdeScore && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">ABCDE Dermatoscopy Analysis</CardTitle>
                  <CardDescription>
                    Asymmetry, Border, Color, Diameter, and Evolving characteristics assessment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm">Asymmetry</span>
                        <span className="text-sm font-medium">{analysisResult.abcdeScore?.asymmetry || 0}/2</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Border irregularity</span>
                        <span className="text-sm font-medium">{analysisResult.abcdeScore?.border || 0}/2</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Color variation</span>
                        <span className="text-sm font-medium">{analysisResult.abcdeScore?.color || 0}/2</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm">Diameter</span>
                        <span className="text-sm font-medium">{analysisResult.abcdeScore?.diameter || 0}/2</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Evolving</span>
                        <span className="text-sm font-medium">{analysisResult.abcdeScore?.evolving || 0}/2</span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-sm">Total Score</span>
                        <span className={`text-sm ${getABCDEGrade(analysisResult.abcdeScore?.total || 0).color}`}>
                          {analysisResult.abcdeScore?.total || 0}/10 (Grade {getABCDEGrade(analysisResult.abcdeScore?.total || 0).grade})
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Clinical Recommendations */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Clinical Recommendations</span>
                    <Badge className={getUrgencyColor(analysisResult.urgency || 'routine')}>
                      {analysisResult.urgency || 'routine'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
              <div className="space-y-4 p-4 rounded-md bg-gray-800 text-white">
                <ul className="space-y-2">
                  {(analysisResult.recommendations || []).map((rec, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-white">
                      <CheckCircle className="w-4 h-4 text-white mt-0.5 flex-shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>

              <div className="pt-4 border-t border-gray-700">
                <p className="text-sm text-white">
                  <strong>Follow-up:</strong> {analysisResult.followUpPeriod || 'Not specified'}
                </p>
              </div>

                    {(analysisResult.urgency || 'routine') === 'urgent' && (
                      <Alert className="border-red-700 bg-red-900 text-white">
                        <AlertTriangle className="h-4 w-4 text-white" />
                        <AlertDescription>
                          <strong>Urgent:</strong> Schedule dermatologist consultation within 1-2 weeks. 
                          High-risk features detected requiring immediate professional evaluation.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Dermatoscope Findings */}
              {analysisResult.dermatoscopeFindings && analysisResult.dermatoscopeFindings.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Digital Dermatoscopy Findings</CardTitle>
                  </CardHeader>
                  <CardContent>
              <ul className="space-y-2">
                {(analysisResult.dermatoscopeFindings || []).map((finding, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-white">
                    <Eye className="w-4 h-4 text-white mt-0.5 flex-shrink-0" />
                    {finding}
                  </li>
                ))}
              </ul>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-3">
                <Button onClick={() => setShowResults(false)} variant="outline">
                  Close
                </Button>
                <ScheduleDermatologistDialog
                  scanResult={{
                    hasCancer: analysisResult.malignancyRisk === 'high',
                    confidence: analysisResult.confidence || 0,
                    riskLevel: analysisResult.malignancyRisk || 'low',
                    findings: analysisResult.dermatoscopeFindings || [],
                    recommendations: analysisResult.recommendations || [],
                    analysis: {
                      lesionType: analysisResult.lesionType || 'Unknown',
                      malignancyRisk: analysisResult.malignancyRisk || 'low',
                      abcdeScore: analysisResult.abcdeScore || {
                        asymmetry: 0,
                        border: 0,
                        color: 0,
                        diameter: 0,
                        evolving: 0,
                        total: 0
                      },
                      urgency: analysisResult.urgency || 'routine',
                      followUpPeriod: analysisResult.followUpPeriod || 'Not specified'
                    }
                  }}
                  urgency={analysisResult.urgency || 'routine'}
                  triggerButton={
                    <Button className="flex items-center gap-2">
                      <Heart className="w-4 h-4" />
                      Schedule Dermatologist
                    </Button>
                  }
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
