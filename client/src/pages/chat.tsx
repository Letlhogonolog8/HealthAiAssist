import { useState, useEffect } from 'react';
import RealTimeChat from '@/components/real-time-chat';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function ChatPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          setError('Please log in to access chat');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setError('Failed to authenticate. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-white">Loading chat...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center text-white space-y-4">
          <p>{error || 'Please log in to access chat'}</p>
          <Button 
            onClick={() => window.location.href = '/'}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="p-4 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              try {
                window.history.back();
              } catch {
                window.location.href = '/';
              }
            }}
            className="text-slate-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-white">Medical Chat</h1>
        </div>
      </div>
      <div className="h-[calc(100vh-80px)]">
        {user ? (
          <RealTimeChat 
            currentUser={{
              id: user.id || 0,
              name: user.fullName || user.username || 'User',
              role: user.role || 'patient'
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white">
            <p>Loading user data...</p>
          </div>
        )}
      </div>
    </div>
  );
}