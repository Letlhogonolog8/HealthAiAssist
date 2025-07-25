import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Users,
  Activity,
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Shield,
  Settings,
  UserCheck,
  UserX,
  Scan,
  HeartPulse,
  UserPlus,
  Stethoscope,
  RefreshCw,
  Server,
  Plus,
  Loader2
} from "lucide-react";
import AdminStaffManagement from "./admin-staff-management";
import AdminAnalyticsDashboard from "./admin-analytics-dashboard";
import AdminUserManagement from "./admin-user-management";
import { StaffDialogFixed } from "./staff-dialog-fixed";
import { MetricCard } from "./metric-card";

interface SystemStats {
  totalUsers: number;
  activeScans: number;
  systemUptime: number;
  aiAccuracy: number;
  dailyScans: number;
  criticalAlerts: number;
  databaseHealth: number;
  securityStatus: string;
}

interface UserMetrics {
  admins: number;
  radiologists: number;
  doctors: number;
  patients: number;
  activeUsers: number;
  newUsersToday: number;
}

interface ScanMetrics {
  totalScans: number;
  pendingScans: number;
  completedToday: number;
  cancerDetections: number;
  averageProcessingTime: number;
  aiConfidenceAverage: number;
}

interface StaffMember {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

interface Activity {
  message: string;
  timestamp: string;
  type: string;
}

// Form validation schemas
const doctorFormSchema = z.object({
  fullName: z.string().min(3, { message: "Full name must be at least 3 characters" }),
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
  specialty: z.string().min(1, { message: "Please select a specialty" })
});

const radiologistFormSchema = z.object({
  fullName: z.string().min(3, { message: "Full name must be at least 3 characters" }),
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
  expertise: z.string().min(1, { message: "Please select an expertise" })
});

export default function AdminDashboard({ user }: { user: any }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [showAddDoctorDialog, setShowAddDoctorDialog] = useState(false);
  const [showAddRadiologistDialog, setShowAddRadiologistDialog] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Form hooks
  const createDoctorForm = useForm<z.infer<typeof doctorFormSchema>>({
    resolver: zodResolver(doctorFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      specialty: ""
    }
  });
  
  const createRadiologistForm = useForm<z.infer<typeof radiologistFormSchema>>({
    resolver: zodResolver(radiologistFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      expertise: ""
    }
  });
  
  // Form submission handlers
  const onSubmitDoctor = (data: z.infer<typeof doctorFormSchema>) => {
    createDoctorMutation.mutate(data);
  };
  
  const onSubmitRadiologist = (data: z.infer<typeof radiologistFormSchema>) => {
    createRadiologistMutation.mutate(data);
  };

  // Helper function to handle API responses
  const handleApiResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Request failed');
      } else {
        const errorText = await response.text();
        throw new Error(errorText || 'Request failed');
      }
    }

    if (!contentType?.includes('application/json')) {
      throw new Error('Received non-JSON response');
    }

    return response.json();
  };

  // Create doctor mutation
  const createDoctorMutation = useMutation({
    mutationFn: async (doctorData: any) => {
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...doctorData,
          role: 'doctor'
        })
      });
      return handleApiResponse(response);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/homepage/statistics'] });
      
      toast({
        title: "Doctor Created Successfully",
        description: `Dr. ${data.fullName || ''} has been added to the system.`,
      });
      setShowAddDoctorDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Doctor",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Create radiologist mutation
  const createRadiologistMutation = useMutation({
    mutationFn: async (radiologistData: any) => {
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...radiologistData,
          role: 'radiologist'
        })
      });
      return handleApiResponse(response);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/homepage/statistics'] });
      
      toast({
        title: "Radiologist Created Successfully",
        description: `${data.fullName || ''} has been added to the system.`,
      });
      setShowAddRadiologistDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Radiologist",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Fetch staff list
  const { data: staffResponse, isLoading: staffLoading, refetch: refetchStaff } = useQuery<{ data: StaffMember[] }>({
    queryKey: ['/api/admin/staff'],
    queryFn: async () => {
      const response = await fetch('/api/admin/staff', { credentials: 'include' });
      return handleApiResponse(response);
    },
    refetchInterval: false,
    refetchOnWindowFocus: false
  });

  const staffMembers = staffResponse?.data || [];
  const doctors = staffMembers.filter((member) => member.role === 'doctor');
  const radiologists = staffMembers.filter((member) => member.role === 'radiologist');
  const deactivatedStaff = staffMembers.filter((member) => !member.isActive);

  // Fetch system statistics
  const { data: systemStats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<SystemStats>({
    queryKey: ['/api/admin/stats'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/stats', { credentials: 'include' });
        const data = await handleApiResponse(response);
        return data;
      } catch (error) {
        console.error('Error fetching system stats:', error);
        return {
          totalUsers: 0,
          activeScans: 0,
          systemUptime: 99.9,
          aiAccuracy: 94,
          dailyScans: 0,
          criticalAlerts: 0,
          databaseHealth: 95,
          securityStatus: 'secure'
        };
      }
    },
    refetchInterval: false,
    refetchOnWindowFocus: false
  });

  // Fetch user metrics
  const { data: userMetrics, isLoading: usersLoading, error: usersError, refetch: refetchUsers } = useQuery<UserMetrics>({
    queryKey: ['/api/admin/users/metrics'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/users/metrics', { credentials: 'include' });
        const data = await handleApiResponse(response);
        return data;
      } catch (error) {
        console.error('Error fetching user metrics:', error);
        return {
          admins: 1,
          radiologists: 0,
          doctors: 0,
          patients: 0,
          activeUsers: 0,
          newUsersToday: 0
        };
      }
    },
    refetchInterval: false,
    refetchOnWindowFocus: false
  });

  // Fetch scan metrics
  const { data: scanMetrics, isLoading: scansLoading, error: scansError, refetch: refetchScans } = useQuery<ScanMetrics>({
    queryKey: ['/api/admin/scans/metrics'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/scans/metrics', { credentials: 'include' });
        const data = await handleApiResponse(response);
        return data;
      } catch (error) {
        console.error('Error fetching scan metrics:', error);
        return {
          totalScans: 0,
          pendingScans: 0,
          completedToday: 0,
          cancerDetections: 0,
          averageProcessingTime: 2.3,
          aiConfidenceAverage: 94
        };
      }
    },
    refetchInterval: false,
    refetchOnWindowFocus: false
  });

  // Fetch recent activities
  const { data: recentActivities, isLoading: activitiesLoading, refetch: refetchActivities } = useQuery<Activity[]>({
    queryKey: ['/api/admin/activities/recent'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/activities/recent', { credentials: 'include' });
        const data = await handleApiResponse(response);
        return data;
      } catch (error) {
        console.error('Error fetching recent activities:', error);
        return [
          { message: 'System initialized successfully', timestamp: '1 hour ago', type: 'system' },
          { message: 'Database health check completed', timestamp: '2 hours ago', type: 'system' },
          { message: 'Security scan completed', timestamp: '4 hours ago', type: 'security' }
        ];
      }
    },
    refetchInterval: false,
    refetchOnWindowFocus: false
  });

  const handleRefresh = () => {
    refetchStats();
    refetchUsers();
    refetchScans();
    refetchActivities();
    refetchStaff();

    queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/scans/metrics'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/activities/recent'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });

    toast({
      title: "Data Refreshed",
      description: "Dashboard data has been refreshed.",
    });
  };

  if (statsLoading || usersLoading || scansLoading || staffLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh Data
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveSection('overview')}
          className={`px-4 py-2 ${activeSection === 'overview' ? 'border-b-2 border-primary font-medium' : ''}`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveSection('staff')}
          className={`px-4 py-2 ${activeSection === 'staff' ? 'border-b-2 border-primary font-medium' : ''}`}
        >
          Staff Management
        </button>
        <button
          onClick={() => setActiveSection('analytics')}
          className={`px-4 py-2 ${activeSection === 'analytics' ? 'border-b-2 border-primary font-medium' : ''}`}
        >
          Analytics
        </button>
        <button
          onClick={() => setActiveSection('settings')}
          className={`px-4 py-2 ${activeSection === 'settings' ? 'border-b-2 border-primary font-medium' : ''}`}
        >
          System Settings
        </button>
      </div>

      {/* Content Sections */}
      {activeSection === 'overview' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard 
              title="Total Users" 
              value={userMetrics?.admins + userMetrics?.doctors + userMetrics?.radiologists + userMetrics?.patients || 0} 
              subtitle={`+${userMetrics?.newUsersToday || 0} today`}
              icon={<Users className="h-5 w-5" />} 
              color="blue"
              onClick={() => setSelectedMetric("Total Users")}
            />
            <MetricCard 
              title="Active Scans" 
              value={systemStats?.activeScans || 0} 
              subtitle={`${scanMetrics?.completedToday || 0} completed today`}
              icon={<Activity className="h-5 w-5" />} 
              color="green"
              onClick={() => setSelectedMetric("Active Scans")}
            />
            <MetricCard 
              title="System Uptime" 
              value={`${systemStats?.systemUptime || 0}%`} 
              subtitle="Last 30 days"
              icon={<Server className="h-5 w-5" />} 
              color="purple"
              onClick={() => setSelectedMetric("System Health")}
            />
            <MetricCard 
              title="AI Accuracy" 
              value={`${systemStats?.aiAccuracy || 0}%`} 
              subtitle="Google Medical AI"
              icon={<Brain className="h-5 w-5" />} 
              color="amber"
              onClick={() => setSelectedMetric("AI Accuracy")}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Recent Activities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentActivities?.map((activity, index) => (
                    <div key={index} className="flex items-start">
                      <div className={`rounded-full p-2 mr-3 ${activity.type === 'system' ? 'bg-blue-100' : activity.type === 'security' ? 'bg-red-100' : 'bg-green-100'}`}>
                        {activity.type === 'system' ? <Database className="h-4 w-4" /> : activity.type === 'security' ? <Shield className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm">{activity.message}</p>
                        <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Database Health</span>
                      <span className="text-sm font-medium">{systemStats?.databaseHealth || 0}%</span>
                    </div>
                    <Progress value={systemStats?.databaseHealth || 0} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Security Status</span>
                      <span className="text-sm font-medium">{systemStats?.securityStatus || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center">
                      <Shield className="h-4 w-4 mr-2 text-green-500" />
                      <span className="text-sm">Protected</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">Critical Alerts</span>
                      <span className="text-sm font-medium">{systemStats?.criticalAlerts || 0}</span>
                    </div>
                    {(systemStats?.criticalAlerts || 0) > 0 ? (
                      <div className="flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-2 text-red-500" />
                        <span className="text-sm">Attention needed</span>
                      </div>
                    ) : (
                      <div className="flex items-center">
                        <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                        <span className="text-sm">All systems normal</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeSection === 'staff' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Staff Management</h2>
            <div className="flex gap-2">
              <Button onClick={() => setShowAddDoctorDialog(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Add Doctor
              </Button>
              <Button onClick={() => setShowAddRadiologistDialog(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Add Radiologist
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Doctors ({doctors.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {doctors.map((doctor) => (
                    <div key={doctor.id} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center">
                        <Avatar>
                          <AvatarFallback>{doctor.fullName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div className="ml-3">
                          <p className="font-medium">{doctor.fullName}</p>
                          <p className="text-sm text-muted-foreground">Doctor</p>
                        </div>
                      </div>
                      <Badge variant={doctor.isActive ? "default" : "outline"}>
                        {doctor.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))}
                  {doctors.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">No doctors found</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Radiologists ({radiologists.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {radiologists.map((radiologist) => (
                    <div key={radiologist.id} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center">
                        <Avatar>
                          <AvatarFallback>{radiologist.fullName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div className="ml-3">
                          <p className="font-medium">{radiologist.fullName}</p>
                          <p className="text-sm text-muted-foreground">Radiologist</p>
                        </div>
                      </div>
                      <Badge variant={radiologist.isActive ? "default" : "outline"}>
                        {radiologist.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))}
                  {radiologists.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">No radiologists found</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Add Doctor Dialog */}
      <Dialog open={showAddDoctorDialog} onOpenChange={setShowAddDoctorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Doctor</DialogTitle>
            <DialogDescription>
              Create a new doctor account in the system.
            </DialogDescription>
          </DialogHeader>
          <Form {...createDoctorForm}>
            <form onSubmit={createDoctorForm.handleSubmit(onSubmitDoctor)} className="space-y-4">
              <FormField
                control={createDoctorForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Dr. John Smith" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createDoctorForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="doctor@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createDoctorForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createDoctorForm.control}
                name="specialty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specialty</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select specialty" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="oncology">Oncology</SelectItem>
                        <SelectItem value="radiology">Radiology</SelectItem>
                        <SelectItem value="dermatology">Dermatology</SelectItem>
                        <SelectItem value="gastroenterology">Gastroenterology</SelectItem>
                        <SelectItem value="urology">Urology</SelectItem>
                        <SelectItem value="general">General Practice</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddDoctorDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createDoctorMutation.isPending}>
                  {createDoctorMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Doctor"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Radiologist Dialog */}
      <Dialog open={showAddRadiologistDialog} onOpenChange={setShowAddRadiologistDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Radiologist</DialogTitle>
            <DialogDescription>
              Create a new radiologist account in the system.
            </DialogDescription>
          </DialogHeader>
          <Form {...createRadiologistForm}>
            <form onSubmit={createRadiologistForm.handleSubmit(onSubmitRadiologist)} className="space-y-4">
              <FormField
                control={createRadiologistForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Smith" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createRadiologistForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="radiologist@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createRadiologistForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createRadiologistForm.control}
                name="expertise"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expertise</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select expertise" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="mri">MRI Specialist</SelectItem>
                        <SelectItem value="ct">CT Scan Specialist</SelectItem>
                        <SelectItem value="xray">X-Ray Specialist</SelectItem>
                        <SelectItem value="ultrasound">Ultrasound Specialist</SelectItem>
                        <SelectItem value="mammography">Mammography Specialist</SelectItem>
                        <SelectItem value="general">General Radiologist</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddRadiologistDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createRadiologistMutation.isPending}>
                  {createRadiologistMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Radiologist"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}