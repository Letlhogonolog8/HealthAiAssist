import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Heart, 
  Wind, 
  Target, 
  Eye, 
  Activity, 
  Brain,
  ArrowRight,
  Zap
} from "lucide-react";
import SkinCancerAnalyzer from "@/components/skin-cancer-analyzer";
import LungCancerAnalyzer from "@/components/lung-cancer-analyzer";
import MultiCancerDetectionSystem from "@/components/multi-cancer-detection-system";
import BloodTestAnalyzer from "@/components/blood-test-analyzer";
import CancerRiskQuestionnaire from "@/components/cancer-risk-questionnaire";
import MedicalImageViewer from "@/components/medical-image-viewer";
import RealTimeSkinScanner from "@/components/real-time-skin-scanner";

const cancerTypes = [
  {
    id: 'multi-cancer',
    name: 'Multi-Cancer Detection',
    description: 'Comprehensive AI analysis across all cancer types',
    icon: Brain,
    color: 'bg-purple-600',
    features: ['5 Cancer Types', 'PI-RADS Scoring', 'Biomarker Analysis', 'TNM Staging']
  },
  {
    id: 'skin',
    name: 'Skin Cancer Analysis',
    description: 'Advanced dermatoscopy with ABCDE criteria',
    icon: Eye,
    color: 'bg-orange-500',
    features: ['ABCDE Scoring', 'Melanoma Detection', 'Risk Assessment', 'Dermoscopy']
  },
  {
    id: 'skin-scanner',
    name: 'Real-Time Skin Scanner',
    description: 'Live camera-based skin lesion analysis',
    icon: Eye,
    color: 'bg-orange-600',
    features: ['Real-time Analysis', 'Camera Integration', 'ABCDE Scoring', 'Instant Results']
  },
  {
    id: 'lung',
    name: 'Lung Cancer Detection',
    description: 'Chest imaging analysis with Lung-RADS classification',
    icon: Wind,
    color: 'bg-blue-500',
    features: ['Lung-RADS Scoring', 'Nodule Analysis', 'Risk Factors', 'TNM Staging']
  },
  {
    id: 'blood-test',
    name: 'Blood Test Analysis',
    description: 'Comprehensive tumor marker screening',
    icon: Activity,
    color: 'bg-red-500',
    features: ['Tumor Markers', 'Multi-Cancer Detection', 'Risk Assessment', 'Early Detection']
  },
  {
    id: 'risk-questionnaire',
    name: 'Cancer Risk Assessment',
    description: 'Comprehensive health questionnaire and risk analysis',
    icon: Target,
    color: 'bg-indigo-500',
    features: ['Risk Scoring', 'Lifestyle Factors', 'Family History', 'Recommendations']
  },
  {
    id: 'image-viewer',
    name: 'Medical Image Viewer',
    description: 'Advanced medical imaging analysis and visualization',
    icon: Eye,
    color: 'bg-teal-500',
    features: ['Image Enhancement', 'Zoom & Pan', 'Measurement Tools', 'Analysis Overlay']
  },
  {
    id: 'breast',
    name: 'Breast Cancer Screening',
    description: 'Mammography analysis with BI-RADS classification',
    icon: Heart,
    color: 'bg-pink-500',
    features: ['BI-RADS Scoring', 'Mass Detection', 'Density Analysis', 'Biomarkers']
  },
  {
    id: 'prostate',
    name: 'Prostate Cancer Analysis',
    description: 'MRI analysis with PI-RADS scoring system',
    icon: Target,
    color: 'bg-purple-500',
    features: ['PI-RADS Scoring', 'PSA Correlation', 'MRI Analysis', 'Risk Stratification']
  },
  {
    id: 'cervical',
    name: 'Cervical Cancer Screening',
    description: 'Pap smear and colposcopy analysis',
    icon: Activity,
    color: 'bg-green-500',
    features: ['Pap Analysis', 'HPV Detection', 'Cytology Review', 'Risk Assessment']
  }
];

