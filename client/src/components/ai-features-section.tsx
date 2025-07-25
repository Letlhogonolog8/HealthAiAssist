import { Microscope, TrendingUp, Smartphone } from "lucide-react";

export default function AIFeaturesSection() {
  const features = [
    {
      icon: Microscope,
      title: "Advanced Imaging Analysis",
      description: "AI algorithms analyze medical images to detect subtle patterns and microcalcifications that may indicate early-stage tumors, reducing false negatives by up to 30%.",
      color: "bg-blue-600"
    },
    {
      icon: TrendingUp,
      title: "Personalized Risk Assessment", 
      description: "Our models analyze genetic data, family history, and lifestyle factors to predict individual risk of developing cancer, enabling personalized screening schedules.",
      color: "bg-purple-600"
    },
    {
      icon: Smartphone,
      title: "Mobile Access",
      description: "Fast ready mobile application with offline capabilities for remote screening in underserved areas, democratizing access to advanced medical consultation and immediate data collection.",
      color: "bg-cyan-600"
    }
  ];

  return (
    <section id="ai-features-section" className="bg-slate-900 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white">AI-Powered Cancer Detection</h2>
          <p className="text-xl text-slate-400 max-w-3xl mx-auto">Combining clinical expertise with cutting-edge technology</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature) => {
            const IconComponent = feature.icon;
            return (
              <div key={feature.title} className="bg-gradient-to-br from-slate-800 to-slate-700 p-8 rounded-xl border border-slate-600 hover:border-blue-500 transition-all duration-300">
                <div className="space-y-6">
                  <div className={`w-16 h-16 ${feature.color} rounded-lg flex items-center justify-center`}>
                    <IconComponent className="w-8 h-8 text-white" />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-xl font-semibold text-white">{feature.title}</h3>
                    <p className="text-slate-300 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
