import { useEffect, useRef, useState } from 'react';
import { getWebSocketUrl, isWebSocketSupported } from '@/lib/websocket-utils';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface UseWebSocketProps {
  user?: {
    id: number;
    username: string;
    role: string;
    fullName: string;
    email: string;
  };
  onActivity?: (activity: any) => void;
  onScanUpdate?: (scan: any) => void;
  onUserStatusUpdate?: (user: any) => void;
  onOnlineUsers?: (users: any[]) => void;
}

export function useWebSocket({
  user,
  onActivity,
  onScanUpdate,
  onUserStatusUpdate,
  onOnlineUsers
}: UseWebSocketProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const metricsRef = useRef({
    messagesSent: 0,
    messagesReceived: 0,
    reconnectAttempts: 0,
  });

  const connect = () => {
    try {
      // Skip WebSocket if not supported or no user
      if (!isWebSocketSupported() || !user) {
        return;
      }

      const wsUrl = getWebSocketUrl();
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
        metricsRef.current.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        
        // Send user authentication info
        if (user) {
          const msg = {
            type: 'user_authenticate',
            data: {
              id: user.id,
              username: user.username,
              role: user.role,
              fullName: user.fullName,
              email: user.email
            }
          };
          wsRef.current?.send(JSON.stringify(msg));
          metricsRef.current.messagesSent++;
        }

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN && user) {
            const heartbeatMsg = {
              type: 'heartbeat',
              data: {
                userId: user.id
              }
            };
            wsRef.current.send(JSON.stringify(heartbeatMsg));
            metricsRef.current.messagesSent++;
          }
        }, 30000); // Send heartbeat every 30 seconds
      };

      wsRef.current.onmessage = (event) => {
        try {
          metricsRef.current.messagesReceived++;
          const message: WebSocketMessage = JSON.parse(event.data);
          
          switch (message.type) {
            case 'activity_update':
              onActivity?.(message.data);
              break;
              
            case 'scan_update':
              onScanUpdate?.(message.data);
              break;
              
            case 'user_status_update':
              onUserStatusUpdate?.(message.data?.user);
              break;
              
            case 'online_users':
              const users = message.data?.users || [];
              setOnlineUsers(users);
              onOnlineUsers?.(users);
              break;
              
            case 'authentication_success':
              console.log('WebSocket authentication successful');
              break;
              
            case 'connection_established':
              console.log('WebSocket connection established');
              break;
              
            case 'heartbeat':
            case 'heartbeat_ack':
              // Handle heartbeat responses
              break;
              
            case 'error':
              console.error('WebSocket error:', message.data?.message);
              break;
              
            default:
              console.log('Unknown WebSocket message type:', message.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        console.log(`WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
        
        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
        
        // Attempt to reconnect with exponential backoff capped at 30 seconds
        if (user) {
          const attempts = metricsRef.current.reconnectAttempts;
          const delay = Math.min(30000, 1000 * 2 ** attempts);
          metricsRef.current.reconnectAttempts++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
          console.log(`Reconnecting WebSocket in ${delay}ms (attempt ${metricsRef.current.reconnectAttempts})`);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Close socket on error to trigger reconnect logic
        wsRef.current?.close();
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      // Gracefully handle WebSocket failure in deployment
      setIsConnected(false);
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setOnlineUsers([]);
  };

  const sendMessage = (message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      metricsRef.current.messagesSent++;
    }
  };

  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [user?.id]);

  return {
    isConnected,
    onlineUsers,
    sendMessage,
    connect,
    disconnect,
    metrics: metricsRef.current
  };
}
