import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  UserPlus, 
  Users, 
  Edit, 
  Trash2, 
  Stethoscope, 
  Brain,
  Mail,
  Phone,
  Badge as BadgeIcon
} from "lucide-react";

interface StaffMember {
  id: number;
  username: string;
  fullName: string;
  role: 'doctor' | 'radiologist';
  email: string;
  specialization?: string;
  licenseNumber?: string;
  isActive: boolean;
  createdAt: string;
}

interface ApiResponse {
  data: StaffMember[];
  success: boolean;
  message?: string;
}

export default function AdminStaffManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    fullName: '',
    email: '',
    role: 'doctor' as 'doctor' | 'radiologist',
    specialization: '',
    licenseNumber: ''
  });

  const { data: staffResponse, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ['/api/admin/staff'],
    queryFn: async () => {
      const response = await fetch('/api/admin/staff', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch staff');
      }
      const data = await response.json();
      return data;
    }
  });

  // Extract staff members with proper type safety
  const staffMembers: StaffMember[] = staffResponse?.data || [];

  // Separate doctors, radiologists, and deactivated staff for rendering
  const doctors = staffMembers.filter(member => member.role === 'doctor');
  const radiologists = staffMembers.filter(member => member.role === 'radiologist');
  const deactivatedStaff = staffMembers.filter(member => !member.isActive);

  const createStaffMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch('/api/admin/staff', {  // Fixed endpoint URL
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create staff member');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      setIsCreateDialogOpen(false);
      setFormData({
        username: '',
        password: '',
        fullName: '',
        email: '',
        role: 'doctor',
        specialization: '',
        licenseNumber: ''
      });
      toast({
        title: "Staff Member Created",
        description: "New staff member has been successfully created and can now login.",
      });
      queryClient.refetchQueries({ queryKey: ['/api/admin/staff'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create staff member",
        variant: "destructive",
      });
    }
  });

  const deactivateStaffMutation = useMutation({
    mutationFn: async (staffId: number) => {
      const response = await fetch(`/api/admin/staff/${staffId}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });
      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || 'Failed to deactivate staff member');
        } catch {
          throw new Error('Failed to deactivate staff member');
        }
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      toast({
        title: "Staff Deactivated",
        description: "Staff member has been deactivated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Deactivation Failed",
        description: error.message || "Failed to deactivate staff member",
        variant: "destructive",
      });
    }
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (staffId: number) => {
      const response = await fetch(`/api/admin/staff/${staffId}/permanent`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });
      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || 'Failed to permanently delete staff member');
        } catch {
          throw new Error('Failed to permanently delete staff member');
        }
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      toast({
        title: "Staff Permanently Deleted",
        description: "Staff member has been permanently removed from the system.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Permanent Deletion Failed",
        description: error.message || "Failed to permanently delete staff member",
        variant: "destructive",
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username || !formData.password || !formData.fullName || !formData.email) {
      toast({
        title: "Missing Fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createStaffMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Staff Management
            </CardTitle>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Staff Member
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create New Staff Member</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="username">Username*</Label>
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                        placeholder="Username"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password*</Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                        placeholder="Password"
                        required
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="fullName">Full Name*</Label>
                    <Input
                      id="fullName"
                      value={formData.fullName}
                      onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="Dr. John Smith"
                      required
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="email">Email*</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="doctor@medai.com"
                      required
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="role">Role*</Label>
                    <Select value={formData.role} onValueChange={(value: 'doctor' | 'radiologist') => setFormData(prev => ({ ...prev, role: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="doctor">Doctor</SelectItem>
                        <SelectItem value="radiologist">Radiologist</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="specialization">Specialization</Label>
                    <Input
                      id="specialization"
                      value={formData.specialization}
                      onChange={(e) => setFormData(prev => ({ ...prev, specialization: e.target.value }))}
                      placeholder="Oncology, Radiology, etc."
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="licenseNumber">License Number</Label>
                    <Input
                      id="licenseNumber"
                      value={formData.licenseNumber}
                      onChange={(e) => setFormData(prev => ({ ...prev, licenseNumber: e.target.value }))}
                      placeholder="MD-12345"
                    />
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createStaffMutation.isPending}>
                      {createStaffMutation.isPending ? 'Creating...' : 'Create Staff Member'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="doctors" className="space-y-6">
            <TabsList>
              <TabsTrigger value="doctors" className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4" />
                Doctors ({doctors.length})
              </TabsTrigger>
              <TabsTrigger value="radiologists" className="flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Radiologists ({radiologists.length})
              </TabsTrigger>
              <TabsTrigger value="deleted" className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Deactivated ({deactivatedStaff.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="doctors">
              <div className="grid gap-4">
                {doctors.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No doctors found. Create your first doctor account above.
                  </div>
                ) : (
                  doctors.map(doctor => (
                    <Card key={doctor.id} className="border-l-4 border-l-blue-500">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-lg">{doctor.fullName}</h3>
                              <Badge variant={doctor.isActive ? "default" : "secondary"}>
                                {doctor.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="space-y-1 text-sm text-gray-600">
                              <div className="flex items-center gap-2">
                                <BadgeIcon className="w-4 h-4" />
                                <span>@{doctor.username}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                <span>{doctor.email}</span>
                              </div>
                              {doctor.specialization && (
                                <div className="flex items-center gap-2">
                                  <Stethoscope className="w-4 h-4" />
                                  <span>{doctor.specialization}</span>
                                </div>
                              )}
                              {doctor.licenseNumber && (
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                    {doctor.licenseNumber}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => deactivateStaffMutation.mutate(doctor.id)}
                              disabled={deactivateStaffMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="radiologists">
              <div className="grid gap-4">
                {radiologists.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No radiologists found. Create your first radiologist account above.
                  </div>
                ) : (
                  radiologists.map(radiologist => (
                    <Card key={radiologist.id} className="border-l-4 border-l-purple-500">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-lg">{radiologist.fullName}</h3>
                              <Badge variant={radiologist.isActive ? "default" : "secondary"}>
                                {radiologist.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="space-y-1 text-sm text-gray-600">
                              <div className="flex items-center gap-2">
                                <BadgeIcon className="w-4 h-4" />
                                <span>@{radiologist.username}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                <span>{radiologist.email}</span>
                              </div>
                              {radiologist.specialization && (
                                <div className="flex items-center gap-2">
                                  <Brain className="w-4 h-4" />
                                  <span>{radiologist.specialization}</span>
                                </div>
                              )}
                              {radiologist.licenseNumber && (
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                    {radiologist.licenseNumber}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => deactivateStaffMutation.mutate(radiologist.id)}
                              disabled={deactivateStaffMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="deleted">
              <div className="grid gap-4">
                {deactivatedStaff.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No deactivated staff members found.
                  </div>
                ) : (
                  deactivatedStaff.map(member => (
                    <Card key={member.id} className="border-l-4 border-l-red-500 bg-red-50">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-lg text-red-800">{member.fullName}</h3>
                              <Badge variant="destructive">Deactivated</Badge>
                            </div>
                            <div className="space-y-1 text-sm text-red-700">
                              <div className="flex items-center gap-2">
                                <BadgeIcon className="w-4 h-4" />
                                <span>@{member.username}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                <span>{member.email}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {member.role === 'doctor' ? <Stethoscope className="w-4 h-4" /> : <Brain className="w-4 h-4" />}
                                <span className="capitalize">{member.role}</span>
                              </div>
                              {member.specialization && (
                                <div className="flex items-center gap-2">
                                  <span>{member.specialization}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              variant="destructive" 
                              size="sm"
                              onClick={() => {
                                if (confirm(`Are you sure you want to permanently delete ${member.fullName}? This action cannot be undone and will remove all associated data.`)) {
                                  permanentDeleteMutation.mutate(member.id);
                                }
                              }}
                              disabled={permanentDeleteMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete Permanently
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}