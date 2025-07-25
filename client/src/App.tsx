import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { OptimizedQueryProvider } from "./components/optimized-query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import Home from "@/pages/home";
import About from "@/pages/about";
import NotFound from "@/pages/not-found";
import DashboardLayout from "@/components/dashboard-layout";
import ForgotPassword from "@/components/forgot-password";
import AppErrorBoundary from "@/components/app-error-boundary";

function Router({ user, onLogin, onLogout }: { user: any; onLogin: (user: any) => void; onLogout: () => void }) {
  // If user is logged in, show dashboard instead of public pages
  if (user) {
    return <DashboardLayout user={user} onLogout={onLogout} />;
  }

  return (
    <Switch>
      <Route path="/" component={() => <Home onLoginSuccess={onLogin} userId={user?.id} />} />
      <Route path="/about" component={() => <About onLoginSuccess={onLogin} />} />
      <Route path="/forgot-password" component={() => <ForgotPassword onBack={() => window.location.href = '/'} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in on app start
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch (error) {
        console.log("No active session");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const handleLogin = (userData: any) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.log("Logout error:", error);
    } finally {
      setUser(null);
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
    <ThemeProvider defaultTheme="system" storageKey="healthai-theme">
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
