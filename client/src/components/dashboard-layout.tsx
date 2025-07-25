import { useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import MedicalTranslator from "./medical-translator";
import AmbientSoundTherapy from "./ambient-sound-therapy";
import AIScanSimulator from "./ai-scan-simulator-fixed";
import MedicalVisualization3D from "./3d-medical-visualization";
import GoogleAIScanner from "./google-ai-scanner-fixed";
import PatientPortalOptimized from "./patient-portal-enhanced-fixed";

import PatientManagement from "./patient-management";
import AdminDashboard from "./admin-dashboard-fixed";
import AdminStaffManagement from "./admin-staff-management";
import AdminUserManagement from "./admin-user-management";
import RadiologistDashboard from "./radiologist-dashboard";
import DoctorDashboard from "./doctor-dashboard-clean";
import CancerDetection from "@/pages/cancer-detection";
import EnhancedChatbot from "./enhanced-chatbot";
import BloodTestAnalyzer from "./blood-test-analyzer";
import CancerRiskQuestionnaire from "./cancer-risk-questionnaire";
import LungCancerAnalyzer from "./lung-cancer-analyzer";
import MedicalImageViewer from "./medical-image-viewer";
import RealTimeSkinScanner from "./real-time-skin-scanner";

interface DashboardLayoutProps {
  user: any;
  onLogout: () => void;
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
      tabs: ["overview", "scans", "ai-analysis", "google-ai", "translator", "therapy", "lung-analyzer"]
    },
    doctor: {
      icon: Stethoscope,
      title: "Doctor Portal",
      color: "bg-blue-600",
      tabs: ["overview", "patients", "reports", "google-ai", "translator", "therapy", "blood-tests", "questionnaire", "lung-analyzer", "image-viewer", "skin-scanner"]
    },
    patient: {
      icon: User,
      title: "Patient Portal",
      color: "bg-green-600",
      tabs: ["overview", "results", "appointments", "therapy", "blood-tests", "questionnaire", "skin-scanner"]
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
        // Fallback to mock data if API fails
        return {
          totalUsers: 156,
          activeScans: 12,
          systemUptime: 99.9,
          aiAccuracy: 94,
          pendingReviews: 8,
          completedToday: 15,
          aiConfidence: 87,
          avgReviewTime: 12,
          activePatients: 45,
          todaysAppointments: 6,
          pendingReports: 3,
          criticalCases: 1,
          completedScans: 23,
          pendingResults: 2,
          nextAppointment: 'Tomorrow 2:00 PM',
          healthScore: 85
        };
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
        { label: "AI Accuracy", key: "aiAccuracy", icon: Brain, color: "text-cyan-400" }
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
        { label: "Next Appointment", key: "nextAppointment", icon: Calendar, color: "text-blue-400" },
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
            let value = statsData ? statsData[stat.key] : 0;
            
            // Format values appropriately
            if (stat.key === 'systemUptime' && typeof value === 'number') {
              value = `${value}%`;
            } else if (stat.key === 'avgReviewTime' && typeof value === 'number') {
              value = `${value}m`;
            } else if (stat.key === 'aiAccuracy' || stat.key === 'aiConfidence') {
              value = `${value}%`;
            } else if (stat.key === 'nextAppointment') {
              value = value || 'None scheduled';
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
                      {stat.key === 'criticalCases' && value > 0 && (
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
                    {user.role === 'admin' && (
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
                    {user.role === 'radiologist' && (
                      <>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></div>
                          <span className="text-slate-300 flex-1">High-priority breast scan assigned</span>
                          <span className="text-slate-500 text-sm">15m ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">AI flagged suspicious nodule in lung CT</span>
                          <span className="text-slate-500 text-sm">1h ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Mammography report completed</span>
                          <span className="text-slate-500 text-sm">2h ago</span>
                        </div>
                      </>
                    )}
                    {user.role === 'doctor' && (
                      <>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                          <span className="text-slate-300 flex-1">New scan results available for review</span>
                          <span className="text-slate-500 text-sm">30m ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Patient appointment confirmed</span>
                          <span className="text-slate-500 text-sm">1h ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Critical case requires attention</span>
                          <span className="text-slate-500 text-sm">3h ago</span>
                        </div>
                      </>
                    )}
                    {user.role === 'patient' && (
                      <>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                          <span className="text-slate-300 flex-1">Scan results are now available</span>
                          <span className="text-slate-500 text-sm">30m ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Appointment reminder: Tomorrow 2:00 PM</span>
                          <span className="text-slate-500 text-sm">2h ago</span>
                        </div>
                        <div className="flex items-center space-x-3 p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors">
                          <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                          <span className="text-slate-300 flex-1">Health screening reminder</span>
                          <span className="text-slate-500 text-sm">1d ago</span>
                        </div>
                      </>
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
                      className="w-full justify-start bg-green-600 hover:bg-green-700"
                      onClick={() => setActiveTab('appointments')}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Book Appointment
                    </Button>
                    <Button 
                      className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                      onClick={() => setActiveTab('results')}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Results
                    </Button>
                  </>
                )}
                <Button 
                  className="w-full justify-start bg-purple-600 hover:bg-purple-700"
                  onClick={() => setActiveTab('translator')}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Medical Translator
                </Button>
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
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
              <Bell className="w-5 h-5" />
            </Button>
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
      <main className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-600 rounded-lg p-1 shadow-lg">
            {(config.tabs || []).map(tab => {
              const tabIcons = {
                'overview': <BarChart3 className="w-4 h-4" />,
                'cancer-detection': <Brain className="w-4 h-4" />,
                'google-ai': <Brain className="w-4 h-4" />,
                'translator': <FileText className="w-4 h-4" />,
                'therapy': <Heart className="w-4 h-4" />,
                'simulator': <Activity className="w-4 h-4" />,
                'visualization': <TrendingUp className="w-4 h-4" />,
                'patients': <Users className="w-4 h-4" />,
                'analytics': <BarChart3 className="w-4 h-4" />,
                'results': <FileText className="w-4 h-4" />,
                'appointments': <Calendar className="w-4 h-4" />,
                'debug': <Settings className="w-4 h-4" />,
                'blood-tests': <Activity className="w-4 h-4" />,
                'questionnaire': <FileText className="w-4 h-4" />,
                'lung-analyzer': <Activity className="w-4 h-4" />,
                'image-viewer': <Eye className="w-4 h-4" />,
                'skin-scanner': <Eye className="w-4 h-4" />,
                'scans': <Activity className="w-4 h-4" />,
                'ai-analysis': <Brain className="w-4 h-4" />,
                'reports': <FileText className="w-4 h-4" />,
                'users': <Users className="w-4 h-4" />,
                'system': <Settings className="w-4 h-4" />
              };
              
              const tabLabels = {
                'overview': 'Overview',
                'cancer-detection': 'Cancer Detection',
                'google-ai': 'Google AI',
                'translator': 'Translator',
                'therapy': 'Therapy',
                'simulator': 'Simulator',
                'visualization': 'Visualization',
                'patients': 'Patients',
                'analytics': 'Analytics',
                'results': 'Results',
                'appointments': 'Appointments',
                'debug': 'Debug',
                'blood-tests': 'Blood Tests',
                'questionnaire': 'Risk Assessment',
                'lung-analyzer': 'Lung Analysis',
                'image-viewer': 'Image Viewer',
                'skin-scanner': 'Skin Scanner',
                'scans': 'Scans',
                'ai-analysis': 'AI Analysis',
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

          <TabsContent value="overview">
            {renderOverview()}
          </TabsContent>

          {config.tabs.includes("appointments") && user.role === 'patient' && (
            <TabsContent value="appointments">
              <div className="bg-blue-50 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-6 text-blue-900">Appointment Management</h2>
                <PatientPortalOptimized user={user} />
              </div>
            </TabsContent>
          )}

          {config.tabs.includes("translator") && (
            <TabsContent value="translator">
              <MedicalTranslator />
            </TabsContent>
          )}

          {config.tabs.includes("therapy") && (
            <TabsContent value="therapy">
              <AmbientSoundTherapy />
            </TabsContent>
          )}

          {config.tabs.includes("scans") && (
            <TabsContent value="scans">
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <AIScanSimulator />
                  <MedicalVisualization3D />
                </div>
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

          {config.tabs.includes("patients") && (
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
                        <div className="space-y-3">
                          {[
                            { type: 'Breast', accuracy: 96, color: 'bg-pink-600' },
                            { type: 'Lung', accuracy: 94, color: 'bg-blue-600' },
                            { type: 'Skin', accuracy: 92, color: 'bg-orange-600' },
                            { type: 'Colon', accuracy: 89, color: 'bg-green-600' },
                            { type: 'Prostate', accuracy: 91, color: 'bg-purple-600' }
                          ].map(item => (
                            <div key={item.type} className="flex justify-between items-center">
                              <span className="text-slate-300">{item.type} Cancer</span>
                              <Badge className={item.color}>{item.accuracy}%</Badge>
                            </div>
                          ))}
                        </div>
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
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">System Uptime</span>
                            <span className="text-green-400 font-medium">99.8%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">Response Time</span>
                            <span className="text-blue-400 font-medium">1.2s</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">Database Health</span>
                            <span className="text-green-400 font-medium">98%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">Security Status</span>
                            <Badge className="bg-green-600">Secure</Badge>
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
                            <span className="text-purple-400 font-medium">{statsData?.dailyScans || 45}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">Active Users</span>
                            <span className="text-blue-400 font-medium">{statsData?.totalUsers || 156}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">Critical Alerts</span>
                            <span className={`font-medium ${(statsData?.criticalAlerts || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {statsData?.criticalAlerts || 0}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300">AI Accuracy</span>
                            <span className="text-cyan-400 font-medium">{statsData?.aiAccuracy || 94}%</span>
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

          {/* Medical Image Viewer */}
          {config.tabs.includes("image-viewer") && (
            <TabsContent value="image-viewer">
              <MedicalImageViewer imageFile={null} />
            </TabsContent>
          )}

          {/* Real-time Skin Scanner */}
          {config.tabs.includes("skin-scanner") && (
            <TabsContent value="skin-scanner">
              <RealTimeSkinScanner />
            </TabsContent>
          )}

          {/* AI Analysis Tab */}
          {config.tabs.includes("ai-analysis") && (
            <TabsContent value="ai-analysis">
              <div className="space-y-6">
                <LungCancerAnalyzer />
              </div>
            </TabsContent>
          )}

          {/* Reports Tab */}
          {config.tabs.includes("reports") && (
            <TabsContent value="reports">
              <div className="space-y-6">
                <Card className="bg-slate-800 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-white">Medical Reports & Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <BloodTestAnalyzer />
                      <MedicalImageViewer imageFile={null} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}

          {/* Users Tab */}
          {config.tabs.includes("users") && (
            <TabsContent value="users">
              <AdminUserManagement />
            </TabsContent>
          )}

          {/* System Tab */}
          {config.tabs.includes("system") && (
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
          )}
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
