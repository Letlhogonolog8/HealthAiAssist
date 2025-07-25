import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ReactNode, createContext, useContext, useCallback, useMemo } from 'react';

// Enhanced query client with optimized defaults
const createOptimizedQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (was cacheTime)
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
    mutations: {
      retry: 1,
      onError: (error) => {
        console.error('Mutation error:', error);
      }
    }
  }
});

// Context for query client
const OptimizedQueryContext = createContext<QueryClient | null>(null);

interface OptimizedQueryProviderProps {
  children: ReactNode;
}

export function OptimizedQueryProvider({ children }: OptimizedQueryProviderProps) {
  const queryClient = useMemo(() => createOptimizedQueryClient(), []);

  return (
    <OptimizedQueryContext.Provider value={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </OptimizedQueryContext.Provider>
  );
}

// Enhanced hooks with proper error handling and type safety
export function useOptimizedQuery<T>(
  queryKey: string | string[],
  endpoint?: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    select?: (data: any) => T;
    onError?: (error: Error) => void;
  }
) {
  const finalEndpoint = endpoint || (Array.isArray(queryKey) ? queryKey.join('/') : queryKey);
  
  return useQuery({
    queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
    queryFn: async (): Promise<T> => {
      const response = await fetch(finalEndpoint.startsWith('/') ? finalEndpoint : `/${finalEndpoint}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      return response.json();
    },
    staleTime: options?.refetchInterval ? 0 : 5 * 60 * 1000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
    select: options?.select
  });
}

export function useOptimizedMutation<TData, TVariables>(
  endpoint: string,
  options?: {
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
    invalidateQueries?: string[][];
  }
) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (variables: TVariables): Promise<TData> => {
      const response = await fetch(endpoint, {
        method: options?.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(variables),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate specified queries
      if (options?.invalidateQueries) {
        options.invalidateQueries.forEach(queryKey => {
          queryClient.invalidateQueries({ queryKey });
        });
      }
      
      options?.onSuccess?.(data, variables);
    },
    onError: options?.onError
  });
}

// Utility for batch invalidation
export function useBatchInvalidation() {
  const queryClient = useQueryClient();
  
  return useCallback((queryKeys: string[][]) => {
    queryKeys.forEach(key => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [queryClient]);
}

// Prefetch hook for performance
export function usePrefetch() {
  const queryClient = useQueryClient();
  
  return useCallback(async (queryKey: string[], endpoint: string) => {
    await queryClient.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error('Prefetch failed');
        return response.json();
      },
      staleTime: 5 * 60 * 1000
    });
  }, [queryClient]);
}

// Default export for compatibility
export default OptimizedQueryProvider;