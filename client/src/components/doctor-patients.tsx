import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Users, 
  User, 
  Search,
  Phone,
  Mail,
  Calendar,
  FileText,
  MessageSquare,
  Heart,
  AlertTriangle,
  Plus
} from 'lucide-react';

interface Patient {
  id: number;
  name: string;
  email: string;
  phone: string;
  age: number;
  gender: string;
  lastVisit: string;
  condition: string;
  status: 'stable' | 'follow-up' | 'critical';
  riskLevel: 'low' | 'medium' | 'high';
  recentScans: number;
  nextAppointment?: string;
}

export default function DoctorPatients({ user, onSectionChange }: { user: any; onSectionChange?: (section: string, data?: any) => void }) {
  const [searchTerm, setSearchTerm] = useState('');

  // Mock patients data
  const mockPatients: Patient[] = [
    {
      id: 1,
      name: 'John Smith',
      email: 'john.smith@email.com',
      phone: '+1 (555) 123-4567',
      age: 45,
      gender: 'Male',
      lastVisit: new Date(Date.now() - 3*24*60*60*1000).toISOString(),
      condition: 'Hypertension',
      status: 'stable',
      riskLevel: 'low',
      recentScans: 2,
      nextAppointment: 'Tomorrow 2:00 PM'
    },
    {
      id: 2,
      name: 'Sarah Wilson',
      email: 'sarah.wilson@email.com',
      phone: '+1 (555) 234-5678',
      age: 38,
      gender: 'Female',
      lastVisit: new Date(Date.now() - 1*24*60*60*1000).toISOString(),
      condition: 'Breast Cancer Screening',
      status: 'follow-up',
      riskLevel: 'medium',
      recentScans: 1,
      nextAppointment: 'Next week'
    },
    {
      id: 3,
      name: 'Michael Davis',
      email: 'michael.davis@email.com',
      phone: '+1 (555) 345-6789',
      age: 62,
      gender: 'Male',
      lastVisit: new Date(Date.now() - 7*24*60*60*1000).toISOString(),
      condition: 'Lung Nodule',
      status: 'critical',
      riskLevel: 'high',
      recentScans: 3
    },
    {
      id: 4,
      name: 'Emily Johnson',
      email: 'emily.johnson@email.com',
      phone: '+1 (555) 456-7890',
      age: 29,
      gender: 'Female',
      lastVisit: new Date(Date.now() - 14*24*60*60*1000).toISOString(),
      condition: 'Routine Checkup',
      status: 'stable',
      riskLevel: 'low',
      recentScans: 0
    }
  ];

  const { data: patients = mockPatients } = useQuery<Patient[]>({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/patients', {
        credentials: 'include'
      });
      if (!response.ok) {
        return mockPatients;
      }
      return response.json();
    },
    retry: 1
  });

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.condition.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable': return 'bg-green-100 text-green-800 border-green-300';
      case 'follow-up': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
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
    <div className="space-y-6">
      {/* Patient Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-white">{patients.length}</div>
            <div className="text-sm text-slate-300">Total Patients</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {patients.filter(p => p.status === 'stable').length}
            </div>
            <div className="text-sm text-slate-300">Stable</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">
              {patients.filter(p => p.status === 'follow-up').length}
            </div>
            <div className="text-sm text-slate-300">Follow-up</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {patients.filter(p => p.status === 'critical').length}
            </div>
            <div className="text-sm text-slate-300">Critical</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Actions */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-white">
              <Users className="w-5 h-5" />
              Patient Management
            </CardTitle>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Patient
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search patients by name or condition..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>

          <div className="space-y-4">
            {filteredPatients.map((patient) => (
              <div key={patient.id} className="p-4 bg-slate-700 border border-slate-600 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                        <User className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-medium text-white">{patient.name}</h4>
                        <p className="text-sm text-slate-300">
                          {patient.age} years • {patient.gender}
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-400">Contact:</span>
                        <div className="flex items-center gap-2 mt-1">
                          <Mail className="w-3 h-3 text-slate-400" />
                          <span className="text-slate-300">{patient.email}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span className="text-slate-300">{patient.phone}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-400">Medical Info:</span>
                        <p className="text-slate-300 mt-1">Condition: {patient.condition}</p>
                        <p className="text-slate-300">Last Visit: {new Date(patient.lastVisit).toLocaleDateString()}</p>
                        <p className="text-slate-300">Recent Scans: {patient.recentScans}</p>
                      </div>
                    </div>

                    {patient.nextAppointment && (
                      <div className="mt-3 p-2 bg-blue-900/20 rounded text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-blue-400" />
                          <span className="text-blue-300">Next Appointment: {patient.nextAppointment}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-col items-end gap-3">
                    <div className="flex gap-2">
                      <Badge className={getStatusColor(patient.status)}>
                        {patient.status.toUpperCase()}
                      </Badge>
                      <Badge className={getRiskColor(patient.riskLevel)}>
                        {patient.riskLevel.toUpperCase()} RISK
                      </Badge>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-slate-300 border-slate-500 hover:bg-slate-600"
                        onClick={() => {
                          if (onSectionChange) {
                            onSectionChange('reports', { patientId: patient.id, patientName: patient.name });
                          }
                        }}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        Records
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-slate-300 border-slate-500 hover:bg-slate-600"
                        onClick={() => {
                          if (onSectionChange) {
                            onSectionChange('chat', { patientId: patient.id, patientName: patient.name });
                          }
                        }}
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Chat
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-slate-300 border-slate-500 hover:bg-slate-600"
                        onClick={() => {
                          if (onSectionChange) {
                            onSectionChange('appointments', { patientId: patient.id, patientName: patient.name });
                          }
                        }}
                      >
                        <Calendar className="w-3 h-3 mr-1" />
                        Schedule
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Risk Assessment */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Heart className="w-5 h-5" />
            Risk Assessment Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-red-900/20 rounded-lg border border-red-800">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className="font-medium text-red-300">High Risk Patients</span>
              </div>
              <div className="text-2xl font-bold text-red-400 mb-2">
                {patients.filter(p => p.riskLevel === 'high').length}
              </div>
              <p className="text-sm text-red-300">Require immediate attention</p>
            </div>
            
            <div className="p-4 bg-yellow-900/20 rounded-lg border border-yellow-800">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                <span className="font-medium text-yellow-300">Medium Risk Patients</span>
              </div>
              <div className="text-2xl font-bold text-yellow-400 mb-2">
                {patients.filter(p => p.riskLevel === 'medium').length}
              </div>
              <p className="text-sm text-yellow-300">Monitor closely</p>
            </div>
            
            <div className="p-4 bg-green-900/20 rounded-lg border border-green-800">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-5 h-5 text-green-400" />
                <span className="font-medium text-green-300">Low Risk Patients</span>
              </div>
              <div className="text-2xl font-bold text-green-400 mb-2">
                {patients.filter(p => p.riskLevel === 'low').length}
              </div>
              <p className="text-sm text-green-300">Routine follow-up</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}