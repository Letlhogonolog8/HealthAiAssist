import { Heart, Stethoscope, Sun, User, Activity } from "lucide-react";

export default function CancerDetectionSection() {
  const cancerTypes = [
    {
      icon: Heart,
      title: "Breast Cancer",
      description: "Advanced mammogram analysis with 94% accuracy in detecting early-stage lesions, significantly improving early diagnosis rates.",
      gradient: "from-red-500 to-pink-600",
      textColor: "text-pink-100"
    },
    {
      icon: Stethoscope,
      title: "Lung Cancer", 
      description: "CT scan analysis that can detect nodules as small as 3mm with high precision, enabling earlier intervention.",
      gradient: "from-blue-500 to-cyan-600",
      textColor: "text-blue-100"
    },
    {
      icon: Sun,
      title: "Skin Cancer",
      description: "Image recognition that distinguishes between seborrheic keratoses and precancerous melanoma with superior accuracy.",
      gradient: "from-yellow-500 to-orange-600", 
      textColor: "text-yellow-100"
    },
    {
      icon: User,
      title: "Prostate Cancer",
      description: "Multiparametric MRI analysis for accurate risk lesion detection, reducing unnecessary biopsies by 40%.",
      gradient: "from-purple-500 to-indigo-600",
      textColor: "text-purple-100"
    },
    {
      icon: Activity,
      title: "Cervical Cancer",
      description: "Pap smear and colposcopy analysis with HPV detection, enabling early intervention and prevention.",
      gradient: "from-green-500 to-teal-600",
      textColor: "text-green-100"
    }
  ];

  return (
    <section id="detection" className="bg-slate-800 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white">Multi-Cancer Detection System</h2>
          <p className="text-xl text-slate-400 max-w-3xl mx-auto">Specialized AI models for five major cancer types</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {cancerTypes.map((cancer) => {
            const IconComponent = cancer.icon;
            return (
              <div key={cancer.title} className={`bg-gradient-to-br ${cancer.gradient} p-8 rounded-xl text-white hover:shadow-2xl transition-all duration-300 transform hover:scale-105`}>
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-white bg-opacity-20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <IconComponent className="w-6 h-6 text-white" />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-2xl font-bold">{cancer.title}</h3>
                    <p className={`${cancer.textColor} leading-relaxed`}>
                      {cancer.description}
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
