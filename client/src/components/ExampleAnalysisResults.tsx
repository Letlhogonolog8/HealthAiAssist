import React from 'react';
import { AnalysisResultsDisplay } from './AnalysisResultsDisplay';

export const ExampleAnalysisResults: React.FC = () => {
  const sampleAnalysisData = {
    title: "Analysis Results",
    subtitle: "Health AI-powered medical image analysis completed",
    confidence: 85,
    riskLevel: 'low' as const,
    primaryFinding: "Normal",
    cancerType: "abnormal findings Cancer",
    scanType: "mri",
    analysisDate: "01/08/2025, 12:36:34",
    scanId: "#527",
    detailedFindings: [
      "Comprehensive AI analysis completed with high precision",
      "Image quality assessment shows optimal resolution",
      "Anatomical structures clearly identified and analyzed",
      "No significant abnormalities detected in target regions",
      "Tissue characterization within normal parameters"
    ],
    recommendations: [
      "Continue routine screening as recommended",
      "Maintain current preventive care protocols",
      "Follow-up imaging per established guidelines",
      "Patient education on risk factor management"
    ],
    additionalInfo: "Google Cloud analysis shows normal patterns"
  };

  return <AnalysisResultsDisplay analysisData={sampleAnalysisData} />;
};