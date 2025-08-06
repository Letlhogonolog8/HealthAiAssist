import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from './useUser';

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

interface ConnectionStats {
  connections: number;
  messages: number;
  onlineUsers: number;
  roles: { [key: string]: number };
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (error: Event) => void;
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  enableHeartbeat?: boolean;
}

export function useWebSocketEnhanced(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const { user } = useUser();
  const queryClient = useQueryClient();

  const {
    onMessage,
    onError,
    onOpen,
    onClose,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    enableHeartbeat = true
  } = options;

  // Enhanced connection with better error handling
  const connect = useCallback(() => {
    try {
      if (wsRef.current?.readyState === WebSocket.CONNECTING || wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      // Get the proper host and port for WebSocket connection
      let host = window.location.hostname;
      let port = window.location.port;
      
      // Use backend port 5000 for WebSocket in development
      if (host === 'localhost' && port === '5173') {
        port = '5000';
      }
      
      // Validate host and port
      if (!host || port === 'undefined' || window.location.host.includes('undefined')) {
        console.warn('Invalid host or port for WebSocket connection');
        return;
      }
      
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${host}:${port}/ws`;
      
      setConnectionState('connecting');
      setError(null);
      
      wsRef.current = new WebSocket(wsUrl);

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
          setError('Connection timeout');
          setConnectionState('error');
        }
      }, 10000); // 10 second timeout

      wsRef.current.onopen = (event) => {
        clearTimeout(connectionTimeout);
        setIsConnected(true);
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;
        
        // Authenticate user if logged in
        if (user) {
          authenticateUser(user);
        }
        
        // Start heartbeat
        if (enableHeartbeat) {
          startHeartbeat();
        }
        
        console.log('🔌 WebSocket connected successfully');
        onOpen?.(event);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);
          
          // Handle different message types
          handleRealTimeMessage(message);
          
          onMessage?.(message);
        } catch (parseError) {
          console.error('Failed to parse WebSocket message:', parseError);
        }
      };

      wsRef.current.onclose = (event) => {
        clearTimeout(connectionTimeout);
        setIsConnected(false);
        setConnectionState('disconnected');
        stopHeartbeat();
        
        console.log(`🔌 WebSocket disconnected: ${event.code} - ${event.reason}`);
        onClose?.(event);
        
        // Attempt reconnection for unexpected closures
        if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          scheduleReconnect();
        }
      };

      wsRef.current.onerror = (event) => {
        clearTimeout(connectionTimeout);
        setError('WebSocket connection error');
        setConnectionState('error');
        setIsConnected(false);
        stopHeartbeat();
        
        console.error('🚨 WebSocket error:', event);
        onError?.(event);
      };

    } catch (connectionError) {
      setError('Failed to establish WebSocket connection');
      setConnectionState('error');
      setIsConnected(false);
      console.error('WebSocket connection error:', connectionError);
    }
  }, [user, onMessage, onError, onOpen, onClose, maxReconnectAttempts, enableHeartbeat]);

  // Authenticate user with the WebSocket server
  const authenticateUser = useCallback((userData: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendMessage({
        type: 'user_authenticate',
        data: {
          id: userData.id,
          username: userData.username,
          role: userData.role,
          fullName: userData.fullName
        }
      });
    }
  }, []);

  // Enhanced message handling
  const handleRealTimeMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'connection_established':
        console.log('🔌 Connection established:', message.data);
        break;
      
      case 'authentication_success':
        console.log('👤 User authenticated:', message.data);
        break;
      
      case 'online_users':
        setOnlineUsers(message.data.users || []);
        break;
      
      case 'user_status_update':
        const updatedUser = message.data.user;
        setOnlineUsers(prev => {
          const filtered = prev.filter(u => u.id !== updatedUser.id);
          return updatedUser.status === 'online' 
            ? [...filtered, updatedUser]
            : filtered;
        });
        break;
      
      case 'new_chat_message':
        queryClient.invalidateQueries({ queryKey: ['/api/chat/messages'] });
        // Show notification for new messages
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('New Message', {
            body: `${message.data.senderName}: ${message.data.message}`,
            icon: '/favicon.ico'
          });
        }
        break;
      
      case 'notification':
        // Handle real-time notifications
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(message.data.title || 'HealthAI Notification', {
            body: message.data.message,
            icon: '/favicon.ico'
          });
        }
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
        break;
      
      case 'activity_update':
        queryClient.invalidateQueries({ queryKey: ['/api/patient/activities'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/activities'] });
        break;
      
      case 'scan_update':
        queryClient.invalidateQueries({ queryKey: ['/api/scans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/patient/scans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/radiologist/pending-reviews'] });
        break;
      
      case 'appointment_update':
        queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments'] });
        queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
        break;
      
      case 'stats_update':
        queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/radiologist/stats'] });
        break;
      
      case 'typing_indicator':
        // Handle typing indicators (could update UI state)
        break;
      
      case 'heartbeat':
        // Respond to heartbeat
        sendMessage({ type: 'heartbeat', data: { userId: user?.id } });
        break;
      
      case 'heartbeat_ack':
        // Heartbeat acknowledged
        break;
      
      case 'error':
        console.error('WebSocket server error:', message.data.message);
        setError(message.data.message);
        break;
      
      default:
        console.log('🤷 Unknown WebSocket message type:', message.type);
    }
  }, [queryClient, user]);

  // Heartbeat management
  const startHeartbeat = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearInterval(heartbeatTimeoutRef.current);
    }
    
    heartbeatTimeoutRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && user) {
        sendMessage({
          type: 'heartbeat',
          data: { userId: user.id }
        });
      }
    }, 30000); // Every 30 seconds
  }, [user]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearInterval(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  // Reconnection logic
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const delay = Math.min(reconnectInterval * Math.pow(2, reconnectAttemptsRef.current), 30000);
    console.log(`🔄 Scheduling reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, delay);
  }, [connect, reconnectInterval]);

  // Send message with validation
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          ...message,
          timestamp: new Date().toISOString()
        }));
        return true;
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
        return false;
      }
    }
    console.warn('WebSocket not connected, message not sent:', message.type);
    return false;
  }, []);

  // Disconnect with cleanup
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    stopHeartbeat();
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Intentional disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setConnectionState('disconnected');
    setOnlineUsers([]);
  }, [stopHeartbeat]);

  // Chat-specific functions
  const sendChatMessage = useCallback((targetUserId: number, message: string, messageType: string = 'text') => {
    return sendMessage({
      type: 'chat_message',
      data: {
        targetUserId,
        message,
        messageType,
        senderId: user?.id,
        senderName: user?.fullName
      }
    });
  }, [sendMessage, user]);

  const sendTypingIndicator = useCallback((targetUserId: number, isTyping: boolean) => {
    return sendMessage({
      type: 'typing_indicator',
      data: {
        targetUserId,
        isTyping,
        userId: user?.id,
        userName: user?.fullName
      }
    });
  }, [sendMessage, user]);

  // Notification functions
  const sendNotification = useCallback((targetUserId: number, notification: any) => {
    return sendMessage({
      type: 'notification',
      data: {
        ...notification,
        targetUserId,
        fromUserId: user?.id
      }
    });
  }, [sendMessage, user]);

  const broadcastToRole = useCallback((role: string, notification: any) => {
    return sendMessage({
      type: 'notification',
      data: {
        ...notification,
        targetRole: role,
        fromUserId: user?.id
      }
    });
  }, [sendMessage, user]);

  // Auto-connect when user is available
  useEffect(() => {
    if (user && connectionState === 'disconnected') {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [user, connect, disconnect, connectionState]);

  // Re-authenticate when user changes
  useEffect(() => {
    if (user && isConnected) {
      authenticateUser(user);
    }
  }, [user, isConnected, authenticateUser]);

  return {
    // Connection state
    isConnected,
    connectionState,
    error,
    
    // Data
    lastMessage,
    onlineUsers,
    connectionStats,
    
    // Actions
    connect,
    disconnect,
    sendMessage,
    
    // Chat functions
    sendChatMessage,
    sendTypingIndicator,
    
    // Notification functions
    sendNotification,
    broadcastToRole,
    
    // Utility
    reconnectAttempts: reconnectAttemptsRef.current
  };
}

// Hook for managing WebSocket notifications
export function useWebSocketNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  
  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);
  
  const requestPermission = useCallback(async () => {
    if ('Notification' in window && permission === 'default') {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }
    return permission;
  }, [permission]);
  
  return {
    permission,
    requestPermission,
    isSupported: 'Notification' in window
  };
}
