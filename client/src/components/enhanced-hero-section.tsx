import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LogIn, Info, Brain, Plus, Check, Microscope, Activity, Zap } from "lucide-react";

interface EnhancedHeroSectionProps {
  onLoginClick: () => void;
}

export default function EnhancedHeroSection({ onLoginClick }: EnhancedHeroSectionProps) {
  const [animateStats, setAnimateStats] = useState(false);

  useEffect(() => {
    setTimeout(() => setAnimateStats(true), 1000);
  }, []);

  const stats = [
    { value: "5", label: "Cancer Types", color: "text-blue-400" },
    { value: "97%", label: "Detection Confidence", color: "text-green-400" },
    { value: "30%", label: "Earlier Detection", color: "text-cyan-400" },
    { value: "60%", label: "Workflow Efficiency", color: "text-purple-400" },
  ];

  return (
    <section className="relative bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 py-20 overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-20 left-10 w-32 h-32 bg-blue-500 rounded-full animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-24 h-24 bg-cyan-500 rounded-full animate-bounce"></div>
        <div className="absolute top-1/2 left-1/4 w-16 h-16 bg-purple-500 rounded-full animate-ping"></div>
        <div className="absolute top-1/3 right-1/3 w-20 h-20 bg-green-500 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/3 left-1/3 w-12 h-12 bg-yellow-500 rounded-full animate-bounce delay-500"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-2 mb-4">
                <Activity className="w-6 h-6 text-cyan-500 animate-pulse" />
                <span className="text-cyan-400 font-semibold">AI-Powered Healthcare</span>
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight animate-fade-in-up">
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent animate-pulse">
                  HAI
                </span>
              </h1>
              
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-blue-300 animate-fade-in-up delay-200">
                Comprehensive Cancer Detection Platform
              </h2>
              
              <p className="text-lg text-slate-300 leading-relaxed max-w-2xl animate-fade-in-up delay-300">
                Advanced multi-modal AI technology for precise cancer detection across five major 
                types: breast, lung, skin, colon, and prostate. Enhancing early detection to improve 
                patient outcomes with cutting-edge machine learning algorithms.
              </p>

              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-slate-300 text-sm">Real-time Analysis</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Brain className="w-4 h-4 text-purple-400" />
                  <span className="text-slate-300 text-sm">AI-Powered Insights</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Microscope className="w-4 h-4 text-blue-400" />
                  <span className="text-slate-300 text-sm">Medical Grade Accuracy</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-green-400" />
                  <span className="text-slate-300 text-sm">FDA Compliant</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-up delay-500">
              <Button 
                onClick={onLoginClick}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-8 py-3 font-semibold transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-2xl animate-pulse"
              >
                <LogIn className="w-5 h-5 mr-2" />
                Access Platform
              </Button>
              <Button 
                variant="outline"
                size="lg"
                className="border-blue-400 text-blue-300 hover:bg-blue-800 hover:border-blue-300 px-8 py-3 font-semibold transition-all duration-200 hover:scale-105"
                onClick={() => {
                  const aboutSection = document.getElementById('ai-features-section');
                  if (aboutSection) {
                    aboutSection.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
              >
                <Info className="w-5 h-5 mr-2" />
                Learn More
              </Button>
            </div>


          </div>
          
          <div className="relative animate-fade-in-right delay-700">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-full w-80 h-80 mx-auto flex items-center justify-center shadow-2xl hover:shadow-3xl transition-all duration-500 hover:scale-105 animate-float">
              <div className="relative">
                <div className="w-48 h-48 bg-blue-700 rounded-full flex items-center justify-center relative animate-spin-slow">
                  <div className="w-24 h-24 bg-cyan-500 rounded-full flex items-center justify-center animate-pulse">
                    <Brain className="w-12 h-12 text-white animate-bounce" />
                  </div>
                  <div className="absolute -top-2 -right-2 w-8 h-8 bg-white rounded-full flex items-center justify-center animate-ping">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="absolute -bottom-4 -left-4 w-8 h-8 bg-green-400 rounded-full flex items-center justify-center animate-bounce delay-300">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                  <div className="absolute top-8 -left-8 w-6 h-6 bg-cyan-400 rounded-full flex items-center justify-center animate-pulse delay-500">
                    <Microscope className="w-3 h-3 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-800 to-transparent"></div>
    </section>
  );
}