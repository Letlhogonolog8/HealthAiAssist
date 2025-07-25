import { Button } from "@/components/ui/button";
import { LogIn, Info, Brain, Plus, Check, Microscope } from "lucide-react";

export default function HeroSection() {
  return (
    <section className="relative bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
                MedAI
              </h1>
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-blue-300">
                Comprehensive Cancer Detection Platform
              </h2>
              <p className="text-lg text-slate-300 leading-relaxed max-w-2xl">
                Advanced multi-modal AI technology for precise cancer detection across five major 
                types: breast, lung, skin, colon, and prostate. Enhancing early detection to improve 
                patient outcomes.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Button 
                size="lg"
                className="bg-medical-blue-600 hover:bg-medical-blue-500 text-white px-8 py-3 font-semibold transform hover:scale-105 transition-all duration-200 shadow-lg"
              >
                <LogIn className="w-5 h-5 mr-2" />
                Login to System
              </Button>
              <Button 
                variant="outline"
                size="lg"
                className="border-blue-400 text-blue-300 hover:bg-blue-800 px-8 py-3 font-semibold transition-all duration-200"
              >
                <Info className="w-5 h-5 mr-2" />
                Learn More
              </Button>
            </div>
          </div>
          
          <div className="relative">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-full w-80 h-80 mx-auto flex items-center justify-center shadow-2xl">
              <div className="relative">
                {/* Medical AI Visualization */}
                <div className="w-48 h-48 bg-blue-700 rounded-full flex items-center justify-center relative">
                  <div className="w-24 h-24 bg-cyan-500 rounded-full flex items-center justify-center">
                    <Brain className="w-12 h-12 text-white" />
                  </div>
                  {/* Floating medical icons */}
                  <div className="absolute -top-2 -right-2 w-8 h-8 bg-white rounded-full flex items-center justify-center">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="absolute -bottom-4 -left-4 w-8 h-8 bg-green-400 rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                  <div className="absolute top-8 -left-8 w-6 h-6 bg-cyan-400 rounded-full flex items-center justify-center">
                    <Microscope className="w-3 h-3 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
