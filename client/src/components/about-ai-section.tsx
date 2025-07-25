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
          title: "Improved Diagnostic Accuracy",
          color: "text-blue-500",
          items: [
            "Mammography Enhancement: AI algorithms reduce false negatives by 20-30% and achieve 94.5% accuracy in breast cancer detection",
            "Risk Prediction: The Mirai algorithm predicts 5-year breast cancer risk using mammograms, outperforming traditional clinical models",
            "Longitudinal Tracking: AI compares current scans with prior images to detect subtle changes over time",
          ],
        },
        {
          icon: Users,
          title: "Reducing Radiologist Workload",
          color: "text-green-500",
          items: [
            "Prioritization: AI flags high-risk scans for urgent review, ensuring critical cases are addressed first",
            "Second Opinions: Tools like ProFound AI® provide confidence scores and lesion annotations",
            "Human-AI Collaboration: AI augments—not replaces—radiologists, improving overall diagnostic accuracy",
          ],
        },
        {
          icon: Globe,
          title: "Democratizing Access",
          color: "text-cyan-500",
          items: [
            "Low-Resource Settings: Portable AI tools bring screening to underserved regions",
            "Mobile Solutions: Butterfly iQ+ device uses AI to assist non-specialists in performing breast exams",
            "Bias Mitigation: DREAM Challenge trains AI models with diverse datasets for accuracy across all demographics",
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
            Why AI Implementation in Hospitals is Critical
          </h2>
          <p className="text-xl text-slate-400 max-w-4xl mx-auto">
            AI technology should be implemented rapidly in hospitals, with
            regulations helping rather than hindering this life-saving advancement
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
                Regulatory Support Needed
              </h3>
              <p className="text-blue-100 mb-6 leading-relaxed">
                Regulations should facilitate rapid AI implementation in
                healthcare, not create barriers. Every delay costs lives that
                could be saved through earlier detection and more accurate
                diagnosis.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button className="bg-white text-blue-800 hover:bg-slate-100">
                  Learn More About Implementation
                </Button>
                <Button
                  variant="outline"
                  className="border-white text-white hover:bg-white hover:text-blue-800"
                >
                  Contact Healthcare Regulators
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
