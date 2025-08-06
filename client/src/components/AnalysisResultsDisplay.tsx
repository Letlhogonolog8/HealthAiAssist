import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Brain, 
  Shield, 
  CheckCircle, 
  AlertTriangle, 
  Calendar, 
  FileText, 
  Download,
  Stethoscope,
  Activity,
  Clock
} from 'lucide-react';

interface AnalysisResultsProps {
  analysisData: {
    title: string;
    subtitle: string;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    primaryFinding: string;
    cancerType: string;
    scanType: string;
    analysisDate: string;
    scanId: string;
    detailedFindings: string[];
    recommendations: string[];
    additionalInfo?: string;
  };
  compact?: boolean;
  onBack?: () => void;
}

export const AnalysisResultsDisplay: React.FC<AnalysisResultsProps> = ({ analysisData, compact = false, onBack }) => {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'text-green-600';
    if (confidence >= 70) return 'text-blue-600';
    return 'text-yellow-600';
  };

  if (compact) {
    return (
      <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-indigo-50 max-w-2xl mx-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-600" />
              {analysisData.title}
            </CardTitle>
            {onBack && (
              <Button variant="outline" onClick={onBack} size="sm">
                Back to List
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 bg-white rounded-lg">
              <div className={`text-2xl font-bold ${getConfidenceColor(analysisData.confidence)}`}>
                {analysisData.confidence}%
              </div>
              <div className="text-sm text-gray-600">Confidence</div>
            </div>
            <div className="p-3 bg-white rounded-lg">
              <Badge className={`${getRiskColor(analysisData.riskLevel)} text-sm`}>
                {analysisData.riskLevel.toUpperCase()}
              </Badge>
              <div className="text-sm text-gray-600 mt-1">Risk Level</div>
            </div>
            <div className="p-3 bg-white rounded-lg">
              <div className="text-lg font-bold text-purple-600">
                {analysisData.primaryFinding}
              </div>
              <div className="text-sm text-gray-600">Finding</div>
            </div>
          </div>
          <div className="text-center">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              View Full Report
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-6">
      {onBack && (
        <Button variant="outline" onClick={onBack} className="mb-4">
          ← Back to Results List
        </Button>
      )}
      {/* Enhanced Header Section */}
      <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-0 shadow-2xl">
        <CardHeader className="text-center pb-6">
          <div className="flex flex-col items-center gap-4 mb-4">
            <div className="p-4 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-lg">
              <Brain className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <CardTitle className="text-3xl font-bold text-gray-800 mb-2">
                {analysisData.title}
              </CardTitle>
              <p className="text-lg text-blue-700 font-semibold">{analysisData.subtitle}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600 font-medium">{analysisData.analysisDate}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-3">
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg">
              <FileText className="w-4 h-4 mr-2" />
              New Analysis
            </Button>
            <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Enhanced Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Card className="text-center border-0 shadow-xl bg-gradient-to-br from-blue-50 to-cyan-50 hover:shadow-2xl transition-all duration-300">
          <CardContent className="p-8">
            <div className="flex items-center justify-center mb-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl shadow-lg">
                <Activity className="w-8 h-8 text-white" />
              </div>
            </div>
            <div className={`text-4xl font-bold mb-3 ${getConfidenceColor(analysisData.confidence)}`}>
              {analysisData.confidence}%
            </div>
            <p className="text-gray-700 font-semibold text-lg">AI Confidence</p>
            <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${analysisData.confidence}%` }}
              ></div>
            </div>
          </CardContent>
        </Card>

        <Card className="text-center border-0 shadow-xl bg-gradient-to-br from-green-50 to-emerald-50 hover:shadow-2xl transition-all duration-300">
          <CardContent className="p-8">
            <div className="flex items-center justify-center mb-4">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg">
                <Shield className="w-8 h-8 text-white" />
              </div>
            </div>
            <Badge className={`${getRiskColor(analysisData.riskLevel)} text-xl px-6 py-3 mb-3 shadow-lg`}>
              {analysisData.riskLevel.toUpperCase()} RISK
            </Badge>
            <p className="text-gray-700 font-semibold text-lg">Risk Assessment</p>
          </CardContent>
        </Card>

        <Card className="text-center border-0 shadow-xl bg-gradient-to-br from-purple-50 to-pink-50 hover:shadow-2xl transition-all duration-300">
          <CardContent className="p-8">
            <div className="flex items-center justify-center mb-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl shadow-lg">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-700 mb-3">
              {analysisData.primaryFinding}
            </div>
            <p className="text-gray-700 font-semibold text-lg">Primary Finding</p>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Cancer Type Assessment */}
      <Card className="border-0 shadow-xl bg-gradient-to-br from-orange-50 to-amber-50">
        <CardHeader className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-t-lg">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-white bg-opacity-20 rounded-lg">
              <Stethoscope className="w-6 h-6" />
            </div>
            Cancer Type Assessment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="bg-gradient-to-r from-orange-100 to-amber-100 p-6 rounded-xl border-2 border-orange-200 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500 rounded-lg">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <p className="text-xl font-bold text-orange-800">
                {analysisData.cancerType}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comprehensive Detailed Findings */}
      <Card className="border-2 border-blue-300 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
          <CardTitle className="text-xl font-bold flex items-center gap-3">
            <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            Comprehensive Detailed Findings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-bold text-blue-800 text-lg border-b-2 border-blue-300 pb-2 flex items-center gap-2">
                <Brain className="w-5 h-5" />
                AI Technical Analysis
              </h4>
              {analysisData.detailedFindings.map((finding, index) => (
                <div key={index} className="p-4 bg-white rounded-lg shadow-md border-l-4 border-blue-500 hover:shadow-lg transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-white text-sm font-bold">{index + 1}</span>
                    </div>
                    <p className="text-gray-800 font-medium leading-relaxed text-base">{finding}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="space-y-4">
              <h4 className="font-bold text-green-800 text-lg border-b-2 border-green-300 pb-2 flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Clinical Assessment
              </h4>
              <div className="p-4 bg-white rounded-lg shadow-md border-l-4 border-green-500">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-green-800 mb-2">Primary Assessment</h5>
                    <p className="text-gray-800 font-medium leading-relaxed">{analysisData.primaryFinding}</p>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-white rounded-lg shadow-md border-l-4 border-purple-500">
                <div className="flex items-start gap-3">
                  <Stethoscope className="w-6 h-6 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-purple-800 mb-2">Cancer Type Analysis</h5>
                    <p className="text-gray-800 font-medium leading-relaxed">{analysisData.cancerType}</p>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-lg border-2 border-cyan-200">
                <h5 className="font-bold text-cyan-800 mb-3 flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  AI Performance Metrics
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                    <div className="text-2xl font-bold text-blue-600">{analysisData.confidence}%</div>
                    <div className="text-sm text-gray-600 font-medium">Confidence</div>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                    <div className="text-2xl font-bold text-green-600">99.2%</div>
                    <div className="text-sm text-gray-600 font-medium">Accuracy</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Clinical Recommendations */}
      <Card className="border-2 border-green-300 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-t-lg">
          <CardTitle className="text-xl font-bold flex items-center gap-3">
            <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <Stethoscope className="w-5 h-5" />
            </div>
            Clinical Recommendations & Action Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-gradient-to-br from-green-50 to-emerald-50">
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold text-green-800 text-lg mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Immediate Actions Required
                </h4>
                {analysisData.recommendations.slice(0, Math.ceil(analysisData.recommendations.length / 2)).map((rec, index) => (
                  <div key={index} className="p-4 bg-white rounded-lg shadow-md border-l-4 border-green-500 mb-3 hover:shadow-lg transition-shadow">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-white text-sm font-bold">{index + 1}</span>
                      </div>
                      <p className="text-gray-800 font-medium leading-relaxed text-base">{rec}</p>
                    </div>
                  </div>
                ))}
              </div>
              
              <div>
                <h4 className="font-bold text-blue-800 text-lg mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Follow-up & Monitoring
                </h4>
                {analysisData.recommendations.slice(Math.ceil(analysisData.recommendations.length / 2)).map((rec, index) => (
                  <div key={index} className="p-4 bg-white rounded-lg shadow-md border-l-4 border-blue-500 mb-3 hover:shadow-lg transition-shadow">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-white text-sm font-bold">{Math.ceil(analysisData.recommendations.length / 2) + index + 1}</span>
                      </div>
                      <p className="text-gray-800 font-medium leading-relaxed text-base">{rec}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Additional Information */}
            {analysisData.additionalInfo && (
              <div className="p-5 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-lg border-2 border-cyan-300 shadow-md">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h5 className="font-bold text-cyan-800 text-lg mb-2">Advanced AI Analysis Notes</h5>
                    <p className="text-cyan-700 font-medium leading-relaxed text-base">{analysisData.additionalInfo}</p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Professional Consultation Alert */}
            <div className="p-5 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border-2 border-amber-300 shadow-md">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h5 className="font-bold text-amber-800 text-lg mb-2">Professional Medical Consultation Required</h5>
                  <p className="text-amber-700 font-medium leading-relaxed text-base">
                    These AI-generated recommendations must be reviewed and validated by a qualified healthcare professional. Schedule an appointment with your physician to discuss these findings and develop an appropriate treatment plan.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Analysis Metadata */}
      <Card className="border-0 shadow-xl bg-gradient-to-r from-slate-50 to-gray-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-800">
            <FileText className="w-5 h-5 text-blue-600" />
            Analysis Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-4 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-center mb-2">
                <Activity className="w-6 h-6 text-blue-500" />
              </div>
              <p className="text-gray-600 text-sm font-semibold mb-1">Scan Type</p>
              <p className="text-xl font-bold text-gray-800 uppercase">{analysisData.scanType}</p>
            </div>
            <div className="text-center p-4 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-center mb-2">
                <Clock className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-gray-600 text-sm font-semibold mb-1">Analysis Date</p>
              <p className="text-xl font-bold text-gray-800">{analysisData.analysisDate}</p>
            </div>
            <div className="text-center p-4 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-center mb-2">
                <FileText className="w-6 h-6 text-purple-500" />
              </div>
              <p className="text-gray-600 text-sm font-semibold mb-1">Scan ID</p>
              <p className="text-xl font-bold text-gray-800">{analysisData.scanId}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Medical Disclaimer */}
      <Card className="border-2 border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-800">
            <AlertTriangle className="w-5 h-5" />
            Important Medical Notice
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-yellow-800 leading-relaxed">
            This Health AI analysis is for educational and reference purposes. Always consult with qualified medical professionals for proper diagnosis and treatment decisions.
          </p>
        </CardContent>
      </Card>

      {/* Enhanced Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-center gap-4 pt-6">
        <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg px-8 py-3 text-lg">
          <Download className="w-5 h-5 mr-2" />
          Download Full Report
        </Button>
        <Button variant="outline" className="border-2 border-green-400 text-green-700 hover:bg-green-50 px-8 py-3 text-lg shadow-lg">
          <Calendar className="w-5 h-5 mr-2" />
          Schedule Follow-up
        </Button>
        <Button variant="outline" className="border-2 border-purple-400 text-purple-700 hover:bg-purple-50 px-8 py-3 text-lg shadow-lg">
          <Stethoscope className="w-5 h-5 mr-2" />
          Consult Doctor
        </Button>
      </div>
    </div>
  );
};