import { useState, lazy, Suspense } from "react";
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Shield, 
  Brain, 
  Stethoscope, 
  User, 
  BarChart3, 
  FileText, 
  Upload, 
  Search,
  LogOut,
  Settings,
  Bell,
  Heart,
  Activity,
  TrendingUp,
  Users,
  Calendar,
  Clock,
  MessageSquare,
  Eye
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import AIScanSimulator from "./ai-scan-simulator-fixed";
import ModelPerformancePanel from "./model-performance-panel";
const GoogleAIScanner = lazy(() => import("./google-ai-scanner"));
const PatientPortalFinal = lazy(() => import("./patient-portal-final"));
import AppointmentScheduler from "./appointment-scheduler";
import SimpleAppointmentBooking from "./simple-appointment-booking";

const PatientManagement = lazy(() => import("./patient-management"));
/**
 * Role dashboards are loaded when the tab that needs them is opened.
 *
 * This file eagerly imported all of them, so a patient's browser downloaded the
 * admin dashboard (96 kB of source), the radiologist review queue and the
 * doctor portal in order to render a patient portal it would never leave.
 */
const AdminDashboard = lazy(() => import("./admin-dashboard"));

const RadiologistDashboard = lazy(() => import("./radiologist-dashboard"));
const DoctorPortal = lazy(() => import("./doctor-portal"));
import DoctorReports from "./doctor-reports";
import DoctorPatients from "./doctor-patients";
import { DoctorAppointmentSection } from "./doctor-appointment-section";
const CancerDetection = lazy(() => import("@/pages/cancer-detection"));
const EnhancedChatbot = lazy(() => import("./enhanced-chatbot"));
const BloodTestAnalyzer = lazy(() => import("./blood-test-analyzer"));
import CancerRiskQuestionnaire from "./cancer-risk-questionnaire";
const LungCancerAnalyzer = lazy(() => import("./lung-cancer-analyzer"));
const MedicalImageViewer = lazy(() => import("./medical-image-viewer"));
const RealTimeSkinScanner = lazy(() => import("./real-time-skin-scanner"));
import ChatNotifications from "./chat-notifications";

interface DashboardLayoutProps {
  user: any;
  onLogout: () => void;
}

