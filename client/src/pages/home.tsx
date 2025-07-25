import { useState } from "react";
import Navigation from "@/components/navigation";
import EnhancedHeroSection from "@/components/enhanced-hero-section";

import AIFeaturesSection from "@/components/ai-features-section";
import CancerDetectionSection from "@/components/cancer-detection-section";
import AIScanSimulator from "@/components/ai-scan-simulator-fixed";
import MedicalVisualization3D from "@/components/3d-medical-visualization";
import MobileQRAccess from "@/components/mobile-qr-access";
import Footer from "@/components/footer";
import LoginDialog from "@/components/login-dialog";

interface HomeProps {
  onLoginSuccess: (user: any) => void;
}

export default function Home({ onLoginSuccess, userId }: HomeProps & { userId?: number }) {
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900">
      <Navigation onLoginSuccess={onLoginSuccess} />
      <EnhancedHeroSection onLoginClick={() => setShowLoginDialog(true)} />
      
      {/* Enhanced AI Demo Section */}
      <section className="bg-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white">Experience AI in Action</h2>
            <p className="text-xl text-slate-400 max-w-3xl mx-auto">
              Interactive demonstrations of our cutting-edge cancer detection technology
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <AIScanSimulator userId={userId} />
            <MedicalVisualization3D />
          </div>
        </div>
      </section>

      <AIFeaturesSection />
      <CancerDetectionSection />
      
      {/* Mobile Access Section */}
      <section className="bg-slate-900 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white">Access on Mobile</h2>
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
    </div>
  );
}
