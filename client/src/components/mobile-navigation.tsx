import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useUser } from '@/hooks/useUser';
import { NotificationButton } from './notification-center';
import { SimpleThemeToggle } from './theme-toggle';
import {
  Menu, Home, Calendar, FileText, MessageSquare, Settings,
  User, Heart, Scan, Activity, Users, BarChart3, Clock,
  Brain, Stethoscope, Shield, LogOut, Bell
} from 'lucide-react';

interface MobileNavigationProps {
  className?: string;
}

export function MobileNavigation({ className }: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { user, logout } = useUser();
  const location = useLocation();

  const getNavigationItems = () => {
    if (!user) return [];

    const baseItems = [
      { href: '/', icon: Home, label: 'Dashboard', badge: null },
      { href: '/chat', icon: MessageSquare, label: 'Messages', badge: null },
      { href: '/profile', icon: User, label: 'Profile', badge: null },
      { href: '/settings', icon: Settings, label: 'Settings', badge: null },
    ];

    switch (user.role) {
      case 'patient':
        return [
          { href: '/patient', icon: Home, label: 'Dashboard', badge: null },
          { href: '/patient/scans', icon: Scan, label: 'My Scans', badge: null },
          { href: '/patient/appointments', icon: Calendar, label: 'Appointments', badge: null },
          { href: '/patient/reports', icon: FileText, label: 'Reports', badge: null },
          { href: '/chat', icon: MessageSquare, label: 'Messages', badge: null },
          { href: '/patient/health', icon: Heart, label: 'Health Metrics', badge: null },
          ...baseItems.slice(-2)
        ];

      case 'doctor':
        return [
          { href: '/doctor', icon: Home, label: 'Dashboard', badge: null },
          { href: '/doctor/patients', icon: Users, label: 'Patients', badge: null },
          { href: '/doctor/appointments', icon: Calendar, label: 'Appointments', badge: 3 },
          { href: '/doctor/reports', icon: FileText, label: 'Reports', badge: null },
          { href: '/doctor/scans', icon: Scan, label: 'Scan Reviews', badge: 5 },
          { href: '/chat', icon: MessageSquare, label: 'Messages', badge: null },
          { href: '/doctor/analytics', icon: BarChart3, label: 'Analytics', badge: null },
          ...baseItems.slice(-2)
        ];

      case 'radiologist':
        return [
          { href: '/radiologist', icon: Home, label: 'Dashboard', badge: null },
          { href: '/radiologist/pending', icon: Clock, label: 'Pending Reviews', badge: 12 },
          { href: '/radiologist/completed', icon: FileText, label: 'Completed', badge: null },
          { href: '/radiologist/ai-analysis', icon: Brain, label: 'AI Analysis', badge: null },
          { href: '/chat', icon: MessageSquare, label: 'Messages', badge: null },
          { href: '/radiologist/reports', icon: BarChart3, label: 'Reports', badge: null },
          ...baseItems.slice(-2)
        ];

      case 'admin':
        return [
          { href: '/admin', icon: Home, label: 'Dashboard', badge: null },
          { href: '/admin/users', icon: Users, label: 'User Management', badge: null },
          { href: '/admin/system', icon: Activity, label: 'System Health', badge: null },
          { href: '/admin/analytics', icon: BarChart3, label: 'Analytics', badge: null },
          { href: '/admin/security', icon: Shield, label: 'Security', badge: null },
          { href: '/chat', icon: MessageSquare, label: 'Messages', badge: null },
          ...baseItems.slice(-2)
        ];

      default:
        return baseItems;
    }
  };

  const navigationItems = getNavigationItems();

  const isActive = (href: string) => {
    if (href === '/') {
      return location.pathname === '/' || location.pathname === `/${user?.role}`;
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div className={`lg:hidden ${className}`}>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">HealthAI</span>
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-2">
            <NotificationButton />
            <SimpleThemeToggle />
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="w-9 h-9 p-0">
                <Menu className="h-4 w-4" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
          </div>
        </div>

        <SheetContent side="right" className="w-80 p-0">
          <div className="flex flex-col h-full">
            {/* User info */}
            <div className="p-4 border-b">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-full flex items-center justify-center text-white font-semibold">
                  {user?.fullName?.charAt(0) || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{user?.fullName}</p>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="text-xs">
                      {user?.role}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      @{user?.username}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <ScrollArea className="flex-1 p-4">
              <nav className="space-y-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setIsOpen(false)}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <Badge variant={active ? 'secondary' : 'default'} className="text-xs">
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
              </nav>

              <Separator className="my-4" />

              {/* Quick actions */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground px-3">Quick Actions</h4>
                
                {user?.role === 'patient' && (
                  <>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <Scan className="w-4 h-4 mr-2" />
                      Upload Scan
                    </Button>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <Calendar className="w-4 h-4 mr-2" />
                      Book Appointment
                    </Button>
                  </>
                )}

                {user?.role === 'doctor' && (
                  <>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <Users className="w-4 h-4 mr-2" />
                      View Patients
                    </Button>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <FileText className="w-4 h-4 mr-2" />
                      Review Reports
                    </Button>
                  </>
                )}

                {user?.role === 'radiologist' && (
                  <>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <Clock className="w-4 h-4 mr-2" />
                      Pending Reviews
                    </Button>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      <Brain className="w-4 h-4 mr-2" />
                      AI Analysis
                    </Button>
                  </>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-4 border-t">
              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => {
                  logout();
                  setIsOpen(false);
                }}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Bottom navigation for mobile (alternative approach)
export function MobileBottomNavigation({ className }: MobileNavigationProps) {
  const { user } = useUser();
  const location = useLocation();

  if (!user) return null;

  const getBottomNavItems = () => {
    const baseItems = [
      { href: `/${user.role}`, icon: Home, label: 'Home' },
      { href: '/chat', icon: MessageSquare, label: 'Chat' },
    ];

    switch (user.role) {
      case 'patient':
        return [
          ...baseItems,
          { href: '/patient/scans', icon: Scan, label: 'Scans' },
          { href: '/patient/appointments', icon: Calendar, label: 'Appointments' },
          { href: '/profile', icon: User, label: 'Profile' },
        ];

      case 'doctor':
        return [
          ...baseItems,
          { href: '/doctor/patients', icon: Users, label: 'Patients' },
          { href: '/doctor/reports', icon: FileText, label: 'Reports' },
          { href: '/profile', icon: User, label: 'Profile' },
        ];

      case 'radiologist':
        return [
          ...baseItems,
          { href: '/radiologist/pending', icon: Clock, label: 'Pending' },
          { href: '/radiologist/ai-analysis', icon: Brain, label: 'AI' },
          { href: '/profile', icon: User, label: 'Profile' },
        ];

      default:
        return [
          ...baseItems,
          { href: '/admin/users', icon: Users, label: 'Users' },
          { href: '/admin/system', icon: Activity, label: 'System' },
          { href: '/profile', icon: User, label: 'Profile' },
        ];
    }
  };

  const items = getBottomNavItems().slice(0, 5); // Limit to 5 items

  const isActive = (href: string) => {
    if (href === `/${user.role}`) {
      return location.pathname === '/' || location.pathname === `/${user.role}`;
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div className={`lg:hidden fixed bottom-0 left-0 right-0 bg-background border-t ${className}`}>
      <div className="flex items-center justify-around py-2 px-4">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          
          return (
            <Link
              key={item.href}
              to={item.href}
              className={`flex flex-col items-center space-y-1 p-2 rounded-lg transition-colors ${
                active
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Mobile-optimized header
export function MobileHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="lg:hidden p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <h1 className="text-xl font-bold">{title}</h1>
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
