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
  const intentionallyClosedRef = useRef(false);
  const queryClient = useQueryClient();

  const {
    reconnectInterval = 3000,
    maxReconnectAttempts = 5
  } = options;

  // Callers pass inline arrow functions, so options.onMessage is a new value on
  // every render. Closing over them directly would change connect()'s identity
  // every render, and the mount effect below would then tear the socket down and
  // open a new one each time. This ref holds the latest handlers without being a
  // dependency of anything.
  const handlersRef = useRef(options);
  handlersRef.current = options;

  const connect = useCallback(() => {
    try {
      // Same origin as the page, always.
      //
      // The previous version rebuilt the authority by hand and defaulted the port
      // to 5000 whenever window.location.port was empty. In production the app is
      // served over 443, where the port IS empty, so it dialled
      // wss://example.com:5000/ws and never connected. In Vite dev the same code
      // jumped from 5173 straight to 5000, bypassing the '/ws' proxy the dev
      // server already provides. window.location.host carries the port when there
      // is one and omits it when there is not, which is correct in both.
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
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
        handlersRef.current.onOpen?.(event);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          // Handle real-time data updates
          handleRealTimeUpdate(message);

          handlersRef.current.onMessage?.(message);
        } catch (parseError) {
          console.error('Failed to parse WebSocket message:', parseError);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setConnectionState('disconnected');

        handlersRef.current.onClose?.(event);

        // Reconnect unless we closed it ourselves, or the server refused us.
        // 1008 and 1011 are policy/server failures: retrying those just loops.
        // An unauthenticated upgrade is rejected with 401 before the socket ever
        // opens, which is why the attempt counter is capped rather than infinite.
        const fatal = event.code === 1008 || event.code === 1011;
        if (
          !intentionallyClosedRef.current &&
          !fatal &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          scheduleReconnect();
        }
      };

      wsRef.current.onerror = (event) => {
        setError('WebSocket connection error');
        setConnectionState('error');
        setIsConnected(false);
        handlersRef.current.onError?.(event);
      };

    } catch (connectionError) {
      setError('Failed to establish WebSocket connection');
      setConnectionState('error');
      setIsConnected(false);
      console.error('WebSocket connection error:', connectionError);
    }
  }, [maxReconnectAttempts]);

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

    // Exponential backoff, capped. A flat 3s retry against a server that is down
    // is one connection attempt every three seconds per open tab, forever.
    const delay = Math.min(reconnectInterval * 2 ** reconnectAttemptsRef.current, 30000);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, delay);
  }, [connect, reconnectInterval]);

  const disconnect = useCallback(() => {
    intentionallyClosedRef.current = true;
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
    // This effect used to contain nothing but its cleanup, under a comment saying
    // the socket was "disabled to prevent connection errors". Everything built on
    // this hook — the doctor portal, the real-time chat, the radiologist
    // view — therefore reported isConnected: false forever and received no
    // updates at all, while still rendering "live" indicators. The connection
    // errors it was avoiding came from the URL bug fixed above and from a server
    // that killed itself on the first upgrade; both are fixed, so it connects.
    intentionallyClosedRef.current = false;
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