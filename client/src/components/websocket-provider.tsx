import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getWebSocketUrl, isWebSocketSupported } from '@/lib/websocket-utils';

interface WebSocketContextType {
  isConnected: boolean;
  sendMessage: (message: any) => void;
  onlineUsers: any[];
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
  sendMessage: () => {},
  onlineUsers: []
});

export const useWebSocketContext = () => useContext(WebSocketContext);

interface WebSocketProviderProps {
  children: React.ReactNode;
  user?: any;
}

export function WebSocketProvider({ children, user }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = () => {
    // Skip WebSocket if not supported or no user
    if (!isWebSocketSupported() || !user) {
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        
        // Send user authentication info
        wsRef.current?.send(JSON.stringify({
          type: 'user_authenticate',
          data: {
            id: user.id,
            username: user.username,
            role: user.role,
            fullName: user.fullName,
            email: user.email
          }
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'online_users':
              setOnlineUsers(message.data?.users || []);
              break;
            case 'authentication_success':
              console.log('WebSocket authentication successful');
              break;
            case 'connection_established':
              console.log('WebSocket connection established');
              break;
            case 'error':
              console.error('WebSocket error:', message.data?.message);
              break;
            default:
              // Handle other message types as needed
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        
        // Attempt to reconnect after 5 seconds if user is still logged in
        if (user) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 5000);
        }
      };

      wsRef.current.onerror = () => {
        setIsConnected(false);
      };

    } catch (error) {
      console.log('WebSocket connection not available in this environment');
      setIsConnected(false);
    }
  };

  const sendMessage = (message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  useEffect(() => {
    if (user) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [user]);

  return (
    <WebSocketContext.Provider value={{ isConnected, sendMessage, onlineUsers }}>
      {children}
    </WebSocketContext.Provider>
  );
}