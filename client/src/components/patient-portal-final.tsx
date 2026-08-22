import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { useToast } from '@/hooks/use-toast';
import { ScanDetailsModal } from './ScanDetailsModal';
import { AnalysisResultsDisplay } from './AnalysisResultsDisplay';
import RealTimeChat from './real-time-chat';
import ImagingResultsManager from './ImagingResultsManager';

import GoogleAIScanner from './google-ai-scanner';
import AppointmentScheduler from './appointment-scheduler';

import { 
  Heart, Activity, FileText,
  User, Stethoscope, Brain, Shield, TrendingUp, Download, Eye, Edit, Save, X, Trash2, MessageSquare, Calendar,
  AlertCircle, CheckCircle2, Clock, MoreVertical, BarChart3, Minimize2, Maximize2, Minus
} from 'lucide-react';

/**
 * What /api/patient/profile/:id actually returns.
 *
 * Everything is nullable because the database genuinely may not hold it. This
 * interface used to promise non-null allergies, conditions, medications, blood
 * pressure and a four-part health score; the server met that promise by making
 * the values up, identically for every patient. It now returns null for what it
 * does not know, and any renderer must handle that rather than assume a value.
 */
interface PatientData {
  id: number;
  personalInfo: {
    name: string;
    age: number | null;
    gender: string | null;
    bloodType: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    emergencyContact: string | null;
  };
  /** Null: this platform does not record a medical history. */
  medicalHistory: null;
  /** Null: this platform does not record vitals. */
  vitals: null;
  /** Null: no health score is computed. */
  healthScore: null;
  unavailable?: Record<string, string>;
}

