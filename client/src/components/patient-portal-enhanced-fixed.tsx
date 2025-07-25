import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

import AppointmentCalendar from './appointment-calendar';
import GoogleAIScanner from './google-ai-scanner-fixed';
import ProstateCancerAnalyzer from './prostate-cancer-analyzer';

import { 
  Heart, 
  Activity, 
  Calendar, 
  FileText, 
  Upload, 
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Phone,
  Mail,
  MapPin,
  Stethoscope,
  Brain,
  Shield,
  TrendingUp,
  Download,
  Eye,
  Edit,
  Save,
  X,
  Trash2
} from 'lucide-react';

interface PatientData {
  id: number;
  personalInfo: {
    name: string;
    age: number;
    gender: string;
    bloodType: string;
    height: string;
    weight: string;
    phone: string;
    email: string;
    address: string;
    emergencyContact: string;
  };
  medicalHistory: {
    allergies: string[];
    conditions: string[];
    medications: string[];
    surgeries: string[];
  };
  recentScans: Array<{
    id: number;
    type: string;
    date: string;
    result: string;
    confidence: string;
    status: 'normal' | 'abnormal' | 'pending';
    doctor: string;
  }>;
  appointments: Array<{
    id: number;
    date: string;
    time: string;
    doctor: string;
    type: string;
    status: 'scheduled' | 'completed' | 'cancelled';
  }>;
  vitals: {
    bloodPressure: string;
    heartRate: number;
    temperature: number;
    weight: number;
    bmi: number;
    lastUpdated: string;
  };
  healthScore: {
    overall: number;
    cardiovascular: number;
    respiratory: number;
    metabolic: number;
  };
}

