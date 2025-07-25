import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (error: Event) => void;
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocketRealTime(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const queryClient = useQueryClient();

  const {
    onMessage,
    onError,
    onOpen,
    onClose,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5
  } = options;

  const connect = useCallback(() => {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      if (wsRef.current?.readyState === WebSocket.CONNECTING || wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      setConnectionState('connecting');
      setError(null);
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = (event) => {
        setIsConnected(true);
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;
        onOpen?.(event);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);
          
          // Handle real-time data updates
          handleRealTimeUpdate(message);
          
          onMessage?.(message);
        } catch (parseError) {
          console.error('Failed to parse WebSocket message:', parseError);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setConnectionState('disconnected');
        
        onClose?.(event);
        
        // Attempt reconnection if not closed intentionally
        if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          scheduleReconnect();
        }
      };

      wsRef.current.onerror = (event) => {
        setError('WebSocket connection error');
        setConnectionState('error');
        onError?.(event);
      };

    } catch (connectionError) {
      setError('Failed to establish WebSocket connection');
      setConnectionState('error');
      console.error('WebSocket connection error:', connectionError);
    }
  }, [onMessage, onError, onOpen, onClose, maxReconnectAttempts]);

  const handleRealTimeUpdate = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'appointment_update':
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments'] });
        queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
        break;
      case 'scan_completed':
        queryClient.invalidateQueries({ queryKey: ['/api/patient/scans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/reports'] });
        queryClient.invalidateQueries({ queryKey: ['/api/radiologist/scans'] });
        break;
      case 'patient_activity':
        queryClient.invalidateQueries({ queryKey: ['/api/patient/activities'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/patients'] });
        break;
      case 'notification':
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/notifications'] });
        queryClient.invalidateQueries({ queryKey: ['/api/patient/notifications'] });
        break;
      case 'stats_update':
        queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/radiologist/stats'] });
        break;
      case 'user_activity':
        queryClient.invalidateQueries({ queryKey: ['/api/admin/activities'] });
        break;
      default:
        // Handle unknown message types gracefully
        break;
    }
  }, [queryClient]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, reconnectInterval);
  }, [connect, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Intentional disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setConnectionState('disconnected');
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    connectionState,
    lastMessage,
    error,
    sendMessage,
    connect,
    disconnect
  };
}