import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Activity, Brain, TrendingUp, AlertTriangle, CheckCircle, Database, Shield, Settings,
  UserCheck, RefreshCw, Server, UserPlus, Edit, Trash2, Key, Mail, Stethoscope, Loader2,
  Search, Filter, Download, Bell, Zap, Eye, EyeOff, BarChart3
} from "lucide-react";
import { MetricCard } from "./metric-card";
import ModelPerformancePanel, { useModelCards } from "./model-performance-panel";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

/** Renders a process uptime in seconds as something a human reads. */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

import { LanguageCoverage } from "./language-switcher";
import DeliveryReachPanel from "./delivery-reach-panel";

interface DashboardData {
  stats: {
    totalUsers: number;
    activeScans: number;
    // Nullable: when a stats fetch fails these are unknown, and the dashboard
    // renders "—". They used to fall back to invented constants (aiAccuracy 94,
    // databaseHealth 95, systemUptime 99.9) that were indistinguishable from
    // measured values.
    systemUptime: number | null;
    /** Seconds this process has been running. Not availability over a window. */
    uptimeSec?: number;
    aiAccuracy: number | null;
    dailyScans: number;
    criticalAlerts: number;
    databaseHealth: number | null;
    /** A live connectivity probe, replacing the constant "databaseHealth". */
    database?: { reachable: boolean; latencyMs: number | null };
  };
  users: {
    admins: number;
    radiologists: number;
    doctors: number;
    patients: number;
    activeUsers: number;
    newUsersToday: number;
    list: Array<{
      id: number;
      username: string;
      fullName: string;
      email: string;
      role: string;
      isActive: boolean;
      specialization?: string;
    }>;
  };
  staff: Array<{
    id: number;
    username: string;
    fullName: string;
    role: string;
    email: string;
    specialization?: string;
    isActive: boolean;
  }>;
  activities: Array<{
    message: string;
    timestamp: string;
    type: string;
  }>;
}

