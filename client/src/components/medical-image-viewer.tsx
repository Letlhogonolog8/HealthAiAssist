import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Move, 
  Maximize, 
  Download,
  Eye,
  Contrast,
  Sun,
  Settings,
  Brain,
  FileText,
  Activity,
  Clock
} from 'lucide-react';

interface MedicalImageViewerProps {
  imageFile: File | null;
  analysisResult?: {
    hasCancer: boolean;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    findings: string[];
  } | null;
}

export default function MedicalImageViewer({ imageFile, analysisResult }: MedicalImageViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [showEnhancements, setShowEnhancements] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Create image URL when file changes
  useEffect(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [imageFile]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 500));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 25));
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleReset = () => {
    setZoom(100);
    setRotation(0);
    setBrightness(100);
    setContrast(100);
    setImagePosition({ x: 0, y: 0 });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - imagePosition.x,
      y: e.clientY - imagePosition.y
    });
  }, [imagePosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    
    setImagePosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDownload = () => {
    if (imageUrl && imageFile) {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = imageFile.name;
      link.click();
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high': return 'border-red-500 bg-red-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-green-500 bg-green-50';
      default: return 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800';
    }
  };

  if (!imageFile || !imageUrl) {
    return (
      <Card className="h-96">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <Eye className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Upload an image to view and analyze</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Viewer Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Eye className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Medical Image Viewer</h2>
                <p className="text-sm text-blue-600 font-medium">AI-Powered Analysis Platform</p>
              </div>
            </span>
            {analysisResult && (
              <div className="flex flex-col items-end gap-2">
                <Badge 
                  variant={analysisResult.hasCancer ? "destructive" : "default"}
                  className={`${getRiskColor(analysisResult.riskLevel)} border-2 text-sm px-3 py-1`}
                >
                  {analysisResult.hasCancer ? "Abnormal" : "Normal"}
                </Badge>
                <span className="text-sm font-semibold text-muted-foreground">
                  Confidence: {analysisResult.confidence.toFixed(1)}%
                </span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Button variant="outline" size="sm" onClick={handleZoomIn} className="hover:bg-green-50 hover:border-green-300">
              <ZoomIn className="w-4 h-4 mr-1" />
              Zoom In
            </Button>
            <Button variant="outline" size="sm" onClick={handleZoomOut} className="hover:bg-red-50 hover:border-red-300">
              <ZoomOut className="w-4 h-4 mr-1" />
              Zoom Out
            </Button>
            <Button variant="outline" size="sm" onClick={handleRotate} className="hover:bg-purple-50 hover:border-purple-300">
              <RotateCw className="w-4 h-4 mr-1" />
              Rotate
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowEnhancements(!showEnhancements)}
              className={`hover:bg-blue-50 hover:border-blue-300 ${showEnhancements ? 'bg-blue-100 border-blue-400' : ''}`}
            >
              <Settings className="w-4 h-4 mr-1" />
              Enhance
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} className="hover:bg-slate-50 dark:bg-slate-800 hover:border-slate-300 dark:border-slate-600">
              Reset View
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} className="hover:bg-indigo-50 hover:border-indigo-300">
              <Download className="w-4 h-4 mr-1" />
              Download
            </Button>
          </div>

          {/* Enhancement Controls */}
          {showEnhancements && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4 p-6 bg-gradient-to-r from-slate-50 to-gray-50 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner">
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 bg-green-100 rounded">
                    <ZoomIn className="w-4 h-4 text-green-600" />
                  </div>
                  <label className="text-sm font-semibold text-foreground">Zoom: {zoom}%</label>
                </div>
                <Slider
                  value={[zoom]}
                  onValueChange={(value) => setZoom(value[0])}
                  min={25}
                  max={500}
                  step={25}
                  className="w-full"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 bg-yellow-100 rounded">
                    <Sun className="w-4 h-4 text-yellow-600" />
                  </div>
                  <label className="text-sm font-semibold text-foreground">Brightness: {brightness}%</label>
                </div>
                <Slider
                  value={[brightness]}
                  onValueChange={(value) => setBrightness(value[0])}
                  min={50}
                  max={200}
                  step={10}
                  className="w-full"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 bg-purple-100 rounded">
                    <Contrast className="w-4 h-4 text-purple-600" />
                  </div>
                  <label className="text-sm font-semibold text-foreground">Contrast: {contrast}%</label>
                </div>
                <Slider
                  value={[contrast]}
                  onValueChange={(value) => setContrast(value[0])}
                  min={50}
                  max={200}
                  step={10}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Image Viewer */}
      <Card className="overflow-hidden shadow-xl border-0">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="relative w-full h-[500px] bg-gradient-to-br from-gray-900 to-black overflow-hidden cursor-move border-4 border-slate-200 dark:border-slate-700 rounded-lg"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Medical scan"
              className="absolute inset-0 max-w-none select-none"
              style={{
                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${zoom / 100}) rotate(${rotation}deg)`,
                filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.2s ease',
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
              draggable={false}
            />
            
            {/* Enhanced Zoom indicator */}
            <div className="absolute top-4 left-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 py-2 rounded-lg shadow-lg border border-blue-400">
              <div className="flex items-center gap-2">
                <ZoomIn className="w-4 h-4" />
                <span className="font-semibold">{zoom}%</span>
              </div>
            </div>

            {/* Enhanced Analysis overlay */}
            {analysisResult && (
              <div className="absolute top-4 right-4 bg-gradient-to-br from-slate-800 to-gray-900 text-white p-4 rounded-xl shadow-2xl border border-gray-600 max-w-sm backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1 bg-blue-500 rounded">
                    <Brain className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold">AI Analysis Results</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span>Risk Level:</span>
                    <Badge className={`${getRiskColor(analysisResult.riskLevel)} text-xs`}>
                      {analysisResult.riskLevel.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Confidence:</span>
                    <span className="font-bold text-blue-300">{analysisResult.confidence.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Status:</span>
                    <span className={`font-medium ${
                      analysisResult.hasCancer ? 'text-red-300' : 'text-green-300'
                    }`}>
                      {analysisResult.hasCancer ? 'Abnormal' : 'Normal'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Crosshair for precise examination */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/2 left-0 w-full h-px bg-white opacity-20"></div>
              <div className="absolute left-1/2 top-0 w-px h-full bg-white opacity-20"></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Image Information */}
      <Card className="shadow-lg border-0 bg-gradient-to-r from-gray-50 to-slate-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <FileText className="w-5 h-5 text-blue-600" />
            Image Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-muted-foreground">File Name</span>
              </div>
              <p className="font-bold text-foreground truncate" title={imageFile.name}>{imageFile.name}</p>
            </div>
            <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-green-500" />
                <span className="text-sm font-semibold text-muted-foreground">File Size</span>
              </div>
              <p className="font-bold text-foreground">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-semibold text-muted-foreground">File Type</span>
              </div>
              <p className="font-bold text-foreground">{imageFile.type}</p>
            </div>
            <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold text-muted-foreground">Last Modified</span>
              </div>
              <p className="font-bold text-foreground">{new Date(imageFile.lastModified).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}