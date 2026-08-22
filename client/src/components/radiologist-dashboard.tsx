import { useState } from "react";
import OutcomeReviewPanel from "./outcome-review-panel";
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
  Brain, FileText, Calendar, Clock, Eye, CheckCircle, AlertCircle,
  TrendingUp, Scan, Activity, Star, Timer, Image, RefreshCw, AlertTriangle
} from "lucide-react";

/**
 * Matches what /api/radiologist/stats returns.
 *
 * `accuracyRate` is gone. The server returned the literal 96, and this file
 * rendered it four times — as "96% accuracy" under the review-time tile, as a
 * "Detection Confidence" progress bar filled to 96, and as an "Accuracy Rate"
 * row in Performance Metrics. Nothing measured it. Accuracy needs confirmed
 * outcomes, which live in `scan_outcomes` and are reported by
 * /api/models/performance with a denominator and a confidence interval; a
 * screening dashboard printing a bare 96% is exactly the claim this platform
 * exists to avoid making.
 *
 * `avgReviewTime` (the literal 3.2) and `workloadHours` (todayScans * 0.2) are
 * replaced by a measured median and the count it was computed from.
 */
interface RadiologyStats {
  pendingReviews: number;
  completedToday: number;
  totalScansReviewed: number;
  criticalCases: number;
  /** Mean of the model's self-reported confidence. Null when nothing recorded one. */
  meanAiConfidencePct: number | null;
  /** Median hours from arrival to sign-off over 30 days. Null until measurable. */
  medianReviewHours: number | null;
  reviewsMeasured: number;
  accuracy?: { available: boolean; reason: string; endpoint: string };
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

export default function RadiologistDashboard({ user, setActiveTab }: { user: any; setActiveTab?: (tab: string) => void }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [searchText, setSearchText] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'submittedAt' | 'priority' | 'aiConfidence'>('submittedAt');
  const [selectedScan, setSelectedScan] = useState<ScanReview | null>(null);
  const [reportText, setReportText] = useState('');
  const [findings, setFindings] = useState('');
  const [showStatsModal, setShowStatsModal] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Handle refresh functions
  const handleRefreshPending = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/radiologist/pending-reviews'] });
  };

