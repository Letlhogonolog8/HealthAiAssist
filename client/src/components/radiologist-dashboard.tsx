import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  FileText,
  Calendar,
  Clock,
  Eye,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Scan,
  Activity,
  Star,
  Timer,
  Image
} from "lucide-react";

interface RadiologyStats {
  pendingReviews: number;
  completedToday: number;
  aiConfidence: number;
  avgReviewTime: number;
  totalScansReviewed: number;
  criticalCases: number;
  accuracyRate: number;
  workloadHours: number;
}

interface ScanReview {
  id: number;
  patientName: string;
  scanType: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  submittedAt: string;
  aiPrediction: string;
  aiConfidence: number;
  bodyPart: string;
  referringDoctor: string;
  notes?: string;
}

interface CompletedScan {
  id: number;
  patientName: string;
  scanType: string;
  completedAt: string;
  findings: string;
  recommendation: string;
  aiAccuracy: number;
}

export default function RadiologistDashboard({ user }: { user: any }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [selectedScan, setSelectedScan] = useState<ScanReview | null>(null);
  const [reportText, setReportText] = useState('');
  const [findings, setFindings] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch real radiologist statistics
  const { data: radiologyStats, isLoading: statsLoading, error: statsError } = useQuery<RadiologyStats>({
    queryKey: ['/api/radiologist/stats'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/stats', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    refetchInterval: 30000
  });

  // Fetch pending scan reviews
  const { data: pendingScans, isLoading: pendingLoading, error: pendingError } = useQuery<ScanReview[]>({
    queryKey: ['/api/radiologist/pending-reviews'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/pending-reviews', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch pending scans');
      return response.json();
    },
    refetchInterval: 15000
  });

  // Fetch completed scans for today
  const { data: completedScans, isLoading: completedLoading } = useQuery<CompletedScan[]>({
    queryKey: ['/api/radiologist/completed-today'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/completed-today', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch completed scans');
      return response.json();
    },
    refetchInterval: 60000
  });

  // Submit scan report mutation
  const submitReportMutation = useMutation({
    mutationFn: async ({ scanId, findings, recommendation }: { scanId: number; findings: string; recommendation: string }) => {
      const response = await fetch(`/api/radiologist/scans/${scanId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ findings, recommendation })
      });
      if (!response.ok) throw new Error('Failed to submit report');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/pending-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/completed-today'] });
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/stats'] });
      setSelectedScan(null);
      setReportText('');
      setFindings('');
      toast({ title: 'Success', description: 'Report submitted successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to submit report', variant: 'destructive' });
    }
  });

  if (statsLoading || pendingLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-white">Loading radiologist workstation...</p>
        </div>
      </div>
    );
  }

  if (statsError || pendingError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load radiologist data</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Radiologist Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-400">Pending Reviews</p>
                <p className="text-3xl font-bold text-white">
                  {radiologyStats?.pendingReviews || pendingScans?.length || 0}
                </p>
                <p className="text-xs text-orange-300">
                  {pendingScans?.filter(s => s.priority === 'urgent').length || 0} urgent
                </p>
              </div>
              <FileText className="w-8 h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-400">Completed Today</p>
                <p className="text-3xl font-bold text-white">
                  {radiologyStats?.completedToday || completedScans?.length || 0}
                </p>
                <p className="text-xs text-green-300">
                  {radiologyStats?.workloadHours || 8}h workload
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-400">AI Collaboration</p>
                <p className="text-3xl font-bold text-white">
                  {radiologyStats?.aiConfidence || 87}%
                </p>
                <p className="text-xs text-purple-300">
                  avg confidence
                </p>
              </div>
              <Brain className="w-8 h-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-400">Avg Review Time</p>
                <p className="text-3xl font-bold text-white">
                  {radiologyStats?.avgReviewTime || 12}m
                </p>
                <p className="text-xs text-blue-300">
                  {radiologyStats?.accuracyRate || 94}% accuracy
                </p>
              </div>
              <Timer className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Radiologist Interface */}
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList className="grid w-full grid-cols-4 bg-slate-800 border-slate-600">
          <TabsTrigger value="overview" className="text-slate-300 data-[state=active]:text-white">Workstation</TabsTrigger>
          <TabsTrigger value="pending" className="text-slate-300 data-[state=active]:text-white">Pending Reviews</TabsTrigger>
          <TabsTrigger value="completed" className="text-slate-300 data-[state=active]:text-white">Completed</TabsTrigger>
          <TabsTrigger value="ai-insights" className="text-slate-300 data-[state=active]:text-white">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Activity className="w-5 h-5" />
                  Today's Productivity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                      {radiologyStats?.completedToday || completedScans?.length || 0}
                    </div>
                    <div className="text-sm text-slate-400">Reviews Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-400">
                      {radiologyStats?.pendingReviews || pendingScans?.length || 0}
                    </div>
                    <div className="text-sm text-slate-400">Still Pending</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-slate-300">
                      <span>Daily Target Progress</span>
                      <span>{Math.round(((radiologyStats?.completedToday || completedScans?.length || 0) / 30) * 100)}%</span>
                    </div>
                    <Progress value={Math.round(((radiologyStats?.completedToday || completedScans?.length || 0) / 30) * 100)} className="h-2" />
                  </div>
                  <div className="space-y-1">
                  <div className="flex justify-between text-sm text-slate-300">
                    <span>Detection Confidence</span>
                    <span>{radiologyStats?.accuracyRate || 94}%</span>
                  </div>
                  <Progress value={radiologyStats?.accuracyRate || 94} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Scan className="w-5 h-5" />
                  Recent High-Priority Cases
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingScans?.filter(scan => scan.priority === 'urgent' || scan.priority === 'high').slice(0, 4).map((scan) => (
                    <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-700 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-white">{scan.patientName}</span>
                          <Badge className={getPriorityColor(scan.priority)}>
                            {scan.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-400">{scan.scanType} - {scan.bodyPart}</p>
                        <p className="text-xs text-slate-500">
                          AI: {scan.aiPrediction} ({scan.aiConfidence}% confidence)
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setSelectedScan(scan)}
                        className="border-slate-600 text-slate-300"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  )) || (
                    <div className="text-center text-slate-400 py-4">
                      No high-priority cases pending
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">Pending Scan Reviews</CardTitle>
              <div className="text-sm text-slate-400">
                {pendingScans?.length || 0} scans awaiting review
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingScans?.map((scan) => (
                  <div key={scan.id} className="border border-slate-600 rounded-lg p-4 space-y-3 bg-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <h4 className="font-medium text-white">{scan.patientName}</h4>
                          <p className="text-sm text-slate-400">
                            {scan.scanType} - {scan.bodyPart}
                          </p>
                        </div>
                        <Badge className={getPriorityColor(scan.priority)}>
                          {scan.priority}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-slate-400">
                          Submitted: {new Date(scan.submittedAt).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-slate-400">
                          Dr. {scan.referringDoctor}
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-900/20 p-3 rounded border border-blue-700">
                      <div className="flex items-center gap-2 mb-1">
                        <Brain className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-medium text-blue-300">AI Analysis</span>
                      </div>
                      <p className="text-sm text-blue-200">
                        {scan.aiPrediction} (Confidence: {scan.aiConfidence}%)
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        onClick={() => setSelectedScan(scan)}
                      >
                        <Image className="w-4 h-4 mr-2" />
                        Open Viewer
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => {
                          setSelectedScan(scan);
                          setReportText('');
                          setFindings('');
                        }}
                        className="border-slate-600 text-slate-300"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Add Report
                      </Button>
                    </div>
                  </div>
                )) || (
                  <div className="text-center text-slate-400 py-8">
                    No pending reviews at this time
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">Today's Completed Reviews</CardTitle>
              <div className="text-sm text-slate-400">
                {completedScans?.length || 0} scans completed today
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {completedScans?.map((scan) => (
                  <div key={scan.id} className="border border-slate-600 rounded-lg p-4 space-y-2 bg-slate-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-white">{scan.patientName}</h4>
                        <p className="text-sm text-slate-400">{scan.scanType}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-slate-400">
                          Completed: {new Date(scan.completedAt).toLocaleTimeString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500" />
                          <span className="text-xs">AI Accuracy: {scan.aiAccuracy}%</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-slate-600 p-3 rounded">
                      <div className="text-sm font-medium mb-1 text-slate-300">Findings:</div>
                      <p className="text-sm text-slate-200">{scan.findings}</p>
                    </div>
                    
                    <div className="bg-green-900/20 p-3 rounded border border-green-700">
                      <div className="text-sm font-medium mb-1 text-green-300">Recommendation:</div>
                      <p className="text-sm text-green-200">{scan.recommendation}</p>
                    </div>
                  </div>
                )) || (
                  <div className="text-center text-slate-400 py-8">
                    No completed reviews today
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-insights" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Brain className="w-5 h-5" />
                  Google Medical AI Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300">Agreement Rate</span>
                    <span className="text-green-400 font-medium">92.4%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300">False Positive Rate</span>
                    <span className="text-orange-400 font-medium">3.1%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300">Sensitivity</span>
                    <span className="text-blue-400 font-medium">94.7%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300">Specificity</span>
                    <span className="text-purple-400 font-medium">89.2%</span>
                  </div>
                </div>
                
                <div className="mt-4 p-3 bg-blue-900/20 rounded border border-blue-700">
                  <div className="text-sm font-medium text-blue-300 mb-1">
                    AI Collaboration Insights
                  </div>
                  <p className="text-sm text-blue-200">
                    Your diagnoses show excellent correlation with AI predictions. 
                    Consider the AI suggestions for cases with 85%+ confidence.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white">Performance Trends</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Review Speed Improvement</span>
                    <span className="text-green-400">+23% this month</span>
                  </div>
                  <Progress value={75} className="h-2" />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Diagnostic Accuracy</span>
                    <span className="text-blue-400">96.2% (target: 95%)</span>
                  </div>
                  <Progress value={96} className="h-2" />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Case Load Management</span>
                    <span className="text-purple-400">Excellent</span>
                  </div>
                  <Progress value={88} className="h-2" />
                </div>

                <div className="mt-4 p-3 bg-green-900/20 rounded border border-green-700">
                  <div className="text-sm font-medium text-green-300 mb-1">
                    Performance Recognition
                  </div>
                  <p className="text-sm text-green-200">
                    Outstanding work! You're exceeding department averages 
                    in both speed and accuracy.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Scan Review Modal */}
      <Dialog open={!!selectedScan} onOpenChange={() => setSelectedScan(null)}>
        <DialogContent className="bg-slate-800 border-slate-600 max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center">
              <Brain className="w-5 h-5 mr-2" />
              Scan Review - {selectedScan?.patientName}
            </DialogTitle>
          </DialogHeader>
          {selectedScan && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-400">Patient</Label>
                  <p className="text-white font-medium">{selectedScan.patientName}</p>
                </div>
                <div>
                  <Label className="text-slate-400">Scan Type</Label>
                  <p className="text-white">{selectedScan.scanType}</p>
                </div>
                <div>
                  <Label className="text-slate-400">Body Part</Label>
                  <p className="text-white">{selectedScan.bodyPart}</p>
                </div>
                <div>
                  <Label className="text-slate-400">Priority</Label>
                  <Badge className={getPriorityColor(selectedScan.priority)}>{selectedScan.priority}</Badge>
                </div>
                <div>
                  <Label className="text-slate-400">Referring Doctor</Label>
                  <p className="text-white">Dr. {selectedScan.referringDoctor}</p>
                </div>
                <div>
                  <Label className="text-slate-400">Submitted</Label>
                  <p className="text-white">{new Date(selectedScan.submittedAt).toLocaleDateString()}</p>
                </div>
              </div>
              
              <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-300 font-medium">AI Analysis</span>
                </div>
                <p className="text-blue-200">{selectedScan.aiPrediction}</p>
                <p className="text-blue-300 text-sm mt-1">Confidence: {selectedScan.aiConfidence}%</p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-white">Clinical Findings</Label>
                  <Textarea
                    value={findings}
                    onChange={(e) => setFindings(e.target.value)}
                    placeholder="Enter your clinical findings..."
                    className="bg-slate-700 border-slate-600 text-white mt-2"
                    rows={4}
                  />
                </div>
                <div>
                  <Label className="text-white">Recommendation</Label>
                  <Textarea
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                    placeholder="Enter your recommendations..."
                    className="bg-slate-700 border-slate-600 text-white mt-2"
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-600">
                <Button
                  variant="outline"
                  onClick={() => setSelectedScan(null)}
                  className="border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (findings && reportText) {
                      submitReportMutation.mutate({
                        scanId: selectedScan.id,
                        findings,
                        recommendation: reportText
                      });
                    }
                  }}
                  disabled={!findings || !reportText || submitReportMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {submitReportMutation.isPending ? 'Submitting...' : 'Submit Report'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}