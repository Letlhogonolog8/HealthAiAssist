// COMPREHENSIVE APPLICATION DEBUG FIXES
// This file contains all the fixes needed for the HealthAI application

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ===== 1. REMOVE DUPLICATE COMPONENTS =====
// Delete these duplicate files:
// - patient-portal-debug.tsx (use patient-portal-enhanced-fixed.tsx)
// - doctor-dashboard-fixed.tsx (use doctor-dashboard-clean.tsx)
// - google-ai-scanner.tsx (use google-ai-scanner-fixed.tsx)
// - useWebSocket.ts (use useWebSocketFixed.ts)

// ===== 2. CENTRALIZED DATA FETCHING =====
export const useRealTimeData = (userId: string, userRole: string) => {
  const queryClient = useQueryClient();

  // Real patient data (no mock fallbacks)
  const { data: patientData, isLoading: patientLoading, error: patientError } = useQuery({
    queryKey: [`/api/patient/profile/${userId}`],
    queryFn: async () => {
      const response = await fetch(`/api/patient/profile/${userId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch patient data: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!userId && userRole === 'patient',
    retry: 3,
    retryDelay: 1000,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true
  });

  // Real appointments data
  const { data: appointmentsData, isLoading: appointmentsLoading, error: appointmentsError } = useQuery({
    queryKey: [`/api/appointments/${userId}`],
    queryFn: async () => {
      const response = await fetch(`/api/appointments/${userId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch appointments: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!userId,
    retry: 2,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: true
  });

  // Real scan results data
  const { data: scanResults, isLoading: scansLoading, error: scansError } = useQuery({
    queryKey: [`/api/scans/${userId}`],
    queryFn: async () => {
      const response = await fetch(`/api/scans/${userId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch scan results: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!userId,
    retry: 2,
    staleTime: 1 * 60 * 1000, // 1 minute
    refetchOnWindowFocus: true
  });

  return {
    patientData,
    appointmentsData,
    scanResults,
    isLoading: patientLoading || appointmentsLoading || scansLoading,
    errors: { patientError, appointmentsError, scansError }
  };
};

// ===== 3. IMPROVED COLOR SYSTEM =====
export const colorSystem = {
  // High contrast colors for scan results
  status: {
    normal: 'bg-green-200 text-green-900 border-green-500 font-bold shadow-sm',
    abnormal: 'bg-red-200 text-red-900 border-red-500 font-bold shadow-sm',
    pending: 'bg-yellow-200 text-yellow-900 border-yellow-500 font-bold shadow-sm',
    critical: 'bg-red-300 text-red-950 border-red-600 font-bold shadow-md animate-pulse'
  },
  
  // Card backgrounds for better visibility
  cards: {
    primary: 'bg-white border-2 border-gray-300 shadow-lg',
    secondary: 'bg-gray-50 border-2 border-gray-200 shadow-md',
    accent: 'bg-blue-50 border-2 border-blue-300 shadow-lg'
  },
  
  // Text colors for maximum readability
  text: {
    primary: 'text-gray-900 font-semibold',
    secondary: 'text-gray-800 font-medium',
    accent: 'text-blue-900 font-bold',
    muted: 'text-gray-700 font-medium'
  }
};

// ===== 4. REAL-TIME WEBSOCKET CONNECTION =====
export const useRealTimeUpdates = (userId: string) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${userId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle different types of real-time updates
        switch (data.type) {
          case 'scan_complete':
            queryClient.invalidateQueries({ queryKey: [`/api/scans/${userId}`] });
            break;
          case 'appointment_update':
            queryClient.invalidateQueries({ queryKey: [`/api/appointments/${userId}`] });
            break;
          case 'profile_update':
            queryClient.invalidateQueries({ queryKey: [`/api/patient/profile/${userId}`] });
            break;
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, [userId, queryClient]);

  return { socket, isConnected };
};

// ===== 5. UNIFIED API CLIENT =====
export class APIClient {
  private baseURL = '/api';
  
  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config: RequestInit = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    const response = await fetch(url, config);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${response.statusText}`);
    }
    
    return response.json();
  }

  // Patient endpoints
  async getPatientProfile(userId: string) {
    return this.request(`/patient/profile/${userId}`);
  }

  async updatePatientProfile(userId: string, data: any) {
    return this.request(`/patient/profile/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  // Appointment endpoints
  async getAppointments(userId: string) {
    return this.request(`/appointments/${userId}`);
  }

  async bookAppointment(data: any) {
    return this.request('/appointments/book', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async cancelAppointment(appointmentId: string) {
    return this.request(`/appointments/${appointmentId}/cancel`, {
      method: 'PATCH'
    });
  }

  // Scan endpoints
  async getScanResults(userId: string) {
    return this.request(`/scans/${userId}`);
  }

  async uploadScan(formData: FormData) {
    return fetch(`${this.baseURL}/scans/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    }).then(res => {
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json();
    });
  }
}

export const apiClient = new APIClient();

// ===== 6. ERROR HANDLING SYSTEM =====
export const useErrorHandler = () => {
  const [errors, setErrors] = useState<string[]>([]);

  const handleError = (error: any, context: string) => {
    const errorMessage = error?.message || 'An unexpected error occurred';
    const fullError = `${context}: ${errorMessage}`;
    
    setErrors(prev => [...prev, fullError]);
    console.error(fullError, error);
    
    // Auto-remove error after 5 seconds
    setTimeout(() => {
      setErrors(prev => prev.filter(e => e !== fullError));
    }, 5000);
  };

  const clearErrors = () => setErrors([]);

  return { errors, handleError, clearErrors };
};

// ===== 7. PERFORMANCE OPTIMIZATIONS =====
export const performanceConfig = {
  // Query configurations
  queries: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
    retryDelay: 1000
  },
  
  // Debounce delays
  debounce: {
    search: 300,
    input: 500,
    api: 1000
  },
  
  // Pagination
  pagination: {
    defaultPageSize: 10,
    maxPageSize: 50
  }
};

// ===== 8. VALIDATION SCHEMAS =====
export const validationSchemas = {
  appointment: {
    type: { required: true, minLength: 3 },
    date: { required: true, futureDate: true },
    time: { required: true }
  },
  
  profile: {
    name: { required: true, minLength: 2 },
    email: { required: true, email: true },
    phone: { required: true, phone: true }
  },
  
  scan: {
    file: { required: true, fileType: ['jpg', 'jpeg', 'png', 'dicom'] },
    maxSize: 10 * 1024 * 1024 // 10MB
  }
};

// ===== 9. CLEANUP INSTRUCTIONS =====
/*
FILES TO DELETE (duplicates):
1. /components/patient-portal-debug.tsx
2. /components/doctor-dashboard-fixed.tsx  
3. /components/chatbot-improvements.tsx
4. /components/improved-chatbot.tsx
5. /hooks/useWebSocket.ts
6. /hooks/useNotifications.ts

FILES TO KEEP AND USE:
1. /components/patient-portal-enhanced-fixed.tsx
2. /components/doctor-dashboard-clean.tsx
3. /components/floating-chatbot.tsx
4. /hooks/useWebSocketFixed.ts
5. /hooks/useWebSocketRealTime.ts

MOCK DATA TO REMOVE:
- Remove all getMockScans() functions
- Remove hardcoded patient data
- Remove fallback mock responses in API calls
- Use only real API endpoints with proper error handling
*/

export default {
  useRealTimeData,
  useRealTimeUpdates,
  useErrorHandler,
  colorSystem,
  apiClient,
  performanceConfig,
  validationSchemas
};