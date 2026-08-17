import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, Upload, FileText, Activity, ChevronLeft, ChevronRight, X, Play } from "lucide-react";

interface DemoWalkthroughProps {
  onClose: () => void;
}

export default function DemoWalkthrough({ onClose }: DemoWalkthroughProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const demoSteps = [
    {
      title: "Upload Medical Images",
      description: "Drag and drop or browse to upload medical scans in DICOM, JPG, or PNG format",
      content: (
        <div className="bg-slate-700 rounded-lg p-8 text-center border-2 border-dashed border-slate-500">
          <Upload className="w-16 h-16 mx-auto mb-4 text-blue-400" />
          <h3 className="text-xl font-semibold text-white mb-2">Upload Medical Image</h3>
          <p className="text-slate-300 mb-4">Supports DICOM, JPG, PNG formats up to 10MB</p>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Upload className="w-4 h-4 mr-2" />
            Browse Files
          </Button>
        </div>
      )
    },
    {
      title: "AI Analysis in Progress",
      description: "Our advanced AI models analyze the medical image for potential abnormalities",
      content: (
        <div className="space-y-6">
          <div className="bg-slate-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Brain className="w-6 h-6 text-purple-400 animate-pulse" />
                <span className="text-white font-medium">AI Analysis in Progress</span>
              </div>
              <span className="text-sm text-slate-400">78%</span>
            </div>
            <Progress value={78} className="w-full mb-4" />
            <p className="text-sm text-slate-300">
              Advanced neural networks are analyzing the medical image for potential abnormalities...
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-700 p-4 rounded-lg text-center">
              <div className="text-lg font-bold text-blue-400">Step 1</div>
              <div className="text-sm text-slate-300">Image Processing</div>
            </div>
            <div className="bg-slate-700 p-4 rounded-lg text-center">
              <div className="text-lg font-bold text-yellow-400">Step 2</div>
              <div className="text-sm text-slate-300">Pattern Recognition</div>
            </div>
            <div className="bg-slate-600 p-4 rounded-lg text-center">
              <div className="text-lg font-bold text-slate-400">Step 3</div>
              <div className="text-sm text-slate-400">Results Generation</div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Analysis Results",
      description: "View detailed AI analysis results with confidence scores and recommendations",
      content: (
        <div className="space-y-4">
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <FileText className="w-5 h-5" />
                Breast Cancer Scan Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">AI Confidence</span>
                  <div className="flex items-center space-x-2">
                    <Progress value={94} className="w-24" />
                    <span className="text-white font-medium">94%</span>
                  </div>
                </div>
                <div className="bg-green-900/20 p-3 rounded border border-green-700">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-green-400" />
                    <span className="text-sm font-medium text-green-300">Analysis Result</span>
                  </div>
                  <p className="text-sm text-green-200">No abnormalities detected</p>
                </div>
                <div className="bg-blue-900/20 p-3 rounded border border-blue-700">
                  <div className="text-sm font-medium text-blue-300 mb-1">Recommendations</div>
                  <p className="text-sm text-blue-200">Continue regular screening schedule</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    },
    {
      title: "Dashboard Overview",
      description: "Access comprehensive dashboard with scan history, appointments, and health insights",
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-slate-700 border-slate-600">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">12</div>
                <div className="text-sm text-slate-300">Total Scans</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-700 border-slate-600">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-400">11</div>
                <div className="text-sm text-slate-300">Normal Results</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-700 border-slate-600">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-400">1</div>
                <div className="text-sm text-slate-300">Follow-up Needed</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-700 border-slate-600">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-purple-400">95%</div>
                <div className="text-sm text-slate-300">Health Score</div>
              </CardContent>
            </Card>
          </div>
          <div className="bg-slate-700 rounded-lg p-4">
            <h4 className="text-white font-medium mb-3">Recent Activity</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-3 p-2 bg-slate-600 rounded">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-slate-300 text-sm">Mammography scan completed - Normal findings</span>
                <span className="text-slate-500 text-xs ml-auto">2h ago</span>
              </div>
              <div className="flex items-center space-x-3 p-2 bg-slate-600 rounded">
                <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                <span className="text-slate-300 text-sm">Appointment scheduled with Dr. Smith</span>
                <span className="text-slate-500 text-xs ml-auto">1d ago</span>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    if (currentStep < demoSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="bg-slate-800 text-white">
      <div className="flex items-center justify-between p-6 border-b border-slate-700">
        <div>
          <h2 className="text-2xl font-bold">HAI Platform Demo</h2>
          <p className="text-slate-400">Interactive walkthrough of key features</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-semibold">{demoSteps[currentStep].title}</h3>
            <Badge variant="outline" className="border-blue-500 text-blue-400">
              {currentStep + 1} of {demoSteps.length}
            </Badge>
          </div>
          <p className="text-slate-400 mb-4">{demoSteps[currentStep].description}</p>
          <Progress value={((currentStep + 1) / demoSteps.length) * 100} className="w-full mb-6" />
        </div>

        <div className="min-h-[400px] mb-6">
          {demoSteps[currentStep].content}
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 0}
            className="border-slate-600 text-slate-300"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>

          <div className="flex space-x-2">
            {demoSteps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full ${
                  index === currentStep ? 'bg-blue-500' : 'bg-slate-600'
                }`}
              />
            ))}
          </div>

          {currentStep < demoSteps.length - 1 ? (
            <Button onClick={nextStep} className="bg-blue-600 hover:bg-blue-700">
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={onClose} className="bg-green-600 hover:bg-green-700">
              Access platform
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}