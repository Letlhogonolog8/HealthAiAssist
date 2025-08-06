import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useWebSocketEnhanced } from '@/hooks/useWebSocketEnhanced';
import { useUser } from '@/hooks/useUser';
import { useToast } from '@/hooks/use-toast';
import {
  Bell, BellRing, Check, Clock, AlertCircle, Info, CheckCircle,
  Calendar, FileText, MessageSquare, UserPlus, Activity, Heart
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'appointment' | 'scan' | 'message' | 'system';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  isRead: boolean;
  createdAt: string;
  actionUrl?: string;
  metadata?: {
    appointmentId?: number;
    scanId?: number;
    messageId?: number;
    userId?: number;
  };
}

interface NotificationCenterProps {
  className?: string;
  showAll?: boolean;
}

export function NotificationCenter({ className, showAll = false }: NotificationCenterProps) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('unread');
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time notifications via WebSocket
  const { isConnected, sendNotification } = useWebSocketEnhanced({
    onMessage: (message) => {
      if (message.type === 'notification') {
        // Show toast for real-time notifications
        const { data } = message;
        
        // Only show toast if it's not from current user
        if (data.fromUserId !== user?.id) {
          toast({
            title: data.title || 'New Notification',
            description: data.message,
            variant: data.type === 'error' ? 'destructive' : 'default',
          });
          
          // Browser notification if permission granted
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(data.title || 'HealthAI Notification', {
              body: data.message,
              icon: '/favicon.ico',
              tag: `notification-${data.id || Date.now()}`,
              requireInteraction: data.priority === 'urgent'
            });
          }
        }
        
        // Invalidate queries to refresh notifications
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      }
    }
  });

  // Fetch notifications
  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['/api/notifications', filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter === 'unread') params.set('unread', 'true');
      if (filter === 'urgent') params.set('priority', 'urgent');
      
      const response = await fetch(`/api/notifications?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch notifications');
      return response.json();
    },
    enabled: !!user,
    refetchInterval: isConnected ? false : 30000 // Poll if WebSocket is disconnected
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to mark notification as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    }
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to mark all notifications as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      toast({
        title: 'All notifications marked as read',
        description: 'Your notification list has been cleared.',
      });
    }
  });

  // Delete notification
  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete notification');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    }
  });

  // Get notification icon
  const getNotificationIcon = (type: string, priority: string) => {
    const iconClass = `w-5 h-5 ${priority === 'urgent' ? 'text-red-500' : 
      priority === 'high' ? 'text-orange-500' : 
      priority === 'medium' ? 'text-blue-500' : 'text-gray-500'}`;

    switch (type) {
      case 'appointment':
        return <Calendar className={iconClass} />;
      case 'scan':
        return <FileText className={iconClass} />;
      case 'message':
        return <MessageSquare className={iconClass} />;
      case 'success':
        return <CheckCircle className={iconClass} />;
      case 'error':
        return <AlertCircle className={iconClass} />;
      case 'warning':
        return <AlertCircle className={iconClass} />;
      case 'system':
        return <Activity className={iconClass} />;
      default:
        return <Info className={iconClass} />;
    }
  };

  // Get priority color
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'destructive';
      case 'high':
        return 'default';
      case 'medium':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  // Filter notifications
  const filteredNotifications = notifications.filter(notification => {
    switch (filter) {
      case 'unread':
        return !notification.isRead;
      case 'urgent':
        return notification.priority === 'urgent';
      default:
        return true;
    }
  });

  // Unread count
  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (!user) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div className="relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full p-0 flex items-center justify-center text-xs"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </div>
            Notifications
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
              >
                <Check className="w-4 h-4 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1 mt-2">
          {['all', 'unread', 'urgent'].map((filterType) => (
            <Button
              key={filterType}
              size="sm"
              variant={filter === filterType ? 'default' : 'outline'}
              onClick={() => setFilter(filterType as any)}
              className="text-xs"
            >
              {filterType === 'all' && 'All'}
              {filterType === 'unread' && `Unread (${unreadCount})`}
              {filterType === 'urgent' && 'Urgent'}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className={showAll ? "h-96" : "h-64"}>
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading notifications...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No notifications</p>
              <p className="text-xs">You're all caught up!</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 border-l-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                    !notification.isRead ? 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : 'border-l-transparent'
                  } ${
                    notification.priority === 'urgent' ? 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20' : ''
                  }`}
                  onClick={() => {
                    if (!notification.isRead) {
                      markAsReadMutation.mutate(notification.id);
                    }
                    // Handle action URL navigation if needed
                    if (notification.actionUrl) {
                      window.open(notification.actionUrl, '_blank');
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notification.type, notification.priority)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h4 className={`text-sm font-medium ${!notification.isRead ? 'font-semibold' : ''}`}>
                            {notification.title}
                          </h4>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                        </div>
                        
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={getPriorityColor(notification.priority) as any} className="text-xs">
                            {notification.priority}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      {/* Metadata info */}
                      {notification.metadata && (
                        <div className="flex items-center gap-2 mt-2">
                          {notification.metadata.appointmentId && (
                            <Badge variant="outline" className="text-xs">
                              <Calendar className="w-3 h-3 mr-1" />
                              Appointment #{notification.metadata.appointmentId}
                            </Badge>
                          )}
                          {notification.metadata.scanId && (
                            <Badge variant="outline" className="text-xs">
                              <FileText className="w-3 h-3 mr-1" />
                              Scan #{notification.metadata.scanId}
                            </Badge>
                          )}
                          {notification.metadata.messageId && (
                            <Badge variant="outline" className="text-xs">
                              <MessageSquare className="w-3 h-3 mr-1" />
                              Message
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1">
                      {!notification.isRead && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-8 h-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsReadMutation.mutate(notification.id);
                          }}
                          disabled={markAsReadMutation.isPending}
                        >
                          <Check className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-8 h-8 p-0 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotificationMutation.mutate(notification.id);
                        }}
                        disabled={deleteNotificationMutation.isPending}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Notification toast hook for real-time notifications
export function useRealtimeNotifications() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // WebSocket notifications
  useWebSocketEnhanced({
    onMessage: (message) => {
      if (message.type === 'notification' && message.data.targetUserId === user?.id) {
        const { data } = message;
        
        // Show toast
        toast({
          title: data.title || 'New Notification',
          description: data.message,
          variant: data.type === 'error' ? 'destructive' : 'default',
        });

        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(data.title || 'HealthAI Notification', {
            body: data.message,
            icon: '/favicon.ico',
            tag: `notification-${data.id || Date.now()}`,
            requireInteraction: data.priority === 'urgent'
          });
        }

        // Refresh notification queries
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      }
    }
  });

  // Request notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  };

  return {
    requestNotificationPermission,
    hasPermission: 'Notification' in window && Notification.permission === 'granted'
  };
}

// Floating notification button component
export function NotificationButton() {
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['/api/notifications', 'unread'],
    queryFn: async () => {
      const response = await fetch('/api/notifications?unread=true', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch notifications');
      return response.json();
    },
    refetchInterval: 30000
  });

  const unreadCount = notifications.length;

  return (
    <Button variant="outline" size="sm" className="relative">
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full p-0 flex items-center justify-center text-xs"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </Button>
  );
}
