import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Search, Plus, Eye, Edit, Trash2, Users, Phone, Mail, Calendar, Activity, FileText, AlertTriangle } from 'lucide-react';
import BloodTestAnalyzer from './blood-test-analyzer';
import MedicalImageViewer from './medical-image-viewer';

interface Patient {
  id: number;
  name: string;
  email: string;
  phone?: string;
  age: number;
  gender: string;
  lastVisit: string;
  condition: string;
  status: string;
  riskLevel: string;
  recentScans: number;
}

export default function PatientManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: '',
    email: '',
    phone: '',
    age: '',
    gender: ''
  });
  const [appointmentForm, setAppointmentForm] = useState({
    date: '',
    time: '',
    type: '',
    notes: ''
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch patients
  const { data: patients = [], isLoading, error } = useQuery({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/patients', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch patients');
      return response.json();
    }
  });

  // Add patient mutation
  const addPatientMutation = useMutation({
    mutationFn: async (patientData: any) => {
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...patientData,
          age: parseInt(patientData.age),
          role: 'patient'
        })
      });
      if (!response.ok) throw new Error('Failed to add patient');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/patients'] });
      setIsAddDialogOpen(false);
      setNewPatient({ name: '', email: '', phone: '', age: '', gender: '' });
      toast({ title: 'Success', description: 'Patient added successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add patient', variant: 'destructive' });
    }
  });

  // Delete patient mutation
  const deletePatientMutation = useMutation({
    mutationFn: async (patientId: number) => {
      const response = await fetch(`/api/patients/${patientId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete patient' }));
        throw new Error(errorData.error || 'Failed to delete patient');
      }
      return response.json().catch(() => ({ success: true }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/patients'] });
      queryClient.refetchQueries({ queryKey: ['/api/doctor/patients'] });
      toast({ title: 'Success', description: 'Patient deleted successfully' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to delete patient', variant: 'destructive' });
    }
  });

  // Schedule appointment mutation
  const scheduleAppointmentMutation = useMutation({
    mutationFn: async ({ patientId, appointmentData }: { patientId: number; appointmentData: any }) => {
      const response = await fetch('/api/patient/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          appointmentDate: appointmentData.date,
          appointmentTime: appointmentData.time,
          type: appointmentData.type,
          reason: appointmentData.notes,
          doctorName: 'Current Doctor'
        })
      });
      if (!response.ok) throw new Error('Failed to schedule appointment');
      return response.json();
    },
    onSuccess: () => {
      setIsScheduleDialogOpen(false);
      setAppointmentForm({ date: '', time: '', type: '', notes: '' });
      toast({ title: 'Success', description: 'Appointment scheduled successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to schedule appointment', variant: 'destructive' });
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

  const getRiskColor = (risk: string) => {
    switch (risk?.toLowerCase()) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const filteredPatients = patients.filter((patient: Patient) =>
    patient.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center">
              <Users className="w-5 h-5 mr-2" />
              Patient Management
            </CardTitle>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2">
                <Search className="w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search patients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64 bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Patient
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 border-slate-600">
                  <DialogHeader>
                    <DialogTitle className="text-white">Add New Patient</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-white">Full Name</Label>
                      <Input
                        value={newPatient.name}
                        onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                        placeholder="Enter patient name"
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-white">Email</Label>
                      <Input
                        type="email"
                        value={newPatient.email}
                        onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                        placeholder="Enter email address"
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-white">Phone</Label>
                      <Input
                        value={newPatient.phone}
                        onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                        placeholder="Enter phone number"
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-white">Age</Label>
                        <Input
                          type="number"
                          value={newPatient.age}
                          onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                          placeholder="Age"
                          className="bg-slate-700 border-slate-600 text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-white">Gender</Label>
                        <Select value={newPatient.gender} onValueChange={(value) => setNewPatient({ ...newPatient, gender: value })}>
                          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-700 border-slate-600">
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        onClick={() => setIsAddDialogOpen(false)}
                        className="border-slate-600 text-slate-300"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => addPatientMutation.mutate(newPatient)}
                        disabled={!newPatient.name || !newPatient.email || addPatientMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {addPatientMutation.isPending ? 'Adding...' : 'Add Patient'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-20 bg-slate-700 rounded animate-pulse"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-400 mb-4">Failed to load patients</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-16 h-16 mx-auto mb-4 text-slate-600" />
              <p className="text-slate-400 mb-4">No patients found</p>
              <Button onClick={() => setIsAddDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                Add First Patient
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredPatients.map((patient: Patient) => (
                <Card key={patient.id} className="bg-slate-700 border-slate-600 hover:border-slate-500 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-slate-600 rounded-full flex items-center justify-center">
                          <Users className="w-6 h-6 text-slate-300" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{patient.name}</h4>
                          <div className="flex items-center space-x-4 text-sm text-slate-400">
                            <span className="flex items-center">
                              <Mail className="w-3 h-3 mr-1" />
                              {patient.email}
                            </span>
                            {patient.phone && (
                              <span className="flex items-center">
                                <Phone className="w-3 h-3 mr-1" />
                                {patient.phone}
                              </span>
                            )}
                            <span>{patient.age} years, {patient.gender}</span>
                          </div>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className="text-xs text-slate-500">Last visit: {new Date(patient.lastVisit).toLocaleDateString()}</span>
                            <span className="text-xs text-slate-500">•</span>
                            <span className="text-xs text-slate-500">{patient.recentScans} recent scans</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="text-right">
                          <Badge className={getStatusColor(patient.status)}>{patient.status}</Badge>
                          <div className="flex items-center mt-1">
                            <div className={`w-2 h-2 rounded-full ${getRiskColor(patient.riskLevel)} mr-1`}></div>
                            <span className="text-xs text-slate-400">{patient.riskLevel} risk</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPatient(patient)}
                            className="border-slate-600 text-slate-300 hover:bg-slate-600"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingPatient(patient)}
                            className="border-slate-600 text-slate-300 hover:bg-slate-600"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this patient?')) {
                                deletePatientMutation.mutate(patient.id);
                              }
                            }}
                            className="border-red-600 text-red-300 hover:bg-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Patient Details Modal */}
      {selectedPatient && (
        <Dialog open={!!selectedPatient} onOpenChange={() => setSelectedPatient(null)}>
          <DialogContent className="bg-slate-800 border-slate-600 max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center">
                <Users className="w-5 h-5 mr-2" />
                {selectedPatient.name} - Patient Details
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">Medical History</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
              </TabsList>
              
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-400">Email</Label>
                    <p className="text-white">{selectedPatient.email}</p>
                  </div>
                  <div>
                    <Label className="text-slate-400">Phone</Label>
                    <p className="text-white">{selectedPatient.phone || 'Not provided'}</p>
                  </div>
                  <div>
                    <Label className="text-slate-400">Age</Label>
                    <p className="text-white">{selectedPatient.age} years</p>
                  </div>
                  <div>
                    <Label className="text-slate-400">Gender</Label>
                    <p className="text-white">{selectedPatient.gender}</p>
                  </div>
                  <div>
                    <Label className="text-slate-400">Last Visit</Label>
                    <p className="text-white">{new Date(selectedPatient.lastVisit).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <Label className="text-slate-400">Recent Scans</Label>
                    <p className="text-white">{selectedPatient.recentScans}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400">Current Condition</Label>
                  <p className="text-white">{selectedPatient.condition}</p>
                </div>
                <div className="flex items-center space-x-4">
                  <div>
                    <Label className="text-slate-400">Status</Label>
                    <Badge className={getStatusColor(selectedPatient.status)}>{selectedPatient.status}</Badge>
                  </div>
                  <div>
                    <Label className="text-slate-400">Risk Level</Label>
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full ${getRiskColor(selectedPatient.riskLevel)} mr-2`}></div>
                      <span className="text-white">{selectedPatient.riskLevel}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="history" className="space-y-4">
                <Card className="bg-slate-700 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white">Medical History</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center py-8">
                      <FileText className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                      <p className="text-slate-400 mb-4">No medical history available</p>
                      <p className="text-slate-500 text-sm">Medical history will appear here once patient data is entered</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              
              <TabsContent value="schedule" className="space-y-4">
                <Card className="bg-slate-700 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white">Schedule Appointment</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-white">Date</Label>
                        <Input
                          type="date"
                          value={appointmentForm.date}
                          onChange={(e) => setAppointmentForm({...appointmentForm, date: e.target.value})}
                          className="bg-slate-600 border-slate-500 text-white"
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                      <div>
                        <Label className="text-white">Time</Label>
                        <Select value={appointmentForm.time} onValueChange={(value) => setAppointmentForm({...appointmentForm, time: value})}>
                          <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                            <SelectValue placeholder="Select time" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="09:00 AM">09:00 AM</SelectItem>
                            <SelectItem value="10:00 AM">10:00 AM</SelectItem>
                            <SelectItem value="11:00 AM">11:00 AM</SelectItem>
                            <SelectItem value="02:00 PM">02:00 PM</SelectItem>
                            <SelectItem value="03:00 PM">03:00 PM</SelectItem>
                            <SelectItem value="04:00 PM">04:00 PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-white">Appointment Type</Label>
                      <Select value={appointmentForm.type} onValueChange={(value) => setAppointmentForm({...appointmentForm, type: value})}>
                        <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="General Consultation">General Consultation</SelectItem>
                          <SelectItem value="Follow-up Visit">Follow-up Visit</SelectItem>
                          <SelectItem value="Cancer Screening">Cancer Screening</SelectItem>
                          <SelectItem value="Test Results Review">Test Results Review</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-white">Notes</Label>
                      <Textarea
                        value={appointmentForm.notes}
                        onChange={(e) => setAppointmentForm({...appointmentForm, notes: e.target.value})}
                        placeholder="Additional notes or reason for visit..."
                        className="bg-slate-600 border-slate-500 text-white"
                        rows={3}
                      />
                    </div>
                    <Button
                      onClick={() => scheduleAppointmentMutation.mutate({ patientId: selectedPatient.id, appointmentData: appointmentForm })}
                      disabled={!appointmentForm.date || !appointmentForm.time || !appointmentForm.type || scheduleAppointmentMutation.isPending}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {scheduleAppointmentMutation.isPending ? 'Scheduling...' : 'Schedule Appointment'}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Patient Dialog */}
      {editingPatient && (
        <Dialog open={!!editingPatient} onOpenChange={() => setEditingPatient(null)}>
          <DialogContent className="bg-slate-800 border-slate-600">
            <DialogHeader>
              <DialogTitle className="text-white">Edit Patient</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-white">Full Name</Label>
                <Input
                  value={editingPatient.name}
                  onChange={(e) => setEditingPatient({ ...editingPatient, name: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div>
                <Label className="text-white">Email</Label>
                <Input
                  type="email"
                  value={editingPatient.email}
                  onChange={(e) => setEditingPatient({ ...editingPatient, email: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div>
                <Label className="text-white">Phone</Label>
                <Input
                  value={editingPatient.phone || ''}
                  onChange={(e) => setEditingPatient({ ...editingPatient, phone: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white">Age</Label>
                  <Input
                    type="number"
                    value={editingPatient.age}
                    onChange={(e) => setEditingPatient({ ...editingPatient, age: parseInt(e.target.value) })}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-white">Gender</Label>
                  <Select value={editingPatient.gender} onValueChange={(value) => setEditingPatient({ ...editingPatient, gender: value })}>
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-slate-600">
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingPatient(null)}
                  className="border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    // Update patient logic would go here
                    toast({ title: 'Success', description: 'Patient updated successfully' });
                    setEditingPatient(null);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}