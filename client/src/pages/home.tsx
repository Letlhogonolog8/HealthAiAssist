import { useState, useEffect } from "react";
import Navigation from "@/components/navigation";
import EnhancedHeroSection from "@/components/enhanced-hero-section";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AIFeaturesSection from "@/components/ai-features-section";
import CancerDetectionSection from "@/components/cancer-detection-section";

import MobileQRAccess from "@/components/mobile-qr-access";
import Footer from "@/components/footer";
import LoginDialog from "@/components/login-dialog";
import { Brain, Shield, Users, TrendingUp, Heart, Activity, Zap, CheckCircle, Star, Award, Microscope, Clock, Globe, ArrowRight, Play } from "lucide-react";
import DemoWalkthrough from "@/components/demo-walkthrough";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface HomeProps {
  onLoginSuccess: (user: any) => void;
}

export default function Home({ onLoginSuccess, userId }: HomeProps & { userId?: number }) {
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);

  useEffect(() => {
    const timer1 = setTimeout(() => setStatsVisible(true), 500);
    const timer2 = setTimeout(() => setFeaturesVisible(true), 1000);
    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, []);

  const stats = [
    { value: "10,000+", label: "Scans Analyzed", icon: Brain, color: "text-blue-400" },
    { value: "97.5%", label: "Detection Accuracy", icon: Shield, color: "text-green-400" },
    { value: "500+", label: "Healthcare Providers", icon: Users, color: "text-purple-400" },
    { value: "30%", label: "Earlier Detection", icon: TrendingUp, color: "text-cyan-400" }
  ];

  const features = [
    { title: "Multi-Cancer Detection", desc: "Breast, Lung, Skin, Colon & Prostate", icon: Heart, color: "bg-red-600" },
    { title: "Real-Time Analysis", desc: "Instant AI-powered results", icon: Zap, color: "bg-yellow-600" },
    { title: "Medical Grade", desc: "FDA compliant accuracy", icon: Award, color: "bg-green-600" },
    { title: "24/7 Availability", desc: "Always accessible platform", icon: Activity, color: "bg-blue-600" }
  ];

  return (
    <div className="min-h-screen bg-slate-900">
      <Navigation onLoginSuccess={onLoginSuccess} />
      <EnhancedHeroSection onLoginClick={() => setShowLoginDialog(true)} />
      




      {/* Features Grid */}
      <section className="bg-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 px-4 py-2 text-sm font-medium mb-6">
              Platform Capabilities
            </Badge>
            <h2 className="text-4xl font-bold text-white mb-6">Advanced AI-Powered Healthcare</h2>
            <p className="text-xl text-slate-400 max-w-4xl mx-auto leading-relaxed">
              Our comprehensive platform combines cutting-edge artificial intelligence with medical expertise 
              to deliver unprecedented accuracy in cancer detection and diagnosis.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { 
                title: "Multi-Modal AI Detection", 
                desc: "Advanced neural networks analyze medical images across 5 cancer types with 97.5% accuracy", 
                icon: Brain, 
                color: "from-blue-600 to-cyan-600" 
              },
              { 
                title: "Real-Time Analysis", 
                desc: "Instant processing and results delivery with comprehensive diagnostic insights", 
                icon: Zap, 
                color: "from-yellow-600 to-orange-600" 
              },
              { 
                title: "Medical Grade Security", 
                desc: "HIPAA compliant infrastructure with enterprise-level data protection", 
                icon: Shield, 
                color: "from-green-600 to-emerald-600" 
              },
              { 
                title: "Clinical Integration", 
                desc: "Seamless workflow integration with existing hospital management systems", 
                icon: Activity, 
                color: "from-purple-600 to-pink-600" 
              },
              { 
                title: "Global Accessibility", 
                desc: "24/7 platform availability with multi-language support for worldwide access", 
                icon: Globe, 
                color: "from-indigo-600 to-blue-600" 
              },
              { 
                title: "Continuous Learning", 
                desc: "AI models continuously improve through federated learning and expert validation", 
                icon: TrendingUp, 
                color: "from-teal-600 to-cyan-600" 
              }
            ].map((feature, index) => {
              const IconComponent = feature.icon;
              return (
                <div 
                  key={index}
                  className={`transform transition-all duration-700 delay-${index * 150} ${
                    featuresVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                  }`}
                >
                  <Card className="bg-slate-700 border-slate-600 hover:border-slate-500 transition-all duration-300 hover:scale-105 group h-full">
                    <CardContent className="p-8">
                      <div className="flex items-start space-x-4">
                        <div className={`w-14 h-14 bg-gradient-to-br ${feature.color} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 flex-shrink-0`}>
                          <IconComponent className="w-7 h-7 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-white mb-3 group-hover:text-blue-400 transition-colors">
                            {feature.title}
                          </h3>
                          <p className="text-slate-400 leading-relaxed">{feature.desc}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      




      <AIFeaturesSection />
      <CancerDetectionSection />
      
      {/* Call to Action Section */}
      <section className="bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="w-full h-full bg-gradient-to-br from-white/5 to-transparent"></div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="space-y-10">
            <div className="space-y-6">
              <div className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm rounded-full px-6 py-3 border border-white/20">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <span className="text-white font-medium">Trusted by 500+ Healthcare Institutions</span>
              </div>
              <h2 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
                Transform Cancer Detection
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
                  with AI Precision
                </span>
              </h2>
              <p className="text-xl text-slate-200 mb-8 max-w-3xl mx-auto leading-relaxed">
                Join the revolution in medical diagnostics. Experience 97.5% accuracy, real-time analysis, 
                and seamless integration with your existing healthcare infrastructure.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <Button 
                onClick={() => setShowLoginDialog(true)}
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white px-10 py-4 text-lg font-semibold transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-cyan-500/25 group"
              >
                Start Free Trial
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button 
                variant="outline"
                size="lg"
                className="border-2 border-white/30 text-white hover:bg-white/10 hover:border-white/50 px-10 py-4 text-lg font-semibold transition-all duration-300 backdrop-blur-sm"
                onClick={() => setShowDemo(true)}
              >
                <Play className="w-5 h-5 mr-2" />
                View Demo
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 pt-16 border-t border-white/20">
              {[
                { icon: Clock, title: "Quick Setup", desc: "Deploy in under 24 hours" },
                { icon: Shield, title: "Enterprise Security", desc: "HIPAA & SOC 2 compliant" },
                { icon: Users, title: "Expert Support", desc: "24/7 clinical assistance" }
              ].map((item, index) => {
                const IconComponent = item.icon;
                return (
                  <div key={index} className="text-center">
                    <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                      <IconComponent className="w-6 h-6 text-cyan-400" />
                    </div>
                    <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                    <p className="text-slate-300 text-sm">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Mobile Access Section */}
      <section className="bg-slate-900 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white">Access Anywhere</h2>
            <p className="text-xl text-slate-400 max-w-3xl mx-auto">
              Use HAI on your smartphone or tablet for convenient health monitoring
            </p>
          </div>
          
          <div className="flex justify-center">
            <MobileQRAccess />
          </div>
        </div>
      </section>
      
      <Footer />

      <LoginDialog
        open={showLoginDialog}
        onOpenChange={setShowLoginDialog}
        onLoginSuccess={onLoginSuccess}
      />

      <Dialog open={showDemo} onOpenChange={setShowDemo}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <DemoWalkthrough onClose={() => setShowDemo(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
