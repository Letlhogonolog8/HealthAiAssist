import { useState, useEffect } from "react";
import { TrendingUp, Users, Globe, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AboutAISection() {
  interface Benefit {
    icon: React.ComponentType<any>;
    title: string;
    color: string;
    items: string[];
  }

  const [benefits, setBenefits] = useState<Benefit[]>([]);

  useEffect(() => {
    async function fetchBenefits() {
      // Replace with real API call or data subscription
      const fetchedBenefits: Benefit[] = [
        {
          icon: TrendingUp,
          title: "Advanced Multi-Cancer Detection",
          color: "text-blue-500",
          items: [
            "ResNet50V2 Deep Learning: Our trained model achieves 96% accuracy in skin cancer detection with real-time analysis",
            "Multi-Modal Analysis: Supports breast, lung, skin, colon, and prostate cancer detection from medical imaging",
            "Real-Time Processing: Instant AI analysis with detailed findings, risk assessment, and clinical recommendations",
          ],
        },
        {
          icon: Users,
          title: "Enhanced Clinical Workflow",
          color: "text-green-500",
          items: [
            "Role-Based Dashboards: Specialized interfaces for admins, doctors, radiologists, and patients",
            "Automated Reporting: AI generates comprehensive reports with confidence scores and malignancy indicators",
            "Integrated Communication: Built-in chat system and appointment scheduling for seamless care coordination",
          ],
        },
        {
          icon: Globe,
          title: "Accessible Healthcare Technology",
          color: "text-cyan-500",
          items: [
            "Web-Based Platform: No special hardware required - accessible from any modern web browser",
            "Multi-Language Support: Medical translation features for diverse patient populations",
            "Telemedicine Integration: Remote consultations with AI-powered analysis and dermatologist finder",
          ],
        },
      ];
      setBenefits(fetchedBenefits);
    }
    fetchBenefits();
  }, []);

  return (
    <section id="about" className="bg-slate-900 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            HealthAI Assistant: Advanced Cancer Detection Platform
          </h2>
          <p className="text-xl text-slate-400 max-w-4xl mx-auto">
            Our comprehensive AI-powered platform revolutionizes cancer detection with multi-modal analysis,
            real-time processing, and integrated healthcare workflows
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-8">
            {benefits.map((benefit) => {
              const IconComponent = benefit.icon;
              return (
                <div
                  key={benefit.title}
                  className="bg-gradient-to-br from-slate-800 to-slate-700 p-8 rounded-xl border border-slate-600"
                >
                  <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
                    <IconComponent
                      className={`${benefit.color} mr-3 w-8 h-8`}
                    />
                    {benefit.title}
                  </h3>
                  <div className="space-y-4 text-slate-300">
                    {benefit.items.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-start space-x-3"
                      >
                        <div
                          className={`w-2 h-2 ${benefit.color.replace(
                            "text-",
                            "bg-"
                          )} rounded-full mt-2 flex-shrink-0`}
                        ></div>
                        <p>{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-8">
            {/* Call to Action */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-8 rounded-xl text-white">
              <h3 className="text-2xl font-bold mb-4 flex items-center">
                <Rocket className="mr-3 w-8 h-8" />
                Ready for Implementation
              </h3>
              <p className="text-blue-100 mb-6 leading-relaxed">
                Our platform is production-ready with comprehensive security,
                performance monitoring, and clinical-grade AI models. Start
                improving patient outcomes with advanced cancer detection today.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button className="bg-white text-blue-800 hover:bg-slate-100">
                  Start Free Trial
                </Button>
                <Button
                  variant="outline"
                  className="border-white text-white hover:bg-white hover:text-blue-800"
                >
                  View Demo
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
