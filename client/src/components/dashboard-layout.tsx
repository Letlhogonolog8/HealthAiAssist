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
import SecuritySettingsDialog from "./security-settings-dialog";
import OfflineScanQueue from "./offline-scan-queue";
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
const DoctorScheduleAppointment = lazy(() => import("./doctor-schedule-appointment"));
const DoctorPortal = lazy(() => import("./doctor-portal"));
import DoctorReports from "./doctor-reports";
import DoctorPatients from "./doctor-patients";
import { DoctorAppointmentSection } from "./doctor-appointment-section";
const CancerDetection = lazy(() => import("@/pages/cancer-detection"));
const EnhancedChatbot = lazy(() => import("./enhanced-chatbot"));
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

/**
 * "3 days ago" from an instant, or empty when there is nothing to format.
 *
 * Tolerant of what the activity endpoints actually return: an ISO string, a
 * Date, or a value that does not parse at all. An unparseable timestamp renders
 * as nothing rather than as "Invalid Date".
 */
function formatRelative(value: unknown): string {
  if (!value) return '';
  const when = new Date(value as string);
  if (Number.isNaN(when.getTime())) return '';

  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return when.toLocaleDateString();
}

export default function DashboardLayout({ user, onLogout }: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [securityOpen, setSecurityOpen] = useState(false);

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
      /**
       * "appointments" is gone, for the reason "debug" went from the doctor's
       * list: it rendered a tab and no panel.
       *
       * The only two <TabsContent value="appointments"> in this file are gated
       * on user.role === 'patient' and user.role === 'doctor', so a radiologist
       * clicking Appointments got an empty page under a heading.
       *
       * It is not an oversight that can be fixed by adding a panel, either.
       * An appointment row has patient_id and doctor_id and no radiologist
       * column, and there is no /api/radiologist/appointments endpoint --
       * there is nothing for the tab to show. A radiologist reads scans; the
       * diary belongs to the referring clinician.
       */
      tabs: ["overview", "scans", "google-ai"]
    },
    doctor: {
      icon: Stethoscope,
      title: "Doctor Portal",
      color: "bg-blue-600",
      /**
       * "debug" is gone. It was listed, it rendered a tab with an icon and a
       * label, and there was no <TabsContent value="debug"> anywhere — so a
       * clinician clicking it got a blank page. A developer tab on a clinical
       * portal is the wrong thing to ship even when it does work.
       */
      tabs: ["overview", "patients", "reports", "appointments", "schedule", "google-ai"]
    },
    patient: {
      icon: User,
      title: "Patient Portal",
      color: "bg-green-600",
      /**
       * "blood-tests" is gone from this list, and BloodTestAnalyzer with it.
       *
       * That tab ran a cancer risk calculation entirely in the browser. There
       * was no endpoint behind it and no model: it added hand-written weights
       * per marker (`riskScore += cea > 10 ? 30 : 15`), bucketed the total into
       * low / medium / high / critical, and rendered findings reading
       * "Strongly indicates ovarian or pancreatic cancer" and "Highly
       * suspicious for pancreatic cancer".
       *
       * Nobody measured those thresholds or those weights. A patient entering
       * their own tumour-marker values got a cancer-type determination out of
       * arithmetic that had never been evaluated against anything — on the
       * patient's own portal, with no clinician between them and it.
       */
      tabs: ["overview", "scan", "results", "appointments", "questionnaire", "skin-scanner"]
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

  const {
    data: recentActivities,
    isLoading: activitiesLoading,
    isError: activitiesError,
  } = useQuery({
    queryKey: [`/api/${user.role}/activities/recent`],
    queryFn: async () => {
      const response = await fetch(`/api/${user.role}/activities/recent`, {
        credentials: 'include'
      });
      if (!response.ok) {
        /**
         * A failed request is an error, not an activity feed.
         *
         * Two fabricated entries were returned here whenever this call failed —
         * "System backup completed successfully, 2 hours ago" and "New scan
         * results available, 4 hours ago" — rendered in the same list as real
         * events, on every role's dashboard, indistinguishable from history that
         * actually happened. The second one is the worse of the two: it tells a
         * patient a result is waiting for them when the server could not be
         * reached at all.
         */
        throw new Error(`Recent activity could not be loaded (${response.status}).`);
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
        // Renamed to match the endpoint and to stop reading as accuracy.
        { label: "Mean AI Confidence", key: "meanAiConfidencePct", icon: Brain, color: "text-purple-400" },
        // Measured from reviewed_at. Replaces `avgReviewTime`, a server literal.
        { label: "Median Review Time", key: "medianReviewHours", icon: Clock, color: "text-blue-400" }
      ],
      doctor: [
        { label: "Active Patients", key: "activePatients", icon: Users, color: "text-blue-400" },
        { label: "Today's Appointments", key: "todaysAppointments", icon: Calendar, color: "text-green-400" },
        { label: "Pending Reports", key: "pendingReports", icon: FileText, color: "text-orange-400" },
        { label: "Critical Cases", key: "criticalCases", icon: Heart, color: "text-red-400" }
      ],
      /**
       * A patient's tiles.
       *
       * "Health Score" is gone. The server computed it as the share of the
       * patient's scans whose `result` text did not contain the substring
       * "abnormal", bucketed into Good / Fair / Needs Attention, and defaulted to
       * "Good" for a patient with no scans at all. Results are written as
       * "Lung Cancer detected - high risk", which contains no such substring — so
       * a patient whose scan had just been flagged for malignancy was shown a
       * green "Good" here. The endpoint now returns healthScore: null and this
       * platform does not attempt to score anyone's health.
       *
       * "Health Insights" is gone too: the endpoint never returned a
       * `healthInsights` field, so the tile always rendered a dash.
       */
      patient: [
        { label: "Completed Scans", key: "completedScans", icon: Activity, color: "text-green-400" },
        { label: "Pending Results", key: "pendingResults", icon: Clock, color: "text-orange-400" },
        { label: "Flagged For Review", key: "flaggedForReview", icon: Heart, color: "text-orange-400" }
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
            } else if (stat.key === 'medianReviewHours' && typeof raw === 'number') {
              value = `${raw}h`;
            } else if (stat.key === 'aiAccuracy' || stat.key === 'meanAiConfidencePct') {
              value = `${raw}%`;
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
                            /*
                              The server sends an ISO instant, which this
                              rendered verbatim — "2026-08-24T10:22:13.131Z" sat
                              beside every activity row. The branch below passed
                              strings straight through on the assumption they
                              were already human-readable, which stopped being
                              true when the endpoint switched from
                              toLocaleTimeString() on the server to ISO.
                            */
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
                                <span className="text-slate-500 text-sm whitespace-nowrap">
                                  {formatRelative(timeLabel)}
                                </span>
                              </div>
                            );
                          })
                        ) : activitiesError ? (
                          /*
                            Distinguished from an empty feed on purpose. "No recent
                            activity" is a statement about the account; this is a
                            statement about the request, and the two used to be
                            rendered identically once the fabricated fallback was
                            removed.
                          */
                          <div className="text-orange-300 text-sm">
                            Recent activity could not be loaded. This is a connection
                            problem, not an empty history.
                          </div>
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
                      onClick={() => setActiveTab('scan')}
                    >
                      <Brain className="w-4 h-4 mr-2" />
                      New Scan
                    </Button>
                    <Button
                      className="w-full justify-start bg-purple-600 hover:bg-purple-700"
                      onClick={() => setActiveTab('appointments')}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Book Appointment
                    </Button>
                    <Button
                      className="w-full justify-start bg-green-600 hover:bg-green-700"
                      onClick={() => setActiveTab('results')}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Results
                    </Button>
                    <Button
                      className="w-full justify-start bg-slate-700 hover:bg-slate-600"
                      onClick={() => { window.location.href = '/chat'; }}
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
            {/* This had no onClick. It rendered a cog, and pressing it did
                nothing — the same defect as a tab with no panel behind it. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSecurityOpen(true)}
              aria-label="Account security"
              className="text-slate-400 hover:text-white"
            >
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
                  'scan': 'New Scan',
                  'cancer-detection': 'Cancer Detection',
                  'google-ai': 'Google AI',
                  'simulator': 'Simulator',
                  'visualization': 'Visualization',
                  'patients': 'Patients',
                  'analytics': 'Analytics',
                  'results': 'Results',
                  'appointments': 'Appointments',
                  'schedule': 'Schedule',
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
              {/*
                The patient's overview was four hardcoded cards and three
                invented events, shadowing renderOverview() — which reads
                /api/patient/stats and /api/patient/activities/recent and is
                what every other role gets.

                A brand-new account with an empty record was shown:

                  Health Score        85%
                  Total Scans         2
                  Next Appointment    Tomorrow 2PM
                  Last Scan           2 days ago

                  "Breast Cancer Scan completed - No abnormalities detected"
                  "Appointment scheduled with Dr. Smith"
                  "Lung CT Scan completed - Normal findings"

                Every one a literal. This is the patient's own screen, about
                their own health, and it told them they had been scanned twice,
                cleared once, and were due to be seen tomorrow — none of which
                had happened. "Breast Cancer Scan" names a modality with no
                classifier at all, and Dr. Smith is the same fictional clinician
                removed from the pending-reports endpoint.

                Health Score in particular was removed from /api/patient/stats
                for being derived from a substring search; it survived here as a
                flat 85%.
              */}
              <TabsContent value="overview">
                <div className="space-y-6">
                  {renderOverview()}
                </div>
              </TabsContent>
              
              {config.tabs.includes("scan") && (
                <TabsContent value="scan">
                  {/* Shown only when something is queued or the connection is
                      down. Placed above the uploader so a clinician sees what is
                      still waiting before capturing more. */}
                  <div className="mb-4">
                    <OfflineScanQueue />
                  </div>
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

            {/*
              Role-gated, because there is a second <TabsContent value="scans">
              below for radiologists and Radix renders every panel whose value
              matches -- not just the first.

              A radiologist opening Scans therefore got the upload-and-analyse
              tool stacked on top of a complete second copy of the
              RadiologistDashboard, the same component already filling the
              Overview tab: two sets of stat cards, two review queues, two
              Outcomes panels, each with its own queries in flight.
            */}
            {config.tabs.includes("scans") && user.role !== 'radiologist' && (
              <TabsContent value="scans">
                <div className="space-y-6">
                  <AIScanSimulator />
                </div>
              </TabsContent>
            )}

            {config.tabs.includes("cancer-detection") && (
              <TabsContent value="cancer-detection">
                <CancerDetection user={user} />
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

            {/*
              A second analytics panel stood here and is removed.

              There were two <TabsContent value="analytics"> in this file: this
              hand-rolled one, gated on config.tabs, and the AdminDashboard
              section below, gated on the admin role. Only administrators have an
              "analytics" tab at all — so for the one role that can reach it,
              both matched and Radix rendered both. The tab showed the same three
              cards twice, once in a dark panel and once in a light one, with two
              different values labelled "Database Latency".

              AdminDashboard's version is the maintained one: it carries the
              model registry, the trend charts and the export. This one duplicated
              a subset of it.
            */}

            {/* Blood Test Analyzer */}
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
            
            {/*
              This tab rendered AppointmentScheduler, the patient-facing booking
              wizard, under a header reading "Create and manage patient
              appointments". A clinician opening it was asked to "Select
              Professional Type — choose the type of medical professional you'd
              like to see", and shown a list headed "Your appointments" that
              queried /api/patient/appointments and so was empty for them however
              full their diary was.

              DoctorScheduleAppointment books for a patient on the clinician's own
              panel, through POST /api/doctor/appointments/schedule.
            */}
            {config.tabs.includes("schedule") && user.role === 'doctor' && (
              <TabsContent value="schedule">
                <DoctorScheduleAppointment user={user} />
              </TabsContent>
            )}

            {/*
              Scans opens on the review queue rather than repeating Overview.
              Both tabs mounted RadiologistDashboard with no argument, so they
              were the same screen twice and Scans landed the radiologist on the
              Workstation summary they had just left.
            */}
            {config.tabs.includes("scans") && user.role === 'radiologist' && (
              <TabsContent value="scans">
                <RadiologistDashboard
                  user={user}
                  setActiveTab={setActiveTab}
                  initialSection="pending"
                />
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
                        
                        {/*
                          These four were 6 / 3 / 2 / 1 — literals, on a
                          clinician's own appointments tab. A doctor with an
                          empty diary was shown six appointments today, three of
                          them already completed.

                          They come from /api/doctor/stats now, which counts
                          them in the database and scopes them to the clinician
                          asking. A figure that has not loaded renders as a dash
                          rather than as zero: "0 appointments today" is a claim,
                          "—" is not.
                        */}
                        <Card className="bg-slate-700 border-slate-600">
                          <CardHeader>
                            <CardTitle className="text-white text-lg">Your appointments</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              {[
                                { label: 'Today', key: 'todaysAppointments', tone: 'text-white' },
                                { label: 'Upcoming', key: 'upcomingAppointments', tone: 'text-blue-400' },
                                { label: 'Completed', key: 'appointmentsCompleted', tone: 'text-green-400' },
                                { label: 'Scans awaiting your report', key: 'pendingReports', tone: 'text-yellow-400' },
                              ].map((row) => {
                                const value = statsData ? statsData[row.key] : undefined;
                                return (
                                  <div key={row.key} className="flex justify-between">
                                    <span className="text-slate-300">{row.label}</span>
                                    <span className={`${row.tone} font-medium tabular-nums`}>
                                      {value ?? '—'}
                                    </span>
                                  </div>
                                );
                              })}
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
            // 'cancer-detection' is not in any role's tab list, so this switched
            // to a tab whose content never renders — the assistant's "book a
            // scan" action dropped the patient on an empty panel. 'scan' is the
            // patient's upload tab and is the one this meant.
            setActiveTab('scan');
          }
        }}
      />

      <SecuritySettingsDialog open={securityOpen} onOpenChange={setSecurityOpen} />
    </div>
  );
}