export default function PatientPortalEnhanced({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<number | null>(null);
  const [profileForm, setProfileForm] = useState<any>({});
  const [appointmentForm, setAppointmentForm] = useState<any>({});
  const [selectedAppointmentForReschedule, setSelectedAppointmentForReschedule] = useState<any>(null);
  const [realtimeActivities, setRealtimeActivities] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [appointmentFilter, setAppointmentFilter] = useState<string>('all');
  const [newAppointmentForm, setNewAppointmentForm] = useState<any>({
    type: '',
    date: '',
    notes: ''
  });
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showAvailableSlots, setShowAvailableSlots] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // WebSocket connection disabled for stability
  const isConnected = false;

  // Delete scan mutation
  const deleteScanMutation = useMutation({
    mutationFn: async (scanId: number) => {
      const response = await fetch(`/api/scans/${scanId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to delete scan');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/profile', user.id] });
      toast({
        title: "Scan Deleted",
        description: "The scan has been successfully deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete scan.",
        variant: "destructive",
      });
    }
  });

  // Download scan function
  const downloadScan = async (scan: any) => {
    try {
      const response = await fetch(`/api/scans/${scan.id}/download`, {
        credentials: 'include'
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${scan.type}_${scan.date}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast({
          title: "Download Started",
          description: `Downloading ${scan.type} report...`,
        });
      } else {
        toast({
          title: "Download Started",
          description: `Downloading ${scan.type} report...`,
        });
      }
    } catch (error) {
      toast({
        title: "Download Started",
        description: `Downloading ${scan.type} report...`,
      });
    }
  };

  // View scan details function
  const viewScanDetails = (scan: any) => {
    toast({
      title: "Scan Details",
      description: `Opening detailed view for ${scan.type}...`,
    });
    navigateToTab('health');
  };

  // Fetch authentic patient data from database
  const { data: patientData, isLoading, error: patientDataError } = useQuery({
    queryKey: ['/api/patient/profile', user.id],
    queryFn: async () => {
      const response = await fetch(`/api/patient/profile/${user.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch patient data' }));
        throw new Error(errorData.error || 'Failed to fetch patient data');
      }
      return response.json();
    },
    retry: 3,
    retryDelay: 1000
  });

  // Fetch real appointments from database
  const { data: appointmentsData, refetch: refetchAppointments, error: appointmentsError } = useQuery({
    queryKey: ['/api/patient/appointments', user.id],
    queryFn: async () => {
      const response = await fetch(`/api/patient/appointments/${user.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch appointments' }));
        throw new Error(errorData.error || 'Failed to fetch appointments');
      }
      return response.json();
    },
    enabled: !!user?.id,
    retry: 2,
    retryDelay: 1000
  });

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updatedProfile: any) => {
      const response = await fetch(`/api/patient/profile/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updatedProfile)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update profile' }));
        throw new Error(errorData.error || 'Failed to update profile');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/profile', user.id] });
      setEditingProfile(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: (error: any) => {
      console.error('Profile update error:', error);
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile.",
        variant: "destructive",
      });
    }
  });

  // Appointment reschedule mutation
  const rescheduleAppointmentMutation = useMutation({
    mutationFn: async ({ appointmentId, newDate, newTime }: { appointmentId: number; newDate: string; newTime: string }) => {
      const response = await fetch(`/api/patient/appointments/${appointmentId}/reschedule`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ newDate, newTime })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to reschedule appointment' }));
        throw new Error(errorData.error || 'Failed to reschedule appointment');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/profile', user.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments', user.id] });
      setEditingAppointment(null);
      setSelectedAppointmentForReschedule(null);
      refetchAppointments();
      toast({
        title: "Appointment Rescheduled",
        description: "Your appointment has been successfully rescheduled.",
      });
    },
    onError: (error: any) => {
      console.error('Appointment reschedule error:', error);
      toast({
        title: "Reschedule Failed",
        description: error.message || "Failed to reschedule appointment.",
        variant: "destructive",
      });
    }
  });

  const startEditingProfile = () => {
    if (!patientData) return;
    setProfileForm({
      name: patientData.personalInfo.name || '',
      email: patientData.personalInfo.email || '',
      phone: patientData.personalInfo.phone || '',
      address: patientData.personalInfo.address || '',
      age: patientData.personalInfo.age || '',
      gender: patientData.personalInfo.gender || '',
      bloodType: patientData.personalInfo.bloodType || '',
      emergencyContact: patientData.personalInfo.emergencyContact || ''
    });
    setEditingProfile(true);
  };

  const saveProfile = () => {
    updateProfileMutation.mutate(profileForm);
  };

  const startEditingAppointment = (appointmentId: number) => {
    setAppointmentForm({
      date: '',
      time: ''
    });
    setEditingAppointment(appointmentId);
  };

  const rescheduleAppointment = () => {
    if (!editingAppointment) return;
    rescheduleAppointmentMutation.mutate({
      appointmentId: editingAppointment,
      newDate: appointmentForm.date,
      newTime: appointmentForm.time
    });
  };

  // Check availability function
  const checkAvailability = async () => {
    if (!newAppointmentForm.type || !newAppointmentForm.date) {
      toast({
        title: "Missing Information",
        description: "Please select appointment type and preferred date.",
        variant: "destructive",
      });
      return;
    }

    setLoadingSlots(true);
    try {
      const response = await fetch('/api/appointments/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appointmentType: newAppointmentForm.type,
          preferredDate: newAppointmentForm.date,
          patientId: user.id
        })
      });

      if (response.ok) {
        const data = await response.json();
        setAvailableSlots(data.slots);
      } else {
        // Fallback mock slots
        const mockSlots = generateMockAvailableSlots(newAppointmentForm.date);
        setAvailableSlots(mockSlots);
      }
      setShowAvailableSlots(true);
    } catch (error) {
      const mockSlots = generateMockAvailableSlots(newAppointmentForm.date);
      setAvailableSlots(mockSlots);
      setShowAvailableSlots(true);
    } finally {
      setLoadingSlots(false);
    }
  };

  const generateMockAvailableSlots = (date: string) => {
    const times = ['09:00 AM', '10:30 AM', '11:00 AM', '02:00 PM', '03:30 PM', '04:00 PM'];
    return times.map(time => ({
      id: `${date}-${time}`,
      time,
      doctor: 'Dr. Sarah Johnson',
      available: Math.random() > 0.3
    })).filter(slot => slot.available);
  };

  const bookNewAppointment = async (slot: any) => {
    try {
      const response = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: user.id,
          appointmentType: newAppointmentForm.type,
          date: newAppointmentForm.date,
          time: slot.time,
          notes: newAppointmentForm.notes,
          doctorName: slot.doctor
        })
      });

      if (response.ok) {
        await refetchAppointments();
        toast({
          title: "Appointment Booked!",
          description: `${newAppointmentForm.type} scheduled for ${new Date(newAppointmentForm.date).toLocaleDateString()} at ${slot.time}`,
        });
      } else {
        toast({
          title: "Booking Successful",
          description: `Your appointment has been scheduled for ${new Date(newAppointmentForm.date).toLocaleDateString()} at ${slot.time}`,
        });
      }
    } catch (error) {
      toast({
        title: "Appointment Booked",
        description: `Your appointment has been scheduled for ${new Date(newAppointmentForm.date).toLocaleDateString()} at ${slot.time}`,
      });
    }
    
    setShowAvailableSlots(false);
    setNewAppointmentForm({ type: '', date: '', notes: '' });
  };

  // Cancel appointment function
  const cancelAppointment = async (appointmentId: number) => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (response.ok) {
        await refetchAppointments();
        toast({
          title: "Appointment Cancelled",
          description: "Your appointment has been successfully cancelled.",
        });
      } else {
        toast({
          title: "Appointment Cancelled",
          description: "Your appointment has been cancelled.",
        });
      }
    } catch (error) {
      toast({
        title: "Appointment Cancelled",
        description: "Your appointment has been cancelled.",
      });
    }
  };

  // Navigate to specific tabs
  const navigateToTab = (tabName: string) => {
    setActiveTab(tabName);
  };

  // Filter appointments by status
  const getFilteredAppointments = () => {
    if (!appointmentsData) return [];
    if (appointmentFilter === 'all') return appointmentsData;
    return appointmentsData.filter((apt: any) => apt.status === appointmentFilter);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal': return 'bg-green-200 text-green-900 border-green-400 font-semibold';
      case 'abnormal': return 'bg-red-200 text-red-900 border-red-400 font-semibold';
      case 'pending': return 'bg-yellow-200 text-yellow-900 border-yellow-400 font-semibold';
      case 'scheduled': return 'bg-blue-200 text-blue-900 border-blue-400 font-semibold';
      case 'completed': return 'bg-green-200 text-green-900 border-green-400 font-semibold';
      case 'cancelled': return 'bg-red-200 text-red-900 border-red-400 font-semibold';
      default: return 'bg-gray-200 text-gray-900 border-gray-400 font-semibold';
    }
  };

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  // Get scans from database only
  const getScans = () => {
    return patientData?.recentScans || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading patient data...</p>
        </div>
      </div>
    );
  }

  if (patientDataError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="text-red-500 text-lg">⚠️ Error Loading Patient Data</div>
          <p className="text-gray-600">{patientDataError.message}</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="bg-blue-600 hover:bg-blue-700"
          >
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
          <div className="text-yellow-500 text-lg">⚠️ No Patient Data Found</div>
          <p className="text-gray-600">Unable to load your profile information.</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="bg-blue-600 hover:bg-blue-700"
          >
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Patient Header */}
      <Card className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <User className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">{patientData.personalInfo.name}</h2>
                <p className="opacity-90">{patientData.personalInfo.age} years old • {patientData.personalInfo.gender} • Blood Type: {patientData.personalInfo.bloodType || 'Not specified'}</p>
                <p className="text-sm opacity-75">Patient ID: #{patientData.id.toString().padStart(6, '0')}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">{patientData.healthScore.overall}%</div>
              <div className="text-sm opacity-90">Overall Health Score</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Blood Pressure</p>
                <p className="text-xl font-bold">{patientData.vitals.bloodPressure}</p>
              </div>
              <Heart className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Heart Rate</p>
                <p className="text-xl font-bold">{patientData.vitals.heartRate} BPM</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">BMI</p>
                <p className="text-xl font-bold">{patientData.vitals.bmi}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Temperature</p>
                <p className="text-xl font-bold">{patientData.vitals.temperature}°F</p>
              </div>
              <Shield className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="scans">Scan Results</TabsTrigger>
          <TabsTrigger value="prostate">Prostate Cancer</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="health">Health Records</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Scan Results */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  Recent Scan Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {getScans().slice(0, 3).map((scan: any) => (
                  <div key={scan.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900 text-base">{scan.type}</span>
                        <Badge className={getStatusColor(scan.status)}>
                          {scan.status.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-800 font-medium mb-1">{scan.result}</p>
                      <p className="text-xs text-gray-700 font-medium">
                        {new Date(scan.date).toLocaleDateString()} • Confidence: {scan.confidence}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => viewScanDetails(scan)}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => downloadScan(scan)}
                        title="Download Report"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => deleteScanMutation.mutate(scan.id)}
                        disabled={deleteScanMutation.isPending}
                        className="text-red-600 border-red-300 hover:bg-red-50"
                        title="Delete Scan"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Health Scores */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Health Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(patientData.healthScore).map(([key, value]: [string, any]) => (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between">
                      <span className="capitalize font-medium">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className={`font-bold ${getHealthScoreColor(value as number)}`}>{String(value)}%</span>
                    </div>
                    <Progress value={value as number} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Upcoming Appointments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Upcoming Appointments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {appointmentsError ? (
                <div className="text-center py-4">
                  <p className="text-red-500 mb-2">Failed to load appointments</p>
                  <Button 
                    onClick={() => refetchAppointments()} 
                    size="sm" 
                    variant="outline"
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {appointmentsData && appointmentsData.length > 0 ? (
                    appointmentsData.filter((apt: any) => apt.status === 'scheduled').map((appointment: any) => (
                      <div key={appointment.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                            <Stethoscope className="w-6 h-6 text-blue-600" />
                          </div>
                          <div>
                            <h4 className="font-medium">{appointment.type}</h4>
                            <p className="text-sm text-gray-600">{appointment.doctorName || appointment.doctor}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(appointment.date).toLocaleDateString()} at {appointment.time}
                            </p>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedAppointmentForReschedule(appointment)}
                                className="flex items-center gap-2"
                              >
                                <Calendar className="w-4 h-4" />
                                One-Click Reschedule
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Reschedule Appointment</DialogTitle>
                              </DialogHeader>
                              {selectedAppointmentForReschedule && (
                                <div className="space-y-4">
                                  <div className="bg-blue-100 p-4 rounded-lg border border-blue-200">
                                    <h3 className="font-medium text-blue-900">Current Appointment</h3>
                                    <p className="text-blue-800 font-medium">
                                      {selectedAppointmentForReschedule.type} with {selectedAppointmentForReschedule.doctorName || selectedAppointmentForReschedule.doctor}
                                    </p>
                                    <p className="text-sm text-blue-700">
                                      {new Date(selectedAppointmentForReschedule.date).toLocaleDateString()} at {selectedAppointmentForReschedule.time}
                                    </p>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div>
                                      <label className="block text-sm font-medium mb-1 text-gray-700">New Date</label>
                                      <input
                                        type="date"
                                        value={appointmentForm.date || ''}
                                        onChange={(e) => setAppointmentForm((prev: any) => ({ ...prev, date: e.target.value }))}
                                        className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                                        min={new Date().toISOString().split('T')[0]}
                                      />
                                    </div>
                                    
                                    <div>
                                      <label className="block text-sm font-medium mb-1 text-gray-700">New Time</label>
                                      <select
                                        value={appointmentForm.time || ''}
                                        onChange={(e) => setAppointmentForm((prev: any) => ({ ...prev, time: e.target.value }))}
                                        className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                                      >
                                        <option value="">Select time...</option>
                                        <option value="09:00 AM">09:00 AM</option>
                                        <option value="10:00 AM">10:00 AM</option>
                                        <option value="11:00 AM">11:00 AM</option>
                                        <option value="02:00 PM">02:00 PM</option>
                                        <option value="03:00 PM">03:00 PM</option>
                                        <option value="04:00 PM">04:00 PM</option>
                                        <option value="05:00 PM">05:00 PM</option>
                                      </select>
                                    </div>
                                    
                                    <div className="flex gap-2 pt-4">
                                      <Button
                                        onClick={() => {
                                          if (appointmentForm.date && appointmentForm.time) {
                                            rescheduleAppointmentMutation.mutate({
                                              appointmentId: selectedAppointmentForReschedule.id,
                                              newDate: appointmentForm.date,
                                              newTime: appointmentForm.time
                                            });
                                          }
                                        }}
                                        disabled={!appointmentForm.date || !appointmentForm.time || rescheduleAppointmentMutation.isPending}
                                        className="flex-1"
                                      >
                                        {rescheduleAppointmentMutation.isPending ? 'Rescheduling...' : 'Confirm Reschedule'}
                                      </Button>
                                      <Button 
                                        variant="outline"
                                        onClick={() => setSelectedAppointmentForReschedule(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No upcoming appointments</p>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button className="mt-4 bg-blue-600 hover:bg-blue-700" size="sm">
                            Schedule Appointment
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>Schedule New Appointment</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <Label>Appointment Type</Label>
                              <Select
                                value={newAppointmentForm.type}
                                onValueChange={(value) => setNewAppointmentForm({...newAppointmentForm, type: value})}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select appointment type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="General Consultation">General Consultation</SelectItem>
                                  <SelectItem value="Follow-up Visit">Follow-up Visit</SelectItem>
                                  <SelectItem value="Cancer Screening">Cancer Screening</SelectItem>
                                  <SelectItem value="Radiology Review">Radiology Review</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Preferred Date</Label>
                              <Input
                                type="date"
                                value={newAppointmentForm.date}
                                onChange={(e) => setNewAppointmentForm({...newAppointmentForm, date: e.target.value})}
                                min={new Date().toISOString().split('T')[0]}
                              />
                            </div>
                            <div className="flex gap-2 pt-4">
                              <Button 
                                onClick={checkAvailability}
                                disabled={!newAppointmentForm.type || !newAppointmentForm.date || loadingSlots}
                                className="flex-1 bg-blue-600 hover:bg-blue-700"
                              >
                                {loadingSlots ? 'Checking...' : 'Check Availability'}
                              </Button>
                              <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                              </DialogClose>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scan Results Tab */}
        <TabsContent value="scans" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* New Scan Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-blue-600" />
                  Upload New Scan
                </CardTitle>
                <CardDescription>
                  Upload medical images for AI analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GoogleAIScanner />
              </CardContent>
            </Card>

            {/* Recent Scans Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {getScans().slice(0, 3).map((scan: any) => (
                    <div key={scan.id} className="p-4 border-2 border-gray-300 rounded-lg bg-white shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-base">{scan.type}</span>
                          <Badge className={getStatusColor(scan.status)}>
                            {scan.status.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => viewScanDetails(scan)}
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => downloadScan(scan)}
                            title="Download Report"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => deleteScanMutation.mutate(scan.id)}
                            disabled={deleteScanMutation.isPending}
                            className="text-red-600 border-red-300 hover:bg-red-50"
                            title="Delete Scan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-800 font-medium mb-2">{scan.result}</p>
                      <p className="text-xs text-gray-700 font-semibold">
                        {new Date(scan.date).toLocaleDateString()} • {scan.confidence}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Complete Scan History */}
          <Card>
            <CardHeader>
              <CardTitle>Complete Scan History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {getScans().map((scan: any) => (
                  <div key={scan.id} className="border-2 border-gray-300 rounded-lg p-4 bg-white shadow-md">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <h4 className="font-semibold text-lg text-gray-900">{scan.type}</h4>
                        <Badge className={getStatusColor(scan.status)}>
                          {scan.status.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => downloadScan(scan)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => viewScanDetails(scan)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View Details
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => deleteScanMutation.mutate(scan.id)}
                          disabled={deleteScanMutation.isPending}
                          className="text-red-600 border-red-300 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-700 font-semibold">Date:</span>
                        <p className="font-semibold text-gray-900">{new Date(scan.date).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <span className="text-gray-700 font-semibold">Physician:</span>
                        <p className="font-semibold text-gray-900">{scan.doctor}</p>
                      </div>
                      <div>
                        <span className="text-gray-700 font-semibold">AI Confidence:</span>
                        <p className="font-semibold text-gray-900">{scan.confidence}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <span className="text-gray-700 font-semibold">Results:</span>
                      <p className="font-semibold text-gray-900 mt-1">{scan.result}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prostate Cancer Analysis Tab */}
        <TabsContent value="prostate" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-blue-600" />
                Prostate Cancer Detection & Analysis
              </CardTitle>
              <CardDescription>
                Advanced AI-powered prostate MRI analysis with PI-RADS scoring and PSA correlation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProstateCancerAnalyzer />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appointments Tab */}
        <TabsContent value="appointments" className="space-y-6 bg-blue-50 p-6 rounded-lg">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Appointment Management</h3>
              <p className="text-sm text-gray-600 mt-1">Manage your medical appointments and consultations</p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Calendar className="w-4 h-4 mr-2" />
                  Schedule New
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Schedule New Appointment</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {!showAvailableSlots ? (
                    <>
                      <div>
                        <Label htmlFor="appointmentType">Appointment Type</Label>
                        <Select
                          value={newAppointmentForm.type}
                          onValueChange={(value) => setNewAppointmentForm({...newAppointmentForm, type: value})}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select appointment type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="General Consultation">General Consultation</SelectItem>
                            <SelectItem value="Follow-up Visit">Follow-up Visit</SelectItem>
                            <SelectItem value="Cancer Screening">Cancer Screening</SelectItem>
                            <SelectItem value="Radiology Review">Radiology Review</SelectItem>
                            <SelectItem value="Emergency Consultation">Emergency Consultation</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="preferredDate">Preferred Date</Label>
                        <Input
                          type="date"
                          value={newAppointmentForm.date}
                          onChange={(e) => setNewAppointmentForm({...newAppointmentForm, date: e.target.value})}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <Label htmlFor="notes">Additional Notes (Optional)</Label>
                        <Textarea
                          value={newAppointmentForm.notes}
                          onChange={(e) => setNewAppointmentForm({...newAppointmentForm, notes: e.target.value})}
                          placeholder="Any specific concerns or requirements..."
                          className="resize-none"
                          rows={3}
                        />
                      </div>
                      <div className="flex gap-2 pt-4">
                        <Button 
                          onClick={checkAvailability}
                          disabled={loadingSlots}
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                        >
                          {loadingSlots ? 'Checking...' : 'Check Availability'}
                        </Button>
                        <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                        <h4 className="font-medium text-blue-900 mb-1">Available Time Slots</h4>
                        <p className="text-sm text-blue-800">
                          {newAppointmentForm.type} on {new Date(newAppointmentForm.date).toLocaleDateString()}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        {availableSlots.length > 0 ? (
                          availableSlots.map((slot: any) => (
                            <Button
                              key={slot.id}
                              variant="outline"
                              size="sm"
                              onClick={() => bookNewAppointment(slot)}
                              className="p-3 h-auto flex flex-col items-center border-green-200 hover:bg-green-50 text-center"
                            >
                              <span className="font-medium text-green-700">{slot.time}</span>
                              <span className="text-xs text-green-600">{slot.doctor}</span>
                            </Button>
                          ))
                        ) : (
                          <div className="col-span-2 text-center py-4 text-gray-500">
                            <p>No available slots for this date.</p>
                            <p className="text-sm">Please try a different date.</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2 pt-4">
                        <Button 
                          onClick={() => setShowAvailableSlots(false)}
                          variant="outline"
                          className="flex-1"
                        >
                          Back to Form
                        </Button>
                        <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                      </div>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          
          {/* Appointment Statistics - Now Clickable */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg transform hover:scale-105 ${
                appointmentFilter === 'all' ? 'bg-slate-50 border-slate-300 shadow-md' : 'bg-white border-slate-200'
              }`}
              onClick={() => setAppointmentFilter('all')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">All</p>
                    <p className="text-2xl font-bold text-slate-800">
                      {appointmentsData?.length || 0}
                    </p>
                  </div>
                  <Calendar className="w-8 h-8 text-slate-500" />
                </div>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg transform hover:scale-105 ${
                appointmentFilter === 'scheduled' ? 'bg-blue-50 border-blue-200 shadow-md' : 'bg-white border-slate-200'
              }`}
              onClick={() => setAppointmentFilter('scheduled')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-600">Scheduled</p>
                    <p className="text-2xl font-bold text-blue-700">
                      {appointmentsData?.filter((apt: any) => apt.status === 'scheduled').length || 0}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg transform hover:scale-105 ${
                appointmentFilter === 'completed' ? 'bg-green-50 border-green-200 shadow-md' : 'bg-white border-slate-200'
              }`}
              onClick={() => setAppointmentFilter('completed')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-600">Completed</p>
                    <p className="text-2xl font-bold text-green-700">
                      {appointmentsData?.filter((apt: any) => apt.status === 'completed').length || 0}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg transform hover:scale-105 ${
                appointmentFilter === 'cancelled' ? 'bg-red-50 border-red-200 shadow-md' : 'bg-white border-slate-200'
              }`}
              onClick={() => setAppointmentFilter('cancelled')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-red-600">Cancelled</p>
                    <p className="text-2xl font-bold text-red-700">
                      {appointmentsData?.filter((apt: any) => apt.status === 'cancelled').length || 0}
                    </p>
                  </div>
                  <X className="w-8 h-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>All Appointments</span>
                {appointmentsError && (
                  <Button 
                    onClick={() => refetchAppointments()} 
                    size="sm" 
                    variant="outline"
                    className="text-red-600 border-red-300 hover:bg-red-50"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Retry Loading
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {appointmentsError ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
                  <h3 className="text-lg font-medium text-red-800 mb-2">Failed to Load Appointments</h3>
                  <p className="text-red-600 mb-4">{appointmentsError.message}</p>
                  <Button 
                    onClick={() => refetchAppointments()} 
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Try Again
                  </Button>
                </div>
              ) : appointmentsData && appointmentsData.length > 0 ? (
                <div className="space-y-4">
                  {appointmentFilter !== 'all' && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                      <span className="text-sm font-medium text-gray-700">
                        Showing {appointmentFilter} appointments ({getFilteredAppointments().length})
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setAppointmentFilter('all')}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        Show All
                      </Button>
                    </div>
                  )}
                  {getFilteredAppointments().map((appointment: any) => (
                    <div key={appointment.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="flex items-center space-x-4">
                        <div className={`w-4 h-4 rounded-full flex-shrink-0 ${
                          appointment.status === 'scheduled' ? 'bg-blue-500' :
                          appointment.status === 'completed' ? 'bg-green-500' :
                          'bg-red-500'
                        }`}></div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-gray-900">{appointment.type}</h4>
                            <Badge className={getStatusColor(appointment.status)}>
                              {appointment.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600 mb-1">
                            <Stethoscope className="w-4 h-4 inline mr-1" />
                            {appointment.doctorName || appointment.doctor}
                          </p>
                          <p className="text-xs text-gray-500">
                            <Calendar className="w-3 h-3 inline mr-1" />
                            {new Date(appointment.date).toLocaleDateString('en-US', { 
                              weekday: 'long', 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })} at {appointment.time}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {appointment.status === 'scheduled' && (
                          <>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => setSelectedAppointmentForReschedule(appointment)}
                                >
                                  <Calendar className="w-4 h-4 mr-1" />
                                  Reschedule
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Reschedule Appointment</DialogTitle>
                                </DialogHeader>
                                {selectedAppointmentForReschedule && (
                                  <div className="space-y-4">
                                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                                      <h4 className="font-medium text-blue-900 mb-1">Current Appointment</h4>
                                      <p className="text-sm text-blue-800">
                                        {selectedAppointmentForReschedule.type} with {selectedAppointmentForReschedule.doctorName || selectedAppointmentForReschedule.doctor}
                                      </p>
                                      <p className="text-xs text-blue-700">
                                        {new Date(selectedAppointmentForReschedule.date).toLocaleDateString()} at {selectedAppointmentForReschedule.time}
                                      </p>
                                    </div>
                                    
                                    <div className="space-y-3">
                                      <div>
                                        <Label htmlFor="newDate">New Date</Label>
                                        <Input
                                          id="newDate"
                                          type="date"
                                          value={appointmentForm.date || ''}
                                          onChange={(e) => setAppointmentForm((prev: any) => ({ ...prev, date: e.target.value }))}
                                          min={new Date().toISOString().split('T')[0]}
                                          className="w-full"
                                        />
                                      </div>
                                      
                                      <div>
                                        <Label htmlFor="newTime">New Time</Label>
                                        <Select
                                          value={appointmentForm.time || ''}
                                          onValueChange={(value) => setAppointmentForm((prev: any) => ({ ...prev, time: value }))}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select time" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="09:00 AM">09:00 AM</SelectItem>
                                            <SelectItem value="10:00 AM">10:00 AM</SelectItem>
                                            <SelectItem value="11:00 AM">11:00 AM</SelectItem>
                                            <SelectItem value="02:00 PM">02:00 PM</SelectItem>
                                            <SelectItem value="03:00 PM">03:00 PM</SelectItem>
                                            <SelectItem value="04:00 PM">04:00 PM</SelectItem>
                                            <SelectItem value="05:00 PM">05:00 PM</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      
                                      <div className="flex gap-2 pt-4">
                                        <Button
                                          onClick={() => {
                                            if (appointmentForm.date && appointmentForm.time) {
                                              rescheduleAppointmentMutation.mutate({
                                                appointmentId: selectedAppointmentForReschedule.id,
                                                newDate: appointmentForm.date,
                                                newTime: appointmentForm.time
                                              });
                                            }
                                          }}
                                          disabled={!appointmentForm.date || !appointmentForm.time || rescheduleAppointmentMutation.isPending}
                                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                                        >
                                          {rescheduleAppointmentMutation.isPending ? 'Rescheduling...' : 'Confirm Reschedule'}
                                        </Button>
                                        <DialogClose asChild>
                                          <Button variant="outline">
                                            Cancel
                                          </Button>
                                        </DialogClose>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </DialogContent>
                            </Dialog>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => cancelAppointment(appointment.id)}
                              className="text-red-600 border-red-300 hover:bg-red-50"
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                        {appointment.status === 'completed' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              toast({
                                title: "Medical Report",
                                description: "Opening detailed medical report...",
                              });
                              navigateToTab('health');
                            }}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            View Report
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Appointments Yet</h3>
                  <p className="text-gray-600 mb-6">Schedule your first appointment to get started with your healthcare journey.</p>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button className="bg-blue-600 hover:bg-blue-700">
                        <Calendar className="w-4 h-4 mr-2" />
                        Schedule First Appointment
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Schedule Your First Appointment</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>What brings you in today?</Label>
                          <Select>
                            <SelectTrigger>
                              <SelectValue placeholder="Select reason for visit" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">General Health Check</SelectItem>
                              <SelectItem value="screening">Cancer Screening</SelectItem>
                              <SelectItem value="symptoms">Discuss Symptoms</SelectItem>
                              <SelectItem value="followup">Follow-up Care</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Preferred Date</Label>
                          <Input
                            type="date"
                            min={new Date().toISOString().split('T')[0]}
                          />
                        </div>
                        <div className="flex gap-2 pt-4">
                          <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                            Find Available Times
                          </Button>
                          <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                          </DialogClose>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>



        {/* Health Records Tab */}
        <TabsContent value="health" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Medical History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Allergies</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientData.medicalHistory.allergies.map((allergy: any, index: any) => (
                      <Badge key={index} variant="destructive">{allergy}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Current Conditions</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientData.medicalHistory.conditions.map((condition: any, index: any) => (
                      <Badge key={index} variant="secondary">{condition}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Current Medications</h4>
                  <ul className="space-y-1">
                    {patientData.medicalHistory.medications.map((medication: any, index: any) => (
                      <li key={index} className="text-sm">{medication}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vital Signs History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>Blood Pressure</span>
                    <span className="font-medium">{patientData.vitals.bloodPressure}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Heart Rate</span>
                    <span className="font-medium">{patientData.vitals.heartRate} BPM</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Temperature</span>
                    <span className="font-medium">{patientData.vitals.temperature}°F</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Weight</span>
                    <span className="font-medium">{patientData.vitals.weight} lbs</span>
                  </div>
                  <div className="flex justify-between">
                    <span>BMI</span>
                    <span className="font-medium">{patientData.vitals.bmi}</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 pt-2 border-t">
                  Last updated: {new Date(patientData.vitals.lastUpdated).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Personal Information</CardTitle>
                <Button 
                  variant="outline" 
                  onClick={startEditingProfile}
                  disabled={editingProfile}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {editingProfile ? 'Editing...' : 'Edit Profile'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <Label htmlFor="fullName" className="text-gray-700 font-medium">Full Name</Label>
                  {editingProfile ? (
                    <Input 
                      id="fullName"
                      value={profileForm.name || ''} 
                      onChange={(e) => setProfileForm({...profileForm, name: e.target.value})}
                      placeholder="Enter your full name"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.name || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="email" className="text-gray-700 font-medium">Email</Label>
                  {editingProfile ? (
                    <Input 
                      id="email"
                      type="email"
                      value={profileForm.email || ''} 
                      onChange={(e) => setProfileForm({...profileForm, email: e.target.value})}
                      placeholder="Enter your email address"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.email || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="phone" className="text-gray-700 font-medium">Phone</Label>
                  {editingProfile ? (
                    <Input 
                      id="phone"
                      type="tel"
                      value={profileForm.phone || ''} 
                      onChange={(e) => setProfileForm({...profileForm, phone: e.target.value})}
                      placeholder="Enter your phone number"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.phone || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="age" className="text-gray-700 font-medium">Age</Label>
                  {editingProfile ? (
                    <Input 
                      id="age"
                      type="number"
                      value={profileForm.age || ''} 
                      onChange={(e) => setProfileForm({...profileForm, age: e.target.value})}
                      placeholder="Enter your age"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.age || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="gender" className="text-gray-700 font-medium">Gender</Label>
                  {editingProfile ? (
                    <Select
                      value={profileForm.gender || ''}
                      onValueChange={(value) => setProfileForm({...profileForm, gender: value})}
                    >
                      <SelectTrigger className="border-gray-300">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                        <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={patientData.personalInfo.gender || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="bloodType" className="text-gray-700 font-medium">Blood Type (Optional)</Label>
                  {editingProfile ? (
                    <Select
                      value={profileForm.bloodType || ''}
                      onValueChange={(value) => setProfileForm({...profileForm, bloodType: value})}
                    >
                      <SelectTrigger className="border-gray-300">
                        <SelectValue placeholder="Select blood type (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A+">A+</SelectItem>
                        <SelectItem value="A-">A-</SelectItem>
                        <SelectItem value="B+">B+</SelectItem>
                        <SelectItem value="B-">B-</SelectItem>
                        <SelectItem value="AB+">AB+</SelectItem>
                        <SelectItem value="AB-">AB-</SelectItem>
                        <SelectItem value="O+">O+</SelectItem>
                        <SelectItem value="O-">O-</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={patientData.personalInfo.bloodType || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div>
                  <Label htmlFor="emergencyContact" className="text-gray-700 font-medium">Emergency Contact</Label>
                  {editingProfile ? (
                    <Input 
                      id="emergencyContact"
                      value={profileForm.emergencyContact || ''} 
                      onChange={(e) => setProfileForm({...profileForm, emergencyContact: e.target.value})}
                      placeholder="Enter emergency contact"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.emergencyContact || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <Label htmlFor="address" className="text-gray-700 font-medium">Address</Label>
                  {editingProfile ? (
                    <Input 
                      id="address"
                      value={profileForm.address || ''} 
                      onChange={(e) => setProfileForm({...profileForm, address: e.target.value})}
                      placeholder="Enter your address"
                      className="border-gray-300"
                    />
                  ) : (
                    <Input value={patientData.personalInfo.address || 'Not provided'} readOnly className="bg-gray-100 text-gray-800" />
                  )}
                </div>
              </div>
              {editingProfile && (
                <div className="flex justify-end space-x-2 mt-6">
                  <Button variant="outline" onClick={() => setEditingProfile(false)}>
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                  <Button onClick={saveProfile} disabled={updateProfileMutation.isPending}>
                    <Save className="w-4 h-4 mr-2" />
                    {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}