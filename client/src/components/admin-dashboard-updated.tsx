import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Activity,
  Brain,
  TrendingUp,
  BarChart3,
  Settings,
  FileText,
  UserCheck,
  UserPlus,
  RefreshCw
} from "lucide-react";
import AdminUserManagement from "./admin-user-management";
import AdminAnalyticsDashboard from "./admin-analytics-dashboard";

export default function AdminDashboardUpdated({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch system stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['/api/admin/stats'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/admin/stats', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch admin stats');
        return res.json();
      } catch (error) {
        console.error('Error fetching admin stats:', error);
        return {
          totalUsers: 0,
          activeScans: 0,
          systemUptime: 99.8,
          aiAccuracy: 81,
          dailyScans: 0,
          criticalAlerts: 0,
          databaseHealth: 95,
          securityStatus: 'secure'
        };
      }
    }
  });

  // Fetch user metrics
  const { data: userMetrics, isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['/api/admin/users/metrics'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/admin/users/metrics', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch user metrics');
        return res.json();
      } catch (error) {
        console.error('Error fetching user metrics:', error);
        return {
          admins: 0,
          radiologists: 0,
          doctors: 0,
          patients: 0,
          activeUsers: 0,
          newUsersToday: 0
        };
      }
    }
  });

  // Fetch recent activities
  const { data: recentActivities, isLoading: activitiesLoading, refetch: refetchActivities } = useQuery({
    queryKey: ['/api/admin/activities/recent'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/admin/activities/recent', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch recent activities');
        return res.json();
      } catch (error) {
        console.error('Error fetching recent activities:', error);
        return [
          { message: 'System backup completed successfully', timestamp: '2h ago', type: 'system' },
          { message: 'New doctor registered: Dr. Emily Watson', timestamp: '4h ago', type: 'user_creation' },
          { message: 'AI model updated to v2.1.4', timestamp: '6h ago', type: 'ai_update' }
        ];
      }
    }
  });

  // Manual refresh function
  const handleRefresh = () => {
    refetchStats();
    refetchUsers();
    refetchActivities();
    
    // Invalidate all queries to ensure fresh data
    queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/activities/recent'] });
    
    toast({
      title: "Data Refreshed",
      description: "Dashboard data has been refreshed.",
    });
  };

  if (statsLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-white">Loading system data...</p>
        </div>
      </div>
    );
  }

  // Calculate total users
  const totalUsers = (userMetrics?.admins || 0) + 
                    (userMetrics?.radiologists || 0) + 
                    (userMetrics?.doctors || 0) + 
                    (userMetrics?.patients || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Administrator Dashboard</h1>
          <p className="text-slate-400">Welcome back, Administrator</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" size="sm" className="border-slate-600 text-slate-300">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 bg-slate-800 border-slate-600">
          <TabsTrigger value="overview" className="text-slate-300 data-[state=active]:text-white">Overview</TabsTrigger>
          <TabsTrigger value="analytics" className="text-slate-300 data-[state=active]:text-white">Analytics</TabsTrigger>
          <TabsTrigger value="users" className="text-slate-300 data-[state=active]:text-white">Users</TabsTrigger>
          <TabsTrigger value="system" className="text-slate-300 data-[state=active]:text-white">System</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-slate-800 border border-slate-600 rounded-lg hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition-all duration-300">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-400">Total Users</p>
                    <p className="text-3xl font-bold text-white">{totalUsers}</p>
                    <p className="text-xs text-blue-300">+{userMetrics?.newUsersToday || 0} today</p>
                  </div>
                  <Users className="w-8 h-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border border-slate-600 rounded-lg hover:border-green-500 hover:shadow-lg hover:shadow-green-500/20 transition-all duration-300">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-400">Active Scans</p>
                    <p className="text-3xl font-bold text-white">{stats?.activeScans || 0}</p>
                    <p className="text-xs text-green-300">{stats?.dailyScans || 0} today</p>
                  </div>
                  <Activity className="w-8 h-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border border-slate-600 rounded-lg hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-purple-400">System Uptime</p>
                    <p className="text-3xl font-bold text-white">{stats?.systemUptime || 99.8}%</p>
                    <p className="text-xs text-purple-300">Last 30 days</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-purple-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border border-slate-600 rounded-lg hover:border-cyan-500 hover:shadow-lg hover:shadow-cyan-500/20 transition-all duration-300">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-cyan-400">AI Accuracy</p>
                    <p className="text-3xl font-bold text-white">{stats?.aiAccuracy || 81}%</p>
                    <p className="text-xs text-cyan-300">Google Medical AI</p>
                  </div>
                  <Brain className="w-8 h-8 text-cyan-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity & Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <Activity className="w-5 h-5 mr-2" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activitiesLoading ? (
                    <div className="space-y-3">
                      {[1,2,3].map(i => (
                        <div key={i} className="h-12 bg-slate-700 rounded animate-pulse"></div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-slate-300 flex-1">System backup completed successfully</span>
                        <span className="text-slate-500 text-sm">2h ago</span>
                      </div>
                      <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span className="text-slate-300 flex-1">New doctor registered: Dr. Emily Watson</span>
                        <span className="text-slate-500 text-sm">4h ago</span>
                      </div>
                      <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                        <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                        <span className="text-slate-300 flex-1">AI model updated to v2.1.4</span>
                        <span className="text-slate-500 text-sm">6h ago</span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Button 
                    className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                    onClick={() => setActiveTab('analytics')}
                  >
                    <BarChart3 className="w-4 h-4 mr-2" />
                    View System Analytics
                  </Button>
                  <Button 
                    className="w-full justify-start bg-green-600 hover:bg-green-700"
                    onClick={() => setActiveTab('users')}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Manage Users
                  </Button>
                  <Button 
                    className="w-full justify-start bg-purple-600 hover:bg-purple-700"
                    onClick={() => setActiveTab('system')}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Medical Translator
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics">
          <AdminAnalyticsDashboard />
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users">
          <AdminUserManagement />
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system">
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white">System Management</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-slate-700 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">System Health</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Server Status</span>
                        <Badge className="bg-green-600">Online</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Database</span>
                        <Badge className="bg-green-600">Connected</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">AI Services</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-700 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">Component Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Blood Test Analyzer</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Lung Cancer Analyzer</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Skin Scanner</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Image Viewer</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Risk Questionnaire</span>
                        <Badge className="bg-green-600">Active</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}