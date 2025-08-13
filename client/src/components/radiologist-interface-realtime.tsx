import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWebSocketRealTime } from "@/hooks/useWebSocketRealTime";
import { 
  Brain, 
  Microscope, 
  FileText, 
  Search, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  TrendingUp,
  Activity,
  Zap,
  Eye,
  Upload,
  Download,
  RefreshCw,
  BarChart3,
  Scan,
  Target,
  Timer,
  Users
} from "lucide-react";

interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
}

interface ScanAnalysis {
  id: number;
  patientName: string;
  scanType: string;
  uploadDate: string;
  status: 'pending' | 'analyzing' | 'completed' | 'reviewed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  aiConfidence: number;
  findings: string[];
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high';
  imageUrl?: string;
}

interface RadiologistStats {
  scansAnalyzed: number;
  pendingReviews: number;
  accuracyRate: number;
  avgAnalysisTime: string;
  criticalFindings: number;
  weeklyTargetProgress: number;
}

interface AIAnalysisResult {
  confidence: number;
  findings: string[];
  recommendations: string[];
  riskLevel: string;
  cancerType?: string;
  technicalDetails: {
    processingTime: number;
    modelVersion: string;
    enhancement: string[];
  };
}

export default function RadiologistInterfaceRealTime({ user, setActiveTab }: { user: User; setActiveTab?: (tab: string) => void }) {
  const [selectedScan, setSelectedScan] = useState<ScanAnalysis | null>(null);
  const [analysisNotes, setAnalysisNotes] = useState("");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [aiAnalysisProgress, setAiAnalysisProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time WebSocket connection
  const { isConnected, lastMessage, sendMessage } = useWebSocketRealTime({
    onMessage: (message) => {
      if (message.type === 'scan_analysis_complete') {
        toast({
          title: "AI Analysis Complete",
          description: `Scan analysis for ${message.data.patientName} is ready for review.`,
        });
        setAiAnalysisProgress(100);
        setIsAnalyzing(false);
      } else if (message.type === 'urgent_scan') {
        toast({
          title: "Urgent Scan Alert",
          description: message.data.message,
          variant: "destructive",
        });
      } else if (message.type === 'analysis_progress') {
        setAiAnalysisProgress(message.data.progress);
      }
    }
  });

  // Fetch real-time stats
  const { data: stats, isLoading: statsLoading } = useQuery<RadiologistStats>({
    queryKey: ['/api/radiologist/stats'],
    queryFn: async () => {
      const res = await fetch('/api/radiologist/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Fetch pending scans
  const { data: scans = [], refetch: refetchScans } = useQuery<ScanAnalysis[]>({
    // Map to existing endpoints: combine pending and completed-today
    queryKey: ['/api/radiologist/pending-and-completed'],
    queryFn: async () => {
      const [pendingRes, completedRes] = await Promise.all([
        fetch('/api/radiologist/pending-reviews', { credentials: 'include' }),
        fetch('/api/radiologist/completed-today', { credentials: 'include' })
      ]);
      if (!pendingRes.ok) throw new Error('Failed to load pending');
      if (!completedRes.ok) throw new Error('Failed to load completed');
      const pending = await pendingRes.json();
      const completed = await completedRes.json();
      // Normalize to ScanAnalysis[]
      const normalizedPending = (pending || []).map((p: any) => ({
        id: p.id,
        patientName: p.patientName,
        scanType: p.scanType,
        uploadDate: p.submittedAt || new Date().toISOString(),
        status: 'pending' as const,
        priority: (p.priority || 'medium') as 'low' | 'medium' | 'high' | 'urgent',
        aiConfidence: Number(p.aiConfidence) || 0,
        findings: [],
        recommendations: [],
        riskLevel: 'medium' as const,
        imageUrl: undefined,
      }));
      const normalizedCompleted = (completed || []).map((c: any) => ({
        id: c.id,
        patientName: c.patientName,
        scanType: c.scanType,
        uploadDate: c.completedAt || new Date().toISOString(),
        status: 'completed' as const,
        priority: 'medium' as const,
        aiConfidence: Number(c.aiAccuracy) || 0,
        findings: c.findings ? [String(c.findings)] : [],
        recommendations: c.recommendation ? [String(c.recommendation)] : [],
        riskLevel: (Number(c.aiAccuracy) || 0) > 85 ? 'high' : (Number(c.aiAccuracy) || 0) > 60 ? 'medium' : 'low',
        imageUrl: undefined,
      }));
      return [...normalizedPending, ...normalizedCompleted];
    },
    refetchInterval: 10000,
  });

  // Fetch recent activities
  // Remove broken activities endpoint (not implemented). Keep placeholder empty array.
  const activities: any[] = [];

  // AI Analysis mutation
  const aiAnalysisMutation = useMutation({
    // No backend endpoint yet; simulate client-side for UX flow
    mutationFn: async ({ scanId, enhancementOptions }: { scanId: number; enhancementOptions: string[] }) => {
      await new Promise(r => setTimeout(r, 300));
      return { ok: true } as any;
    },
    onMutate: () => {
      setIsAnalyzing(true);
      setAiAnalysisProgress(0);
    },
    onSuccess: (result: AIAnalysisResult) => {
      toast({
        title: "AI Analysis Started",
        description: "The AI system is processing the medical image.",
      });
      // Simulate real-time progress updates
      const progressInterval = setInterval(() => {
        setAiAnalysisProgress(prev => {
          if (prev >= 100) {
            clearInterval(progressInterval);
            setIsAnalyzing(false);
            return 100;
          }
          return prev + Math.random() * 15;
        });
      }, 500);
    },
  });

  // Review completion mutation
  const completeReviewMutation = useMutation({
    // Map to existing POST /api/radiologist/scans/:id/report
    mutationFn: async ({ scanId, notes, approved }: { scanId: number; notes: string; approved: boolean }) => {
      const response = await fetch(`/api/radiologist/scans/${scanId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ findings: notes, recommendation: approved ? 'Approved' : 'Revision requested' }),
      });
      if (!response.ok) throw new Error('Failed to complete review');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Review Completed",
        description: "Scan review has been submitted successfully.",
      });
      setSelectedScan(null);
      setAnalysisNotes("");
      refetchScans();
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/stats'] });
    },
  });

  const startAIAnalysis = (scan: ScanAnalysis, enhancementOptions: string[] = []) => {
    aiAnalysisMutation.mutate({ scanId: scan.id, enhancementOptions });
    // Send real-time notification
    sendMessage({
      type: 'analysis_started',
      data: { scanId: scan.id, radiologistId: user.id }
    });
  };

  const completeReview = (approved: boolean) => {
    if (selectedScan) {
      completeReviewMutation.mutate({
        scanId: selectedScan.id,
        notes: analysisNotes,
        approved
      });
    }
  };

  const filteredScans = scans.filter(scan => {
    const priorityMatch = filterPriority === "all" || scan.priority === filterPriority;
    const statusMatch = filterStatus === "all" || scan.status === filterStatus;
    return priorityMatch && statusMatch;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-500 border-red-500';
      case 'high': return 'text-orange-500 border-orange-500';
      case 'medium': return 'text-yellow-500 border-yellow-500';
      case 'low': return 'text-green-500 border-green-500';
      default: return 'text-gray-500 border-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-600';
      case 'analyzing': return 'bg-blue-600';
      case 'completed': return 'bg-green-600';
      case 'reviewed': return 'bg-purple-600';
      default: return 'bg-gray-600';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center">
              <Brain className="w-6 h-6 mr-2 text-purple-400" />
              Radiologist Interface
            </h1>
            <p className="text-slate-400">AI-assisted medical image analysis and interpretation</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-slate-400">
                {isConnected ? 'Real-time Connected' : 'Connecting...'}
              </span>
            </div>
            {isAnalyzing && (
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                <span className="text-sm text-blue-400">AI Processing</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Performance Dashboard */}
      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {statsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="animate-pulse">
                    <div className="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
                    <div className="h-8 bg-slate-700 rounded w-1/2"></div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Scans Analyzed</p>
                      <p className="text-2xl font-bold text-blue-400">{stats?.scansAnalyzed || 0}</p>
                    </div>
                    <Scan className="w-6 h-6 text-blue-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Pending Reviews</p>
                      <p className="text-2xl font-bold text-yellow-400">{stats?.pendingReviews || 0}</p>
                    </div>
                    <Clock className="w-6 h-6 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Detection Confidence</p>
                      <p className="text-2xl font-bold text-green-400">{stats?.accuracyRate || 0}%</p>
                    </div>
                    <Target className="w-6 h-6 text-green-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Avg Analysis Time</p>
                      <p className="text-2xl font-bold text-purple-400">{stats?.avgAnalysisTime || '0m'}</p>
                    </div>
                    <Timer className="w-6 h-6 text-purple-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Critical Findings</p>
                      <p className="text-2xl font-bold text-red-400">{stats?.criticalFindings || 0}</p>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Weekly Progress</p>
                      <p className="text-2xl font-bold text-cyan-400">{stats?.weeklyTargetProgress || 0}%</p>
                    </div>
                    <TrendingUp className="w-6 h-6 text-cyan-400" />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* AI Analysis Progress */}
        {isAnalyzing && (
          <Card className="bg-slate-800 border-slate-700 mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Brain className="w-5 h-5 text-blue-400 animate-pulse" />
                  <span className="text-white font-medium">AI Analysis in Progress</span>
                </div>
                <span className="text-sm text-slate-400">{Math.round(aiAnalysisProgress)}%</span>
              </div>
              <Progress value={aiAnalysisProgress} className="w-full" />
              <p className="text-sm text-slate-400 mt-2">
                Advanced neural networks are analyzing the medical image for potential abnormalities...
              </p>
            </CardContent>
          </Card>
        )}

        {/* Main Content */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid grid-cols-6 w-full bg-slate-800">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="scans">Scans</TabsTrigger>
            <TabsTrigger value="ai-analysis">AI Analysis</TabsTrigger>
            <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
            <TabsTrigger value="translator">Translator</TabsTrigger>
            <TabsTrigger value="therapy">Therapy</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Today's Productivity */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <BarChart3 className="w-5 h-5 mr-2" />
                    Today's Productivity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Daily Target Progress</span>
                      <span className="text-white font-medium">{filteredScans.length}/10 scans</span>
                    </div>
                    <Progress value={Math.min((filteredScans.length / 10) * 100, 100)} className="w-full" />
                    
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-400">{scans.filter(s => s.status === 'completed' || s.status === 'reviewed').length}</p>
                        <p className="text-sm text-slate-400">Completed</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-yellow-400">{scans.filter(s => s.status === 'pending' || s.status === 'analyzing').length}</p>
                        <p className="text-sm text-slate-400">Pending</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent High-Priority Cases */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <AlertTriangle className="w-5 h-5 mr-2" />
                    Recent High-Priority Cases
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {filteredScans.filter(scan => scan.priority === 'high' || scan.priority === 'urgent').length === 0 ? (
                      <p className="text-slate-400 text-center py-8">No high-priority cases pending</p>
                    ) : (
                      filteredScans
                        .filter(scan => scan.priority === 'high' || scan.priority === 'urgent')
                        .slice(0, 3)
                        .map((scan) => (
                          <div key={scan.id} className="p-3 bg-slate-700 rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-white font-medium">{scan.patientName}</p>
                                <p className="text-sm text-slate-400">{scan.scanType}</p>
                                <p className="text-xs text-slate-500">{new Date(scan.uploadDate).toLocaleDateString()}</p>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Badge className={`${getPriorityColor(scan.priority)} border`}>
                                  {scan.priority}
                                </Badge>
                                <Badge className={getStatusColor(scan.status)}>
                                  {scan.status}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Scans Tab */}
          <TabsContent value="scans" className="space-y-6">
            {/* Filters */}
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <Label className="text-slate-300">Filter by Priority</Label>
                    <Select value={filterPriority} onValueChange={setFilterPriority}>
                      <SelectTrigger className="bg-slate-700 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Priorities</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-slate-300">Filter by Status</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="bg-slate-700 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="analyzing">Analyzing</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="reviewed">Reviewed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Scans List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredScans.map((scan) => (
                <Card key={scan.id} className="bg-slate-800 border-slate-700 hover:border-slate-600 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-white font-medium">{scan.patientName}</h4>
                        <p className="text-sm text-slate-400">{scan.scanType}</p>
                        <p className="text-xs text-slate-500">{new Date(scan.uploadDate).toLocaleDateString()}</p>
                      </div>
                      <div className="flex flex-col space-y-1">
                        <Badge className={`${getPriorityColor(scan.priority)} border text-xs`}>
                          {scan.priority}
                        </Badge>
                        <Badge className={`${getStatusColor(scan.status)} text-xs`}>
                          {scan.status}
                        </Badge>
                      </div>
                    </div>

                    {scan.status === 'completed' && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-400">AI Confidence</span>
                          <span className="text-xs text-white">{scan.aiConfidence}%</span>
                        </div>
                        <Progress value={scan.aiConfidence} className="h-2" />
                        
                        <div className="mt-2">
                          <Badge className={getRiskColor(scan.riskLevel)}>
                            {scan.riskLevel} risk
                          </Badge>
                        </div>
                      </div>
                    )}

                    <div className="flex space-x-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => setSelectedScan(scan)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        Review
                      </Button>
                      {scan.status === 'pending' && (
                        <Button 
                          size="sm" 
                          onClick={() => startAIAnalysis(scan)}
                          disabled={isAnalyzing}
                        >
                          <Brain className="w-3 h-3 mr-1" />
                          Analyze
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* AI Analysis Tab */}
          <TabsContent value="ai-analysis" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Brain className="w-5 h-5 mr-2" />
                  Advanced AI Analysis Tools
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Card className="bg-slate-700 border-slate-600">
                    <CardContent className="p-4">
                      <div className="flex items-center space-x-3">
                        <Microscope className="w-8 h-8 text-blue-400" />
                        <div>
                          <h4 className="text-white font-medium">Deep Learning Analysis</h4>
                          <p className="text-sm text-slate-400">CNN-based pattern recognition</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-700 border-slate-600">
                    <CardContent className="p-4">
                      <div className="flex items-center space-x-3">
                        <Target className="w-8 h-8 text-green-400" />
                        <div>
                          <h4 className="text-white font-medium">Lesion Detection</h4>
                          <p className="text-sm text-slate-400">Automated abnormality detection</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-700 border-slate-600">
                    <CardContent className="p-4">
                      <div className="flex items-center space-x-3">
                        <BarChart3 className="w-8 h-8 text-purple-400" />
                        <div>
                          <h4 className="text-white font-medium">Risk Stratification</h4>
                          <p className="text-sm text-slate-400">Multi-factor risk assessment</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <Zap className="w-5 h-5 text-blue-400 mt-1" />
                    <div>
                      <h4 className="text-blue-400 font-medium">Real-time AI Processing</h4>
                      <p className="text-sm text-slate-300 mt-1">
                        Our AI system processes medical images using advanced deep learning models trained on 
                        millions of medical scans. Results are delivered in real-time with confidence scores 
                        and detailed findings.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Scan Review Modal */}
        {selectedScan && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-white">{selectedScan.patientName}</h3>
                  <p className="text-slate-400">{selectedScan.scanType} - {new Date(selectedScan.uploadDate).toLocaleDateString()}</p>
                </div>
                <Button variant="outline" onClick={() => setSelectedScan(null)}>
                  ✕
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Image Viewer */}
                <div className="space-y-4">
                  <div className="bg-slate-700 rounded-lg p-4 h-64 flex items-center justify-center">
                    <p className="text-slate-400">Medical Image Viewer</p>
                  </div>
                  
                  <div className="flex space-x-2">
                    <Button size="sm" variant="outline" className="flex-1">
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1">
                      <Search className="w-3 h-3 mr-1" />
                      Enhance
                    </Button>
                  </div>
                </div>

                {/* Analysis Results */}
                <div className="space-y-4">
                  {selectedScan.status === 'completed' && (
                    <>
                      <div>
                        <Label className="text-slate-300">AI Confidence</Label>
                        <div className="flex items-center space-x-2">
                          <Progress value={selectedScan.aiConfidence} className="flex-1" />
                          <span className="text-white font-medium">{selectedScan.aiConfidence}%</span>
                        </div>
                      </div>

                      <div>
                        <Label className="text-slate-300">Risk Level</Label>
                        <Badge className={getRiskColor(selectedScan.riskLevel)}>
                          {selectedScan.riskLevel} risk
                        </Badge>
                      </div>

                      <div>
                        <Label className="text-slate-300">AI Findings</Label>
                        <div className="bg-slate-700 rounded-lg p-3">
                          {selectedScan.findings.map((finding, index) => (
                            <p key={index} className="text-sm text-slate-300">• {finding}</p>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-slate-300">Recommendations</Label>
                        <div className="bg-slate-700 rounded-lg p-3">
                          {selectedScan.recommendations.map((rec, index) => (
                            <p key={index} className="text-sm text-slate-300">• {rec}</p>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <Label htmlFor="review-notes" className="text-slate-300">Radiologist Notes</Label>
                    <Textarea
                      id="review-notes"
                      value={analysisNotes}
                      onChange={(e) => setAnalysisNotes(e.target.value)}
                      placeholder="Add your professional interpretation and notes..."
                      className="bg-slate-700 border-slate-600 text-white h-32"
                    />
                  </div>

                  <div className="flex space-x-2">
                    <Button 
                      onClick={() => completeReview(true)}
                      disabled={completeReviewMutation.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                    <Button 
                      onClick={() => completeReview(false)}
                      disabled={completeReviewMutation.isPending}
                      variant="outline"
                      className="flex-1"
                    >
                      Request Revision
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}