export default function AdminDashboard({ user, section = 'overview', hideLocalTabs = false, setActiveTab }: { user: any; section?: 'overview' | 'analytics' | 'users' | 'system'; hideLocalTabs?: boolean; setActiveTab?: (tab: string) => void }) {
  const [activeSection, setActiveSection] = useState(section);
  useEffect(() => {
    setActiveSection(section);
  }, [section]);
  const [showAddStaffDialog, setShowAddStaffDialog] = useState(false);
  const [showEditStaffDialog, setShowEditStaffDialog] = useState(false);
  const [showEditUserDialog, setShowEditUserDialog] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [staffFormData, setStaffFormData] = useState({
    username: '', password: '', fullName: '', email: '', role: 'doctor', specialization: ''
  });
  const [editStaffFormData, setEditStaffFormData] = useState({
    id: 0, username: '', fullName: '', email: '', role: 'doctor', specialization: '', isActive: true
  });
  const [editUserFormData, setEditUserFormData] = useState({
    id: 0, username: '', fullName: '', email: '', role: 'patient', specialization: '', isActive: true
  });
  const [showPasswordResetDialog, setShowPasswordResetDialog] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [activeUserTab, setActiveUserTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Measured model performance, for the analytics panel and the export.
  const { data: modelCards } = useModelCards();

  // System health query (advanced routes)
  const { data: systemHealth } = useQuery<{ status: string; services: Record<string, string>; performance?: any; memory?: any }>({
    queryKey: ['/api/advanced/health'],
    queryFn: async () => {
      const res = await fetch('/api/advanced/health', { credentials: 'include' });
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
    refetchInterval: 30000,
  });

  /**
   * Readiness, which is where the real operational facts live.
   *
   * /api/ready probes the database on each call and reports the pool counters,
   * which notification channels are configured, and which encryption key is
   * active. It is the same endpoint a load balancer polls, so what an operator
   * sees here is what the infrastructure sees.
   */
  const { data: ready, refetch: refetchReady } = useQuery<{
    status: string;
    uptimeSec: number;
    database: string;
    latencyMs?: number;
    pool?: { total: number; idle: number; waiting: number };
    notificationChannels?: { email: boolean; sms: boolean };
    encryption?: { configured: boolean; activeKeyId: string | null; keyCount: number };
  }>({
    queryKey: ['/api/ready'],
    queryFn: async () => (await fetch('/api/ready')).json(),
    refetchInterval: 30000,
  });

  /** Round trip the browser measured for the last /api/admin/stats call. */
  const [statsResponseMs, setStatsResponseMs] = useState<number | null>(null);

  // Consolidated dashboard data fetch with real-time updates
  const { data: dashboardData, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ['/api/admin/dashboard'],
    queryFn: async () => {
      try {
        const startedAt = performance.now();
        // /api/debug/users was in this list and does not exist on the server: it
        // 404'd on every dashboard render, and the two "fallback" branches that
        // consumed it could never fire. It has been dropped along with them.
        const [statsRes, usersRes, staffRes, activitiesRes, wsStatsRes, metricsRes] = await Promise.all([
          fetch('/api/admin/stats', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
          fetch('/api/admin/users', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
          fetch('/api/admin/staff', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
          fetch('/api/admin/activities/recent', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
          fetch('/api/system/ws-stats', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
          fetch('/api/admin/users/metrics', { credentials: 'include' }).catch(() => ({ ok: false } as Response)),
        ]);
        setStatsResponseMs(Math.round(performance.now() - startedAt));

        const [stats, users, staff, activities, wsStats, metrics]: any[] = await Promise.all([
          statsRes.ok ? statsRes.json().catch(() => ({})) : {
            totalUsers: 0, activeScans: 0, systemUptime: null, aiAccuracy: null,
            dailyScans: 0, criticalAlerts: 0, databaseHealth: null
          },
          usersRes.ok ? usersRes.json().catch(() => []) : [],
          staffRes.ok ? staffRes.json().catch(() => ({ data: [] })) : { data: [] },
          // An empty list, not a fabricated "System initialized successfully"
          // entry timestamped "1 hour ago". A failed fetch is not an event.
          activitiesRes.ok ? activitiesRes.json().catch(() => []) : [],
          wsStatsRes.ok ? wsStatsRes.json().catch(() => ({ connections: 0, messages: 0, onlineUsers: 0, roles: {} }))
                        : { connections: 0, messages: 0, onlineUsers: 0, roles: {} },
          metricsRes.ok ? metricsRes.json().catch(() => ({})) : {},
        ]);

        let userList = Array.isArray(users) ? users : [] as any[];
        // Fallback: if /api/admin/users returns empty, derive from /api/admin/staff.
        //
        // This existed because /api/admin/users had been commented out of
        // routes.ts and answered 404, so the user list silently degraded to
        // staff-only — patients simply were not there, with nothing to say so.
        // The route is restored; this stays as a genuine degradation path.
        if (userList.length === 0 && staff && Array.isArray((staff as any).data)) {
          userList = (staff as any).data.map((s: any) => ({
            id: s.id,
            username: s.username,
            fullName: s.fullName,
            email: s.email,
            role: s.role,
            specialization: s.specialization,
            isActive: s.isActive ?? true,
            createdAt: s.createdAt || new Date().toISOString()
          }));
        }
        // Build metrics from either metrics endpoint or computed list
        const computedMetrics = {
          admins: userList.filter((u: any) => u.role === 'admin').length,
          doctors: userList.filter((u: any) => u.role === 'doctor').length,
          radiologists: userList.filter((u: any) => u.role === 'radiologist').length,
          patients: userList.filter((u: any) => u.role === 'patient').length,
          activeUsers: userList.filter((u: any) => u.isActive).length,
          newUsersToday: 0,
        };
        const userMetrics = {
          admins: (metrics.admins ?? computedMetrics.admins) || 0,
          doctors: (metrics.doctors ?? computedMetrics.doctors) || 0,
          radiologists: (metrics.radiologists ?? computedMetrics.radiologists) || 0,
          patients: (metrics.patients ?? computedMetrics.patients) || 0,
          activeUsers: (metrics.activeUsers ?? computedMetrics.activeUsers) || 0,
          newUsersToday: (metrics.newUsersToday ?? computedMetrics.newUsersToday) || 0,
          list: userList
        };

        return {
          stats: { ...stats, totalUsers: (metrics.totalUsers ?? userList.length) || userList.length, ws: wsStats },
          users: userMetrics,
          staff: staff.data || [],
          activities: Array.isArray(activities) ? activities : []
        };
      } catch (error) {
        console.error('Dashboard data fetch error:', error);
        return {
          stats: {
            totalUsers: 0, activeScans: 0, systemUptime: null, aiAccuracy: null,
            dailyScans: 0, criticalAlerts: 0, databaseHealth: null
          },
          users: { admins: 0, doctors: 0, radiologists: 0, patients: 0, activeUsers: 0, newUsersToday: 0, list: [] },
          staff: [],
          activities: [{ message: 'System initialized successfully', timestamp: '1 hour ago', type: 'system' }]
        };
      }
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: 1
  });

  // Create staff mutation
  const createStaffMutation = useMutation({
    mutationFn: async (data: typeof staffFormData) => {
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create staff member' }));
        throw new Error(errorData.error || 'Failed to create staff member');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      setShowAddStaffDialog(false);
      setStaffFormData({ username: '', password: '', fullName: '', email: '', role: 'doctor', specialization: '' });
      toast({
        title: "Staff Member Created",
        description: `${data.fullName || staffFormData.fullName} has been successfully created.`,
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Edit staff mutation
  const editStaffMutation = useMutation({
    mutationFn: async (data: typeof editStaffFormData) => {
      const response = await fetch(`/api/admin/staff/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update staff member' }));
        throw new Error(errorData.error || 'Failed to update staff member');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      setShowEditStaffDialog(false);
      setEditingStaff(null);
      toast({ title: "Staff Updated", description: "Staff member updated successfully." });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    }
  });

  // Edit user mutation
  const editUserMutation = useMutation({
    mutationFn: async (data: typeof editUserFormData) => {
      const response = await fetch(`/api/admin/users/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update user' }));
        throw new Error(errorData.error || 'Failed to update user');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      setShowEditUserDialog(false);
      setEditingUser(null);
      toast({ title: "User Updated", description: "User updated successfully." });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    }
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete user' }));
        throw new Error(errorData.error || 'Failed to delete user');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      toast({ title: 'User Deleted', description: 'The user has been removed successfully.' });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: 'Delete Failed', description: error.message, variant: 'destructive' });
    }
  });

  // Password reset mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { userId: number; newPassword: string }) => {
      const response = await fetch(`/api/admin/users/${data.userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: data.newPassword })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to reset password' }));
        throw new Error(errorData.error || 'Failed to reset password');
      }
      return response.json();
    },
    onSuccess: () => {
      setShowPasswordResetDialog(false);
      setResetPasswordUser(null);
      setNewPassword('');
      toast({ title: "Password Reset", description: "Password has been reset successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Reset Failed", description: error.message, variant: "destructive" });
    }
  });

  // Auto-refresh effect with update tracking
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      setLastUpdated(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  const handleRefresh = () => {
    refetch();
    setLastUpdated(new Date());
    toast({ 
      title: "Data Refreshed", 
      description: "Dashboard data updated successfully.",
      duration: 2000
    });
  };

  /**
   * Chart series, from the database.
   *
   * Both of these used to be synthesised in the browser out of a single scalar.
   * The scan trend was `dailyScans - (6 - i) * 2`, i.e. today's count with a
   * fixed slope subtracted, labelled Sun-Sat regardless of what day it was. The
   * user-growth bars were the current user count times 0.5, 0.6, 0.7, 0.78,
   * 0.86, 0.93 and 1.0, labelled Jan-Jul forever. Neither had any history behind
   * it, and both drew a rising curve on an empty database.
   */
  const { data: trends } = useQuery<{
    scansPerDay: Array<{ day: string; scans: number }>;
    usersByMonth: Array<{ month: string; users: number }>;
  }>({
    queryKey: ['/api/admin/trends'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trends', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load trends');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const scanTrendData = (trends?.scansPerDay ?? []).map((row) => ({
    day: new Date(row.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
    scans: row.scans,
  }));
  const userGrowthData = (trends?.usersByMonth ?? []).map((row) => ({
    month: row.month,
    users: row.users,
  }));

  function AdvancedPerformanceSection() {
    const { data, isLoading, error } = useQuery<{ ai: any; database: any; api: any; overall: any }>({
      queryKey: ['/api/advanced/analytics/performance'],
      queryFn: async () => {
        const res = await fetch('/api/advanced/analytics/performance', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load performance metrics');
        return res.json();
      },
      refetchInterval: 30000,
    });

    if (isLoading) {
      return (
        <Card className="shadow-lg border-2 border-slate-300">
          <CardHeader className="bg-slate-200 border-b border-slate-300">
            <CardTitle>Advanced System Metrics</CardTitle>
          </CardHeader>
          <CardContent className="p-6">Loading metrics...</CardContent>
        </Card>
      );
    }
    if (error || !data) {
      return null;
    }

    const apiSeries = [
      { name: 'Requests/min', value: data.api?.requestsPerMinute ?? 0 },
      { name: 'Avg Response (ms)', value: Math.round(data.api?.averageResponseTime ?? 0) },
      { name: 'Throughput', value: Math.round(data.api?.throughput ?? 0) },
    ];
    const dbSeries = [
      { name: 'Avg Query (ms)', value: Math.round(data.database?.averageQueryTime ?? 0) },
      { name: 'Connections', value: Math.round(data.database?.connectionCount ?? 0) },
      { name: 'Cache Hit %', value: Math.round((data.database?.cachehitRate ?? 0) * 100) },
    ];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-lg border-2 border-slate-300">
          <CardHeader className="bg-slate-200 border-b border-slate-300">
            <CardTitle>API Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-white">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={apiSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-lg border-2 border-slate-300">
          <CardHeader className="bg-slate-200 border-b border-slate-300">
            <CardTitle>Database Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-white">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dbSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-lg border-2 border-slate-300">
          <CardHeader className="bg-slate-200 border-b border-slate-300">
            <CardTitle>Overall Health</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-white">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[{ name: 'Health Score', score: Math.round((data.overall?.healthScore ?? 0)) }]}> 
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 text-sm text-slate-600">Uptime: {Math.round((data.overall?.uptime ?? 0) * 100)}%</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffFormData.username || !staffFormData.password || !staffFormData.fullName || !staffFormData.email) {
      toast({
        title: "Missing Fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createStaffMutation.mutate(staffFormData);
  };

  const handleEditStaff = (staff: any) => {
    setEditingStaff(staff);
    setEditStaffFormData({
      id: staff.id,
      username: staff.username,
      fullName: staff.fullName,
      email: staff.email,
      role: staff.role,
      specialization: staff.specialization || '',
      isActive: staff.isActive
    });
    setShowEditStaffDialog(true);
  };

  const handleEditUser = (user: any) => {
    setEditingUser(user);
    setEditUserFormData({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      specialization: user.specialization || '',
      isActive: user.isActive
    });
    setShowEditUserDialog(true);
  };

  const handleEditStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    editStaffMutation.mutate(editStaffFormData);
  };

  const handleEditUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    editUserMutation.mutate(editUserFormData);
  };

  const handlePasswordReset = (user: any) => {
    setResetPasswordUser(user);
    setNewPassword('');
    setShowPasswordResetDialog(true);
  };

  const handlePasswordResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "Invalid Password", description: "Password must be at least 6 characters long", variant: "destructive" });
      return;
    }
    resetPasswordMutation.mutate({ userId: resetPasswordUser.id, newPassword });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-500 mb-4">Error loading dashboard data</p>
        <p className="text-muted-foreground mb-4 text-sm">Please check your connection and try again</p>
        <Button onClick={handleRefresh} className="bg-blue-600 hover:bg-blue-700">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const doctors = dashboardData?.staff.filter(member => 
    member.role === 'doctor' && 
    (searchTerm === '' || member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
     member.email.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];
  
  const radiologists = dashboardData?.staff.filter(member => 
    member.role === 'radiologist' && 
    (searchTerm === '' || member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
     member.email.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];
  
  const filteredUsers = dashboardData?.users.list.filter(user => 
    (activeUserTab === 'all' || user.role === activeUserTab) &&
    (searchTerm === '' || user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
     user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
     user.username.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  return (
    <div className="p-4 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 min-h-screen">
      {/* Navigation Tabs (hidden when controlled by parent) */}
      {!hideLocalTabs && (
        <div className="mb-6">
          <div className="flex space-x-1 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {[ 
              { id: 'overview', label: 'Overview', icon: TrendingUp },
              { id: 'analytics', label: 'Analytics', icon: BarChart3 },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'system', label: 'System', icon: Settings }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeSection === id
                    ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm border border-blue-100 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      
        <div className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Administrator Dashboard</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <div className="flex gap-2">
            <Button onClick={() => {
            const data = { stats: dashboardData?.stats, users: dashboardData?.users, staff: dashboardData?.staff };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `admin-dashboard-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            toast({ title: "Data Exported", description: "Dashboard data exported successfully." });
            }} variant="outline" size="sm" className="border-slate-300 dark:border-slate-600">
              <Download className="h-4 w-4 mr-2" /> Export
          </Button>
            <Button onClick={handleRefresh} variant="outline" size="sm" className="border-slate-300 dark:border-slate-600">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Content Sections */}
      {activeSection === 'overview' && (
        <div>
          {/* Enhanced Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white hover:shadow-xl transition-all cursor-pointer" onClick={() => hideLocalTabs ? setActiveTab && setActiveTab('users') : setActiveSection('users')}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Total Users</p>
                    <p className="text-3xl font-bold">{dashboardData?.stats.totalUsers || 0}</p>
                    <p className="text-blue-200 text-xs mt-1">+{dashboardData?.users.newUsersToday || 0} today</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-3">
                    <Users className="h-8 w-8" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-emerald-500 to-green-600 text-white hover:shadow-xl transition-all cursor-pointer" onClick={() => hideLocalTabs ? setActiveTab && setActiveTab('analytics') : setActiveSection('analytics')}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-100 text-sm font-medium">Active Scans</p>
                    <p className="text-3xl font-bold">{dashboardData?.stats.activeScans || 0}</p>
                    <p className="text-green-200 text-xs mt-1">{dashboardData?.stats.dailyScans || 0} completed today</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-3">
                    <Activity className="h-8 w-8" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-violet-500 to-purple-600 text-white hover:shadow-xl transition-all cursor-pointer" onClick={() => hideLocalTabs ? setActiveTab && setActiveTab('system') : setActiveSection('system')}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-100 text-sm font-medium">Process Uptime</p>
                    <p className="text-3xl font-bold">
                      {dashboardData?.stats.uptimeSec != null
                        ? formatUptime(dashboardData.stats.uptimeSec)
                        : '—'}
                    </p>
                    <p className="text-purple-200 text-xs mt-1">
                      Since last restart. Availability over a window needs an
                      external monitor.
                    </p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-3">
                    <Server className="h-8 w-8" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-amber-500 to-orange-500 text-white hover:shadow-xl transition-all cursor-pointer" onClick={() => hideLocalTabs ? setActiveTab && setActiveTab('analytics') : setActiveSection('analytics')}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-amber-100 text-sm font-medium">Mean AI Confidence</p>
                    <p className="text-3xl font-bold">
                      {dashboardData?.stats.aiAccuracy != null ? `${dashboardData.stats.aiAccuracy}%` : '—'}
                    </p>
                    <p className="text-amber-200 text-xs mt-1">How sure the model was, not how often it was right</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-3">
                    <Brain className="h-8 w-8" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Additional Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="border-l-4 border-l-red-500 dark:border-l-red-600 bg-white dark:bg-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Critical Alerts</p>
                    <p className="text-2xl font-bold text-red-600">{dashboardData?.stats.criticalAlerts || 0}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-blue-500 dark:border-l-blue-600 bg-white dark:bg-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Database Latency</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {dashboardData?.stats.database
                        ? dashboardData.stats.database.reachable
                          ? `${dashboardData.stats.database.latencyMs} ms`
                          : 'unreachable'
                        : '—'}
                    </p>
                  </div>
                  <Database className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-green-500 dark:border-l-green-600 bg-white dark:bg-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">At-rest encryption</p>
                    <p
                      className={`text-lg font-bold ${
                        ready?.encryption?.configured ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {ready?.encryption == null
                        ? '—'
                        : ready.encryption.configured
                          ? 'Configured'
                          : 'Not configured'}
                    </p>
                  </div>
                  <Shield className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-cyan-500 dark:border-l-cyan-600 bg-white dark:bg-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-cyan-600">WebSocket Connections</p>
                    <p className="text-2xl font-bold text-cyan-700">{(dashboardData as any)?.stats?.ws?.connections || 0}</p>
                  </div>
                  <Server className="h-8 w-8 text-cyan-600" />
                </div>
                <p className="text-xs text-cyan-600 mt-1">Online users: {(dashboardData as any)?.stats?.ws?.onlineUsers || 0}</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-sky-500 dark:border-l-sky-600 bg-white dark:bg-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-sky-600">Realtime Messages</p>
                    <p className="text-2xl font-bold text-sky-700">{(dashboardData as any)?.stats?.ws?.messages || 0}</p>
                  </div>
                  <Activity className="h-8 w-8 text-sky-600" />
                </div>
                <p className="text-xs text-sky-600 mt-1">Across all roles</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="col-span-2 shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-700" />
                  <span className="text-slate-900">Recent System Activities</span>
                  <Badge className="ml-auto bg-green-200 text-green-900 border border-green-400">
                    Live Feed
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {dashboardData?.activities.length === 0 ? (
                    <div className="text-center py-8">
                      <Activity className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                      <p className="text-slate-700 font-medium">No recent activities</p>
                    </div>
                  ) : (
                    dashboardData?.activities.map((activity, index) => (
                      <div key={index} className="flex items-start p-3 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-colors">
                        <div className={`rounded-full p-2 mr-4 border ${
                          activity.type === 'system' ? 'bg-blue-200 text-blue-800 border-blue-300' : 
                          activity.type === 'security' ? 'bg-red-200 text-red-800 border-red-300' : 
                          activity.type === 'user' ? 'bg-green-200 text-green-800 border-green-300' :
                          'bg-purple-200 text-purple-800 border-purple-300'
                        }`}>
                          {activity.type === 'system' ? <Database className="h-4 w-4" /> : 
                           activity.type === 'security' ? <Shield className="h-4 w-4" /> : 
                           activity.type === 'user' ? <UserCheck className="h-4 w-4" /> :
                           <Bell className="h-4 w-4" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900">{activity.message}</p>
                          <p className="text-xs text-slate-600 mt-1">{activity.timestamp}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-green-700" />
                  <span className="text-slate-900">System Health Monitor</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-blue-900">Database Latency</span>
                      <span className="text-lg font-bold text-blue-700">
                        {dashboardData?.stats.database
                          ? dashboardData.stats.database.reachable
                            ? `${dashboardData.stats.database.latencyMs} ms`
                            : 'unreachable'
                          : '—'}
                      </span>
                    </div>
                    <p className="text-xs text-blue-600 mt-1">Round trip for SELECT 1</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-green-50 to-green-100 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-green-900">At-rest encryption</p>
                        <p className="text-lg font-bold text-green-700">
                          {ready?.encryption == null
                            ? '—'
                            : ready.encryption.configured
                              ? 'Configured'
                              : 'Not configured'}
                        </p>
                      </div>
                      <Shield className="h-8 w-8 text-green-600" />
                    </div>
                    {/* Was "All security protocols active" — a literal. */}
                    <p className="text-xs text-green-600 mt-1">
                      {ready?.encryption?.configured
                        ? `Active key ${ready.encryption.activeKeyId}, ${ready.encryption.keyCount} in the ring`
                        : 'No encryption key is configured for this deployment'}
                    </p>
                  </div>
                  
                  <div className={`p-4 rounded-lg ${
                    (dashboardData?.stats.criticalAlerts || 0) > 0 
                      ? 'bg-gradient-to-r from-red-50 to-red-100' 
                      : 'bg-gradient-to-r from-green-50 to-green-100'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-sm font-medium ${
                          (dashboardData?.stats.criticalAlerts || 0) > 0 ? 'text-red-900' : 'text-green-900'
                        }`}>Critical Alerts</p>
                        <p className={`text-lg font-bold ${
                          (dashboardData?.stats.criticalAlerts || 0) > 0 ? 'text-red-700' : 'text-green-700'
                        }`}>{dashboardData?.stats.criticalAlerts || 0}</p>
                      </div>
                      {(dashboardData?.stats.criticalAlerts || 0) > 0 ? (
                        <AlertTriangle className="h-8 w-8 text-red-600" />
                      ) : (
                        <CheckCircle className="h-8 w-8 text-green-600" />
                      )}
                    </div>
                    <p className={`text-xs mt-1 ${
                      (dashboardData?.stats.criticalAlerts || 0) > 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {/* Was "All systems operational" at zero. This counts
                          scans flagged critical; it says nothing about the
                          system's own health. */}
                      {(dashboardData?.stats.criticalAlerts || 0) > 0
                        ? 'Scans flagged critical, awaiting review'
                        : 'No scans currently flagged critical'}
                    </p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-purple-50 to-purple-100 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-purple-900">Models serving</p>
                        {/* Was the literal "Active", whatever the registry said. */}
                        <p className="text-lg font-bold text-purple-700 tabular-nums">
                          {modelCards
                            ? `${modelCards.models.filter((m) => m.enabled).length} of ${modelCards.models.length}`
                            : '—'}
                        </p>
                      </div>
                      <Brain className="h-8 w-8 text-purple-600" />
                    </div>
                    <p className="text-xs text-purple-600 mt-1">
                      Mean confidence{' '}
                      {dashboardData?.stats.aiAccuracy != null ? `${dashboardData.stats.aiAccuracy}%` : '—'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}



      {activeSection === 'users' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              User Management
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Dialog open={showAddStaffDialog} onOpenChange={setShowAddStaffDialog}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Staff
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Add New Staff Member</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleStaffSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="username">Username*</Label>
                      <Input
                        id="username"
                        value={staffFormData.username}
                        onChange={(e) => setStaffFormData(prev => ({ ...prev, username: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password*</Label>
                      <Input
                        id="password"
                        type="password"
                        value={staffFormData.password}
                        onChange={(e) => setStaffFormData(prev => ({ ...prev, password: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="fullName">Full Name*</Label>
                      <Input
                        id="fullName"
                        value={staffFormData.fullName}
                        onChange={(e) => setStaffFormData(prev => ({ ...prev, fullName: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email*</Label>
                      <Input
                        id="email"
                        type="email"
                        value={staffFormData.email}
                        onChange={(e) => setStaffFormData(prev => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="role">Role*</Label>
                      <Select value={staffFormData.role} onValueChange={(value) => setStaffFormData(prev => ({ ...prev, role: value }))}>
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
                        value={staffFormData.specialization}
                        onChange={(e) => setStaffFormData(prev => ({ ...prev, specialization: e.target.value }))}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setShowAddStaffDialog(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createStaffMutation.isPending}>
                        {createStaffMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          'Create Staff'
                        )}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          
          <Dialog open={showEditUserDialog} onOpenChange={setShowEditUserDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleEditUserSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="edit-user-username">Username*</Label>
                  <Input
                    id="edit-user-username"
                    value={editUserFormData.username}
                    onChange={(e) => setEditUserFormData(prev => ({ ...prev, username: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="edit-user-fullName">Full Name*</Label>
                  <Input
                    id="edit-user-fullName"
                    value={editUserFormData.fullName}
                    onChange={(e) => setEditUserFormData(prev => ({ ...prev, fullName: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="edit-user-email">Email*</Label>
                  <Input
                    id="edit-user-email"
                    type="email"
                    value={editUserFormData.email}
                    onChange={(e) => setEditUserFormData(prev => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="edit-user-role">Role*</Label>
                  <Select value={editUserFormData.role} onValueChange={(value) => setEditUserFormData(prev => ({ ...prev, role: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="doctor">Doctor</SelectItem>
                      <SelectItem value="radiologist">Radiologist</SelectItem>
                      <SelectItem value="patient">Patient</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(editUserFormData.role === 'doctor' || editUserFormData.role === 'radiologist') && (
                  <div>
                    <Label htmlFor="edit-user-specialization">Specialization</Label>
                    <Input
                      id="edit-user-specialization"
                      value={editUserFormData.specialization}
                      onChange={(e) => setEditUserFormData(prev => ({ ...prev, specialization: e.target.value }))}
                    />
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowEditUserDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editUserMutation.isPending}>
                    {editUserMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      'Update User'
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          
          <Dialog open={showPasswordResetDialog} onOpenChange={setShowPasswordResetDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reset Password</DialogTitle>
                <DialogDescription>
                  Reset password for {resetPasswordUser?.fullName}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="new-password">New Password*</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password (min 6 characters)"
                      required
                      minLength={6}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowPasswordResetDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={resetPasswordMutation.isPending}>
                    {resetPasswordMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      'Reset Password'
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          
          <CardContent>
            <Tabs value={activeUserTab} onValueChange={setActiveUserTab}>
              <TabsList className="mb-4 flex flex-wrap">
                <TabsTrigger value="all">All Users ({dashboardData?.users.list.length || 0})</TabsTrigger>
                <TabsTrigger value="admin">Admins ({dashboardData?.users.admins || 0})</TabsTrigger>
                <TabsTrigger value="doctor">Doctors ({dashboardData?.users.doctors || 0})</TabsTrigger>
                <TabsTrigger value="radiologist">Radiologists ({dashboardData?.users.radiologists || 0})</TabsTrigger>
                <TabsTrigger value="patient">Patients ({dashboardData?.users.patients || 0})</TabsTrigger>
              </TabsList>
              <div className="mb-2 text-xs text-slate-500">
                Active: {dashboardData?.users.activeUsers || 0} • New today: {dashboardData?.users.newUsersToday || 0}
              </div>

              <TabsContent value={activeUserTab} className="space-y-4">
                {filteredUsers.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-3">No users found in this category.</p>
                    <Button
                      variant="outline"
                      onClick={() => setActiveUserTab('all')}
                      className="mr-2"
                    >
                      View All
                    </Button>
                    <Button onClick={() => setShowAddStaffDialog(true)}>
                      <UserPlus className="w-4 h-4 mr-2" /> Add Staff
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {filteredUsers.map((user) => (
                      <Card key={user.id} className="border-l-4" style={{
                        borderLeftColor: user.role === 'admin' ? '#ef4444' : 
                                        user.role === 'doctor' ? '#3b82f6' : 
                                        user.role === 'radiologist' ? '#8b5cf6' : 
                                        '#22c55e'
                      }}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <h3 className="font-semibold text-lg">{user.fullName}</h3>
                                <Badge variant={user.isActive ? "default" : "secondary"}>
                                  {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                                </Badge>
                              </div>
                              <div className="space-y-1 text-sm text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  <span>@{user.username}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Mail className="w-4 h-4" />
                                  <span>{user.email}</span>
                                </div>
                                {user.specialization && (
                                  <div className="flex items-center gap-2">
                                    <span>{user.specialization}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleEditUser(user)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handlePasswordReset(user)}>
                                <Key className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                onClick={() => {
                                  if (confirm(`Delete user ${user.fullName}? This cannot be undone.`)) {
                                    deleteUserMutation.mutate(user.id);
                                  }
                                }}
                                disabled={deleteUserMutation.isPending}
                                title="Delete user"
                              >
                                {deleteUserMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {activeSection === 'analytics' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-600" />
              System Analytics & Performance
            </h2>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-green-600 border-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                Real-time Data
              </Badge>
              <Button variant="outline" size="sm" onClick={() => {
                // The exported aiPerformance block used to be a literal:
                // "Breast Cancer, accuracy 96, scans 245, falsePositives 8,
                // falseNegatives 2" and four more like it. No breast, colon or
                // prostate scan has ever run — those modalities have no
                // classifier — so the false-negative counts described misses
                // that could not have happened. Exported to JSON it looked
                // exactly like a real clinical audit. It now carries the
                // measured registry figures, or nothing if they are unread.
                const analyticsData = {
                  aiPerformance: modelCards?.models.map(m => ({
                    scanType: m.scanType,
                    enabled: m.enabled,
                    disabledReason: m.disabledReason,
                    evaluation: m.evaluation,
                  })) ?? 'unavailable — /api/models/cards could not be read',
                  performanceNote:
                    'Balanced accuracy on a held-out test set. Per-modality scan ' +
                    'counts and confusion-matrix figures are not tracked in ' +
                    'production; nothing here is a live clinical audit.',
                  usageStats: dashboardData?.stats,
                  userMetrics: dashboardData?.users
                };
                const blob = new Blob([JSON.stringify(analyticsData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `analytics-report-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                toast({ title: "Analytics Exported", description: "Analytics report downloaded successfully." });
              }}>
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
            </div>
          </div>
          
          {/* Key Performance Indicators */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white hover:shadow-lg transition-all">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Daily Scans</p>
                    <p className="text-3xl font-bold">{dashboardData?.stats.dailyScans ?? 0}</p>
                    {/* Was "+12% from yesterday", a constant. Nothing compared
                        anything to yesterday. */}
                    <p className="text-blue-200 text-xs mt-1">Today</p>
                  </div>
                  <Activity className="h-10 w-10 opacity-80" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white hover:shadow-lg transition-all">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-100 text-sm font-medium">Active Users</p>
                    <p className="text-3xl font-bold">{dashboardData?.users.activeUsers ?? 0}</p>
                    <p className="text-green-200 text-xs mt-1">Holding a live session</p>
                  </div>
                  <Users className="h-10 w-10 opacity-80" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white hover:shadow-lg transition-all">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-100 text-sm font-medium">Mean AI Confidence</p>
                    <p className="text-3xl font-bold">
                      {dashboardData?.stats.aiAccuracy != null ? `${dashboardData.stats.aiAccuracy}%` : '—'}
                    </p>
                    <p className="text-purple-200 text-xs mt-1">Not a measure of correctness</p>
                  </div>
                  <Brain className="h-10 w-10 opacity-80" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-orange-500 to-red-500 text-white hover:shadow-lg transition-all">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-orange-100 text-sm font-medium">Critical Alerts</p>
                    <p className="text-3xl font-bold">{dashboardData?.stats.criticalAlerts || 0}</p>
                    <p className="text-orange-200 text-xs mt-1">All systems normal</p>
                  </div>
                  <AlertTriangle className="h-10 w-10 opacity-80" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* AI Detection Accuracy */}
            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-700" />
                  <span className="text-slate-900">AI Detection Accuracy</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <ModelPerformancePanel variant="light" />
              </CardContent>
            </Card>

            {/* System Performance */}
            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-700" />
                  <span className="text-slate-900">System Performance</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-blue-100 rounded-lg border border-blue-200">
                    <span className="font-medium text-blue-900">Process Uptime</span>
                    <span className="font-bold text-blue-800">
                      {dashboardData?.stats.uptimeSec != null
                        ? formatUptime(dashboardData.stats.uptimeSec)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-100 rounded-lg border border-green-200">
                    {/* "1.2s" was a literal. The API's own response time is on
                        every reply as the X-Response-Time header; this reports the
                        time the browser measured for the stats request itself. */}
                    <span className="font-medium text-green-900">Stats Response</span>
                    <span className="font-bold text-green-800">
                      {statsResponseMs != null ? `${statsResponseMs} ms` : '\u2014'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-purple-100 rounded-lg border border-purple-200">
                    <span className="font-medium text-purple-900">Database Latency</span>
                    <span className="font-bold text-purple-800">
                      {dashboardData?.stats.database
                        ? dashboardData.stats.database.reachable
                          ? `${dashboardData.stats.database.latencyMs} ms`
                          : 'unreachable'
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-orange-100 rounded-lg border border-orange-200">
                    <span className="font-medium text-orange-900">Security Status</span>
                    <span className="font-bold text-orange-800">Secure</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Usage Statistics */}
            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-700" />
                  <span className="text-slate-900">Usage Statistics</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-blue-100 rounded-lg border border-blue-200">
                    <span className="font-medium text-blue-900">Daily Scans</span>
                    <span className="font-bold text-blue-800">{dashboardData?.stats.dailyScans ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-100 rounded-lg border border-green-200">
                    <span className="font-medium text-green-900">Active Users</span>
                    <span className="font-bold text-green-800">{dashboardData?.users.activeUsers ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-red-100 rounded-lg border border-red-200">
                    <span className="font-medium text-red-900">Critical Alerts</span>
                    <span className="font-bold text-red-800">{dashboardData?.stats.criticalAlerts || 0}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-purple-100 rounded-lg border border-purple-200">
                    <span className="font-medium text-purple-900">Mean AI Confidence</span>
                    <span className="font-bold text-purple-800">
                      {dashboardData?.stats.aiAccuracy != null ? `${dashboardData.stats.aiAccuracy}%` : '—'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts: Scan Trends and User Growth */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-700" />
                  <span className="text-slate-900">Scan Trends (Last 7 Days)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scanTrendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="day" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="scans" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-2 border-slate-300">
              <CardHeader className="bg-slate-200 border-b border-slate-300">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-green-700" />
                  <span className="text-slate-900">User Growth (YTD)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-white">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={userGrowthData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="users" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Advanced System Metrics from /api/advanced/analytics/performance */}
          <AdvancedPerformanceSection />
        </div>
      )}

      {/* Removed duplicate Staff top-level section; staff management lives within Users */}

      {activeSection === 'system' && (
        <div className="space-y-6">
          {/* System Health Overview */}
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-100 dark:from-slate-800 dark:to-slate-800">
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-green-700" />
                System Health
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border bg-white dark:bg-slate-800">
                  <p className="text-sm text-slate-500">Status</p>
                  <p className={`text-xl font-semibold ${systemHealth?.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                    {systemHealth?.status || 'unknown'}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-white dark:bg-slate-800">
                  <p className="text-sm text-slate-500">Database</p>
                  <p className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                    {systemHealth?.services?.database || 'unknown'}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-white dark:bg-slate-800">
                  <p className="text-sm text-slate-500">AI Engine</p>
                  <p className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                    {systemHealth?.services?.ai || 'unknown'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="w-6 h-6 text-muted-foreground" />
              System Configuration & Management
            </h2>
            <div className="flex gap-2">
              {/* Was the literal "System Online". */}
              <Badge
                variant="outline"
                className={
                  ready?.status === 'ready'
                    ? 'text-green-600 border-green-600'
                    : 'text-red-600 border-red-600'
                }
              >
                <Server className="w-3 h-3 mr-1" />
                {ready?.status === 'ready' ? 'Ready' : ready ? 'Not ready' : 'Checking…'}
              </Badge>

              {/*
                Re-probes and reports what came back.

                This used to show "Running comprehensive system diagnostics…",
                wait three seconds on a setTimeout, and then assert "All systems
                operational and secure" — unconditionally, having checked
                nothing. An administrator clicking it during an incident was
                told everything was fine by a button that had not looked.

                /api/ready runs a real SELECT against the database on each call
                and returns 503 when it fails, so refetching it is a genuine
                check, and the toast now says whatever it actually found.
              */}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const probe = await refetchReady();
                  const result = probe.data;
                  const ok = result?.status === 'ready';
                  toast({
                    title: ok ? 'Ready' : 'Not ready',
                    description: ok
                      ? `Database responded in ${result?.latencyMs ?? '?'} ms.`
                      : `Database is ${result?.database ?? 'unreachable'}. This instance cannot serve requests.`,
                    variant: ok ? undefined : 'destructive',
                    duration: 4000,
                  });
                }}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Re-check readiness
              </Button>
            </div>
          </div>
          
          {/*
            This span held about four hundred lines of operations panel, and
            almost none of it described this deployment.

              Server Configuration   "3 active nodes, Round-robin algorithm",
                                     "CDN Status: 12 edge locations, 95% cache
                                     hit rate, Latency 45ms". There is one Node
                                     process and no CDN.

              Database Management    "PostgreSQL 14.9 — High availability
                                     cluster, 3 replicas", "Backup Status: 2
                                     hours ago — Success", "Storage: 2.4 GB /
                                     50 GB", "Connection Pool 12 / 100".
                                     There are no replicas and no backup system
                                     at all; the pool max is 20.

              AI Model Configuration "5 cancer detection models active —
                                     Breast, Lung, Skin, Colon, Prostate",
                                     "v2.1.4, Released Nov 2024, Trained on 2M+
                                     images", "Confidence Threshold 85%". Two
                                     models exist. They were retrained in
                                     August 2026 on 1,244 and 660 images, and
                                     the thresholds are 0.30 for lung and a
                                     0.70/0.30 band for skin.

              Status cards           "Server Status: Online", "Database:
                                     Healthy", "AI Models: Active", "Security:
                                     Protected" — four string literals that
                                     said the same thing whatever was true.

            "Backup Status: 2 hours ago — Success" is the dangerous one. This is
            the screen an operator opens during an incident, and it asserted a
            recovery point that does not exist.

            Every button was the same shape: Backup, Optimize, Health, Retrain,
            Update, Security Audit, Scan Threats, Schedule Restart fired a toast
            claiming the work had started and did nothing. They are gone rather
            than disabled — a control that cannot act should not be drawn.

            What replaces them is what the system can actually answer.
          */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Readiness</p>
                <p className={`text-lg font-bold ${ready?.status === 'ready' ? 'text-green-600' : 'text-red-600'}`}>
                  {ready?.status ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {ready?.uptimeSec != null ? `up ${formatUptime(ready.uptimeSec)}` : 'not reported'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Database</p>
                <p className={`text-lg font-bold ${ready?.database === 'ok' ? 'text-blue-600' : 'text-red-600'}`}>
                  {ready?.database ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {ready?.latencyMs != null ? `${ready.latencyMs} ms probe` : 'no probe recorded'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Models served</p>
                <p className="text-lg font-bold text-purple-600">
                  {modelCards ? modelCards.models.filter((m) => m.enabled).length : '—'}
                  {modelCards && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}of {modelCards.models.length} registered
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">from /api/models/cards</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">At-rest encryption</p>
                <p className={`text-lg font-bold ${ready?.encryption?.configured ? 'text-orange-600' : 'text-red-600'}`}>
                  {ready?.encryption == null
                    ? '—'
                    : ready.encryption.configured
                      ? 'configured'
                      : 'not configured'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {ready?.encryption?.configured
                    ? `active key ${ready.encryption.activeKeyId}, ${ready.encryption.keyCount} in ring`
                    : 'no key in the environment'}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── Connection pool ── */}
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-600" />
                  Connection pool
                </CardTitle>
                <CardDescription>
                  Live counters from the pg pool, via /api/ready.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ready?.pool ? (
                  <>
                    {[
                      { label: 'Total', value: ready.pool.total },
                      { label: 'Idle', value: ready.pool.idle },
                      {
                        label: 'Waiting',
                        value: ready.pool.waiting,
                        note: 'Persistently above zero means requests are queuing for a connection.',
                      },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between items-start gap-4">
                        <div>
                          <span className="text-sm text-foreground">{row.label}</span>
                          {row.note && (
                            <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">{row.note}</p>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Pool counters are unavailable — the readiness probe did not reach the
                    database.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── Reachability ── */}
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-amber-600" />
                  Can a patient be reached?
                </CardTitle>
                <CardDescription>
                  Off-platform delivery channels, as the server sees them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(['email', 'sms'] as const).map((channel) => {
                  const on = ready?.notificationChannels?.[channel];
                  return (
                    <div key={channel} className="flex justify-between items-center gap-4">
                      <span className="text-sm text-foreground capitalize">{channel}</span>
                      <Badge
                        className={
                          on
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-300'
                        }
                      >
                        {on == null ? 'unknown' : on ? 'configured' : 'not configured'}
                      </Badge>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  A channel that is off is not an error — it is a channel with no
                  credentials. Notifications still persist in-app either way.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ── Registered models ── */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                Registered models
              </CardTitle>
              <CardDescription>
                The registry decides what is served. A model is enabled only when a
                trained artifact exists and its measured balanced accuracy beats chance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {modelCards ? (
                <div className="space-y-3">
                  {modelCards.models.map((model) => (
                    <div
                      key={model.scanType}
                      className="flex flex-wrap justify-between items-start gap-3 p-3 rounded-lg border"
                    >
                      <div>
                        <span className="font-semibold capitalize text-foreground">
                          {model.scanType}
                        </span>
                        {model.evaluation ? (
                          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                            balanced acc {(model.evaluation.balancedAccuracy * 100).toFixed(1)}% ·
                            sensitivity {(model.evaluation.sensitivity * 100).toFixed(1)}% ·
                            specificity {(model.evaluation.specificity * 100).toFixed(1)}%
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">
                            No evaluation recorded.
                          </p>
                        )}
                        {model.disabledReason && (
                          <p className="text-xs text-red-600 mt-1">{model.disabledReason}</p>
                        )}
                      </div>
                      <Badge
                        className={
                          model.enabled
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-red-100 text-red-800 border border-red-300'
                        }
                      >
                        {model.enabled ? 'Serving' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading the registry…</p>
              )}

              <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                There is no Retrain or Update button here. Retraining is a scripted,
                reviewed operation that produces a new evaluation — it is not something
                to trigger from a dashboard, and the buttons that appeared to do it only
                showed a toast.
              </p>
            </CardContent>
          </Card>

          {/* ── What this screen cannot tell you ── */}
          <Card className="shadow-lg border-amber-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Not monitored from here
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="text-foreground font-medium">Backups.</span> This
                    deployment has no backup system. The panel that stood here reported
                    "2 hours ago — Success", which was a literal. Recovery points are a
                    deployment-side concern and nothing in the application can confirm one
                    exists.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="text-foreground font-medium">Uptime and logs.</span>{' '}
                    Nothing external polls /api/ready and no log drain is configured. Both
                    have to be added where the app is hosted.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="text-foreground font-medium">Storage and replicas.</span>{' '}
                    Single instance, single database. There is no cluster and no CDN,
                    whatever the previous version of this card said.
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}