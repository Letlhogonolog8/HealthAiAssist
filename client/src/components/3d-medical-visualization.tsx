import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Zap, Activity, Heart } from "lucide-react";

export default function MedicalVisualization3D() {
  const [rotation, setRotation] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const [activeOrgan, setActiveOrgan] = useState("heart");

  // State for organs and analysis results to replace static/mock data
  interface Organ {
    id: string;
    name: string;
    color: string;
    accuracy: string;
  }

  interface Analysis {
    detectionStatus: string;
    confidenceLevel: string;
    processingSpeed: string;
    lastUpdated: string;
    heatmapData?: number[]; // New field for heatmap or feature importance data
  }

  const [organs, setOrgans] = useState<Organ[]>([]);
  const [analysis, setAnalysis] = useState<Analysis>({
    detectionStatus: "",
    confidenceLevel: "",
    processingSpeed: "",
    lastUpdated: "",
    heatmapData: []
  });

  useEffect(() => {
    if (isAnimating) {
      const interval = setInterval(() => {
        setRotation((prev) => (prev + 1) % 360);
      }, 50);
      return () => clearInterval(interval);
    }
  }, [isAnimating]);

  // Simulate fetching real-time data including heatmap
  useEffect(() => {
    async function fetchData() {
      // Replace this with real API calls or data subscriptions
      const fetchedOrgans = [
        { id: "heart", name: "Heart", color: "text-red-400", accuracy: "96%" },
        { id: "lungs", name: "Lungs", color: "text-blue-400", accuracy: "94%" },
        { id: "brain", name: "Brain", color: "text-purple-400", accuracy: "92%" },
      ];
      const fetchedAnalysis = {
        detectionStatus: "Normal",
        confidenceLevel: "97.3%",
        processingSpeed: "Real-time",
        lastUpdated: "Now",
        heatmapData: [0.1, 0.5, 0.3, 0.7, 0.2, 0.4, 0.6, 0.8] // Example heatmap values
      };
      setOrgans(fetchedOrgans);
      setAnalysis(fetchedAnalysis);
    }
    fetchData();
  }, []);

  // Render heatmap dots with intensity based on heatmapData
  const renderHeatmap = () => {
    if (!analysis.heatmapData || analysis.heatmapData.length === 0) return null;
    return analysis.heatmapData.map((value, i) => (
      <div
        key={i}
        className="absolute w-3 h-3 rounded-full"
        style={{
          top: `${20 + Math.sin(i * 0.8 + rotation * 0.1) * 30}%`,
          left: `${20 + Math.cos(i * 0.8 + rotation * 0.1) * 30}%`,
          backgroundColor: `rgba(255, 0, 0, ${value})`,
          boxShadow: `0 0 8px rgba(255, 0, 0, ${value})`
        }}
        aria-label={`Heatmap intensity ${value.toFixed(2)}`}
        role="img"
      />
    ));
  };

  return (
    <Card className="bg-slate-800 border-slate-600">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <Activity className="w-5 h-5 mr-2 text-blue-400" />
          HAI 3D Medical Visualization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 3D Visualization Area */}
        <div className="relative h-64 bg-slate-900 rounded-lg overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Animated 3D Heart */}
            <div
              className="relative transform transition-transform duration-100"
              style={{ transform: `rotateY(${rotation}deg)` }}
            >
              <div className="w-24 h-24 relative">
                {/* Heart shape using CSS */}
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2">
                  <Heart
                    className={`w-16 h-16 ${
                      activeOrgan === "heart" ? "text-red-500" : "text-slate-600"
                    } animate-pulse`}
                    fill="currentColor"
                  />
                </div>

                {/* Neural network visualization with heatmap overlay */}
                <div className="absolute inset-0">
                  {renderHeatmap()}
                </div>
              </div>

              {/* Scanning beams */}
              <div className="absolute -inset-8">
                <div
                  className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-pulse"
                  style={{ top: `${30 + Math.sin(rotation * 0.05) * 20}%` }}
                />
                <div
                  className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-green-400 to-transparent animate-pulse"
                  style={{ top: `${60 + Math.cos(rotation * 0.07) * 20}%` }}
                />
              </div>
            </div>
          </div>

          {/* Control overlay */}
          <div className="absolute top-4 right-4">
            <Button
              onClick={() => setIsAnimating(!isAnimating)}
              size="sm"
              variant="outline"
              className="border-slate-600 text-slate-300"
              aria-pressed={isAnimating}
              aria-label={isAnimating ? "Pause animation" : "Start animation"}
            >
              {isAnimating ? (
                <RotateCcw className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* AI Analysis indicators */}
          <div className="absolute bottom-4 left-4 flex space-x-2">
            <Badge className="bg-green-600 animate-pulse">AI Active</Badge>
            <Badge className="bg-blue-600">Real-time</Badge>
          </div>
        </div>

        {/* Organ Selection */}
        <div className="grid grid-cols-3 gap-3">
          {organs.map((organ) => (
            <button
              key={organ.id}
              onClick={() => setActiveOrgan(organ.id)}
              className={`p-3 rounded-lg border transition-all ${
                activeOrgan === organ.id
                  ? "border-blue-500 bg-blue-600/20"
                  : "border-slate-600 bg-slate-700 hover:border-slate-500"
              }`}
              aria-pressed={activeOrgan === organ.id}
              aria-label={`Select ${organ.name}`}
            >
              <div className="text-center space-y-1">
                <p className={`font-medium ${organ.color}`}>{organ.name}</p>
                <p className="text-slate-400 text-xs">{organ.accuracy}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Analysis Results */}
        <div className="bg-slate-700 rounded-lg p-4 space-y-3">
          <h4 className="text-white font-medium">Real-time Analysis</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-400">Detection Status</p>
              <p className="text-green-400 font-medium">{analysis.detectionStatus}</p>
            </div>
            <div>
              <p className="text-slate-400">Confidence Level</p>
              <p className="text-blue-400 font-medium">{analysis.confidenceLevel}</p>
            </div>
            <div>
              <p className="text-slate-400">Processing Speed</p>
              <p className="text-purple-400 font-medium">{analysis.processingSpeed}</p>
            </div>
            <div>
              <p className="text-slate-400">Last Updated</p>
              <p className="text-cyan-400 font-medium">{analysis.lastUpdated}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
