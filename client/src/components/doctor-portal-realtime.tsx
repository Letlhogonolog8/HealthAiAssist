import { useState, useEffect } from "react";
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
  lastVisit: string;
  condition: string;
  riskLevel: 'low' | 'medium' | 'high';
  nextAppointment?: string;
}

interface Report {
  id: number;
  patientName: string;
  scanType: string;
  date: string;
  status: 'pending' | 'reviewed' | 'completed';
  priority: 'low' | 'medium' | 'high';
  findings?: string;
}

interface DoctorStats {
  activePatients: number;
  todaysAppointments: number;
  pendingReports: number;
  criticalCases: number;
  avgConsultationTime: string;
  patientSatisfaction: number;
}

export default function DoctorPortalRealTime({ user }: { user: User }) {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [activePatientId, setActivePatientId] = useState<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time WebSocket connection
  const { isConnected, lastMessage, sendMessage } = useWebSocketRealTime({
    onMessage: (message) => {
      if (message.type === 'appointment_update') {
        toast({
          title: "Appointment Update",
          description: "New appointment request received.",
        });
      } else if (message.type === 'urgent_case') {
        toast({
          title: "Urgent Case Alert",
          description: message.data.message,
          variant: "destructive",
        });
      }
    }
  });

  // Fetch real-time stats
  const { data: stats, isLoading: statsLoading } = useQuery<DoctorStats>({
    queryKey: ['/api/doctor/stats'],
    refetchInterval: 5000, // Update every 5 seconds
  });

  // Fetch appointments - using upcoming appointments to show scheduled ones
  const { data: appointments = [], refetch: refetchAppointments } = useQuery<Appointment[]>({
    queryKey: ['/api/doctor/appointments/upcoming'],
    refetchInterval: 3000,
  });

  // Fetch active patients
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ['/api/doctor/patients'],
    refetchInterval: 10000,
  });

  // Fetch pending reports
  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ['/api/doctor/reports/pending'],
    refetchInterval: 5000,
  });

  // Fetch notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ['/api/doctor/notifications'],
    refetchInterval: 2000,
  });

  // Appointment action mutations
  const appointmentActionMutation = useMutation({
    mutationFn: async ({ appointmentId, action, notes }: { appointmentId: number; action: 'accept' | 'decline' | 'complete' | 'delete'; notes?: string }) => {
      const response = await fetch(`/api/doctor/appointments/${appointmentId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!response.ok) throw new Error(`Failed to ${action} appointment`);
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
      // Send real-time notification
      sendMessage({
        type: 'doctor_message',
        data: { patientId: activePatientId, message: chatMessage }
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

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center">
              <Stethoscope className="w-6 h-6 mr-2 text-blue-400" />
              Doctor Portal
            </h1>
            <p className="text-slate-400">Welcome back, Dr. {user.fullName}</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-slate-400">
                {isConnected ? 'Real-time Connected' : 'Connecting...'}
              </span>
            </div>
            <div className="relative">
              <Bell className="w-5 h-5 text-slate-400" />
              {(notifications as any[])?.length > 0 && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white">{(notifications as any[]).length}</span>
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

      {/* Performance Metrics */}
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
                      <p className="text-sm text-slate-400">Active Patients</p>
                      <p className="text-2xl font-bold text-blue-400">{stats?.activePatients || 0}</p>
                    </div>
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Today's Appointments</p>
                      <p className="text-2xl font-bold text-green-400">{stats?.todaysAppointments || 0}</p>
                    </div>
                    <Calendar className="w-6 h-6 text-green-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Pending Reports</p>
                      <p className="text-2xl font-bold text-yellow-400">{stats?.pendingReports || 0}</p>
                    </div>
                    <FileText className="w-6 h-6 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Critical Cases</p>
                      <p className="text-2xl font-bold text-red-400">{stats?.criticalCases || 0}</p>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Avg Consultation</p>
                      <p className="text-2xl font-bold text-purple-400">{stats?.avgConsultationTime || '0m'}</p>
                    </div>
                    <Clock className="w-6 h-6 text-purple-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Patient Satisfaction</p>
                      <p className="text-2xl font-bold text-cyan-400">{stats?.patientSatisfaction || 0}%</p>
                    </div>
                    <Star className="w-6 h-6 text-cyan-400" />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid grid-cols-7 w-full bg-slate-800">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="patients">Patients</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
            <TabsTrigger value="translator">Translator</TabsTrigger>
            <TabsTrigger value="therapy">Therapy</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Today's Appointments */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center">
                      <Calendar className="w-5 h-5 mr-2" />
                      Today's Appointments
                    </CardTitle>
                    <Badge variant="outline" className="text-green-400 border-green-400">
                      Real-time
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {appointments.length === 0 ? (
                    <p className="text-slate-400 text-center py-8">No appointments scheduled for today</p>
                  ) : (
                    <div className="space-y-4">
                      {appointments.map((appointment) => (
                        <div key={appointment.id} className="p-4 bg-slate-700 rounded-lg">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="text-white font-medium">{appointment.patientName}</p>
                              <p className="text-sm text-slate-400">{appointment.reason}</p>
                              <p className="text-sm text-slate-300">{appointment.time}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <AlertTriangle className={`w-4 h-4 ${getPriorityColor(appointment.priority)}`} />
                              <Badge className={getStatusColor(appointment.status)}>
                                {appointment.status}
                              </Badge>
                            </div>
                          </div>
                          
                          {appointment.status === 'pending' && (
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
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notifications */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Bell className="w-5 h-5 mr-2" />
                    Notifications
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!(notifications as any[])?.length ? (
                    <p className="text-slate-400 text-center py-8">No new notifications</p>
                  ) : (
                    <div className="space-y-3">
                      {(notifications as any[])?.map((notification: any, index: number) => (
                        <div key={index} className="p-3 bg-slate-700 rounded-lg">
                          <p className="text-white text-sm">{notification.message}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(notification.timestamp).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Patient Management Tab */}
          <TabsContent value="patients" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  Active Patients
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {patients.map((patient) => (
                    <Card key={patient.id} className="bg-slate-700 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="text-white font-medium">{patient.name}</h4>
                            <p className="text-sm text-slate-400">{patient.email}</p>
                            <p className="text-sm text-slate-300 mt-1">{patient.condition}</p>
                            <p className="text-xs text-slate-400 mt-2">
                              Last visit: {new Date(patient.lastVisit).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge className={getRiskColor(patient.riskLevel)}>
                            {patient.riskLevel} risk
                          </Badge>
                        </div>
                        
                        <div className="flex space-x-2 mt-4">
                          <Button size="sm" variant="outline" className="flex-1">
                            <User className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => {
                              setActivePatientId(patient.id);
                            }}
                          >
                            <MessageSquare className="w-3 h-3 mr-1" />
                            Chat
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Real-time Chat Interface */}
            {activePatientId && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center">
                      <MessageSquare className="w-5 h-5 mr-2" />
                      Patient Communication
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setActivePatientId(null)}>
                      Close Chat
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="bg-slate-700 rounded-lg p-4 min-h-[200px]">
                      <p className="text-slate-400 text-sm">Chat messages will appear here...</p>
                    </div>
                    
                    <div className="flex space-x-2">
                      <Input
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        placeholder="Type your message to the patient..."
                        className="bg-slate-700 border-slate-600"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendChatToPatient(activePatientId);
                          }
                        }}
                      />
                      <Button 
                        onClick={() => sendChatToPatient(activePatientId)}
                        disabled={!chatMessage.trim() || sendChatMutation.isPending}
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="w-5 h-5 mr-2" />
                  Pending Reports
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {reports.map((report) => (
                    <div key={report.id} className="p-4 bg-slate-700 rounded-lg">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-white font-medium">{report.patientName}</p>
                          <p className="text-sm text-slate-400">{report.scanType}</p>
                          <p className="text-sm text-slate-300">{new Date(report.date).toLocaleDateString()}</p>
                          {report.findings && (
                            <p className="text-sm text-slate-300 mt-2">{report.findings}</p>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <AlertTriangle className={`w-4 h-4 ${getPriorityColor(report.priority)}`} />
                          <Badge className={getStatusColor(report.status)}>
                            {report.status}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="flex space-x-2 mt-3">
                        <Button size="sm" variant="outline">
                          <FileText className="w-3 h-3 mr-1" />
                          Review
                        </Button>
                        <Button size="sm" variant="outline">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

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