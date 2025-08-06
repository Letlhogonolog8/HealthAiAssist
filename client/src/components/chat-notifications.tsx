import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface ChatNotification {
  id: number;
  senderId: number;
  senderName: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface ChatNotificationsProps {
  user: any;
  onChatOpen?: () => void;
}

export default function ChatNotifications({ user, onChatOpen }: ChatNotificationsProps) {
  const [notifications, setNotifications] = useState<ChatNotification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // Poll for real notifications from API
  const { data: apiNotifications } = useQuery({
    queryKey: ['/api/chat/notifications', user.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/chat/notifications?userId=${user.id}`, {
          credentials: 'include'
        });
        if (!response.ok) return [];
        return response.json();
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
        return [];
      }
    },
    refetchInterval: 10000, // Poll every 10 seconds to reduce server load
    enabled: !!(user?.id && (user.role === 'doctor' || user.role === 'radiologist'))
  });

  // Update notifications when API data changes
  useEffect(() => {
    if (apiNotifications) {
      setNotifications(apiNotifications);
    }
  }, [apiNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = async (notificationId: number) => {
    try {
      await fetch('/api/chat/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notificationId, userId: user.id })
      });
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const clearAll = () => {
    setNotifications([]);
    setShowDropdown(false);
  };

  const handleNotificationClick = (notification: ChatNotification) => {
    markAsRead(notification.id);
    setShowDropdown(false);
    if (onChatOpen) {
      onChatOpen();
    } else {
      window.location.href = '/chat';
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowDropdown(!showDropdown)}
        className="text-slate-400 hover:text-white relative"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-2 -right-2 bg-red-500 text-white min-w-5 h-5 rounded-full flex items-center justify-center text-xs">
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </Button>

      {showDropdown && (
        <Card className="absolute right-0 top-12 w-80 bg-slate-800 border-slate-600 shadow-xl z-50">
          <CardContent className="p-0">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center">
                <MessageSquare className="w-4 h-4 mr-2" />
                Chat Messages
              </h3>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Clear All
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDropdown(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-slate-400">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No new messages</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`p-3 hover:bg-slate-700 cursor-pointer border-l-4 ${
                        notification.read 
                          ? 'border-transparent bg-slate-800' 
                          : 'border-blue-500 bg-slate-750'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${
                            notification.read ? 'text-slate-300' : 'text-white'
                          }`}>
                            {notification.senderName}
                          </p>
                          <p className={`text-xs mt-1 ${
                            notification.read ? 'text-slate-400' : 'text-slate-200'
                          }`}>
                            {notification.message}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {new Date(notification.timestamp).toLocaleTimeString([], { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-1"></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-3 border-t border-slate-700">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDropdown(false);
                    if (onChatOpen) {
                      onChatOpen();
                    } else {
                      window.location.href = '/chat';
                    }
                  }}
                  className="w-full text-slate-300 border-slate-600 hover:bg-slate-700"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Open Chat
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}