export default function PatientPortalFinal({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<any>({});
  const [selectedScan, setSelectedScan] = useState<any>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const [showChat, setShowChat] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [showAppointmentScheduler, setShowAppointmentScheduler] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time patient data
  const { data: patientData, isLoading, error: patientDataError } = useQuery({
    queryKey: [`/api/patient/profile/${user?.id}`],
    queryFn: async () => {
      const response = await fetch(`/api/patient/profile/${user.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch patient data');
      }
      return response.json();
    },
    enabled: !!user?.id,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true
  });



  // Real-time scan results
  const { data: scanResults, isLoading: scansLoading } = useQuery({
    queryKey: [`/api/scans`],
    queryFn: async () => {
      const response = await fetch(`/api/scans?patientId=${user.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        return [];
      }
      return response.json();
    },
    enabled: !!user?.id,
    retry: 1,
    staleTime: 1 * 60 * 1000
  });

  // Real-time appointments data
  const { data: appointments, isLoading: appointmentsLoading, error: appointmentsError } = useQuery({
    queryKey: [`/api/appointments/${user?.id}`],
    queryFn: async () => {
      const response = await fetch(`/api/appointments?patientId=${user.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        return [];
      }
      return response.json();
    },
    enabled: !!user?.id,
    retry: 1,
    staleTime: 2 * 60 * 1000
  });

  // Delete scan mutation with fallback
  const deleteScanMutation = useMutation({
    mutationFn: async (scanId: number) => {
      try {
        const response = await fetch(`/api/scans/${scanId}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        if (!response.ok) {
          if (response.status === 403) {
            // Fallback: Remove from local state only
            return { localDelete: true, scanId };
          }
          throw new Error(`Server error: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        // If API fails, remove from local state as fallback
        return { localDelete: true, scanId };
      }
    },
    onSuccess: (data) => {
      if (data?.localDelete) {
        // Remove from local state when API is not available
        queryClient.setQueryData([`/api/scans`], (old: any) => {
          if (Array.isArray(old)) {
            return old.filter((scan: any) => scan.id !== data.scanId);
          }
          return old;
        });
        toast({
          title: "Scan Removed",
          description: "The scan has been removed from your view.",
        });
      } else {
        // Normal API deletion
        queryClient.invalidateQueries({ queryKey: [`/api/scans`] });
        toast({
          title: "Scan Deleted",
          description: "The scan has been successfully deleted.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Remove Failed",
        description: "Unable to remove scan. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updatedProfile: any) => {
      const response = await fetch(`/api/patient/profile/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updatedProfile)
      });
      if (!response.ok) {
        throw new Error('Failed to update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patient/profile/${user.id}`] });
      setEditingProfile(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile.",
        variant: "destructive",
      });
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal': return 'bg-green-100 text-green-800 border-green-300';
      case 'abnormal': return 'bg-red-100 text-red-800 border-red-300';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'critical': return 'bg-red-200 text-red-900 border-red-400';
      case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-700';
    if (score >= 60) return 'text-yellow-700';
    return 'text-red-700';
  };

  const getScanTypeDisplay = (scanType: string) => {
    const type = scanType.toLowerCase();
    if (type.includes('breast')) return { name: 'Mammography', modality: 'Digital Mammogram', icon: '🔬' };
    if (type.includes('lung')) return { name: 'Pulmonary MRI', modality: 'Magnetic Resonance Imaging', icon: '🫁' };
    if (type.includes('skin')) return { name: 'Dermatoscopy', modality: 'Digital Dermoscopy', icon: '🔍' };
    if (type.includes('colon')) return { name: 'Colonoscopy', modality: 'Endoscopic Imaging', icon: '🩺' };
    if (type.includes('prostate')) return { name: 'Prostate MRI', modality: 'Multiparametric MRI', icon: '⚕️' };
    return { name: scanType, modality: 'Medical Imaging', icon: '🏥' };
  };

  /**
   * The patient's own scan cards.
   *
   * Two things were invented here and one was recomputed wrongly.
   *
   * `confidence` read `scan.aiConfidence || '85%'`, so a scan that had never
   * recorded a confidence — one queued for manual review, or written before the
   * column existed — was shown to the patient as 85% confident. The same literal
   * was parsed into the risk calculation below it, so the fabricated figure also
   * decided which band the card was painted.
   *
   * `riskLevel` was then derived in the browser by searching the result text for
   * "abnormal", "suspicious", "malignant" or "cancer" and comparing that
   * confidence against 80. The server records `risk_level` on the row — the band
   * the model actually assigned, which is what the clinician sees — so the
   * patient's card and the clinician's queue could disagree about the same scan
   * purely because of how the finding was worded.
   *
   * Everything below now comes from the row.
   */
  const processedScans = useMemo(() => {
    if (!Array.isArray(scanResults)) return [];

    return scanResults.map(scan => {
      const scanDisplay = getScanTypeDisplay(scan.scanType || 'Medical Scan');
      return {
        id: scan.id,
        type: scanDisplay.name,
        modality: scanDisplay.modality,
        icon: scanDisplay.icon,
        // Null rather than "Analysis completed" — a scan still being read has no
        // result, and saying it completed is the opposite of true.
        result: scan.result ?? null,
        // Null when the scan recorded no confidence, so the card can say so.
        confidence: scan.aiConfidence || null,
        date: scan.createdAt ?? null,
        status: scan.status ?? 'pending',
        // The band the model assigned, as stored. Not re-derived from prose.
        riskLevel: scan.riskLevel ?? null,
        modelVersion: scan.modelVersion ?? null,
      };
    });
  }, [scanResults]);

  const downloadScan = useCallback(async (scan: any) => {
    try {
      toast({
        title: "Download Started",
        description: `Downloading ${scan.type} report...`,
      });
      // Add actual download logic here
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Unable to download the report. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const viewScanDetails = useCallback((scan: any) => {
    setSelectedScan(scan);
    setIsDetailsModalOpen(true);
  }, []);



  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600 mx-auto mb-4"></div>
          <p className="text-slate-700">Loading patient data...</p>
        </div>
      </div>
    );
  }

  if (patientDataError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="text-red-600 text-lg">⚠️ Error Loading Patient Data</div>
          <p className="text-slate-700">{patientDataError.message}</p>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!patientData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="text-yellow-600 text-lg">⚠️ No Patient Data Found</div>
          <p className="text-slate-700">Unable to load your profile information.</p>
          <Button onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions Bar */}
      <Card className="bg-slate-800 border-slate-600">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-white">Patient Portal</h2>
              <div className="flex items-center gap-2">
                <Button 
                  onClick={() => {
                    setShowChat(true);
                    setChatMinimized(false);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white flex items-center"
                  size="sm"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Chat with Doctor
                </Button>
                <Button 
                  onClick={() => setShowAppointmentScheduler(true)}
                  className="bg-green-600 hover:bg-green-700 text-white flex items-center"
                  size="sm"
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Schedule Appointment
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-3 text-white text-xl">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <FileText className="w-5 h-5" />
                </div>
                Medical Imaging Results
              </CardTitle>
              <CardDescription className="text-slate-300 mt-2">
                Comprehensive AI-powered analysis of your medical scans and diagnostic imaging studies
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      <CardContent>
              {/* Comprehensive Analysis Dashboard */}
              {processedScans.length > 0 && (
                <div className="space-y-6 mb-8">
                  {/* Primary Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="bg-gradient-to-br from-slate-700 to-slate-800 border-slate-600">
                      <CardContent className="p-5 text-center">
                        <div className="text-3xl font-bold text-white mb-1">{processedScans.length}</div>
                        <div className="text-sm text-slate-300 font-medium">Total Examinations</div>
                        <div className="text-xs text-slate-400 mt-1">Lifetime Studies</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-green-700 to-green-800 border-green-600">
                      <CardContent className="p-5 text-center">
                        <div className="text-3xl font-bold text-white mb-1">
                          {processedScans.filter(s => s.status === 'completed').length}
                        </div>
                        <div className="text-sm text-green-100 font-medium">Analysis Complete</div>
                        <div className="text-xs text-green-200 mt-1">Ready for Review</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-yellow-600 to-yellow-700 border-yellow-500">
                      <CardContent className="p-5 text-center">
                        <div className="text-3xl font-bold text-white mb-1">
                          {processedScans.filter(s => s.status === 'pending').length}
                        </div>
                        <div className="text-sm text-yellow-100 font-medium">In Processing</div>
                        <div className="text-xs text-yellow-200 mt-1">AI Analysis Active</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-blue-700 to-blue-800 border-blue-600">
                      <CardContent className="p-5 text-center">
                        <div className="text-3xl font-bold text-white mb-1">
                          {processedScans.filter(s => new Date(s.date) > new Date(Date.now() - 30*24*60*60*1000)).length}
                        </div>
                        <div className="text-sm text-blue-100 font-medium">Recent Studies</div>
                        <div className="text-xs text-blue-200 mt-1">Last 30 Days</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Advanced Analytics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-slate-700 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-300 text-sm font-medium">Risk Distribution</span>
                          <Shield className="w-4 h-4 text-slate-400" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-slate-400">Low Risk</span>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-slate-600 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-green-500 rounded-full transition-all duration-300" 
                                  style={{width: `${processedScans.length > 0 ? (processedScans.filter(s => s.riskLevel === 'low').length / processedScans.length) * 100 : 0}%`}}
                                ></div>
                              </div>
                              <span className="text-xs text-green-400 font-medium">{processedScans.filter(s => s.riskLevel === 'low').length}</span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-slate-400">Medium Risk</span>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-slate-600 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-yellow-500 rounded-full transition-all duration-300" 
                                  style={{width: `${processedScans.length > 0 ? (processedScans.filter(s => s.riskLevel === 'medium').length / processedScans.length) * 100 : 0}%`}}
                                ></div>
                              </div>
                              <span className="text-xs text-yellow-400 font-medium">{processedScans.filter(s => s.riskLevel === 'medium').length}</span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-slate-400">High Risk</span>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-slate-600 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-red-500 rounded-full transition-all duration-300" 
                                  style={{width: `${processedScans.length > 0 ? (processedScans.filter(s => s.riskLevel === 'high').length / processedScans.length) * 100 : 0}%`}}
                                ></div>
                              </div>
                              <span className="text-xs text-red-400 font-medium">{processedScans.filter(s => s.riskLevel === 'high').length}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-slate-700 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-300 text-sm font-medium">Your Scans</span>
                          <Brain className="w-4 h-4 text-slate-400" />
                        </div>
                        {/*
                          This card was headed "AI Performance" and carried three
                          figures, none of which described this platform:

                            Avg Confidence   averaged scan.confidence, which fell
                                             back to the literal '85%' per scan,
                                             and to a literal 91% when the patient
                                             had no scans at all
                            Processing Speed the string "2.3s avg"
                            Model Accuracy   the string "94.2%"

                          The last one is a clinical performance claim shown to a
                          patient. Measured accuracy for these models needs
                          confirmed outcomes and is published, with its
                          denominators and confidence intervals, on the model
                          cards at /api/models/cards. It is not something a
                          patient dashboard should assert in passing, so the card
                          now counts the patient's own scans instead.
                        */}
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-400">Scans on file</span>
                            <span className="text-sm text-blue-400 font-medium">
                              {processedScans.length}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-400">Awaiting a clinician</span>
                            <span className="text-sm text-orange-400 font-medium">
                              {processedScans.filter((s: any) => s.status !== 'completed').length}
                            </span>
                          </div>
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-xs text-slate-400">Model performance</span>
                            <span className="text-xs text-slate-400 text-right max-w-[55%]">
                              Published on the model cards, with its measurement set.
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-slate-700 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-300 text-sm font-medium">Study Types</span>
                          <Activity className="w-4 h-4 text-slate-400" />
                        </div>
                        <div className="space-y-1">
                          {Array.from(new Set(processedScans.map(s => s.type))).slice(0, 3).map((type, index) => (
                            <div key={index} className="flex justify-between items-center">
                              <span className="text-xs text-slate-400 truncate">{type}</span>
                              <span className="text-xs text-slate-300 font-medium">
                                {processedScans.filter(s => s.type === type).length}
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
              
              {scansLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="h-24 bg-slate-700 rounded-xl animate-pulse border border-slate-600"></div>
                  ))}
                </div>
              ) : processedScans.length > 0 ? (
                <ImagingResultsManager
                  results={processedScans.map((scan: any) => ({
                    id: scan.id.toString(),
                    patientName: user?.fullName || 'Patient',
                    scanType: scan.type,
                    analysisDate: scan.date,
                    /*
                      Straight from the row.

                      This block re-derived `riskLevel` in the browser by
                      searching the result text for "abnormal", "suspicious",
                      "malignant" or "cancer" and comparing a confidence — which
                      itself defaulted to a literal 85% — against 80. The comment
                      above it read "Recalculate risk level to ensure
                      consistency", and it did the opposite: the server stores the
                      band the model assigned, so recomputing it here is how the
                      patient's card and the clinician's queue came to disagree
                      about the same scan.

                      `hasCancer: riskLevel === 'high'` was the sharpest edge of
                      it — a cancer determination made in a browser, from a
                      substring match, on a number the server had not supplied.
                      The row records `predictedPositive` for exactly this, and a
                      scan with no prediction is not a negative.
                    */
                    confidence: scan.confidence
                      ? parseInt(String(scan.confidence).replace('%', ''), 10)
                      : null,
                    riskLevel: scan.riskLevel,
                    primaryFinding: scan.result,
                    hasCancer: scan.predictedPositive ?? null,
                    imageUrl: scan.imageUrl
                  }))}
                  onViewResult={(result) => {
                    const scan = processedScans.find(s => s.id.toString() === result.id);
                    if (scan) viewScanDetails(scan);
                  }}
                  onDeleteResult={(id) => {
                    if (window.confirm('Are you sure you want to remove this scan result?')) {
                      deleteScanMutation.mutate(parseInt(id));
                    }
                  }}
                />
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🏥</div>
                  <h3 className="text-xl font-semibold text-slate-300 mb-2">No Medical Scans Yet</h3>
                  <p className="text-slate-400 mb-6">Start your health journey by uploading your first medical scan</p>
                  <Button 
                    onClick={() => setActiveTab?.('google-ai')}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    Start AI Analysis
                  </Button>
                </div>
              )}
      </CardContent>
      
      {selectedScan && (
        <ScanDetailsModal 
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          scan={selectedScan}
        />
      )}
      </Card>

      {/* Enhanced Real-time Chat Modal - Maximized */}
      {showChat && !chatMinimized && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-7xl h-[85vh] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl overflow-hidden relative shadow-2xl border border-slate-700 flex flex-col">
            {/* Enhanced Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 border-b border-slate-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">Medical Chat Portal</h3>
                    <p className="text-blue-100 text-sm">Secure communication with healthcare providers</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-1 bg-white bg-opacity-20 rounded-full">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-white text-sm font-medium">Online</span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setChatMinimized(true)}
                    className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2"
                    title="Minimize Chat"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setShowChat(false)}
                    className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2"
                    title="Close Chat"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            
            {/* Chat Content with Enhanced Styling */}
            <div className="flex-1 bg-slate-900 overflow-hidden">
              <RealTimeChat 
                currentUser={{
                  id: user.id,
                  name: user.fullName,
                  role: 'patient'
                }}
                onClose={() => setShowChat(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Minimized Chat Window */}
      {showChat && chatMinimized && (
        <div className="fixed bottom-20 right-6 z-50 w-96 bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-2xl border border-slate-600 overflow-hidden">
          {/* Minimized Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div>
                  <span className="text-white font-semibold text-sm">Medical Chat</span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-blue-100 text-xs">Healthcare providers online</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setChatMinimized(false)}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 h-8 w-8"
                  title="Maximize Chat"
                >
                  <Maximize2 className="w-3 h-3" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowChat(false)}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 h-8 w-8"
                  title="Close Chat"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
          
          {/* Minimized Content */}
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-white" />
            </div>
            <h4 className="text-white font-semibold mb-2">Chat Minimized</h4>
            <p className="text-slate-400 text-sm mb-4">Your conversation is ready to continue</p>
            <Button 
              onClick={() => setChatMinimized(false)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 transform hover:scale-105"
            >
              <Maximize2 className="w-4 h-4 mr-2" />
              Open Chat
            </Button>
          </div>
        </div>
      )}

      {/* Appointment Scheduler Modal */}
      {showAppointmentScheduler && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="w-full max-w-4xl max-h-[80vh] overflow-auto bg-white rounded-lg">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Schedule Appointment</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowAppointmentScheduler(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <AppointmentScheduler 
              user={user}
              onClose={() => setShowAppointmentScheduler(false)}
            />
          </div>
        </div>
      )}

      {/* Enhanced Floating Chat Button - Only show when chat is closed */}
      {!showChat && (
        <div className="fixed bottom-6 right-6 z-40">
          <div className="relative">
            {/* Notification Badge */}
            <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center z-10">
              <span className="text-white text-xs font-bold">3</span>
            </div>
            
            {/* Pulsing Ring Animation */}
            <div className="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-20"></div>
            <div className="absolute inset-0 bg-blue-600 rounded-full animate-pulse opacity-30"></div>
            
            <Button 
              onClick={() => {
                setShowChat(true);
                setChatMinimized(false);
              }}
              className="relative bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-2xl rounded-full w-16 h-16 p-0 transition-all duration-300 transform hover:scale-110 border-2 border-white border-opacity-20"
              title="Chat with Healthcare Providers"
            >
              <MessageSquare className="w-7 h-7" />
            </Button>
            
            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-slate-800 text-white text-sm rounded-lg opacity-0 hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
              Chat with Doctor
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}