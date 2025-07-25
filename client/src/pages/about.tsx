import Navigation from "@/components/navigation";
import AboutAISection from "@/components/about-ai-section";
import Footer from "@/components/footer";

interface AboutProps {
  onLoginSuccess: (user: any) => void;
}

export default function About({ onLoginSuccess }: AboutProps) {
  return (
    <div className="min-h-screen bg-slate-900">
      <Navigation onLoginSuccess={onLoginSuccess} />
      <div className="pt-16">
        <AboutAISection />
      </div>
      <Footer />
    </div>
  );
}
