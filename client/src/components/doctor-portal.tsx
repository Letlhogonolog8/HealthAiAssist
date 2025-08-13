import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWebSocketRealTime } from "@/hooks/useWebSocketRealTime";
import { ScanDetailsModal } from './ScanDetailsModal';
import { AnalysisResultsDisplay } from './AnalysisResultsDisplay';
import { 
  Users, 
  Calendar, 
  FileText, 
  AlertTriangle, 
  Clock, 
  CheckCircle, 
  XCircle,
  Edit,
  Trash2,
  Phone,
  MessageSquare,
  Activity,
  TrendingUp,
  Star,
  RefreshCw,
  Bell,
  User,
  Stethoscope,
  Heart,
  Brain
} from "lucide-react";

interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
}

interface Appointment {
  id: number;
  patientName: string;
  patientEmail: string;
  date: string;
  time: string;
  reason: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  priority: 'low' | 'medium' | 'high';
}

interface Patient {
  id: number;
  name: string;
  email: string;
  phone?: string;
  age: number;
  gender: string;
  lastVisit: string;
  condition: string;
  status: 'stable' | 'follow-up' | 'critical';
  riskLevel: 'low' | 'medium' | 'high';
  recentScans: number;
  nextAppointment?: string;
}

interface Report {
  id: number;
  patientName: string;
  scanType: string;
  date?: string;
  submittedAt: string;
  status: 'pending' | 'reviewed' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  findings?: string;
  radiologist?: string;
  aiConfidence?: string;
}

interface DoctorStats {
  activePatients: number;
  todaysAppointments: number;
  pendingReports: number;
  criticalCases: number;
  avgConsultationTime: string;
  patientSatisfaction: number;
}

