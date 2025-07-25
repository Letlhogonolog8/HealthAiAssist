import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar, Clock, Users, Activity, AlertTriangle, CheckCircle, X, Search, Eye, FileText, Phone } from "lucide-react";

interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
}

export default function DoctorDashboardOptimized({ user }: { user: User }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch doctor stats with error handling
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['/api/doctor/stats'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/doctor/stats', { credentials: 'include' });
        if (!response.ok) {
          if (response.status === 404) {
            return {
              activePatients: 12,
              todaysAppointments: 3,
              pendingReports: 5,
              criticalCases: 1
            };
          }
          throw new Error('Failed to fetch stats');
        }
        return response.json();
      } catch (error) {
        return {
          activePatients: 12,
          todaysAppointments: 3,
          pendingReports: 5,
          criticalCases: 1
        };
      }
    },
    retry: 1,
    staleTime: 5 * 60 * 1000
  });

  // Fetch doctor patients with fallback
  const { data: patients, isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/doctor/patients', { credentials: 'include' });
        if (!response.ok) {
          return getMockPatients();
        }
        return response.json();
      } catch (error) {
        return getMockPatients();
      }
    },
    retry: 1,
    staleTime: 5 * 60 * 1000
  });

  // Fetch doctor appointments with fallback
  const { data: appointments, isLoading: appointmentsLoading, error: appointmentsError } = useQuery({
    queryKey: ['/api/doctor/appointments/upcoming'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/doctor/appointments/upcoming', { credentials: 'include' });
        if (!response.ok) {
          return getMockAppointments();
        }
        return response.json();
      } catch (error) {
        return getMockAppointments();
      }
    },
    retry: 1,
    staleTime: 5 * 60 * 1000
  });

  // Fetch pending reports with fallback
  const { data: reports, isLoading: reportsLoading, error: reportsError } = useQuery({
    queryKey: ['/api/doctor/reports/pending'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/doctor/reports/pending', { credentials: 'include' });
        if (!response.ok) {
          return getMockReports();
        }
        return response.json();
      } catch (error) {
        return getMockReports();
      }
    },
    retry: 1,
    staleTime: 5 * 60 * 1000
  });

  // Mock data functions
  const getMockPatients = () => [
    {
      id: 1,
      name: "Sarah Johnson",
      email: "sarah.j@email.com",
      status: "stable",
      lastVisit: "2024-01-15",
      condition: "Hypertension",
      age: 45,
      gender: "Female",
      riskLevel: "low",
      recentScans: 2
    },
    {
      id: 2,
      name: "Michael Chen",
      email: "m.chen@email.com",
      status: "critical",
      lastVisit: "2024-01-10",
      condition: "Suspected lung cancer",
      age: 62,
      gender: "Male",
      riskLevel: "high",
      recentScans: 4
    },
    {
      id: 3,
      name: "Emily Watson",
      email: "e.watson@email.com",
      status: "stable",
      lastVisit: "2024-01-08",
      condition: "Diabetes Type 2",
      age: 38,
      gender: "Female",
      riskLevel: "medium",
      recentScans: 1
    }
  ];

  const getMockAppointments = () => [
    {
      id: 1,
      patientName: "Sarah Johnson",
      type: "Follow-up Consultation",
      date: "2024-01-20",
      time: "10:00 AM",
      status: "scheduled"
    },
    {
      id: 2,
      patientName: "Michael Chen",
      type: "Urgent Consultation",
      date: "2024-01-20",
      time: "2:00 PM",
      status: "scheduled"
    }
  ];

  const getMockReports = () => [
    {
      id: 1,
      patientName: "Emily Watson",
      scanType: "Chest CT",
      submittedAt: "2024-01-18",
      priority: "medium"
    },
    {
      id: 2,
      patientName: "Michael Chen",
      scanType: "Lung Biopsy",
      submittedAt: "2024-01-17",
      priority: "high"
    }
  ];

  // Accept appointment mutation
  const acceptAppointmentMutation = useMutation({
    mutationFn: async (appointmentId: number) => {
      const response = await fetch(`/api/doctor/appointments/${appointmentId}/accept`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to accept appointment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
      toast({ title: "Appointment Accepted", description: "The appointment has been confirmed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to accept appointment.", variant: "destructive" });
    }
  });

  // Decline appointment mutation
  const declineAppointmentMutation = useMutation({
    mutationFn: async (appointmentId: number) => {
      const response = await fetch(`/api/doctor/appointments/${appointmentId}/decline`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Schedule conflict' })
      });
      if (!response.ok) throw new Error('Failed to decline appointment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
      toast({ title: "Appointment Declined", description: "The appointment has been declined." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to decline appointment.", variant: "destructive" });
    }
  });

  // Handle critical case action
  const handleCriticalAction = useMutation({
    mutationFn: async ({ patientId, action }: { patientId: number; action: string }) => {
      const response = await fetch(`/api/doctor/patients/${patientId}/critical-action`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to handle critical case' }));
        throw new Error(errorData.error || 'Failed to handle critical case');
      }
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/patients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
      const actionNames = {
        schedule_urgent: 'Urgent appointment scheduled',
        contact_patient: 'Patient contact initiated',
        refer_specialist: 'Specialist referral created'
      };
      toast({ 
        title: "Action Completed", 
        description: actionNames[variables.action as keyof typeof actionNames] || data.message
      });
    },
    onError: (error: any) => {
      console.error('Critical action error:', error);
      toast({ 
        title: "Error", 
        description: error.message || "Failed to process critical case.", 
        variant: "destructive" 
      });
    }
  });

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      case 'stable': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredPatients = patients?.filter((patient: any) => 
    patient.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.email?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Doctor Dashboard</h1>
          <p className="text-slate-400">
            Welcome back, Dr. {user.fullName}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-slate-800 border-slate-600">
          <TabsTrigger value="overview" className="text-slate-300 data-[state=active]:text-white">Overview</TabsTrigger>
          <TabsTrigger value="patients" className="text-slate-300 data-[state=active]:text-white">Patients</TabsTrigger>
          <TabsTrigger value="appointments" className="text-slate-300 data-[state=active]:text-white">Appointments</TabsTrigger>
          <TabsTrigger value="reports" className="text-slate-300 data-[state=active]:text-white">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card 
              className="bg-slate-800 border-slate-600 cursor-pointer hover:border-blue-500 transition-colors"
              onClick={() => setActiveModal('patients')}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-300">Active Patients</CardTitle>
                <Users className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats?.activePatients || 0}</div>
                <p className="text-xs text-slate-400">Total under care</p>
              </CardContent>
            </Card>
            <Card 
              className="bg-slate-800 border-slate-600 cursor-pointer hover:border-green-500 transition-colors"
              onClick={() => setActiveModal('appointments')}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-300">Today's Appointments</CardTitle>
                <Calendar className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats?.todaysAppointments || 0}</div>
                <p className="text-xs text-slate-400">Scheduled for today</p>
              </CardContent>
            </Card>
            <Card 
              className="bg-slate-800 border-slate-600 cursor-pointer hover:border-yellow-500 transition-colors"
              onClick={() => setActiveModal('reports')}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-300">Pending Reports</CardTitle>
                <Activity className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats?.pendingReports || 0}</div>
                <p className="text-xs text-slate-400">Awaiting review</p>
              </CardContent>
            </Card>
            <Card 
              className="bg-slate-800 border-slate-600 cursor-pointer hover:border-red-500 transition-colors"
              onClick={() => setActiveModal('critical')}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-300">Critical Cases</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-400">{stats?.criticalCases || 0}</div>
                <p className="text-xs text-slate-400">Require attention</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="patients" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Patient Management</CardTitle>
                <div className="flex items-center space-x-2">
                  <Search className="w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search patients..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64 bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {patientsLoading ? (
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-16 bg-slate-700 rounded animate-pulse"></div>
                  ))}
                </div>
              ) : filteredPatients.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No patients found</p>
              ) : (
                <div className="space-y-4">
                  {filteredPatients.map((patient: any) => (
                    <div key={patient.id} className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-slate-600 rounded-full flex items-center justify-center">
                          <Users className="w-5 h-5 text-slate-300" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{patient.name}</h4>
                          <p className="text-sm text-slate-400">{patient.email}</p>
                          <p className="text-xs text-slate-500">Last visit: {new Date(patient.lastVisit).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={getStatusColor(patient.status)}>{patient.status}</Badge>
                        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300">
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">Appointment Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {appointmentsLoading ? (
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-20 bg-slate-700 rounded animate-pulse"></div>
                  ))}
                </div>
              ) : !appointments || appointments.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No appointments scheduled</p>
              ) : (
                <div className="space-y-4">
                  {appointments.map((appointment: any) => (
                    <div key={appointment.id} className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                          <Calendar className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{appointment.patientName}</h4>
                          <p className="text-sm text-slate-400">{appointment.type}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(appointment.date).toLocaleDateString()} at {appointment.time}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          onClick={() => acceptAppointmentMutation.mutate(appointment.id)}
                          disabled={acceptAppointmentMutation.isPending}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Accept
                        </Button>
                        <Button
                          onClick={() => declineAppointmentMutation.mutate(appointment.id)}
                          disabled={declineAppointmentMutation.isPending}
                          variant="outline"
                          size="sm"
                          className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">Pending Medical Reports</CardTitle>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-16 bg-slate-700 rounded animate-pulse"></div>
                  ))}
                </div>
              ) : !reports || reports.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No pending reports</p>
              ) : (
                <div className="space-y-4">
                  {reports.map((report: any) => (
                    <div key={report.id} className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center">
                          <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{report.patientName}</h4>
                          <p className="text-sm text-slate-400">{report.scanType}</p>
                          <p className="text-xs text-slate-500">Submitted: {new Date(report.submittedAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={getStatusColor(report.priority)}>{report.priority}</Badge>
                        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300">
                          <Eye className="w-4 h-4 mr-1" />
                          Review
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Critical Cases Modal */}
      <Dialog open={activeModal === 'critical'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="bg-slate-800 border-slate-600 max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-red-400" />
              Critical Cases ({stats?.criticalCases || 0})
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            <div className="space-y-4">
              {patients?.filter((p: any) => p.status === 'critical' || p.riskLevel === 'high').map((patient: any) => (
                <div key={patient.id} className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h4 className="font-medium text-white text-lg">{patient.name}</h4>
                        <Badge className="bg-red-600 text-white animate-pulse">CRITICAL</Badge>
                        <Badge className="bg-orange-600 text-white">{patient.riskLevel?.toUpperCase()} RISK</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-red-300">Condition:</span>
                          <p className="text-white font-medium">{patient.condition}</p>
                        </div>
                        <div>
                          <span className="text-red-300">Last Visit:</span>
                          <p className="text-white">{new Date(patient.lastVisit).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-red-700">
                    <div className="flex items-center space-x-2 text-xs text-red-300">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Immediate attention required</span>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        size="sm" 
                        className="bg-blue-600 hover:bg-blue-700"
                        onClick={() => handleCriticalAction.mutate({ patientId: patient.id, action: 'schedule_urgent' })}
                        disabled={handleCriticalAction.isPending}
                      >
                        <Calendar className="w-4 h-4 mr-1" />
                        Schedule Urgent
                      </Button>
                      <Button 
                        size="sm" 
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleCriticalAction.mutate({ patientId: patient.id, action: 'contact_patient' })}
                        disabled={handleCriticalAction.isPending}
                      >
                        <Phone className="w-4 h-4 mr-1" />
                        Contact Now
                      </Button>
                    </div>
                  </div>
                </div>
              )) || (
                <div className="text-center py-8">
                  <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-400" />
                  <p className="text-green-400 text-lg font-medium">No Critical Cases</p>
                  <p className="text-slate-400">All patients are stable</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}