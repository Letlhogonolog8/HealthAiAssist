import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, Brain, Eye, CheckCircle, AlertTriangle, FileText, Image, X } from "lucide-react";

export default function AIScanSimulator({ userId }: { userId?: number }) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResult, setScanResult] = useState<any>(null);
  // No default modality: it is chosen once the server has said which exist.
  const [scanType, setScanType] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  /**
   * The modalities this server can actually analyse, read from the server.
   *
   * The list used to be five hardcoded entries — mammography, chest X-ray, CT,
   * MRI, ultrasound — each with an accuracy label that had never been measured.
   * The labels were removed; the list was not. Only two of the five have a model
   * behind them, so four of the five choices on offer produced a 503 the moment
   * the user pressed analyse. Driving the options from /api/models/cards means
   * disabling a model in MODEL_REGISTRY immediately stops the UI offering it,
   * which is how multi-cancer-detection-system.tsx already works.
   */
  const { data: cards, isLoading: loadingModels } = useQuery<{
    models: Array<{ scanType: string; enabled: boolean; disabledReason: string | null }>;
  }>({
    queryKey: ['/api/models/cards'],
    queryFn: async () => {
      const response = await fetch('/api/models/cards');
      if (!response.ok) throw new Error('Could not load model capabilities');
      return response.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const palette: Record<string, string> = {
    lung: 'bg-blue-500',
    skin: 'bg-orange-500',
  };

  const scanTypes = (cards?.models ?? [])
    .filter((m) => m.enabled)
    .map((m) => ({
      id: m.scanType,
      name: m.scanType.charAt(0).toUpperCase() + m.scanType.slice(1),
      color: palette[m.scanType] ?? 'bg-slate-500',
    }));

  // Pick the first available modality once the server has answered. The
  // dependency is the id rather than the array, which is rebuilt on every render
  // and would re-run this effect each time.
  const firstAvailable = scanTypes[0]?.id;
  useEffect(() => {
    if (!scanType && firstAvailable) setScanType(firstAvailable);
  }, [scanType, firstAvailable]);

  // Image upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, scanType }: { file: File; scanType: string }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('scanType', scanType);
      if (userId !== undefined) {
        formData.append('patientId', userId.toString());
      }

      const response = await fetch('/api/scan/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload and analyze image');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setScanResult(data.analysis);
      setIsScanning(false);
      setScanProgress(100);
      toast({
        title: "Scan Complete",
        description: "AI analysis completed successfully",
      });
    },
    onError: (error: any) => {
      setIsScanning(false);
      setScanProgress(0);
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to analyze image",
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

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Please select an image smaller than 10MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
      
      // Create preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startAIScan = () => {
    if (!selectedFile) {
      toast({
        title: "No Image Selected",
        description: "Please select an image to analyze",
        variant: "destructive",
      });
      return;
    }

    setIsScanning(true);
    setScanProgress(0);
    setScanResult(null);

    // Simulate progress while upload/analysis happens
    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90; // Let the mutation handle the final completion
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    // Start the actual upload and analysis
    uploadMutation.mutate({ file: selectedFile, scanType });
  };

  const resetScan = () => {
    setScanResult(null);
    setScanProgress(0);
    setIsScanning(false);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Brain className="w-5 h-5 mr-2 text-blue-400" />
            AI Medical Image Analysis
          </CardTitle>
          <p className="text-slate-400">Upload medical images for real-time AI cancer detection</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scan Type Selection */}
          <div className="space-y-3">
            <Label className="text-white font-medium">Select Scan Type</Label>
            {!loadingModels && scanTypes.length === 0 && (
              <p className="text-sm text-amber-300">
                No imaging model is currently available. Uploads are queued for
                manual review.
              </p>
            )}
            <Select value={scanType} onValueChange={setScanType} disabled={scanTypes.length === 0}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-700 border-slate-600">
                {scanTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id} className="text-white hover:bg-slate-600">
                    <div className="flex items-center space-x-2">
                      <div className={`w-3 h-3 rounded-full ${type.color}`}></div>
                      <span>{type.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File Upload Area */}
          <div className="space-y-4">
            <Label className="text-white font-medium">Upload Medical Image</Label>
            
            {!selectedFile ? (
              <div 
                className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center bg-slate-700/50 hover:border-slate-500 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-white font-medium mb-2">Click to upload medical image</p>
                <p className="text-slate-400 text-sm mb-4">
                  Supports DICOM, JPG, PNG formats up to 10MB
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="bg-transparent border-slate-500 text-slate-300 hover:bg-slate-600"
                >
                  <Image className="w-4 h-4 mr-2" />
                  Browse Files
                </Button>
              </div>
            ) : (
              <div className="border border-slate-600 rounded-lg p-4 bg-slate-700/50">
                <div className="flex items-start space-x-4">
                  {previewUrl && (
                    <div className="flex-shrink-0">
                      <img 
                        src={previewUrl} 
                        alt="Preview" 
                        className="w-20 h-20 object-cover rounded-md border border-slate-500"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{selectedFile.name}</p>
                    <p className="text-slate-400 text-sm">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                    <Badge variant="outline" className="mt-2 text-xs">
                      {selectedFile.type}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeFile}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            <Input
              ref={fileInputRef}
              type="file"
              accept="image/*,.dcm"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Analysis Button */}
          <Button
            onClick={startAIScan}
            disabled={isScanning || !selectedFile}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600"
          >
            {isScanning ? (
              <>
                <Brain className="w-4 h-4 mr-2 animate-pulse" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Start AI Analysis
              </>
            )}
          </Button>

          {/* Scanning Progress */}
          {isScanning && (
            <Card className="bg-slate-700 border-slate-600">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">AI Analysis in Progress</span>
                    <span className="text-blue-400">{scanProgress.toFixed(0)}%</span>
                  </div>
                  <Progress value={scanProgress} className="h-2" />
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Eye className="w-4 h-4 text-blue-400" />
                      <span className="text-slate-300">Image Processing</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Brain className="w-4 h-4 text-purple-400" />
                      <span className="text-slate-300">Pattern Recognition</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-green-400" />
                      <span className="text-slate-300">Generating Report</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {scanResult && !isScanning && (
            <Card className="bg-slate-700 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  {scanResult.status === "abnormal" ? (
                    <AlertTriangle className="w-5 h-5 mr-2 text-orange-400" />
                  ) : (
                    <CheckCircle className="w-5 h-5 mr-2 text-green-400" />
                  )}
                  Analysis Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-400 text-sm">Scan Type</span>
                    <p className="text-white font-medium">{scanResult.type}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-sm">AI Confidence</span>
                    <p className="text-white font-medium">{scanResult.confidence}%</p>
                  </div>
                </div>
                
                <div>
                  <span className="text-slate-400 text-sm">Status</span>
                  <div className="mt-1">
                    <Badge 
                      className={scanResult.status === "abnormal" ? 
                        "bg-orange-500/20 text-orange-300 border-orange-500" : 
                        "bg-green-500/20 text-green-300 border-green-500"
                      }
                    >
                      {scanResult.status === "abnormal" ? "Abnormal findings detected" : "Normal findings"}
                    </Badge>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 text-sm">Key Findings</span>
                  <ul className="mt-2 space-y-1">
                    {scanResult.findings?.map((finding: string, index: number) => (
                      <li key={index} className="text-white text-sm flex items-start">
                        <span className="text-blue-400 mr-2">•</span>
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <span className="text-slate-400 text-sm">Recommendation</span>
                  <p className="text-white mt-1">{scanResult.recommendation}</p>
                </div>

                <Button
                  onClick={resetScan}
                  variant="outline"
                  className="w-full mt-4 border-slate-500 text-slate-300 hover:bg-slate-600"
                >
                  Analyze Another Image
                </Button>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}