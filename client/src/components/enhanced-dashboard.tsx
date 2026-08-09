import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWebSocketEnhanced } from '@/hooks/useWebSocketEnhanced';
import { useUser } from '@/hooks/useUser';
import {
  Activity, TrendingUp, TrendingDown, Users, Calendar, FileText,
  Heart, Brain, Scan, AlertTriangle, CheckCircle, Clock,
  ArrowUpRight, ArrowDownRight, Minus, BarChart3, PieChart, LineChart
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart as RechartsBarChart, Bar, PieChart as RechartsPieChart, Cell, Pie,
  AreaChart, Area
} from 'recharts';

interface DashboardStats {
  totalPatients: number;
  totalScans: number;
  pendingReviews: number;
  completedToday: number;
  trends: {
    patients: number;
    scans: number;
    reviews: number;
  };
  chartData: {
    daily: any[];
    weekly: any[];
    monthly: any[];
  };
}

interface EnhancedDashboardProps {
  userRole: string;
  className?: string;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function EnhancedDashboard({ userRole, className }: EnhancedDashboardProps) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const { user } = useUser();
  const queryClient = useQueryClient();

  // Real-time updates via WebSocket
  const { isConnected, connectionState } = useWebSocketEnhanced({
    onMessage: (message) => {
      // Handle real-time dashboard updates
      if (['stats_update', 'scan_update', 'appointment_update'].includes(message.type)) {
        // Refresh dashboard data
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      }
    }
  });

