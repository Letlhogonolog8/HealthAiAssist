import { useState, useEffect } from 'react';

export interface User {
  id: number;
  username: string;
  role: string;
  fullName: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else if (response.status !== 401) {
          // Only set error if it's not just unauthorized
          setError('Failed to fetch user data');
        }
      } catch (err) {
        setError('Network error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { 
        method: 'POST', 
        credentials: 'include' 
      });
      setUser(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return {
    user,
    isLoading,
    error,
    logout,
    isAuthenticated: !!user
  };
}
