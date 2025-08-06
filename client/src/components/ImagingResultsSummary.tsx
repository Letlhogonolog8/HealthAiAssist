import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Calendar,
  AlertTriangle,
  CheckCircle,
  Brain,
  BarChart3
} from 'lucide-react';

interface ImagingResult {
  id: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  analysisDate: string;
  hasCancer: boolean;
  scanType: string;
}

interface ImagingResultsSummaryProps {
  results: ImagingResult[];
  onViewAll: () => void;
}

export default function ImagingResultsSummary({ results, onViewAll }: ImagingResultsSummaryProps) {
  const recentResults = results.slice(0, 3);
  const highRiskCount = results.filter(r => r.riskLevel === 'high').length;
  const abnormalCount = results.filter(r => r.hasCancer).length;
  const avgConfidence = results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.confidence, 0) / results.length) : 0;

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  if (results.length === 0) {
    return (
      <Card className="shadow-lg border-0 bg-gradient-to-r from-gray-50 to-slate-50">
        <CardContent className="text-center py-8">
          <Brain className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-600 mb-2">No Analysis Results Yet</h3>
          <p className="text-gray-500">Upload and analyze medical images to see results here</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <BarChart3 className="w-6 h-6 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-blue-600">{results.length}</div>
            <div className="text-sm text-gray-600">Total Scans</div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
            <div className="text-2xl font-bold text-green-600">{avgConfidence}%</div>
            <div className="text-sm text-gray-600">Avg Confidence</div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-pink-50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div className="text-2xl font-bold text-red-600">{highRiskCount}</div>
            <div className="text-sm text-gray-600">High Risk</div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-indigo-50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <CheckCircle className="w-6 h-6 text-purple-600" />
            </div>
            <div className="text-2xl font-bold text-purple-600">{abnormalCount}</div>
            <div className="text-sm text-gray-600">Abnormal</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Results */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              Recent Analysis Results
            </CardTitle>
            <Button variant="outline" onClick={onViewAll} size="sm">
              View All ({results.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentResults.map((result, index) => (
            <div key={result.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-blue-600">{index + 1}</span>
                </div>
                <div>
                  <div className="font-medium text-gray-800">{result.scanType.toUpperCase()}</div>
                  <div className="text-sm text-gray-600">
                    {new Date(result.analysisDate).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-800">{result.confidence}%</div>
                  <div className="text-xs text-gray-600">Confidence</div>
                </div>
                <Badge className={`${getRiskColor(result.riskLevel)} text-xs`}>
                  {result.riskLevel.toUpperCase()}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}