import { useEffect, useRef, useState } from 'react';

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
      // Skip WebSocket in deployment if not available
      if (typeof WebSocket === 'undefined' || !user) {
        return;
      }

      // Validate host before constructing URL
      if (!window.location.host || window.location.host.includes('undefined') || window.location.host.includes('localhost:undefined')) {
        return;
      }

      // Replace localhost with server IP for mobile access
      let host = window.location.host;
      const serverIp = import.meta.env.VITE_SERVER_IP || '192.168.0.113';
      if (host.includes('localhost')) {
        host = host.replace('localhost', serverIp); // Replace with your server IP
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${host}/ws`;
      
      // Validate URL before creating WebSocket
      try {
        new URL(wsUrl);
      } catch (urlError) {
        console.error('Invalid WebSocket URL:', wsUrl);
        return;
      }
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
        metricsRef.current.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        
        // Send user connection info
        if (user) {
          const msg = {
            type: 'user_connected',
            user: user
          };
          wsRef.current?.send(JSON.stringify(msg));
          metricsRef.current.messagesSent++;
        }

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN && user) {
            const heartbeatMsg = {
              type: 'heartbeat',
              userId: user.id
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
            case 'new_activity':
              onActivity?.(message.activity);
              break;
              
            case 'scan_update':
              onScanUpdate?.(message.scan);
              break;
              
            case 'user_status_update':
              onUserStatusUpdate?.(message.user);
              break;
              
            case 'online_users':
              setOnlineUsers(message.users);
              onOnlineUsers?.(message.users);
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