/** Seconds of process uptime, rendered for a human. */
function formatProcessUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export default function DashboardLayout({ user, onLogout }: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState("overview");

  const roleConfig = {
    admin: {
      icon: Shield,
      title: "Administrator Dashboard",
      color: "bg-red-600",
      tabs: ["overview", "analytics", "users", "system"]
    },
    radiologist: {
      icon: Brain,
      title: "Radiologist Interface",
      color: "bg-purple-600",
      tabs: ["overview", "scans", "appointments", "google-ai"]
    },
    doctor: {
      icon: Stethoscope,
      title: "Doctor Portal",
      color: "bg-blue-600",
      tabs: ["overview", "patients", "reports", "appointments", "schedule", "google-ai", "debug"]
    },
    patient: {
      icon: User,
      title: "Patient Portal",
      color: "bg-green-600",
      tabs: ["overview", "scan", "results", "appointments", "blood-tests", "questionnaire", "skin-scanner"]
    }
  };

  const config = roleConfig[user.role as keyof typeof roleConfig] || roleConfig.patient;
  const IconComponent = config.icon;

  // Fetch real-time stats based on user role
  const { data: statsData, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: [`/api/${user.role}/stats`],
    queryFn: async () => {
      const response = await fetch(`/api/${user.role}/stats`, {
        credentials: 'include'
      });
      if (!response.ok) {
        // Fail rather than substitute. This previously returned a block of
        // invented numbers whenever the API errored — including
        // `criticalCases: 1` and `pendingReports: 3`. A clinician cannot tell a
        // fabricated caseload from a real one, and "1 critical case" shown
        // during an outage is worse than no number at all.
        throw new Error(`Stats unavailable (${response.status})`);
      }
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false
  });

  const { data: recentActivities, isLoading: activitiesLoading } = useQuery({
    queryKey: [`/api/${user.role}/activities/recent`],
    queryFn: async () => {
      const response = await fetch(`/api/${user.role}/activities/recent`, {
        credentials: 'include'
      });
      if (!response.ok) {
        // Return mock activities if API fails
        return [
          { message: 'System backup completed successfully', timestamp: '2 hours ago', type: 'system' },
          { message: 'New scan results available', timestamp: '4 hours ago', type: 'scan' }
        ];
      }
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false
  });

  const renderOverview = () => {
    const statsConfig = {
      admin: [
        { label: "Total Users", key: "totalUsers", icon: Users, color: "text-blue-400" },
        { label: "Active Scans", key: "activeScans", icon: Activity, color: "text-green-400" },
        { label: "System Uptime", key: "systemUptime", icon: TrendingUp, color: "text-purple-400" },
        // Not accuracy. The server computes this as the mean of scan
        // aiConfidence, which says how sure the model was, not how often it was
        // right — a model can be confidently wrong. Measured accuracy lives in
        // the model performance panel, sourced from /api/models/cards.
        { label: "Mean AI Confidence", key: "aiAccuracy", icon: Brain, color: "text-cyan-400" }
      ],
      radiologist: [
        { label: "Pending Reviews", key: "pendingReviews", icon: FileText, color: "text-orange-400" },
        { label: "Completed Today", key: "completedToday", icon: Calendar, color: "text-green-400" },
        { label: "AI Confidence", key: "aiConfidence", icon: Brain, color: "text-purple-400" },
        { label: "Avg Review Time", key: "avgReviewTime", icon: Clock, color: "text-blue-400" }
      ],
      doctor: [
        { label: "Active Patients", key: "activePatients", icon: Users, color: "text-blue-400" },
        { label: "Today's Appointments", key: "todaysAppointments", icon: Calendar, color: "text-green-400" },
        { label: "Pending Reports", key: "pendingReports", icon: FileText, color: "text-orange-400" },
        { label: "Critical Cases", key: "criticalCases", icon: Heart, color: "text-red-400" }
      ],
      patient: [
        { label: "Completed Scans", key: "completedScans", icon: Activity, color: "text-green-400" },
        { label: "Pending Results", key: "pendingResults", icon: Clock, color: "text-orange-400" },
        { label: "Health Insights", key: "healthInsights", icon: Brain, color: "text-blue-400" },
        { label: "Health Score", key: "healthScore", icon: Heart, color: "text-green-400" }
      ]
    };

    if (statsLoading) {
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1,2,3,4].map((index) => (
              <Card key={index} className="bg-slate-800 border-slate-600">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-slate-600 rounded animate-pulse w-3/4"></div>
                      <div className="h-8 bg-slate-600 rounded animate-pulse w-1/2"></div>
                    </div>
                    <div className="w-12 h-12 bg-slate-700 rounded-lg animate-pulse"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <div className="h-6 bg-slate-600 rounded animate-pulse w-1/4"></div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1,2,3].map(i => (
                  <div key={i} className="h-12 bg-slate-700 rounded animate-pulse"></div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statsConfig[user.role as keyof typeof statsConfig].map((stat, index) => {
            const StatIcon = stat.icon;
            // An unknown value renders as "—", never as 0. Zero is a claim
            // ("no critical cases"); the dash says the number could not be read.
            const raw = statsData ? statsData[stat.key] : undefined;
            let value: string | number = raw ?? '—';

            // Format values appropriately
            if (raw === undefined || raw === null) {
              value = '—';
            } else if (stat.key === 'systemUptime' && typeof raw === 'number') {
              value = `${raw}%`;
            } else if (stat.key === 'avgReviewTime' && typeof raw === 'number') {
              value = `${raw}m`;
            } else if (stat.key === 'aiAccuracy' || stat.key === 'aiConfidence') {
              value = `${raw}%`;
            } else if (stat.key === 'healthInsights') {
              value = raw || 'Available';
            }
            
            return (
              <Card 
                key={index} 
                className="bg-slate-800 border-slate-600 hover:border-slate-500 transition-colors cursor-pointer"
                onClick={() => {
                  // Navigate to relevant tab based on stat
                  if (stat.key === 'activePatients' || stat.key === 'todaysAppointments') {
                    setActiveTab('patients');
                  } else if (stat.key === 'pendingReviews' || stat.key === 'completedToday') {
                    setActiveTab('scans');
                  } else if (stat.key === 'completedScans' || stat.key === 'pendingResults') {
                    setActiveTab('results');
                  }
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-sm font-medium">{stat.label}</p>
                      <p className={`text-2xl font-bold ${stat.color}`}>{value}</p>
                      {stat.key === 'criticalCases' && typeof raw === 'number' && raw > 0 && (
                        <p className="text-red-400 text-xs mt-1">Requires attention</p>
                      )}
                    </div>
                    <div className={`w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center hover:bg-slate-600 transition-colors`}>
                      <StatIcon className={`w-6 h-6 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Recent Activity */}
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
                        {Array.isArray(recentActivities) && recentActivities.length > 0 ? (
                          recentActivities.map((item: any, idx: number) => {
                            const message = item.message || item.description || 'Activity';
                            const timeLabel = item.timestamp || item.date || '';
                            const status = (item.status || item.type || '').toString().toLowerCase();
                            const colorClass = status.includes('critical') ? 'bg-red-400' :
                                               status.includes('abnormal') ? 'bg-orange-400' :
                                               status.includes('normal') ? 'bg-green-400' :
                                               'bg-blue-400';
                            return (
                              <div key={idx} className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                                <div className={`w-2 h-2 ${colorClass} rounded-full`}></div>
                                <span className="text-slate-300 flex-1">{message}</span>
                                <span className="text-slate-500 text-sm">{typeof timeLabel === 'string' ? timeLabel : new Date(timeLabel).toLocaleString()}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-slate-400 text-sm">No recent activity</div>
                        )}
                      </>
                    )}
                  </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="bg-slate-800 border-slate-600">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <MessageSquare className="w-5 h-5 mr-2" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {user.role === 'admin' && (
                  <>
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
                  </>
                )}
                {user.role === 'radiologist' && (
                  <>
                    <Button 
                      className="w-full justify-start bg-purple-600 hover:bg-purple-700"
                      onClick={() => setActiveTab('scans')}
                    >
                      <Brain className="w-4 h-4 mr-2" />
                      Review Pending Scans
                    </Button>
                    <Button 
                      className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                      onClick={() => setActiveTab('google-ai')}
                    >
                      <Activity className="w-4 h-4 mr-2" />
                      AI Analysis Tools
                    </Button>
                  </>
                )}
                {user.role === 'doctor' && (
                  <>
                    <Button 
                      className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                      onClick={() => setActiveTab('patients')}
                    >
                      <Users className="w-4 h-4 mr-2" />
                      View Patients
                    </Button>
                    <Button 
                      className="w-full justify-start bg-green-600 hover:bg-green-700"
                      onClick={() => setActiveTab('google-ai')}
                    >
                      <Brain className="w-4 h-4 mr-2" />
                      AI Diagnostics
                    </Button>
                  </>
                )}
                {user.role === 'patient' && (
                  <>
                    <Button 
                      className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                      onClick={() => setActiveTab('results')}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Results
                    </Button>
                    <Button 
                      className="w-full justify-start bg-purple-600 hover:bg-purple-700"
                      onClick={() => {
                        console.log('Chat button clicked, navigating to /chat');
                        window.location.href = '/chat';
                      }}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Chat with Doctor
                    </Button>
                  </>
                )}

              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-10 h-10 ${config.color} rounded-lg flex items-center justify-center`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{config.title}</h1>
              <p className="text-slate-400 text-sm">Welcome back, {user.fullName}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            {(user.role === 'doctor' || user.role === 'radiologist') && (
              <ChatNotifications user={user} onChatOpen={() => window.location.href = '/chat'} />
            )}
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
              <Settings className="w-5 h-5" />
            </Button>
            <Button 
              onClick={onLogout}
              variant="outline" 
              size="sm"
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6" onLoad={() => {
        try {
          const rolePath = user.role === 'admin' ? '/?role=admin' : '/';
          sessionStorage.setItem('lastPath', rolePath);
        } catch {}
      }}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-600 rounded-lg p-1 shadow-lg">
              {(config.tabs || []).map(tab => {
                const tabIcons = {
                  'overview': <BarChart3 className="w-4 h-4" />,
                  'cancer-detection': <Brain className="w-4 h-4" />,
                  'google-ai': <Brain className="w-4 h-4" />,
                  'simulator': <Activity className="w-4 h-4" />,
                  'visualization': <TrendingUp className="w-4 h-4" />,
                  'patients': <Users className="w-4 h-4" />,
                  'analytics': <BarChart3 className="w-4 h-4" />,
                  'results': <FileText className="w-4 h-4" />,
                  'appointments': <Calendar className="w-4 h-4" />,
                  'schedule': <Clock className="w-4 h-4" />,
                  'debug': <Settings className="w-4 h-4" />,
                  'blood-tests': <Activity className="w-4 h-4" />,
                  'questionnaire': <FileText className="w-4 h-4" />,
                  'lung-analyzer': <Activity className="w-4 h-4" />,
                  'image-viewer': <Eye className="w-4 h-4" />,
                  'skin-scanner': <Eye className="w-4 h-4" />,
                  'scans': <Activity className="w-4 h-4" />,

                  'reports': <FileText className="w-4 h-4" />,
                  'users': <Users className="w-4 h-4" />,
                  'system': <Settings className="w-4 h-4" />
                };
                
                const tabLabels = {
                  'overview': 'Overview',
                  'cancer-detection': 'Cancer Detection',
                  'google-ai': 'Google AI',
                  'simulator': 'Simulator',
                  'visualization': 'Visualization',
                  'patients': 'Patients',
                  'analytics': 'Analytics',
                  'results': 'Results',
                  'appointments': 'Appointments',
                  'schedule': 'Schedule',
                  'debug': 'Debug',
                  'blood-tests': 'Blood Tests',
                  'questionnaire': 'Risk Assessment',
                  'lung-analyzer': 'Lung Analysis',
                  'image-viewer': 'Image Viewer',
                  'skin-scanner': 'Skin Scanner',
                  'scans': 'Scans',

                  'reports': 'Reports',
                  'users': 'Users',
                  'system': 'System'
                };
                
                return (
                  <TabsTrigger 
                    key={tab} 
                    value={tab}
                    className="relative flex items-center gap-2 px-4 py-3 rounded-md font-medium transition-all duration-300 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:scale-105 hover:bg-slate-700 text-slate-300 hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      {tabIcons[tab as keyof typeof tabIcons] || <FileText className="w-4 h-4" />}
                      <span className="hidden sm:inline">{tabLabels[tab as keyof typeof tabLabels] || tab.replace('-', ' ')}</span>
                    </span>
                    {tab === 'google-ai' && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-lg"></div>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* A local boundary, so switching to a lazily-loaded tab shows a
                small placeholder in the content area rather than replacing the
                whole page with the route-level fallback. */}
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-24">
                  <div className="w-10 h-10 bg-blue-600 rounded-full animate-pulse" />
                </div>
              }
            >

            <>
              <TabsContent value="overview">
                {user.role === 'admin' ? (
                  <AdminDashboard user={user} section={'overview'} hideLocalTabs setActiveTab={setActiveTab} />
                ) : user.role === 'doctor' ? (
                  <DoctorPortal user={user} setActiveTab={setActiveTab} />
                ) : user.role === 'radiologist' ? (
                  <RadiologistDashboard user={user} setActiveTab={setActiveTab} />
                ) : null}
              </TabsContent>

            </>

          {/* Patient-specific tabs */}
          {user.role === 'patient' && (
            <>
              <TabsContent value="overview">
                <div className="space-y-6">
                  {/* Health Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="bg-slate-800 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-slate-400 text-sm">Health Score</p>
                            <p className="text-2xl font-bold text-green-400">85%</p>
                          </div>
                          <Heart className="w-8 h-8 text-green-400" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-slate-400 text-sm">Total Scans</p>
                            <p className="text-2xl font-bold text-blue-400">2</p>
                          </div>
                          <Brain className="w-8 h-8 text-blue-400" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-slate-400 text-sm">Next Appointment</p>
                            <p className="text-sm font-bold text-purple-400">Tomorrow 2PM</p>
                          </div>
                          <Calendar className="w-8 h-8 text-purple-400" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800 border-slate-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-slate-400 text-sm">Last Scan</p>
                            <p className="text-sm font-bold text-orange-400">2 days ago</p>
                          </div>
                          <Activity className="w-8 h-8 text-orange-400" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Quick Actions */}
                  <Card className="bg-slate-800 border-slate-600">
                    <CardHeader>
                      <CardTitle className="text-white">Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Button 
                          onClick={() => setActiveTab('scan')}
                          className="bg-blue-600 hover:bg-blue-700 h-16 flex flex-col gap-2"
                        >
                          <Brain className="w-6 h-6" />
                          <span>New Scan</span>
                        </Button>
                        <Button 
                          onClick={() => setActiveTab('appointments')}
                          className="bg-purple-600 hover:bg-purple-700 h-16 flex flex-col gap-2"
                        >
                          <Calendar className="w-6 h-6" />
                          <span>Book Appointment</span>
                        </Button>
                        <Button 
                          onClick={() => setActiveTab('results')}
                          className="bg-green-600 hover:bg-green-700 h-16 flex flex-col gap-2"
                        >
                          <FileText className="w-6 h-6" />
                          <span>View Results</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Recent Activity */}
                  <Card className="bg-slate-800 border-slate-600">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        Recent Activity
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg">
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Breast Cancer Scan completed - No abnormalities detected</span>
                          <span className="text-slate-500 text-sm">2d ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg">
                          <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Appointment scheduled with Dr. Smith</span>
                          <span className="text-slate-500 text-sm">3d ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg">
                          <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Lung CT Scan completed - Normal findings</span>
                          <span className="text-slate-500 text-sm">1w ago</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
              
              {config.tabs.includes("scan") && (
                <TabsContent value="scan">
                  <Card className="bg-slate-800 border-slate-600">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <Brain className="w-5 h-5" />
                        AI Medical Scanner
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <GoogleAIScanner />
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {config.tabs.includes("results") && (
                <TabsContent value="results">
                  <PatientPortalFinal user={user} />
                </TabsContent>
              )}

              {config.tabs.includes("appointments") && (
                <TabsContent value="appointments">
                  <AppointmentScheduler user={user} />
                </TabsContent>
              )}
            </>
          )}

            {config.tabs.includes("scans") && (
              <TabsContent value="scans">
                <div className="space-y-6">
                  <AIScanSimulator />
                </div>
              </TabsContent>
            )}

            {config.tabs.includes("cancer-detection") && (
              <TabsContent value="cancer-detection">
                <CancerDetection />
              </TabsContent>
            )}

            {config.tabs.includes("google-ai") && (
              <TabsContent value="google-ai">
                <GoogleAIScanner />
              </TabsContent>
            )}

            {config.tabs.includes("patients") && user.role === 'doctor' && (
              <TabsContent value="patients">
                <DoctorPatients 
                  user={user} 
                  onSectionChange={(section, data) => {
                    if (section === 'reports') {
                      setActiveTab('reports');
                    } else if (section === 'chat') {
                      // Navigate to chat with patient context
                      window.location.href = `/chat?patientId=${data?.patientId}&patientName=${encodeURIComponent(data?.patientName || '')}`;
                    } else if (section === 'appointments') {
                      setActiveTab('appointments');
                    }
                  }}
                />
              </TabsContent>
            )}

            {config.tabs.includes("patients") && user.role === 'admin' && (
              <TabsContent value="patients">
                <PatientManagement />
              </TabsContent>
            )}

            {config.tabs.includes("analytics") && (
              <TabsContent value="analytics">
                <Card className="bg-slate-800 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center">
                      <BarChart3 className="w-5 h-5 mr-2" />
                      System Analytics & Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <Card className="bg-slate-700 border-slate-600">
                        <CardHeader>
                          <CardTitle className="text-white text-lg flex items-center">
                            <Brain className="w-4 h-4 mr-2 text-purple-400" />
                            AI Detection Accuracy
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ModelPerformancePanel variant="dark" />
                        </CardContent>
                      </Card>
                      <Card className="bg-slate-700 border-slate-600">
                        <CardHeader>
                          <CardTitle className="text-white text-lg flex items-center">
                            <Activity className="w-4 h-4 mr-2 text-green-400" />
                            System Performance
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {/* Every value in this card was a literal: 99.8%, 1.2s,
                              98% and a green "Secure" badge, rendered identically
                              whether the system was healthy, degraded or down.
                              They come from /api/admin/stats now, and an unknown
                              value renders as an em dash. */}
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Process Uptime</span>
                              <span className="text-green-400 font-medium">
                                {statsData?.uptimeSec != null
                                  ? formatProcessUptime(statsData.uptimeSec)
                                  : '\u2014'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Database Latency</span>
                              <span className="text-blue-400 font-medium">
                                {statsData?.database
                                  ? statsData.database.reachable
                                    ? `${statsData.database.latencyMs} ms`
                                    : 'unreachable'
                                  : '\u2014'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Security Status</span>
                              <Badge
                                className={
                                  statsData?.securityStatus === 'secure'
                                    ? 'bg-green-600'
                                    : statsData?.securityStatus
                                      ? 'bg-amber-600'
                                      : 'bg-slate-600'
                                }
                              >
                                {statsData?.securityStatus ?? 'unknown'}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      
                      <Card className="bg-slate-700 border-slate-600">
                        <CardHeader>
                          <CardTitle className="text-white text-lg flex items-center">
                            <TrendingUp className="w-4 h-4 mr-2 text-cyan-400" />
                            Usage Statistics
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Daily Scans</span>
                              <span className="text-purple-400 font-medium">{statsData?.dailyScans ?? '\u2014'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Active Users</span>
                              <span className="text-blue-400 font-medium">{statsData?.totalUsers ?? '\u2014'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">Critical Alerts</span>
                              <span className={`font-medium ${(statsData?.criticalAlerts || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                {statsData?.criticalAlerts || 0}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-300">AI Accuracy</span>
                              {/* `|| 94` here reported 94% whenever the real value was 0
                                  or missing, which is every deployment with no scans yet.
                                  It is also confidence, not accuracy. */}
                              <span className="text-cyan-400 font-medium">
                                {statsData?.aiAccuracy != null ? `${statsData.aiAccuracy}%` : '\u2014'}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* Blood Test Analyzer */}
            {config.tabs.includes("blood-tests") && (
              <TabsContent value="blood-tests">
                <BloodTestAnalyzer />
              </TabsContent>
            )}

            {/* Cancer Risk Questionnaire */}
            {config.tabs.includes("questionnaire") && (
              <TabsContent value="questionnaire">
                <CancerRiskQuestionnaire 
                  user={user} 
                  onRequestTabChange={setActiveTab}
                />
              </TabsContent>
            )}

            {/* Lung Cancer Analyzer */}
            {config.tabs.includes("lung-analyzer") && (
              <TabsContent value="lung-analyzer">
                <LungCancerAnalyzer />
              </TabsContent>
            )}

            {/* Real-time Skin Scanner */}
            {config.tabs.includes("skin-scanner") && (
              <TabsContent value="skin-scanner">
                <RealTimeSkinScanner />
              </TabsContent>
            )}

            {/* Reports Tab */}
            {config.tabs.includes("reports") && user.role === 'doctor' && (
              <TabsContent value="reports">
                <DoctorReports user={user} />
              </TabsContent>
            )}
            
            {config.tabs.includes("schedule") && user.role === 'doctor' && (
              <TabsContent value="schedule">
                <Card className="bg-slate-800 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      Schedule New Appointment
                    </CardTitle>
                    <p className="text-slate-300 text-sm">
                      Create and manage patient appointments
                    </p>
                  </CardHeader>
                  <CardContent>
                    <AppointmentScheduler user={user} />
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {config.tabs.includes("scans") && user.role === 'radiologist' && (
              <TabsContent value="scans">
                <RadiologistDashboard user={user} setActiveTab={setActiveTab} />
              </TabsContent>
            )}

            {config.tabs.includes("appointments") && user.role === 'doctor' && (
              <TabsContent value="appointments">
                <div className="space-y-6">
                  <Card className="bg-slate-800 border-slate-600">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Calendar className="w-5 h-5" />
                        Appointment Management
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Schedule New Appointment */}
                        <Card className="bg-slate-700 border-slate-600">
                          <CardHeader>
                            <CardTitle className="text-white text-lg">Schedule New Appointment</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-slate-300 mb-4">Create appointments for your patients</p>
                            <Button 
                              className="w-full bg-blue-600 hover:bg-blue-700"
                              onClick={() => setActiveTab('schedule')}
                            >
                              <Calendar className="w-4 h-4 mr-2" />
                              Schedule Appointment
                            </Button>
                          </CardContent>
                        </Card>
                        
                        {/* Quick Stats */}
                        <Card className="bg-slate-700 border-slate-600">
                          <CardHeader>
                            <CardTitle className="text-white text-lg">Today's Schedule</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              <div className="flex justify-between">
                                <span className="text-slate-300">Total Appointments</span>
                                <span className="text-white font-medium">6</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-300">Completed</span>
                                <span className="text-green-400 font-medium">3</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-300">Upcoming</span>
                                <span className="text-blue-400 font-medium">2</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-300">Pending</span>
                                <span className="text-yellow-400 font-medium">1</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CardContent>
                  </Card>
                  
                  {/* Appointment List */}
                  <div className="bg-slate-800 border border-slate-600 rounded-lg">
                    <DoctorAppointmentSection user={user} />
                  </div>
                </div>
              </TabsContent>
            )}
            
            {config.tabs.includes("appointments") && user.role === 'radiologist' && (
              <TabsContent value="appointments">
                <AppointmentScheduler user={user} />
              </TabsContent>
            )}

            {user.role === 'admin' && (
              <TabsContent value="analytics">
                <AdminDashboard user={user} section={'analytics'} hideLocalTabs setActiveTab={setActiveTab} />
              </TabsContent>
            )}

            {user.role === 'admin' && (
              <TabsContent value="users">
                <AdminDashboard user={user} section={'users'} hideLocalTabs setActiveTab={setActiveTab} />
              </TabsContent>
            )}

            {user.role === 'admin' && (
              <TabsContent value="system">
                <AdminDashboard user={user} section={'system'} hideLocalTabs setActiveTab={setActiveTab} />
              </TabsContent>
            )}

            </Suspense>
        </Tabs>
      </main>

      {/* Enhanced Chatbot */}
      <EnhancedChatbot 
        user={user}
        onActionClick={(action) => {
          if (action.type === 'schedule_appointment') {
            setActiveTab('appointments');
          } else if (action.type === 'view_results') {
            setActiveTab('results');
          } else if (action.type === 'book_scan') {
            setActiveTab('cancer-detection');
          }
        }}
      />
    </div>
  );
}
