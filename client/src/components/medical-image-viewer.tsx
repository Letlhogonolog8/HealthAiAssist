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
  Settings
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
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  if (!imageFile || !imageUrl) {
    return (
      <Card className="h-96">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500">
            <Eye className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Upload an image to view and analyze</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Viewer Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              HAI Medical Image Viewer
            </span>
            {analysisResult && (
              <Badge 
                variant={analysisResult.hasCancer ? "destructive" : "default"}
                className={`${getRiskColor(analysisResult.riskLevel)} border-2`}
              >
                {analysisResult.hasCancer ? "Abnormal" : "Normal"} - {analysisResult.confidence.toFixed(1)}%
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={handleZoomIn}>
              <ZoomIn className="w-4 h-4 mr-1" />
              Zoom In
            </Button>
            <Button variant="outline" size="sm" onClick={handleZoomOut}>
              <ZoomOut className="w-4 h-4 mr-1" />
              Zoom Out
            </Button>
            <Button variant="outline" size="sm" onClick={handleRotate}>
              <RotateCw className="w-4 h-4 mr-1" />
              Rotate
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowEnhancements(!showEnhancements)}
            >
              <Settings className="w-4 h-4 mr-1" />
              Enhance
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset View
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-1" />
              Download
            </Button>
          </div>

          {/* Enhancement Controls */}
          {showEnhancements && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ZoomIn className="w-4 h-4" />
                  <label className="text-sm font-medium">Zoom: {zoom}%</label>
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4" />
                  <label className="text-sm font-medium">Brightness: {brightness}%</label>
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Contrast className="w-4 h-4" />
                  <label className="text-sm font-medium">Contrast: {contrast}%</label>
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
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="relative w-full h-96 bg-black overflow-hidden cursor-move"
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
            
            {/* Zoom indicator */}
            <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
              {zoom}%
            </div>

            {/* Analysis overlay */}
            {analysisResult && (
              <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white p-3 rounded max-w-xs">
                <div className="text-sm font-medium mb-2">AI Analysis Results</div>
                <div className="space-y-1 text-xs">
                  <div>Risk Level: <span className={`font-medium ${
                    analysisResult.riskLevel === 'high' ? 'text-red-400' :
                    analysisResult.riskLevel === 'medium' ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>{analysisResult.riskLevel.toUpperCase()}</span></div>
                  <div>Confidence: {analysisResult.confidence.toFixed(1)}%</div>
                  <div>Status: {analysisResult.hasCancer ? 'Abnormal findings' : 'Normal scan'}</div>
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

      {/* Image Information */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">File Name:</span>
              <p className="font-medium truncate">{imageFile.name}</p>
            </div>
            <div>
              <span className="text-gray-500">File Size:</span>
              <p className="font-medium">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div>
              <span className="text-gray-500">File Type:</span>
              <p className="font-medium">{imageFile.type}</p>
            </div>
            <div>
              <span className="text-gray-500">Last Modified:</span>
              <p className="font-medium">{new Date(imageFile.lastModified).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}