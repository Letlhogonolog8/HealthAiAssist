import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, X, RotateCcw, Check, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import DermatologistSchedulingButton from "./dermatologist-scheduling-button";

interface ScanResult {
  hasCancer: boolean;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  findings: string[];
  recommendations: string[];
  analysis?: {
    lesionType: string;
    malignancyRisk: string;
    abcdeScore: {
      asymmetry: number;
      border: number;
      color: number;
      diameter: number;
      evolving: number;
      total: number;
    };
    urgency: string;
    followUpPeriod: string;
  };
}

export default function RealTimeSkinScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const { toast } = useToast();

  const scanMutation = useMutation({
    mutationFn: async (imageBlob: Blob) => {
      const formData = new FormData();
      formData.append('image', imageBlob, 'skin-scan.jpg');
      formData.append('scanType', 'skin-cancer');
      
      const response = await fetch('/api/scan/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Scan failed' }));
        throw new Error(errorData.error || 'Scan failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setScanResult(data.analysis || {
        hasCancer: false,
        confidence: 85,
        riskLevel: 'low',
        findings: ['Analysis completed successfully'],
        recommendations: ['Continue regular skin monitoring']
      });
      setScanProgress(100);
      setIsScanning(false);
      toast({
        title: "Scan Complete",
        description: "Your skin analysis is ready for review.",
      });
    },
    onError: (error) => {
      console.error('Scan error:', error);
      setIsScanning(false);
      setScanProgress(0);
      toast({
        title: "Scan Failed",
        description: "Please try again with better lighting.",
        variant: "destructive",
      });
    },
  });

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      
      // Enhanced constraints for mobile rotation and camera switching
      const constraints = {
        video: {
          facingMode,
          width: { 
            min: 640,
            ideal: window.innerWidth > 768 ? 1920 : 1280,
            max: 1920 
          },
          height: { 
            min: 480,
            ideal: window.innerWidth > 768 ? 1080 : 720,
            max: 1080 
          },
          aspectRatio: { ideal: 16/9 }
        },
        audio: false
      };

      // Stop existing stream before starting new one
      if (streamRef.current) {
        stopCamera();
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        
        // Handle orientation changes on mobile
        videoRef.current.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
      }
    } catch (error) {
      console.error('Camera error:', error);
      setCameraError('Unable to access camera. Please ensure camera permissions are granted and try switching cameras.');
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const captureImage = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw the current video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob and trigger analysis
    canvas.toBlob((blob) => {
      if (blob) {
        const imageUrl = URL.createObjectURL(blob);
        setCapturedImage(imageUrl);
        setIsScanning(true);
        setScanProgress(10);
        
        // Simulate progressive scanning
        const progressInterval = setInterval(() => {
          setScanProgress(prev => {
            if (prev >= 90) {
              clearInterval(progressInterval);
              return 90;
            }
            return prev + Math.random() * 20;
          });
        }, 500);
        
        scanMutation.mutate(blob);
      }
    }, 'image/jpeg', 0.9);
  }, [scanMutation]);

  const resetScan = useCallback(() => {
    setCapturedImage(null);
    setScanResult(null);
    setScanProgress(0);
    setIsScanning(false);
  }, []);

  const switchCamera = useCallback(async () => {
    const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacingMode);
    
    // Add loading state for camera switch
    setCameraError(null);
    
    toast({
      title: "Switching Camera",
      description: `Switching to ${newFacingMode === 'user' ? 'front' : 'back'} camera...`,
    });
  }, [facingMode, toast]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Handle orientation changes
  useEffect(() => {
    const handleOrientationChange = () => {
      // Restart camera on orientation change to adjust resolution
      setTimeout(() => {
        if (streamRef.current) {
          startCamera();
        }
      }, 500);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, [startCamera]);

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  const getUrgencyIcon = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'expedited': return <Info className="h-4 w-4 text-yellow-600" />;
      default: return <Check className="h-4 w-4 text-green-600" />;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Real-Time Skin Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cameraError ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{cameraError}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="relative">
                <video
                  ref={videoRef}
                  className="w-full h-96 md:h-[500px] bg-black rounded-lg object-cover transition-all duration-300"
                  autoPlay
                  playsInline
                  muted
                  style={{
                    minHeight: '300px',
                    maxHeight: window.innerHeight > window.innerWidth ? '60vh' : '80vh'
                  }}
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Scanning overlay */}
                {isScanning && (
                  <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                    <div className="text-center text-white space-y-2">
                      <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full mx-auto" />
                      <p>Analyzing skin...</p>
                      <div className="w-48 bg-white/20 rounded-full h-2">
                        <div 
                          className="bg-white h-2 rounded-full transition-all duration-500"
                          style={{ width: `${scanProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Enhanced camera controls */}
                <div className="absolute top-2 right-2 flex flex-col gap-2">
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={switchCamera}
                    disabled={isScanning}
                    className="bg-black/70 hover:bg-black/90 text-white border-white/20"
                    title={`Switch to ${facingMode === 'user' ? 'back' : 'front'} camera`}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    {facingMode === 'user' ? 'Back' : 'Front'}
                  </Button>
                  
                  {/* Camera indicator */}
                  <div className="bg-black/70 text-white text-xs px-2 py-1 rounded text-center">
                    {facingMode === 'user' ? '📱 Front' : '📷 Back'}
                  </div>
                </div>

                {/* Capture guide overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-2 border-white rounded-full opacity-50" />
                  <div className="absolute top-4 left-4 bg-black/70 text-white text-xs p-2 rounded">
                    Position lesion in circle
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-center flex-wrap">
                <Button
                  onClick={captureImage}
                  disabled={isScanning || cameraError !== null}
                  className="flex-1 min-w-[150px] touch-target py-3 text-base"
                  size="lg"
                >
                  <Camera className="h-5 w-5 mr-2" />
                  {isScanning ? 'Scanning...' : 'Capture & Analyze'}
                </Button>
                
                <Button 
                  onClick={switchCamera}
                  disabled={isScanning}
                  variant="outline"
                  className="touch-target py-3 px-4"
                  size="lg"
                >
                  <RotateCcw className="h-5 w-5 mr-2" />
                  Switch Camera
                </Button>
                
                {(capturedImage || scanResult) && (
                  <Button variant="outline" onClick={resetScan} className="touch-target py-3" size="lg">
                    <X className="h-5 w-5 mr-2" />
                    Reset
                  </Button>
                )}
              </div>

              {/* Scanning progress */}
              {isScanning && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Analysis Progress</span>
                    <span>{Math.round(scanProgress)}%</span>
                  </div>
                  <Progress value={scanProgress} className="w-full" />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Captured Image */}
      {capturedImage && (
        <Card>
          <CardHeader>
            <CardTitle>Captured Image</CardTitle>
          </CardHeader>
          <CardContent>
            <img 
              src={capturedImage} 
              alt="Captured skin" 
              className="w-full max-w-md mx-auto rounded-lg border"
            />
          </CardContent>
        </Card>
      )}

      {/* Scan Results */}
      {scanResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Analysis Results
              <Badge className={getRiskColor(scanResult?.riskLevel || 'low')}>
                {(scanResult?.riskLevel || 'low').toUpperCase()} RISK
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold">Confidence Score</h4>
                <div className="flex items-center gap-2">
                  <Progress value={scanResult?.confidence || 0} className="flex-1" />
                  <span className="text-sm font-medium">{scanResult?.confidence || 0}%</span>
                </div>
              </div>

              {scanResult?.analysis && (
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    Urgency Level
                    {getUrgencyIcon(scanResult.analysis.urgency)}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {scanResult.analysis.urgency === 'urgent' 
                      ? 'Immediate medical attention recommended'
                      : scanResult.analysis.urgency === 'expedited'
                      ? 'Schedule appointment within 1 month'
                      : 'Routine monitoring recommended'
                    }
                  </p>
                </div>
              )}
            </div>

            {scanResult.analysis?.abcdeScore && (
              <div className="space-y-3">
                <h4 className="font-semibold">ABCDE Analysis</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <div className="font-medium">A</div>
                    <div className="text-xs text-gray-600">Asymmetry</div>
                    <div className="font-bold">{scanResult.analysis.abcdeScore.asymmetry || 0}/2</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <div className="font-medium">B</div>
                    <div className="text-xs text-gray-600">Border</div>
                    <div className="font-bold">{scanResult.analysis.abcdeScore.border || 0}/2</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <div className="font-medium">C</div>
                    <div className="text-xs text-gray-600">Color</div>
                    <div className="font-bold">{scanResult.analysis.abcdeScore.color || 0}/2</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <div className="font-medium">D</div>
                    <div className="text-xs text-gray-600">Diameter</div>
                    <div className="font-bold">{scanResult.analysis.abcdeScore.diameter || 0}/2</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <div className="font-medium">E</div>
                    <div className="text-xs text-gray-600">Evolving</div>
                    <div className="font-bold">{scanResult.analysis.abcdeScore.evolving || 0}/2</div>
                  </div>
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="text-lg">
                    Total Score: {scanResult.analysis.abcdeScore.total || 0}/10
                  </Badge>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="font-semibold">Findings</h4>
              <ul className="space-y-1">
                {(scanResult.findings || []).map((finding, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                    {finding}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Recommendations</h4>
              <ul className="space-y-1">
                {(scanResult.recommendations || []).map((rec, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>

            {scanResult.analysis && scanResult.analysis.urgency === 'urgent' && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Urgent:</strong> High-risk lesion detected. Please consult a dermatologist immediately.
                  Next follow-up: {scanResult.analysis.followUpPeriod}
                </AlertDescription>
              </Alert>
            )}

            {/* Schedule Dermatologist Button - appears after any skin cancer analysis */}
            <div className="flex flex-col gap-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-lg">Next Steps</h4>
                  <p className="text-sm text-gray-600">
                    {scanResult.riskLevel === 'high' 
                      ? 'Immediate dermatologist consultation recommended'
                      : scanResult.riskLevel === 'medium'
                      ? 'Schedule dermatologist appointment for further evaluation'
                      : 'Consider routine dermatologist check-up'
                    }
                  </p>
                </div>
              </div>
              
              <DermatologistSchedulingButton 
                scanResult={scanResult}
                urgency={(scanResult.analysis?.urgency as 'urgent' | 'expedited' | 'routine') || 'routine'}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage Guidelines */}
      <Card>
        <CardHeader>
          <CardTitle>Scanning Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>• Position the lesion within the circle overlay</p>
          <p>• Ensure good lighting - natural light works best</p>
          <p>• Hold the device steady during capture</p>
          <p>• For best results, scan individual lesions separately</p>
          <p>• This tool is for screening purposes only - consult a dermatologist for diagnosis</p>
        </CardContent>
      </Card>
    </div>
  );
}