export default function DoctorPortal({ user, setActiveTab, onSectionChange }: { user: User; setActiveTab?: (tab: string) => void; onSectionChange?: (section: string, data?: any) => void }) {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [activePatientId, setActivePatientId] = useState<number | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  // Close notifications when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);
  const [scheduleForm, setScheduleForm] = useState({
    patientId: '',
    date: '',
    time: '',
    type: '',
    reason: ''
  });
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time WebSocket connection (disabled for now to prevent errors)
  const { isConnected, lastMessage, sendMessage } = {
    isConnected: false,
    lastMessage: null,
    sendMessage: () => false
  };

  // Fetch real-time stats with fallback
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<DoctorStats>({
    queryKey: ['/api/doctor/stats'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/doctor/stats', {
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        return response.json();
      } catch (error) {
        throw error;
      }
    },
    refetchInterval: 15000,
    retry: 1,
    staleTime: 30000
  });

  // Fetch appointments - using upcoming appointments to show scheduled ones
  const { data: appointments = [], refetch: refetchAppointments, error: appointmentsError } = useQuery<Appointment[]>({
    queryKey: ['/api/doctor/appointments/upcoming'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/appointments/upcoming', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 5000,
    retry: 1
  });

  // Fetch active patients
  const { data: patients = [], isLoading: patientsLoading, error: patientsError } = useQuery<Patient[]>({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/patients', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 15000,
    retry: 1
  });

  // Fetch pending reports
  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ['/api/doctor/reports/pending'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/reports/pending', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 8000,
    retry: 1
  });

  // Fetch notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ['/api/doctor/notifications'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/notifications', {
        credentials: 'include'
      });
      if (!response.ok) {
        console.warn('Failed to fetch notifications, using fallback');
        return [];
      }
      return response.json();
    },
    refetchInterval: 10000,
    retry: 1
  });

  // Appointment action mutations
  const appointmentActionMutation = useMutation({
    mutationFn: async ({ appointmentId, action, notes }: { appointmentId: number; action: 'accept' | 'decline' | 'complete' | 'delete'; notes?: string }) => {
      let endpoint = `/api/doctor/appointments/${appointmentId}`;
      let method = 'POST';
      
      if (action === 'delete') {
        method = 'DELETE';
      } else {
        endpoint += `/${action}`;
      }
      
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'DELETE' ? JSON.stringify({ notes }) : undefined,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to ${action} appointment`);
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Appointment Updated",
        description: `Appointment ${variables.action}ed successfully.`,
      });
      refetchAppointments();
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
      setSelectedAppointment(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update appointment",
        variant: "destructive",
      });
    },
  });

  // Send chat message mutation
  const sendChatMutation = useMutation({
    mutationFn: async ({ patientId, message }: { patientId: number; message: string }) => {
      const response = await fetch('/api/doctor/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, message }),
      });
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Message Sent",
        description: "Your message has been sent to the patient.",
      });
      setChatMessage("");
      // Real-time notification would be sent here when WebSocket is enabled
    },
  });

  // Schedule appointment mutation
  const scheduleAppointmentMutation = useMutation({
    mutationFn: async (appointmentData: any) => {
      const response = await fetch('/api/doctor/appointments/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData),
      });
      if (!response.ok) throw new Error('Failed to schedule appointment');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Appointment Scheduled",
        description: "The appointment has been scheduled successfully.",
      });
      refetchAppointments();
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
      setShowScheduleDialog(false);
      setScheduleForm({ patientId: '', date: '', time: '', type: '', reason: '' });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule appointment",
        variant: "destructive",
      });
    },
  });

  // Report approval mutation
  const approveReportMutation = useMutation({
    mutationFn: async ({ reportId, notes }: { reportId: number; notes?: string }) => {
      const response = await fetch(`/api/doctor/reports/${reportId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!response.ok) throw new Error('Failed to approve report');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Report Approved",
        description: "The report has been approved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/reports/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to approve report",
        variant: "destructive",
      });
    },
  });

  const handleAppointmentAction = (action: 'accept' | 'decline' | 'complete' | 'delete') => {
    if (selectedAppointment) {
      appointmentActionMutation.mutate({
        appointmentId: selectedAppointment.id,
        action,
        notes: appointmentNotes
      });
    }
  };

  const sendChatToPatient = (patientId: number) => {
    if (chatMessage.trim()) {
      sendChatMutation.mutate({ patientId, message: chatMessage });
    }
  };

  const fetchAvailableSlots = async (date: string) => {
    if (!date) return;
    
    setLoadingSlots(true);
    try {
      const response = await fetch(`/api/doctor/appointments/available-slots?date=${date}`);
      if (response.ok) {
        const slots = await response.json();
        setAvailableSlots(slots);
      } else {
        console.error('Failed to fetch available slots');
        setAvailableSlots([]);
      }
    } catch (error) {
      console.error('Error fetching available slots:', error);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleScheduleAppointment = () => {
    if (!scheduleForm.patientId || !scheduleForm.date || !scheduleForm.time || !scheduleForm.type) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    scheduleAppointmentMutation.mutate({
      patientId: scheduleForm.patientId,
      appointmentDate: scheduleForm.date,
      appointmentTime: scheduleForm.time,
      type: scheduleForm.type,
      reason: scheduleForm.reason || 'Doctor scheduled appointment'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-600';
      case 'confirmed': return 'bg-blue-600';
      case 'completed': return 'bg-green-600';
      case 'cancelled': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-green-500';
      default: return 'text-gray-500';
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

  const getPatientStatusColor = (status: string) => {
    switch (status) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'follow-up': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'stable': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Stethoscope className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Doctor Portal
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Welcome back, Dr. {user.fullName}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-full">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {isConnected ? 'Connected' : 'Offline'}
                </span>
              </div>
              <div className="relative" ref={notificationRef}>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="relative"
                  onClick={() => setShowNotifications(!showNotifications)}
                >
                  <Bell className="w-4 h-4" />
                  {(notifications as any[])?.length > 0 && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                      <span className="text-xs text-white">{(notifications as any[]).length}</span>
                    </div>
                  )}
                </Button>
                {showNotifications && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-lg z-50">
                    <div className="p-3 border-b border-slate-600">
                      <h3 className="font-medium text-white">Notifications</h3>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {(notifications as any[])?.length > 0 ? (
                        (notifications as any[]).map((notification: any, index: number) => (
                          <div 
                            key={index} 
                            className="p-3 border-b border-slate-700 hover:bg-slate-700 cursor-pointer transition-colors"
                            onClick={() => {
                              if (notification.type === 'scan_result') {
                                setActiveTab?.('scans');
                              } else if (notification.type === 'appointment') {
                                setActiveTab?.('appointments');
                              }
                              setShowNotifications(false);
                            }}
                          >
                            <p className="text-sm text-white">{notification.message}</p>
                            <p className="text-xs text-slate-400 mt-1">{notification.timestamp}</p>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-slate-400">
                          <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No new notifications</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Performance Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          {statsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm">
                <CardContent className="p-6">
                  <div className="animate-pulse">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2"></div>
                    <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : statsError ? (
            <div className="col-span-full">
              <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
                <CardContent className="p-6 text-center">
                  <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                  <p className="text-yellow-700 dark:text-yellow-300">Unable to load dashboard statistics</p>
                  <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">Some features may be limited</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <>
              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Active Patients</p>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats?.activePatients || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                      <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Today's Appointments</p>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats?.todaysAppointments || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Pending Reports</p>
                      <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats?.pendingReports || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center">
                      <FileText className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Critical Cases</p>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats?.criticalCases || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Avg Consultation</p>
                      <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats?.avgConsultationTime || '0m'}</p>
                    </div>
                    <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center">
                      <Clock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Patient Satisfaction</p>
                      <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{stats?.patientSatisfaction || 0}%</p>
                    </div>
                    <div className="w-12 h-12 bg-cyan-100 dark:bg-cyan-900/20 rounded-lg flex items-center justify-center">
                      <Star className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
        
        {/* Error indicator for stats */}
        {statsError && (
          <div className="mb-6">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-center">
                <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2" />
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Dashboard is running in offline mode. Some data may not be current.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Overview Content */}
        <div className="mt-6 space-y-6">
            {/* Quick Actions */}
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Button 
                    onClick={() => {
                      setActiveTab?.('patients');
                      if (onSectionChange) onSectionChange('patients');
                    }}
                    className="bg-blue-600 hover:bg-blue-700 h-16 flex flex-col gap-2"
                  >
                    <Users className="w-6 h-6" />
                    <span>View Patients</span>
                  </Button>
                  <Button 
                    onClick={() => setShowScheduleDialog(true)}
                    className="bg-green-600 hover:bg-green-700 h-16 flex flex-col gap-2"
                  >
                    <Calendar className="w-6 h-6" />
                    <span>Schedule Appointment</span>
                  </Button>
                  <Button 
                    onClick={() => setActiveTab?.('reports')}
                    className="bg-purple-600 hover:bg-purple-700 h-16 flex flex-col gap-2"
                  >
                    <FileText className="w-6 h-6" />
                    <span>Review Reports</span>
                  </Button>
                  <Button 
                    onClick={() => setActiveTab?.('google-ai')}
                    className="bg-orange-600 hover:bg-orange-700 h-16 flex flex-col gap-2"
                  >
                    <Brain className="w-6 h-6" />
                    <span>AI Diagnostics</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Today's Appointments */}
              <Card className="bg-slate-800 border-slate-600 shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center text-white">
                      <Calendar className="w-5 h-5 mr-2 text-blue-400" />
                      Today's Appointments
                    </CardTitle>
                    <Badge variant="outline" className="text-green-400 border-green-400 bg-green-900/20">
                      Live
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {appointments.length === 0 ? (
                    <div className="text-center py-12">
                      <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-400">No appointments scheduled for today</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {appointments.map((appointment) => (
                        <div key={appointment.id} className="p-4 bg-slate-700 rounded-lg border border-slate-600">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium text-white">{appointment.patientName}</p>
                              <p className="text-sm text-slate-300 mt-1">{appointment.reason}</p>
                              <p className="text-sm text-slate-400 mt-1">{appointment.time}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <AlertTriangle className={`w-4 h-4 ${getPriorityColor(appointment.priority)}`} />
                              <Badge className={getStatusColor(appointment.status)}>
                                {appointment.status}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="flex space-x-2 mt-3">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => setSelectedAppointment(appointment)}
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Manage
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                setActivePatientId(appointment.id);
                                // Open chat functionality
                              }}
                            >
                              <MessageSquare className="w-3 h-3 mr-1" />
                              Chat
                            </Button>

                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Patient Scans */}
              <Card className="bg-slate-800 border-slate-600 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center text-white">
                    <Activity className="w-5 h-5 mr-2 text-blue-400" />
                    Recent Patient Scans
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <Activity className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-400">No recent scans available</p>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Pending Reports Section */}
            {reports.length > 0 && (
              <Card className="bg-slate-800 border-slate-600 shadow-sm mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-white">
                    <div className="flex items-center">
                      <FileText className="w-5 h-5 mr-2 text-blue-400" />
                      Pending Reports for Review
                    </div>
                    <Badge variant="outline" className="text-yellow-400 border-yellow-400">
                      {reports.length} pending
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {reports.slice(0, 3).map((report) => (
                      <div key={report.id} className="p-3 bg-slate-700 rounded-lg border border-slate-600">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <p className="font-medium text-white text-sm">{report.patientName}</p>
                            <p className="text-xs text-slate-400">{report.scanType} • {new Date(report.submittedAt).toLocaleDateString()}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs px-2 py-1 ${
                              report.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                              report.priority === 'high' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {report.priority?.toUpperCase()}
                            </Badge>
                            <Button 
                              size="sm" 
                              onClick={() => approveReportMutation.mutate({ reportId: report.id })}
                              disabled={approveReportMutation.isPending}
                              className="bg-green-600 hover:bg-green-700 text-xs px-2 py-1 h-6"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Approve
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {reports.length > 3 && (
                    <div className="mt-4 pt-3 border-t border-slate-600">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-slate-300 border-slate-600 hover:bg-slate-700"
                        onClick={() => setActiveTab?.('reports')}
                      >
                        View All {reports.length} Reports
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
        </div>

        {/* Patient Management Section */}
        {patients.length > 0 && (
          <Card className="bg-slate-800 border-slate-600 shadow-sm mt-6">
            <CardHeader>
              <CardTitle className="flex items-center text-white">
                <Users className="w-5 h-5 mr-2 text-blue-400" />
                Active Patients Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {patients.slice(0, 6).map((patient) => (
                  <div key={patient.id} className="p-4 bg-slate-700 rounded-lg border border-slate-600">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-white">{patient.name}</p>
                        <p className="text-sm text-slate-400">{patient.age} years, {patient.gender}</p>
                      </div>
                      <Badge className={getRiskColor(patient.riskLevel)}>
                        {patient.riskLevel?.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 space-y-1">
                      <p>Last Visit: {new Date(patient.lastVisit).toLocaleDateString()}</p>
                      <p>Condition: {patient.condition}</p>
                      <p>Recent Scans: {patient.recentScans}</p>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" className="text-xs">
                        <User className="w-3 h-3 mr-1" />
                        View Profile
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs"
                        onClick={() => {
                          setActivePatientId(patient.id);
                          // Open chat functionality
                        }}
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Message
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Schedule Appointment Dialog - Enhanced Professional Styling */}
        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent className="max-w-lg bg-gradient-to-br from-blue-50 to-indigo-100 border-2 border-blue-300 shadow-xl" data-enhanced="v2">
            <DialogHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg -m-6 mb-6 p-6">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                Schedule New Appointment - Enhanced
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 p-2">
              <div className="space-y-2">
                <Label htmlFor="patient" className="font-semibold text-gray-800 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Select Patient
                </Label>
                <Select value={scheduleForm.patientId} onValueChange={(value) => setScheduleForm({...scheduleForm, patientId: value})}>
                  <SelectTrigger className="border-2 border-blue-300 focus:border-blue-500 bg-blue-50 focus:bg-white">
                    <SelectValue placeholder="Choose a patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id.toString()}>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          {patient.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date" className="font-semibold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Appointment Date
                  </Label>
                  <Input
                    id="date"
                    type="date"
                    value={scheduleForm.date}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      setScheduleForm({...scheduleForm, date: newDate, time: ''});
                      if (newDate) {
                        fetchAvailableSlots(newDate);
                      }
                    }}
                    min={new Date().toISOString().split('T')[0]}
                    className="border-2 border-blue-300 focus:border-blue-500 bg-blue-50 focus:bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time" className="font-semibold text-gray-800 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Available Times
                  </Label>
                  <Select 
                    value={scheduleForm.time} 
                    onValueChange={(value) => setScheduleForm({...scheduleForm, time: value})}
                    disabled={!scheduleForm.date || loadingSlots}
                  >
                    <SelectTrigger className="border-2 border-blue-200 focus:border-blue-400">
                      <SelectValue placeholder={loadingSlots ? "Loading..." : "Select time"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSlots.length === 0 && scheduleForm.date && !loadingSlots ? (
                        <SelectItem value="" disabled>No available slots</SelectItem>
                      ) : (
                        availableSlots.map((slot) => (
                          <SelectItem key={slot} value={slot}>
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              {slot}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {scheduleForm.date && availableSlots.length === 0 && !loadingSlots && (
                    <p className="text-sm text-amber-600 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      No available slots for this date
                    </p>
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="type" className="font-semibold text-gray-800 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4" />
                  Appointment Type
                </Label>
                <Select value={scheduleForm.type} onValueChange={(value) => setScheduleForm({...scheduleForm, type: value})}>
                  <SelectTrigger className="border-2 border-blue-200 focus:border-blue-400">
                    <SelectValue placeholder="Choose consultation type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General Consultation">🩺 General Consultation</SelectItem>
                    <SelectItem value="Follow-up Appointment">📋 Follow-up Visit</SelectItem>
                    <SelectItem value="Cancer Screening">🔬 Cancer Screening</SelectItem>
                    <SelectItem value="Emergency Consultation">🚨 Emergency Care</SelectItem>
                    <SelectItem value="Diagnostic Imaging">📸 Diagnostic Imaging</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="reason" className="font-semibold text-gray-800 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Reason for Visit
                </Label>
                <Textarea
                  id="reason"
                  value={scheduleForm.reason}
                  onChange={(e) => setScheduleForm({...scheduleForm, reason: e.target.value})}
                  placeholder="Describe the reason for this appointment..."
                  rows={3}
                  className="border-2 border-blue-200 focus:border-blue-400 resize-none"
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={handleScheduleAppointment}
                  disabled={scheduleAppointmentMutation.isPending || !scheduleForm.patientId || !scheduleForm.date || !scheduleForm.time || !scheduleForm.type}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 shadow-lg transition-all duration-200 transform hover:scale-105"
                >
                  {scheduleAppointmentMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Scheduling...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Schedule Appointment
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setShowScheduleDialog(false)}
                  disabled={scheduleAppointmentMutation.isPending}
                  className="flex-1 border-2 border-gray-300 hover:border-gray-400"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Appointment Management Dialog */}
        {selectedAppointment && (
          <Dialog open={!!selectedAppointment} onOpenChange={() => setSelectedAppointment(null)}>
            <DialogContent className="bg-slate-800 border-slate-700">
              <DialogHeader>
                <DialogTitle className="text-white">Manage Appointment</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Patient</Label>
                    <p className="text-white">{selectedAppointment.patientName}</p>
                  </div>
                  <div>
                    <Label className="text-slate-300">Time</Label>
                    <p className="text-white">{selectedAppointment.time}</p>
                  </div>
                </div>
                
                <div>
                  <Label className="text-slate-300">Reason</Label>
                  <p className="text-white">{selectedAppointment.reason}</p>
                </div>
                
                <div>
                  <Label htmlFor="notes" className="text-slate-300">Notes</Label>
                  <Textarea
                    id="notes"
                    value={appointmentNotes}
                    onChange={(e) => setAppointmentNotes(e.target.value)}
                    placeholder="Add notes about this appointment..."
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                
                <div className="flex space-x-2">
                  <Button 
                    onClick={() => handleAppointmentAction('accept')}
                    disabled={appointmentActionMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Accept
                  </Button>
                  <Button 
                    onClick={() => handleAppointmentAction('decline')}
                    disabled={appointmentActionMutation.isPending}
                    variant="outline"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Decline
                  </Button>
                  <Button 
                    onClick={() => handleAppointmentAction('complete')}
                    disabled={appointmentActionMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete
                  </Button>
                  <Button 
                    onClick={() => handleAppointmentAction('delete')}
                    disabled={appointmentActionMutation.isPending}
                    variant="destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}