  const handleRefreshCompleted = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/radiologist/completed-today'] });
  };

  // Enhanced radiologist statistics query with error handling
  const { 
    data: radiologyStats, 
    isLoading: statsLoading, 
    error: statsError,
    refetch: refetchStats 
  } = useQuery<RadiologyStats>({
    queryKey: ['/api/radiologist/stats'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/stats', { 
        credentials: 'include' 
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch stats: ${response.status} ${errorText}`);
      }
      return response.json();
    },
    retry: 3,
    retryDelay: 1000,
    staleTime: 30000,
    refetchInterval: 60000,
    enabled: !!user?.id
  });

  // Enhanced pending scans query with error handling
  const { 
    data: pendingScans, 
    isLoading: pendingLoading, 
    error: pendingError,
    refetch: refetchPending 
  } = useQuery<ScanReview[], Error>({
    queryKey: ['/api/radiologist/pending-reviews'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/pending-reviews', { 
        credentials: 'include' 
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch pending scans: ${response.status} ${errorText}`);
      }
      return response.json();
    },
    retry: 3,
    retryDelay: 1000,
    staleTime: 15000,
    refetchInterval: 30000,
    enabled: !!user?.id
  });

  // Enhanced completed scans query with error handling
  const { 
    data: completedScans, 
    isLoading: completedLoading,
    error: completedError,
    refetch: refetchCompleted 
  } = useQuery<CompletedScan[]>({
    queryKey: ['/api/radiologist/completed-today'],
    queryFn: async () => {
      const response = await fetch('/api/radiologist/completed-today', { 
        credentials: 'include' 
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch completed scans: ${response.status} ${errorText}`);
      }
      return response.json();
    },
    retry: 2,
    retryDelay: 1000,
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: !!user?.id
  });

  // Enhanced submit report mutation with proper error handling
  const submitReportMutation = useMutation({
    mutationFn: async ({ scanId, findings, recommendation }: { 
      scanId: number; 
      findings: string; 
      recommendation: string 
    }) => {
      const response = await fetch(`/api/radiologist/scans/${scanId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ findings, recommendation })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to submit report: ${response.status} ${errorText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/pending-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/completed-today'] });
      queryClient.invalidateQueries({ queryKey: ['/api/radiologist/stats'] });
      setSelectedScan(null);
      setReportText('');
      setFindings('');
      toast({ 
        title: 'Success', 
        description: 'Report submitted successfully' 
      });
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to submit report';
      toast({ 
        title: 'Error', 
        description: errorMessage, 
        variant: 'destructive' 
      });
    }
  });

  // Enhanced priority color function
  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-300 font-bold animate-pulse';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300 font-semibold';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300 font-medium';
      case 'low': return 'bg-green-100 text-green-800 border-green-300 font-medium';
      default: return 'bg-gray-100 text-gray-800 border-gray-300 font-medium';
    }
  };

  // Loading state
  if (statsLoading || pendingLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-white font-semibold">Loading radiologist workstation...</p>
        </div>
      </div>
    );
  }

  // Error state with retry options
  if (statsError || pendingError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 mx-auto text-red-400" />
          <div className="text-red-400 font-bold">Failed to load radiologist data</div>
          <p className="text-slate-300 text-sm">
            {statsError?.message || pendingError?.message || 'Unknown error occurred'}
          </p>
          <div className="space-x-2">
            <Button 
              onClick={() => {
                refetchStats();
                refetchPending();
                refetchCompleted();
              }}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
            <Button 
              onClick={() => window.location.reload()}
              variant="outline"
              className="border-slate-600 text-slate-300"
            >
              Refresh Page
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Safe data access with fallbacks. The measured fields fall back to null, not
  // to 0: "0 minutes median review time" is a claim, "—" says it is unknown.
  const safeStats: RadiologyStats = radiologyStats || {
    pendingReviews: 0,
    completedToday: 0,
    totalScansReviewed: 0,
    criticalCases: 0,
    meanAiConfidencePct: null,
    medianReviewHours: null,
    reviewsMeasured: 0
  };

  /** Renders a number that may not exist as a dash rather than as zero. */
  const orDash = (value: number | null | undefined, suffix = '') =>
    value === null || value === undefined ? '—' : `${value}${suffix}`;

  const safePendingScans = pendingScans || [];
  const safeCompletedScans = completedScans || [];

  const filteredPending = safePendingScans
    .filter(s => !searchText || s.patientName.toLowerCase().includes(searchText.toLowerCase()) || s.scanType.toLowerCase().includes(searchText.toLowerCase()))
    .filter(s => priorityFilter === 'all' || s.priority === priorityFilter)
    .sort((a, b) => {
      if (sortBy === 'submittedAt') return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      if (sortBy === 'priority') {
        const order: Record<string, number> = { urgent: 3, high: 2, medium: 1, low: 0 };
        return (order[b.priority] ?? 0) - (order[a.priority] ?? 0);
      }
      if (sortBy === 'aiConfidence') return (b.aiConfidence ?? 0) - (a.aiConfidence ?? 0);
      return 0;
    });

  return (
    <div className="space-y-6">
      {/* Enhanced Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-600 hover:border-orange-500 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-400">Pending Reviews</p>
                <p className="text-3xl font-bold text-white">
                  {safeStats.pendingReviews || safePendingScans.length}
                </p>
                <p className="text-xs text-orange-300">
                  {safePendingScans.filter(s => s.priority === 'urgent').length} urgent
                </p>
              </div>
              <FileText className="w-8 h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600 hover:border-green-500 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-400">Completed Today</p>
                <p className="text-3xl font-bold text-white">
                  {safeStats.completedToday || safeCompletedScans.length}
                </p>
                <p className="text-xs text-green-300">
                  {/* Was `workloadHours`, computed as todayScans * 0.2 — a made-up
                      minutes-per-scan constant presented as hours worked. */}
                  {safeStats.pendingReviews} still queued
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600 hover:border-purple-500 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-400">Mean AI Confidence</p>
                <p className="text-3xl font-bold text-white">
                  {safeStats.meanAiConfidencePct === null
                    ? '—'
                    : `${safeStats.meanAiConfidencePct}%`}
                </p>
                {/* Named for what it is. How sure the model was, not how often it
                    was right — a model can be confidently wrong. */}
                <p className="text-xs text-purple-300">not an accuracy figure</p>
              </div>
              <Brain className="w-8 h-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-600 hover:border-blue-500 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-400">Median Review Time</p>
                <p className="text-3xl font-bold text-white">
                  {orDash(safeStats.medianReviewHours, 'h')}
                </p>
                <p className="text-xs text-blue-300">
                  {/* The caption here read "96% accuracy" from a literal. It now
                      reports the sample the median came from, so a median over
                      three reviews is visibly a median over three reviews. */}
                  {safeStats.reviewsMeasured > 0
                    ? `over ${safeStats.reviewsMeasured} reviews, last 30 days`
                    : 'not yet measurable'}
                </p>
              </div>
              <Timer className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Radiologist Interface */}
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList className="grid w-full grid-cols-4 bg-slate-800 border-slate-600">
          <TabsTrigger value="overview" className="text-slate-300 data-[state=active]:text-white">
            Workstation
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-slate-300 data-[state=active]:text-white">
            Pending Reviews ({safePendingScans.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-slate-300 data-[state=active]:text-white">
            Completed ({safeCompletedScans.length})
          </TabsTrigger>
          {/* The step that turns predictions into measurements. Without it the
              platform can report what the models said and never whether they
              were right. */}
          <TabsTrigger value="outcomes" className="text-slate-300 data-[state=active]:text-white">
            Outcomes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Quick Actions */}
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Button 
                  onClick={() => setActiveSection('pending')}
                  className="bg-orange-600 hover:bg-orange-700 h-16 flex flex-col gap-2"
                >
                  <FileText className="w-6 h-6" />
                  <span>Review Scans</span>
                </Button>
                <Button 
                  onClick={() => setActiveSection('completed')}
                  className="bg-green-600 hover:bg-green-700 h-16 flex flex-col gap-2"
                >
                  <CheckCircle className="w-6 h-6" />
                  <span>View Completed</span>
                </Button>
                <Button 
                  onClick={() => {
                    if (setActiveTab) {
                      setActiveTab('google-ai');
                    } else {
                      window.location.href = '/dashboard?tab=google-ai';
                    }
                  }}
                  className="bg-purple-600 hover:bg-purple-700 h-16 flex flex-col gap-2"
                >
                  <Brain className="w-6 h-6" />
                  <span>AI Analysis</span>
                </Button>
                <Button 
                  onClick={() => setShowStatsModal(true)}
                  className="bg-blue-600 hover:bg-blue-700 h-16 flex flex-col gap-2"
                >
                  <TrendingUp className="w-6 h-6" />
                  <span>Stats</span>
                </Button>
              </div>
            </CardContent>
          </Card>

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
                      {safeStats.completedToday || safeCompletedScans.length}
                    </div>
                    <div className="text-sm text-slate-400">Reviews Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-400">
                      {safeStats.pendingReviews || safePendingScans.length}
                    </div>
                    <div className="text-sm text-slate-400">Still Pending</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-slate-300">
                      <span>Daily Target Progress</span>
                      <span>{Math.min(Math.round(((safeStats.completedToday || safeCompletedScans.length) / 30) * 100), 100)}%</span>
                    </div>
                    <Progress 
                      value={Math.min(Math.round(((safeStats.completedToday || safeCompletedScans.length) / 30) * 100), 100)} 
                      className="h-2" 
                    />
                  </div>
                  {/*
                    A progress bar labelled "Detection Confidence" and filled to
                    safeStats.accuracyRate — the server's literal 96 — stood here.
                    A bar is a strong visual claim of a measured proportion, and
                    there was no measurement behind it. It is replaced with the
                    mean model confidence, labelled as such, and rendered only
                    when a value exists.
                  */}
                  {safeStats.meanAiConfidencePct !== null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-slate-300">
                        <span>Mean AI confidence (not accuracy)</span>
                        <span>{safeStats.meanAiConfidencePct}%</span>
                      </div>
                      <Progress value={safeStats.meanAiConfidencePct} className="h-2" />
                    </div>
                  )}
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
                  {safePendingScans
                    .filter(scan => scan.priority === 'urgent' || scan.priority === 'high')
                    .slice(0, 4)
                    .map((scan) => (
                      <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
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
                          className="border-slate-600 text-slate-300 hover:bg-slate-600"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  {safePendingScans.filter(s => s.priority === 'urgent' || s.priority === 'high').length === 0 && (
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">Pending Scan Reviews</CardTitle>
                  <div className="text-sm text-slate-400">
                    {filteredPending.length} scans awaiting review
                  </div>
                </div>
                <Button
                  onClick={() => refetchPending()}
                  variant="outline"
                  size="sm"
                  className="border-slate-600 text-slate-300"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <input
                  placeholder="Search patient or scan type..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200 outline-none"
                />
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as any)}
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200"
                >
                  <option value="all">All priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200"
                >
                  <option value="submittedAt">Sort: Newest</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="aiConfidence">Sort: AI Confidence</option>
                </select>
              </div>
              {pendingError ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
                  <h3 className="text-lg font-medium text-red-400 mb-2">Failed to Load Pending Reviews</h3>
                  <p className="text-slate-400 mb-4">{pendingError ? (pendingError as Error).message || 'Unknown error' : 'Unknown error'}</p>
                  <Button 
                    onClick={handleRefreshPending} 
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredPending.map((scan) => (
                    <div key={scan.id} className="border border-slate-600 rounded-lg p-4 space-y-3 bg-slate-700 hover:bg-slate-600 transition-colors">
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
                          className="border-slate-600 text-slate-300 hover:bg-slate-600"
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Add Report
                        </Button>
                      </div>
                    </div>
                  ))}
                  {safePendingScans.length === 0 && (
                    <div className="text-center text-slate-400 py-8">
                      <Scan className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">No pending reviews at this time</p>
                      <p className="text-sm">Great work! You're all caught up.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">Today's Completed Reviews</CardTitle>
                  <div className="text-sm text-slate-400">
                    {safeCompletedScans.length} scans completed today
                  </div>
                </div>
                <Button
                  onClick={() => refetchCompleted()}
                  variant="outline"
                  size="sm"
                  className="border-slate-600 text-slate-300"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {completedError ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
                  <h3 className="text-lg font-medium text-red-400 mb-2">Failed to Load Completed Reviews</h3>
                  <p className="text-slate-400 mb-4">{completedError ? (completedError as Error).message || 'Unknown error' : 'Unknown error'}</p>
                  <Button 
                    onClick={handleRefreshCompleted} 
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {safeCompletedScans.map((scan) => (
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
                            <span className="text-xs text-slate-300">AI Accuracy: {scan.aiAccuracy}%</span>
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
                  ))}
                  {safeCompletedScans.length === 0 && (
                    <div className="text-center text-slate-400 py-8">
                      <CheckCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">No completed reviews today</p>
                      <p className="text-sm">Reviews will appear here once completed.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="outcomes" className="space-y-4">
          <OutcomeReviewPanel />
        </TabsContent>

      </Tabs>

      {/* Enhanced Scan Review Modal */}
      <Dialog open={!!selectedScan} onOpenChange={() => setSelectedScan(null)}>
        <DialogContent aria-describedby={undefined} className="bg-slate-800 border-slate-600 max-w-4xl max-h-[90vh] overflow-y-auto">
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
                  <Badge className={getPriorityColor(selectedScan.priority)}>
                    {selectedScan.priority}
                  </Badge>
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
                    } else {
                      toast({
                        title: "Missing Information",
                        description: "Please fill in both findings and recommendations.",
                        variant: "destructive"
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

      {/* Stats Modal */}
      <Dialog open={showStatsModal} onOpenChange={setShowStatsModal}>
        <DialogContent aria-describedby={undefined} className="bg-slate-800 border-slate-600 max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Radiologist Performance Statistics
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-700 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-orange-400">{safeStats.pendingReviews}</div>
                <div className="text-sm text-slate-300">Pending Reviews</div>
              </div>
              <div className="bg-slate-700 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-green-400">{safeStats.completedToday}</div>
                <div className="text-sm text-slate-300">Completed Today</div>
              </div>
              <div className="bg-slate-700 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {safeStats.meanAiConfidencePct === null ? '—' : `${safeStats.meanAiConfidencePct}%`}
                </div>
                <div className="text-sm text-slate-300">Mean AI Confidence</div>
              </div>
              <div className="bg-slate-700 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-blue-400">
                  {orDash(safeStats.medianReviewHours, 'h')}
                </div>
                <div className="text-sm text-slate-300">Median Review Time</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-700 p-4 rounded-lg">
                <h3 className="text-white font-medium mb-3">Performance Metrics</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-300">Total Scans Reviewed</span>
                    <span className="text-white">{safeStats.totalScansReviewed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">Critical Cases</span>
                    <span className="text-red-400">{safeStats.criticalCases}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">Reviews measured (30d)</span>
                    <span className="text-blue-400">{safeStats.reviewsMeasured}</span>
                  </div>
                  {/*
                    An "Accuracy Rate: 96%" row stood here, from a literal.
                    Accuracy on this deployment is a comparison against confirmed
                    outcomes and is reported where those live, with its
                    denominator and interval attached.
                  */}
                  <div className="flex justify-between items-start gap-2 pt-2 border-t border-slate-600">
                    <span className="text-slate-300">Model accuracy</span>
                    <span className="text-slate-400 text-right text-xs max-w-[60%]">
                      Measured from confirmed outcomes, not from this queue. See the
                      model performance panel.
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-slate-700 p-4 rounded-lg">
                <h3 className="text-white font-medium mb-3">Quick Actions</h3>
                <div className="space-y-2">
                  <Button 
                    onClick={() => {
                      refetchStats();
                      refetchPending();
                      refetchCompleted();
                      toast({ title: "Statistics Updated", description: "Data refreshed successfully." });
                    }}
                    className="w-full bg-green-600 hover:bg-green-700"
                    size="sm"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Data
                  </Button>
                  <Button 
                    onClick={() => {
                      setShowStatsModal(false);
                      setActiveSection('pending');
                    }}
                    className="w-full bg-orange-600 hover:bg-orange-700"
                    size="sm"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    View Pending
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}