import { Heart, Mail, Phone, MapPin } from "lucide-react";

export default function Footer() {
  const footerSections = [
    {
      title: "Platform",
      links: [
        "AI Performance",
        "Cancer Detection", 
        "Risk Assessment",
        "Mobile Access"
      ]
    },
    {
      title: "Resources",
      links: [
        "Documentation",
        "Research Papers",
        "Clinical Studies", 
        "Support"
      ]
    }
  ];

  const contactInfo = [
    { icon: Mail, text: "letlhogonolo@hai.health" },
    { icon: Phone, text: "0734801556" },
    { icon: MapPin, text: "Medical AI Center" }
  ];

  return (
    <footer className="bg-slate-800 border-t border-slate-700 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Heart className="h-8 w-8 text-cyan-500" />
              <span className="text-xl font-bold text-white">HAI</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Advanced AI technology for comprehensive cancer detection and early intervention.
            </p>
          </div>
          
          {footerSections.map((section) => (
            <div key={section.title} className="space-y-4">
              <h4 className="text-lg font-semibold text-white">{section.title}</h4>
              <ul className="space-y-2 text-slate-400">
                {section.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="hover:text-white transition-colors duration-200">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-white">Contact</h4>
            <ul className="space-y-2 text-slate-400">
              {contactInfo.map((info, index) => {
                const IconComponent = info.icon;
                return (
                  <li key={index} className="flex items-center space-x-2">
                    <IconComponent className="w-4 h-4" />
                    <span>{info.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        
        <div className="border-t border-slate-700 mt-8 pt-8 text-center">
          <p className="text-slate-400">
            &copy; 2024 HAI. All rights reserved. | Advancing healthcare through artificial intelligence.
          </p>
        </div>
      </div>
    </footer>
  );
}