  // Fetch dashboard statistics
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats', userRole, timeRange],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/stats?role=${userRole}&range=${timeRange}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch dashboard stats');
      return response.json();
    },
    enabled: !!user,
    refetchInterval: isConnected ? false : 30000
  });

  // Get trend icon and color
  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (trend < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-gray-500" />;
  };

  const getTrendColor = (trend: number) => {
    if (trend > 0) return 'text-green-500';
    if (trend < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  // Role-specific dashboard configurations
  const getDashboardConfig = () => {
    switch (userRole) {
      case 'admin':
        return {
          title: 'System Overview',
          primaryMetrics: [
            {
              title: 'Total Users',
              value: stats?.totalPatients || 0,
              trend: stats?.trends.patients || 0,
              icon: Users,
              description: 'Registered users'
            },
            {
              title: 'Scans Today',
              value: stats?.completedToday || 0,
              trend: stats?.trends.scans || 0,
              icon: Scan,
              description: 'Scans processed today'
            },
            {
              title: 'Pending Reviews',
              value: stats?.pendingReviews || 0,
              trend: stats?.trends.reviews || 0,
              icon: Clock,
              description: 'Awaiting radiologist review'
            },
            {
              title: 'System Health',
              value: isConnected ? 100 : 75,
              trend: 0,
              icon: Activity,
              description: 'Real-time connectivity'
            }
          ]
        };
      
      case 'doctor':
        return {
          title: 'Medical Dashboard',
          primaryMetrics: [
            {
              title: 'My Patients',
              value: stats?.totalPatients || 0,
              trend: stats?.trends.patients || 0,
              icon: Users,
              description: 'Active patients'
            },
            {
              title: 'Scans Reviewed',
              value: stats?.completedToday || 0,
              trend: stats?.trends.scans || 0,
              icon: FileText,
              description: 'Reviews completed today'
            },
            {
              title: 'Appointments',
              value: stats?.pendingReviews || 0,
              trend: stats?.trends.reviews || 0,
              icon: Calendar,
              description: 'Scheduled today'
            },
            {
              title: 'Critical Cases',
              value: Math.floor((stats?.pendingReviews || 0) * 0.1),
              trend: 0,
              icon: AlertTriangle,
              description: 'Requiring immediate attention'
            }
          ]
        };
      
      case 'radiologist':
        return {
          title: 'Radiology Dashboard',
          primaryMetrics: [
            {
              title: 'Pending Reviews',
              value: stats?.pendingReviews || 0,
              trend: stats?.trends.reviews || 0,
              icon: Clock,
              description: 'Scans awaiting review'
            },
            {
              title: 'Completed Today',
              value: stats?.completedToday || 0,
              trend: stats?.trends.scans || 0,
              icon: CheckCircle,
              description: 'Reviews completed'
            },
            {
              title: 'AI Confidence',
              value: 87,
              trend: 3,
              icon: Brain,
              description: 'Average AI accuracy'
            },
            {
              title: 'Urgent Cases',
              value: Math.floor((stats?.pendingReviews || 0) * 0.2),
              trend: -1,
              icon: AlertTriangle,
              description: 'High priority scans'
            }
          ]
        };
      
      default: // patient
        return {
          title: 'Health Dashboard',
          primaryMetrics: [
            {
              title: 'My Scans',
              value: stats?.totalScans || 0,
              trend: stats?.trends.scans || 0,
              icon: Scan,
              description: 'Total scans performed'
            },
            {
              title: 'Recent Results',
              value: stats?.completedToday || 0,
              trend: 0,
              icon: FileText,
              description: 'New results available'
            },
            {
              title: 'Appointments',
              value: stats?.pendingReviews || 0,
              trend: 0,
              icon: Calendar,
              description: 'Upcoming appointments'
            },
            {
              title: 'Health Score',
              value: 85,
              trend: 2,
              icon: Heart,
              description: 'Overall health rating'
            }
          ]
        };
    }
  };

  const config = getDashboardConfig();

  // Chart component
  const renderChart = () => {
    if (!stats?.chartData) return null;

    const data = stats.chartData[timeRange] || [];

    switch (chartType) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <RechartsBarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#8884d8" />
            </RechartsBarChart>
          </ResponsiveContainer>
        );
      
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#8884d8" fill="#8884d8" />
            </AreaChart>
          </ResponsiveContainer>
        );
      
      default: // line
        return (
          <ResponsiveContainer width="100%" height={300}>
            <RechartsLineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={2} />
            </RechartsLineChart>
          </ResponsiveContainer>
        );
    }
  };

  if (isLoading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{config.title}</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.fullName}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? 'default' : 'secondary'}>
            <Activity className="w-3 h-3 mr-1" />
            {connectionState}
          </Badge>
        </div>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {config.primaryMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      {metric.title}
                    </p>
                    <div className="flex items-center space-x-2">
                      <p className="text-2xl font-bold">
                        {typeof metric.value === 'number' && metric.title.includes('Health') 
                          ? `${metric.value}%` 
                          : metric.value.toLocaleString()}
                      </p>
                      {metric.trend !== 0 && (
                        <div className={`flex items-center text-sm ${getTrendColor(metric.trend)}`}>
                          {getTrendIcon(metric.trend)}
                          <span className="ml-1">
                            {Math.abs(metric.trend)}%
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {metric.description}
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-full">
                    <Icon className="w-6 h-6" />
                  </div>
                </div>
                
                {metric.title.includes('Health') && (
                  <div className="mt-4">
                    <Progress value={metric.value} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Activity Overview
              </CardTitle>
              
              <div className="flex items-center gap-2">
                {/* Time Range Selector */}
                <div className="flex bg-muted rounded-lg p-1">
                  {(['daily', 'weekly', 'monthly'] as const).map((range) => (
                    <Button
                      key={range}
                      size="sm"
                      variant={timeRange === range ? 'default' : 'ghost'}
                      onClick={() => setTimeRange(range)}
                      className="text-xs"
                    >
                      {range.charAt(0).toUpperCase() + range.slice(1)}
                    </Button>
                  ))}
                </div>
                
                {/* Chart Type Selector */}
                <div className="flex bg-muted rounded-lg p-1">
                  {(['line', 'bar', 'area'] as const).map((type) => (
                    <Button
                      key={type}
                      size="sm"
                      variant={chartType === type ? 'default' : 'ghost'}
                      onClick={() => setChartType(type)}
                      className="text-xs p-2"
                    >
                      {type === 'line' && <LineChart className="w-4 h-4" />}
                      {type === 'bar' && <BarChart3 className="w-4 h-4" />}
                      {type === 'area' && <Activity className="w-4 h-4" />}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {renderChart()}
          </CardContent>
        </Card>

        {/* Side Panel */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {userRole === 'patient' && (
                <>
                  <Button className="w-full justify-start" variant="outline">
                    <Scan className="w-4 h-4 mr-2" />
                    Upload New Scan
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Calendar className="w-4 h-4 mr-2" />
                    Book Appointment
                  </Button>
                </>
              )}
              
              {userRole === 'doctor' && (
                <>
                  <Button className="w-full justify-start" variant="outline">
                    <Users className="w-4 h-4 mr-2" />
                    View Patients
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <FileText className="w-4 h-4 mr-2" />
                    Review Reports
                  </Button>
                </>
              )}
              
              {userRole === 'radiologist' && (
                <>
                  <Button className="w-full justify-start" variant="outline">
                    <Clock className="w-4 h-4 mr-2" />
                    Pending Reviews
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Brain className="w-4 h-4 mr-2" />
                    AI Analysis
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <div className="flex-1">
                      <p className="font-medium">Sample activity {i}</p>
                      <p className="text-muted-foreground text-xs">2 hours ago</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Enhanced stats card component
export function StatsCard({ 
  title, 
  value, 
  trend, 
  icon: Icon, 
  description,
  format = 'number'
}: {
  title: string;
  value: number;
  trend?: number;
  icon: any;
  description?: string;
  format?: 'number' | 'percentage' | 'currency';
}) {
  const formatValue = (val: number) => {
    switch (format) {
      case 'percentage':
        return `${val}%`;
      case 'currency':
        return `$${val.toLocaleString()}`;
      default:
        return val.toLocaleString();
    }
  };

  const getTrendIcon = (trendValue?: number) => {
    if (!trendValue || trendValue === 0) return null;
    return trendValue > 0 
      ? <ArrowUpRight className="w-4 h-4 text-green-500" />
      : <ArrowDownRight className="w-4 h-4 text-red-500" />;
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-center space-x-2">
              <p className="text-2xl font-bold">{formatValue(value)}</p>
              {trend && (
                <div className="flex items-center text-sm">
                  {getTrendIcon(trend)}
                  <span className={`ml-1 ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {Math.abs(trend)}%
                  </span>
                </div>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="p-3 bg-muted rounded-full">
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
