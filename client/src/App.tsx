import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { OptimizedQueryProvider } from "./components/optimized-query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/theme-context";
import Home from "@/pages/home";
import About from "@/pages/about";
import NotFound from "@/pages/not-found";
import ChatPage from "@/pages/chat";
import DashboardLayout from "@/components/dashboard-layout";
import ForgotPassword from "@/components/forgot-password";
import AppErrorBoundary from "@/components/app-error-boundary";

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
      <Route path="/about" component={() => <About onLoginSuccess={onLogin} />} />
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
            <Router user={user} onLogin={handleLogin} onLogout={handleLogout} />
          </TooltipProvider>
        </OptimizedQueryProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
