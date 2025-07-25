import { createContext, useContext, useEffect, useRef, useState } from 'react';

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
    // Skip WebSocket in environments where it's not available
    if (typeof WebSocket === 'undefined' || !user) {
      return;
    }

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      // Validate URL structure
      if (!window.location.host || window.location.host.includes('undefined')) {
        console.log('Invalid host for WebSocket connection, skipping');
        return;
      }

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        
        // Send user connection info
        wsRef.current?.send(JSON.stringify({
          type: 'user_connected',
          user: user
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'online_users':
              setOnlineUsers(message.users || []);
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