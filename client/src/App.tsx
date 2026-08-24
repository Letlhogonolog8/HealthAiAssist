import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { OptimizedQueryProvider } from "./components/optimized-query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/theme-context";
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";
import AppErrorBoundary from "@/components/app-error-boundary";

/**
 * Everything behind a login, or behind a second route, is loaded on demand.
 *
 * The whole application used to be one eager import graph: a visitor landing on
 * the public homepage downloaded the admin dashboard, the radiologist review
 * queue, the genomics page, the chatbot and every charting library they use
 * before the page could render. That is a 1.5 MB main chunk (227 kB gzipped) to
 * show a marketing page, over whatever connection the patient happens to have.
 *
 * Home stays eager because it is the first paint for an anonymous visitor and
 * lazy-loading it would only add a round trip.
 */
const About = lazy(() => import("@/pages/about"));
const ChatPage = lazy(() => import("@/pages/chat"));
const GenomicsPage = lazy(() => import("@/pages/genomics"));
const CancerDetection = lazy(() => import("@/pages/cancer-detection"));
const DashboardLayout = lazy(() => import("@/components/dashboard-layout"));
const ForgotPassword = lazy(() => import("@/components/forgot-password"));

/** Shown while a route chunk is in flight. */
function RouteFallback() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 bg-blue-600 rounded-full animate-pulse mx-auto"></div>
        <p className="text-white">Loading…</p>
      </div>
    </div>
  );
}

function Router({ user, onLogin, onLogout }: { user: any; onLogin: (user: any) => void; onLogout: () => void }) {
  return (
    <Switch>
      <Route path="/chat">
        {user ? <ChatPage /> : <Home onLoginSuccess={onLogin} userId={user?.id} />}
      </Route>
      <Route path="/" component={() => {
        // If user is logged in, show dashboard instead of public pages
        if (user) {
          return <DashboardLayout user={user} onLogout={onLogout} />;
        }
        return <Home onLoginSuccess={onLogin} userId={user?.id} />;
      }} />
      {/* Public by design: the transferability table and panel provenance are
          statements about the system's limits, and hiding them behind a login
          would defeat the purpose. Consent and upload tabs still require a user. */}
      <Route path="/genomics" component={() => <GenomicsPage user={user} />} />
      <Route path="/about" component={() => <About onLoginSuccess={onLogin} />} />
      {/* Public like /genomics, and for the same reason: which modalities have a
          model — and which do not — is a statement about the system's limits.
          The analysers themselves post scans and need a session, so the page
          asks for one at the point of use rather than at the door. */}
      <Route
        path="/cancer-detection"
        component={() => <CancerDetection user={user} onLoginSuccess={onLogin} standalone />}
      />
      <Route path="/forgot-password" component={() => {
        const [, setLocation] = useLocation();
        return <ForgotPassword onBack={() => setLocation('/')} />;
      }} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on app start and restore last route
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          // Restore last location (admin vs patient) if saved
          const lastPath = sessionStorage.getItem('lastPath');
          if (lastPath && window.location.pathname === '/') {
            window.history.replaceState({}, '', lastPath);
          }
        }
      } catch (error) {
        console.log('No existing session');
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
  }, []);

  const handleLogin = (userData: any) => {
    setUser(userData);
    // Store user in sessionStorage for persistence
    sessionStorage.setItem('user', JSON.stringify(userData));
    // Save landing path per role
    const rolePath = userData?.role === 'admin' ? '/?role=admin' : '/';
    sessionStorage.setItem('lastPath', rolePath);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: 'include' });
    } catch (error) {
      console.log("Logout error:", error);
    } finally {
      setUser(null);
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('lastPath');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 bg-blue-600 rounded-full animate-pulse mx-auto"></div>
          <p className="text-white">Loading HAI Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <OptimizedQueryProvider>
          <TooltipProvider>
            <Toaster />
            <Suspense fallback={<RouteFallback />}>
              <Router user={user} onLogin={handleLogin} onLogout={handleLogout} />
            </Suspense>
          </TooltipProvider>
        </OptimizedQueryProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