export default function CancerDetection() {
  const [selectedType, setSelectedType] = useState('multi-cancer');

  const getAnalyzerComponent = () => {
    switch (selectedType) {
      case 'skin':
        return <SkinCancerAnalyzer />;
      case 'skin-scanner':
        return <RealTimeSkinScanner />;
      case 'lung':
        return <LungCancerAnalyzer />;
      case 'blood-test':
        return <BloodTestAnalyzer />;
      case 'risk-questionnaire':
        return <CancerRiskQuestionnaire user={null} />;
      case 'image-viewer':
        return <MedicalImageViewer imageFile={null} />;
      case 'multi-cancer':
      default:
        return <MultiCancerDetectionSystem />;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          AI-Powered Cancer Detection Platform
        </h1>
        <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
          Advanced medical imaging analysis using cutting-edge artificial intelligence for early cancer detection and diagnosis across multiple organ systems.
        </p>
        <div className="flex justify-center gap-4">
          <Badge variant="outline" className="bg-green-50 text-green-800 border-green-300">
            <Zap className="w-4 h-4 mr-1" />
            Real-time Analysis
          </Badge>
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-300">
            Screening triage only
          </Badge>
          <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300">
            Not a medical device
          </Badge>
        </div>
      </div>

      <Tabs value={selectedType} onValueChange={setSelectedType} className="space-y-6">
        <div className="space-y-6">
          {/* Cancer Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Select Cancer Detection Type</CardTitle>
              <CardDescription>
                Choose the specific cancer analysis based on your medical imaging or screening needs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cancerTypes.map((type) => {
                  const IconComponent = type.icon;
                  return (
                    <Card 
                      key={type.id}
                      className={`cursor-pointer transition-all duration-200 hover:shadow-lg transform hover:scale-105 ${
                        selectedType === type.id 
                          ? 'ring-2 ring-blue-500 bg-blue-50 shadow-lg' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedType(type.id)}
                    >
                      <CardContent className="p-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className={`p-3 rounded-lg ${type.color} text-white`}>
                              <IconComponent className="w-6 h-6" />
                            </div>
                            {/* This badge used to show a hardcoded accuracy per tool
                                (98.5%, 96.8%, 95.2% ...). None was measured. Real,
                                reproducible figures live on the home page and in
                                MODEL_CARDS.md, read from /api/models/cards. */}
                            <Badge variant="outline" className="bg-slate-100 text-slate-700">
                              Screening triage
                            </Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold text-lg mb-2">{type.name}</h3>
                            <p className="text-sm text-muted-foreground mb-3">{type.description}</p>
                            <div className="space-y-1">
                              {type.features.map((feature, index) => (
                                <div key={index} className="flex items-center text-xs text-muted-foreground">
                                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-2" />
                                  {feature}
                                </div>
                              ))}
                            </div>
                          </div>
                          {selectedType === type.id && (
                            <Button className="w-full" size="sm">
                              <ArrowRight className="w-4 h-4 mr-2" />
                              Start Analysis
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Selected Analyzer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {(() => {
                  const selectedCancer = cancerTypes.find(t => t.id === selectedType);
                  const IconComponent = selectedCancer?.icon || Brain;
                  return (
                    <>
                      <IconComponent className="w-5 h-5" />
                      {selectedCancer?.name || 'Multi-Cancer Detection'}
                    </>
                  );
                })()}
              </CardTitle>
              <CardDescription>
                {cancerTypes.find(t => t.id === selectedType)?.description || 'Advanced AI analysis'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {getAnalyzerComponent()}
            </CardContent>
          </Card>
        </div>
      </Tabs>

      {/* Footer Information */}
      <Card className="bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            {/* Previously claimed "FDA Approved Technology" and validation across
                "100,000+ medical images with radiologist verification". Neither is
                true: there is no regulatory clearance, and the models were evaluated
                on 660 and 1,244 research images with no radiologist adjudication. */}
            <div>
              <h3 className="font-semibold text-lg mb-2">No regulatory clearance</h3>
              <p className="text-sm text-muted-foreground">
                Not a registered medical device in any jurisdiction. A research
                prototype for screening triage, not for clinical decisions.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">Evaluation, not validation</h3>
              <p className="text-sm text-muted-foreground">
                Measured retrospectively on held-out research images — 660 for skin,
                1,244 for lung. No prospective study and no clinical validation. See
                MODEL_CARDS.md for the figures and their limits.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">Access controlled</h3>
              <p className="text-sm text-muted-foreground">
                Role-based access with session authentication, and every genomic data
                access recorded in an audit log. No compliance certification is
                claimed.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}