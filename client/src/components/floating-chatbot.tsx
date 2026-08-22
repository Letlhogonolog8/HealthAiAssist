import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageCircle, X, Send, Bot, User, Minimize2, Maximize2, Loader2,
  Paperclip, Mic, MicOff, FileText, Image, AlertTriangle, Heart,
  Calendar, Phone, Video, Stethoscope, Camera, Search, BookOpen,
  Clock, Pill, Zap, Volume2, Play, Pause, Upload, Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';

interface AppointmentSlot {
  id: string;
  date: string;
  time: string;
  available: boolean;
}

interface Doctor {
  id?: string;
  name: string;
  specialization: string;
}

interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  suggestions?: string[];
  actions?: Array<{
    type: string;
    label: string;
    data?: any;
    urgency?: 'low' | 'medium' | 'high' | 'urgent';
    icon?: string;
  }>;
  attachments?: Array<{
    type: 'image' | 'document' | 'chart' | 'report';
    url: string;
    title: string;
    preview?: string;
  }>;
  quickReplies?: string[];
  isEmergency?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'concerned';
}

interface FloatingChatbotProps {
  user?: any;
  onActionClick?: (action: { type: string; data?: any }) => void;
}

export default function FloatingChatbot({ user, onActionClick }: FloatingChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      content: `👋 Hello${user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}! I'm your HAI Assistant.\n\nI'm here to help you with:\n• Medical appointments & scheduling\n• Health information & guidance\n• Scan results & reports\n• Emergency assistance\n\nWhat can I help you with today?`,
      sender: 'assistant',
      timestamp: new Date(),
      suggestions: [
        "Schedule an appointment",
        "Check my symptoms",
        "View test results",
        "Emergency help"
      ]
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState('');
  
  // Ensure input box is focused when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSeen, setLastSeen] = useState(new Date());
  const [isOnline, setIsOnline] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  // Use single state for quick actions toggle
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [currentVoiceMessage, setCurrentVoiceMessage] = useState<string | null>(null);
  const [healthReminders, setHealthReminders] = useState<any[]>([]);
  const [showScheduler, setShowScheduler] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<AppointmentSlot[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [realTimeMessages, setRealTimeMessages] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const { toast } = useToast();

  // The status dot used to be driven by `Math.random() > 0.1` on a 30-second
  // timer, so the assistant appeared to go offline one cycle in ten regardless
  // of whether anything was wrong, and appeared online when the API was down.
  // It reflects reachability now: a failed send flips it, a successful one
  // restores it.

  // Play notification sound for new messages
  const playNotificationSound = () => {
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBDWH0PXIcisF');
      audio.volume = 0.2;
      audio.preload = 'auto';
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Silently handle play interruption
        });
      }
    } catch (error) {
      // Audio not supported, ignore
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      content: content.trim(),
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentMessage('');
    setIsTyping(true);

    try {
      const response = await fetch('/api/chatbot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          messages: [...messages, userMessage].map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.content
          })),
          userId: user?.id 
        })
      });

      if (!response.ok) throw new Error('Failed to get response');
      
      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: data.message,
        sender: 'assistant',
        timestamp: new Date(),
        suggestions: data.suggestions,
        actions: data.actions
      };

      setMessages(prev => [...prev, assistantMessage]);
      setIsOnline(true);

      if (!isOpen) {
        setUnreadCount(prev => prev + 1);
        // Only play sound if chat is closed and user interaction has occurred
        if (document.hasFocus()) {
          playNotificationSound();
        }
      }
      setLastSeen(new Date());
    } catch (error) {
      console.error('Chat error:', error);
      setIsOnline(false);
      toast({
        title: "Connection Error",
        description: "Unable to reach AI Assistant. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const handleActionClick = (action: { type: string; label: string; data?: any }) => {
    // Handle appointment scheduling with redirect
    if (action.type === 'schedule_appointment') {
      if (action.data?.redirect) {
        // Redirect to appointments page
        window.location.href = action.data.redirect;
        return;
      }
      
      const doctorType = action.data?.doctorType || 'general';
      fetchAvailableSlots(doctorType);
      setShowScheduler(true);
      
      const schedulingMessage: ChatMessage = {
        id: Date.now().toString(),
        content: `📅 Let me check available appointment slots for you...`,
        sender: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, schedulingMessage]);
      return;
    }
    
    // Open the messages surface, where the real chat lives.
    if (action.type === 'open_messages') {
      window.location.href = '/chat';
      return;
    }

    // Handle real-time chat
    if (action.type === 'start_chat') {
      // Was `|| 'demo'`, which fed a sentinel id into the lookup so the button
      // always landed in the demo-chat branch.
      if (!action.data?.doctorId) {
        window.location.href = '/chat';
        return;
      }
      startRealTimeChat(String(action.data.doctorId));
      return;
    }
    
    // Handle video call actions
    if (action.type === 'video_join') {
      if (action.data?.roomUrl) {
        window.open(action.data.roomUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
        toast({
          title: "Video Call Joined",
          description: "Video consultation opened in new window",
        });
        
        const joinMessage: ChatMessage = {
          id: Date.now().toString(),
          content: "📹 You've joined the video consultation! The call is now active in a new window.",
          sender: 'assistant',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, joinMessage]);
      }
      return;
    }
    
    if (action.type === 'video_cancel') {
      setIsVideoCallActive(false);
      toast({
        title: "Video Call Cancelled",
        description: "Video consultation has been cancelled",
      });
      
      const cancelMessage: ChatMessage = {
        id: Date.now().toString(),
        content: "🚫 Video consultation cancelled. You can start a new call anytime by clicking the video button.",
        sender: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, cancelMessage]);
      return;
    }
    
    if (onActionClick) {
      onActionClick(action);
    }
    
    // Send confirmation message for other actions
    const confirmMessage = `I'll help you with: ${action.label}`;
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      content: confirmMessage,
      sender: 'assistant',
      timestamp: new Date()
    }]);
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setIsMinimized(false);
    }
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  const toggleQuickActions = () => {
    setShowQuickActions(prev => !prev);
  };

  // 🎤 Voice Recording Functions
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const audioChunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        await processVoiceMessage(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      
      toast({
        title: "Recording Started",
        description: "Speak your message now...",
      });
    } catch (error) {
      toast({
        title: "Microphone Error",
        description: "Unable to access microphone. Please check permissions.",
        variant: "destructive"
      });
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processVoiceMessage = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice-message.wav');
      formData.append('userId', user?.id || '');

      const response = await fetch('/api/chatbot/voice-to-text', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        sendMessage(data.text);
      } else {
        toast({
          title: "Voice Processing Error",
          description: "Unable to process voice message. Try typing instead.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Voice processing error:', error);
    }
  };

  // 📎 File Upload Functions
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload files smaller than 10MB.",
        variant: "destructive"
      });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', user?.id || '');

    try {
      setIsTyping(true);
      
      // Add file upload message
      const fileMessage: ChatMessage = {
        id: Date.now().toString(),
        content: `📎 Uploaded: ${file.name}`,
        sender: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, fileMessage]);

      const response = await fetch('/api/chatbot/analyze-file', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          content: data.analysis,
          sender: 'assistant',
          timestamp: new Date(),
          suggestions: data.suggestions,
          actions: data.actions
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error: any) {
      toast({
        title: "Upload Error",
        description: error?.message || "Unable to process file. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsTyping(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 🚨 Emergency Detection
  const detectEmergencyKeywords = (message: string): boolean => {
    const emergencyKeywords = [
      'emergency', 'urgent', 'help', 'pain', 'chest pain', 'difficulty breathing',
      'bleeding', 'unconscious', 'heart attack', 'stroke', 'severe', 'critical'
    ];
    return emergencyKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  };

  const handleEmergencyAlert = () => {
    setEmergencyMode(true);
    toast({
      title: "🚨 Emergency Alert Activated",
      description: "Connecting you with emergency services...",
      variant: "destructive"
    });
    
    const emergencyMessage: ChatMessage = {
      id: Date.now().toString(),
      content: "🚨 EMERGENCY: I need immediate medical assistance!",
      sender: 'user',
      timestamp: new Date(),
      isEmergency: true
    };
    
    setMessages(prev => [...prev, emergencyMessage]);
    
    // Auto-response for emergency
    setTimeout(() => {
      const responseMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: "🚨 Emergency alert received! I'm immediately connecting you with:\n\n• Emergency Medical Services: 911\n• Hospital Emergency Department\n• Your primary physician\n\nPlease stay calm. Help is on the way.",
        sender: 'assistant',
        timestamp: new Date(),
        isEmergency: true,
        actions: [
          { type: 'emergency_call', label: 'Call 911 Now', urgency: 'urgent', icon: 'phone' },
          { type: 'emergency_location', label: 'Share Location', urgency: 'urgent', icon: 'map-pin' }
        ]
      };
      setMessages(prev => [...prev, responseMessage]);
    }, 1000);
  };

  // 📹 Video Call Functions
  const startVideoCall = async () => {
    setIsVideoCallActive(true);
    toast({
      title: "Video Call Starting",
      description: "Connecting with available medical professional...",
    });

    try {
      // Request video consultation from backend
      const response = await fetch('/api/video/request-consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          patientId: user?.id,
          urgency: emergencyMode ? 'urgent' : 'normal'
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        const callMessage: ChatMessage = {
          id: Date.now().toString(),
          content: `📹 Video consultation requested successfully!\n\n• Session ID: ${data.sessionId}\n• Estimated wait time: ${data.estimatedWait || '2-5 minutes'}\n• Doctor: ${data.assignedDoctor || 'Available physician'}`,
          sender: 'assistant',
          timestamp: new Date(),
          actions: [
            { type: 'video_join', label: 'Join Video Call', data: { sessionId: data.sessionId, roomUrl: data.roomUrl } },
            { type: 'video_cancel', label: 'Cancel Call', data: { sessionId: data.sessionId } }
          ]
        };
        setMessages(prev => [...prev, callMessage]);
        
        // Auto-join after 3 seconds if room URL is available
        if (data.roomUrl) {
          setTimeout(() => {
            window.open(data.roomUrl, '_blank', 'width=1200,height=800');
            toast({
              title: "Video Call Opened",
              description: "Video consultation window opened in new tab",
            });
          }, 3000);
        }
      } else {
        throw new Error('Failed to request consultation');
      }
    } catch (error) {
      console.error('Video call error:', error);

      /**
       * Says the feature is unavailable. It used to open a public video room.
       *
       * /api/video/request-consultation is not a route this server registers, so
       * this catch ran on every single attempt. What it did was build a
       * meet.jit.si URL — `MedAI-Consultation-${Date.now()}` — and tell the
       * patient "Video consultation ready!", with a Join button.
       *
       * Two things were wrong with that, and both are serious.
       *
       * No clinician was ever told. Nothing notified anyone, nothing was written
       * to the database, no appointment existed. A patient who reached this
       * through the emergency path was told a consultation was ready and was put
       * in an empty room to wait for a doctor who did not know they were there.
       *
       * And the room was public. meet.jit.si rooms are open to anyone holding
       * the name, and the name was the word "MedAI-Consultation" plus a
       * millisecond timestamp — a keyspace small enough to enumerate. A
       * consultation held there is a medical conversation a stranger can join.
       *
       * Video consultation has no backend on this platform. The honest response
       * is to say so, and to offer the thing that does work.
       */
      const callMessage: ChatMessage = {
        id: Date.now().toString(),
        content:
          `📹 Video consultation is not available on this platform yet.\n\n` +
          `Nothing was booked and no clinician has been notified. ` +
          `You can book an appointment instead, and a clinician will confirm it.\n\n` +
          `If this is a medical emergency, contact your local emergency services now.`,
        sender: 'assistant',
        timestamp: new Date(),
        actions: [
          { type: 'schedule_appointment', label: 'Book an appointment' }
        ]
      };
      setMessages(prev => [...prev, callMessage]);

      toast({
        title: "Video consultation unavailable",
        description: "No call was placed and no clinician was notified.",
        variant: "destructive"
      });
    } finally {
      setIsVideoCallActive(false);
    }
  };

  // 🔍 Smart Search Functions
  const performMedicalSearch = async (query: string) => {
    try {
      const response = await fetch('/api/chatbot/medical-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query, userId: user?.id })
      });

      if (response.ok) {
        const data = await response.json();
        const searchMessage: ChatMessage = {
          id: Date.now().toString(),
          content: `🔍 Medical Information: ${data.results}`,
          sender: 'assistant',
          timestamp: new Date(),
          suggestions: data.relatedTopics,
          actions: [
            { type: 'book_consultation', label: 'Book Consultation', icon: 'calendar' },
            { type: 'save_info', label: 'Save Info', icon: 'bookmark' }
          ]
        };
        setMessages(prev => [...prev, searchMessage]);
      }
    } catch (error) {
      console.error('Medical search error:', error);
    }
  };

  // ❤️ Health Monitoring Functions
  const checkHealthReminders = async () => {
    try {
      const response = await fetch('/api/health/reminders', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      
      if (response.ok) {
        const reminders = await response.json();
        setHealthReminders(reminders);
        
        const reminderMessage: ChatMessage = {
          id: Date.now().toString(),
          content: reminders.length > 0 
            ? `❤️ Health Reminders:\n• ${reminders.map((r: any) => r.message).join('\n• ')}`
            : '❤️ No health reminders at this time. You\'re up to date!',
          sender: 'assistant',
          timestamp: new Date(),
          actions: reminders.length > 0 ? [
            { type: 'snooze_reminder', label: 'Snooze 15min', icon: 'clock' },
            { type: 'mark_completed', label: 'Mark Done', icon: 'check' }
          ] : []
        };
        setMessages(prev => [...prev, reminderMessage]);
      }
    } catch (error) {
      console.error('Failed to fetch health reminders:', error);
    }
  };

  // Enhanced message sending with emergency detection
  const enhancedSendMessage = async (content: string) => {
    if (detectEmergencyKeywords(content)) {
      setEmergencyMode(true);
    }
    await sendMessage(content);
  };

  // Appointment Scheduling Functions
  const fetchAvailableSlots = async (doctorType: string) => {
    setLoadingSlots(true);
    try {
      const response = await fetch('/api/appointments/available-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doctorType, patientId: user?.id })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAvailableSlots(data.slots);
        setSelectedDoctor(data.doctor);
      } else {
        // Show nothing rather than invent availability. See below.
        setAvailableSlots([]);
        setSelectedDoctor(null);
      }
    } catch (error) {
      setAvailableSlots([]);
      setSelectedDoctor(null);
    } finally {
      setLoadingSlots(false);
    }
  };

  // `generateMockSlots` was called on both of the paths above. It invented
  // clinicians — "Dr. Sarah Johnson", "Dr. Michael Chen", "Dr. Emily Watson" —
  // and decided each time slot's availability with `Math.random() > 0.3`. The
  // slots it produced were live: `bookAppointment` would submit one, so a
  // patient could be shown, and try to book, an appointment with a doctor who
  // does not exist at a time nobody had checked. Whenever the availability API
  // is unreachable the UI now falls through to its existing "No available slots
  // found" state.


  /**
   * Books the slot, and says so only if it was actually booked.
   *
   * This posted to /api/appointments/book, which is not a route this server
   * registers, so every attempt 404'd. Both the `else` branch and the `catch`
   * then called showBookingConfirmation() with an object assembled in the
   * browser — `{ id: Date.now(), date, time, doctor }` — and the chatbot told the
   * patient their appointment was confirmed, with a reference number.
   *
   * Nothing was written. No row existed, no clinician was notified, no calendar
   * entry was made. A patient who booked through the assistant was given a
   * confirmation for an appointment that had never been created, and would find
   * that out by arriving for it.
   *
   * The real endpoint is POST /api/patient/appointments, which takes the patient
   * from the session, checks the slot against the clinician's calendar, and
   * returns 409 if it is taken. A failure is now reported as a failure.
   */
  const bookAppointment = async (slot: AppointmentSlot) => {
    if (!selectedDoctor?.id) {
      toast({
        title: "No clinician selected",
        description: "Choose a clinician before booking.",
        variant: "destructive"
      });
      return;
    }

    try {
      const response = await fetch('/api/patient/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          appointmentDate: slot.date,
          appointmentTime: slot.time,
          type: 'Consultation',
          reason: 'Booked through the assistant'
        })
      });

      if (!response.ok) {
        // 409 means the slot went while the patient was choosing it, which is a
        // different message from a general failure and is worth saying plainly.
        const detail = await response.json().catch(() => ({}));
        const failure: ChatMessage = {
          id: Date.now().toString(),
          content:
            response.status === 409
              ? `That time has just been taken. Nothing was booked — please pick another slot.`
              : `The appointment could not be booked${detail?.message ? `: ${detail.message}` : '.'}\n\n` +
                `Nothing was scheduled and no clinician has been notified. Please try again.`,
          sender: 'assistant',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, failure]);
        toast({
          title: "Appointment not booked",
          description: response.status === 409 ? "That slot is no longer free." : "Nothing was scheduled.",
          variant: "destructive"
        });
        return;
      }

      const booking = await response.json();
      showBookingConfirmation(booking.appointment ?? booking);
      setShowScheduler(false);
    } catch (error) {
      console.error('Appointment booking error:', error);
      const failure: ChatMessage = {
        id: Date.now().toString(),
        content:
          `The appointment could not be booked — the server could not be reached.\n\n` +
          `Nothing was scheduled. Please check your connection and try again.`,
        sender: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, failure]);
      toast({
        title: "Appointment not booked",
        description: "Nothing was scheduled.",
        variant: "destructive"
      });
    }
  };

  /**
   * Confirms a booking that the server actually made.
   *
   * Reads the appointment row's own column names. It previously read
   * `booking.date` and `booking.time`, which is the shape of the object the
   * fabricated fallback built in the browser, not the shape the API returns —
   * so on the one path where a real booking could have arrived, the confirmation
   * would have shown "Invalid Date".
   */
  const showBookingConfirmation = (booking: any) => {
    const rawDate = booking.appointmentDate ?? booking.date;
    const when = rawDate ? new Date(rawDate).toLocaleDateString() : 'date to be confirmed';
    const time = booking.appointmentTime ?? booking.time ?? 'time to be confirmed';
    const clinician = booking.doctorName ?? selectedDoctor?.name ?? 'your clinician';

    const confirmationMessage: ChatMessage = {
      id: Date.now().toString(),
      content:
        `✅ Appointment booked.\n\n📅 Date: ${when}\n🕐 Time: ${time}\n` +
        `👨‍⚕️ Clinician: ${clinician}\n🏥 Type: Consultation\n\n` +
        // The line removed here promised "You'll receive a confirmation email
        // shortly". Email delivery is off unless SENDGRID_API_KEY and
        // NOTIFICATION_FROM_EMAIL are configured, and /api/ready reports whether
        // they are — so this promised a message that in most deployments never
        // arrives. The appointment list is the reliable record either way.
        `It is on your appointments list. If a reminder channel is configured for ` +
        `this deployment, you may also receive a notification.`,
      sender: 'assistant',
      timestamp: new Date(),
      actions: [
        { type: 'view_appointments', label: 'View All Appointments' },
        { type: 'reschedule', label: 'Reschedule', data: { appointmentId: booking.id } }
      ]
    };

    setMessages(prev => [...prev, confirmationMessage]);

    toast({
      title: "Appointment booked",
      description: `${when} at ${time}`,
    });
  };

  // Real-time Chat Functions
  /**
   * Opens a conversation with a clinician.
   *
   * This posted to /api/chat/start-session, which is not a route this server
   * registers, so it 404'd on every attempt and fell through to
   * initializeDemoChat() — a message reading "Demo chat mode activated ... In
   * production, this would connect you directly with your assigned doctor".
   * That text was itself shown *in* production, to real patients, as the only
   * outcome this button ever produced.
   *
   * There is no session to start: chat here is a message thread between two
   * users, backed by /api/chat/participants, /api/chat/messages and
   * /api/chat/send. Opening it means checking the clinician is someone this
   * patient may message, then pointing them at the chat surface.
   */
  const startRealTimeChat = async (doctorId: string) => {
    try {
      const response = await fetch('/api/chat/participants', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Chat is unavailable right now (${response.status}).`);
      }

      const participants = await response.json();
      const clinician = Array.isArray(participants)
        ? participants.find((p: any) => String(p.id) === String(doctorId))
        : null;

      if (!clinician) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          content:
            `That clinician is not available to message from your account.\n\n` +
            `You can message clinicians involved in your care from the Messages tab.`,
          sender: 'assistant',
          timestamp: new Date()
        }]);
        return;
      }

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content:
          `💬 You can message ${clinician.fullName ?? clinician.name ?? 'this clinician'} ` +
          `from the Messages tab.\n\nMessages are stored encrypted and are visible only ` +
          `to you and the clinician. Replies are not immediate — this is not an ` +
          `emergency channel.`,
        sender: 'assistant',
        timestamp: new Date(),
        actions: [{ type: 'open_messages', label: 'Open Messages' }]
      }]);
    } catch (error) {
      console.error('Chat availability check failed:', error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content:
          `Chat could not be opened — the server could not be reached.\n\n` +
          `No message was sent and no clinician has been notified.`,
        sender: 'assistant',
        timestamp: new Date()
      }]);
    }
  };

  /*
   * initializeChatSession() and initializeDemoChat() stood here and are removed
   * with their only caller.
   *
   * The second one produced the "Demo chat mode activated" message that this
   * button actually showed in production; the first one was written for a
   * /api/chat/start-session response that no route ever returned.
   */

  // Text-to-Speech Function
  const speakMessage = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.8;
      utterance.pitch = 1;
      speechSynthesis.speak(utterance);
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-16 right-6 z-50"
          >
            <Button
              onClick={toggleChat}
              className="relative w-16 h-16 rounded-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 shadow-xl hover:shadow-2xl transform hover:scale-110 transition-all duration-300"
            >
              <MessageCircle className="w-8 h-8 text-white" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-2 -right-2 bg-red-500 text-white min-w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 100 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 100 }}
            className="fixed bottom-16 right-6 z-50"
          >
            <Card className={`bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-2xl transition-all duration-300 ${
              isMinimized ? 'w-80 h-16' : 'w-96 h-[600px]'
            }`}>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-t-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold">HAI Assistant</h3>
                    <p className="text-xs opacity-90 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                      {isOnline ? 'Online • Ready to help' : `Last seen ${lastSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleMinimize}
                    className="text-white hover:bg-white/10 p-1"
                  >
                    {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleChat}
                    className="text-white hover:bg-white/10 p-1"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Chat Content */}
              {!isMinimized && (
                <div className="flex flex-col h-full">
                  {/* Messages - Now with proper scrolling and fixed height */}
                  <div className="flex-1 p-4 overflow-y-auto h-[calc(100%-220px)]">
                    <div className="space-y-4">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex mb-4 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`flex items-end space-x-2 max-w-[85%] ${
                            message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                          }`}>
                            {/* Avatar */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${
                              message.sender === 'user' 
                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 shadow-lg' 
                                : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg'
                            }`}>
                              {message.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                            </div>

                            {/* Message Bubble */}
                            <div className="flex flex-col">
                              <div className={`rounded-2xl px-4 py-3 shadow-md ${
                                message.sender === 'user'
                                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md'
                                  : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-bl-md'
                              }`}>
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                              </div>
                              <p className={`text-xs text-slate-500 dark:text-slate-400 mt-1 px-2 ${
                                message.sender === 'user' ? 'text-right' : 'text-left'
                              }`}>
                                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Typing Indicator */}
                      {isTyping && (
                        <div className="flex justify-start mb-4">
                          <div className="flex items-end space-x-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg flex items-center justify-center flex-shrink-0">
                              <Bot className="w-4 h-4 text-white" />
                            </div>
                            <div className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl rounded-bl-md px-4 py-3 shadow-md">
                              <div className="flex items-center space-x-1">
                                <span className="text-sm text-slate-600 dark:text-slate-300 mr-2">HAI is typing</span>
                                <div className="flex space-x-1">
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Suggestions */}
                  {messages.length > 0 && messages[messages.length - 1].suggestions && messages[messages.length - 1].sender === 'assistant' && (
                    <div className="mb-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-2">Quick suggestions:</p>
                      <div className="flex flex-wrap gap-2 px-2">
                        {messages[messages.length - 1].suggestions?.map((suggestion, index) => (
                          <Button
                            key={index}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="text-xs rounded-full border-2 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/30 px-3 py-1 transition-all transform hover:scale-105"
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                      {/* Action Buttons */}
                  {messages.length > 0 && messages[messages.length - 1].actions && messages[messages.length - 1].sender === 'assistant' && (
                    <div className="mb-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-2">Available actions:</p>
                      <div className="flex flex-wrap gap-2 px-2">
                        {messages[messages.length - 1].actions?.map((action, index) => (
                          <Button
                            key={index}
                            size="sm"
                            onClick={() => handleActionClick(action)}
                            className="text-xs rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-3 py-1 shadow-md transform hover:scale-105 transition-all"
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  {/* Input Area - Now properly positioned at the bottom */}
                  <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    {/* Emergency Alert Bar */}
                    {emergencyMode && (
                      <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 text-red-700 dark:text-red-300">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-sm font-medium">Emergency Mode Active</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEmergencyMode(false)}
                            className="text-red-700 dark:text-red-300"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Toggle Button for Advanced Features */}
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm text-slate-400">Advanced Features</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowQuickActions(!showQuickActions)}
                        className="text-slate-400 hover:text-white p-2"
                      >
                        {showQuickActions ? (
                          <>
                            <X className="w-4 h-4 mr-1" />
                            Hide
                          </>
                        ) : (
                          <>
                            <Settings className="w-4 h-4 mr-1" />
                            Show
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Quick Action Buttons */}
                    {showQuickActions && (
                      <div className="flex items-center justify-between mb-4 px-3">
                        <div className="flex items-center space-x-2">
                          {/* Voice Recording */}
                          <Button
                            variant="default"
                            size="sm"
                            onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                            className={`p-3 rounded-md ${isRecording ? 'bg-red-300 text-red-800 dark:bg-red-900/40' : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'}`}
                          >
                            {isRecording ? <MicOff className="w-5 h-5 text-red-800 dark:text-red-400" /> : <Mic className="w-5 h-5" />}
                          </Button>

                        {/* File Upload */}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-3 rounded-md bg-green-600 text-white hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600"
                        >
                          <Paperclip className="w-5 h-5" />
                        </Button>

                        {/* Video Call */}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={startVideoCall}
                          className="p-3 rounded-md bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600"
                        >
                          <Video className="w-5 h-5" />
                        </Button>

                        {/* Medical Search */}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => performMedicalSearch('general health information')}
                          className="p-3 rounded-md bg-yellow-600 text-white hover:bg-yellow-700 dark:bg-yellow-500 dark:hover:bg-yellow-600"
                        >
                          <Search className="w-5 h-5" />
                        </Button>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Health Reminders */}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={checkHealthReminders}
                          className="p-3 rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-500 dark:hover:bg-pink-600"
                        >
                          <Heart className="w-5 h-5" />
                        </Button>

                        {/* Emergency Button */}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleEmergencyAlert}
                          className="p-3 rounded-md bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700"
                        >
                          <Zap className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                    )}

                    {/* Quick Medical Actions */}
                      <div className="flex flex-wrap gap-2 mb-4 px-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => enhancedSendMessage("Schedule cancer screening")}
                          className="text-sm rounded-full bg-green-600 text-white hover:bg-green-700 px-4 py-1"
                        >
                          <Calendar className="w-4 h-4 mr-2" />
                          Schedule Screening
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => enhancedSendMessage("Symptom checker")}
                          className="text-sm rounded-full bg-blue-600 text-white hover:bg-blue-700 px-4 py-1"
                        >
                          <Stethoscope className="w-4 h-4 mr-2" />
                          Symptom Check
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => enhancedSendMessage("Medication reminders")}
                          className="text-sm rounded-full bg-purple-600 text-white hover:bg-purple-700 px-4 py-1"
                        >
                          <Pill className="w-4 h-4 mr-2" />
                          Medications
                        </Button>
                      </div>

                    {/* Main Input Area - Highly Visible */}
                    <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-slate-800 dark:to-slate-700 rounded-xl border-2 border-blue-200 dark:border-blue-600 shadow-lg">
                      <div className="flex items-center space-x-3">
                        <div className="flex-1 relative">
                          <Input
                            ref={inputRef}
                            value={currentMessage}
                            onChange={(e) => setCurrentMessage(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && enhancedSendMessage(currentMessage)}
                            placeholder={isRecording ? "🎤 Recording..." : "Type your message here..."}
                            className="w-full h-12 px-4 bg-white dark:bg-slate-900 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 text-base font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                            disabled={isTyping || isRecording}
                          />
                        </div>
                        <Button
                          onClick={() => enhancedSendMessage(currentMessage)}
                          disabled={!currentMessage.trim() || isTyping || isRecording}
                          className="rounded-full w-12 h-12 p-0 bg-blue-600 hover:bg-blue-700 shadow-lg transform hover:scale-105 transition-all flex-shrink-0"
                        >
                          {isTyping ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                          ) : (
                            <Send className="w-6 h-6" />
                          )}
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center">
                        Press Enter to send or click the send button
                      </div>
                    </div>

                    {/* Appointment Scheduler */}
                    {showScheduler && (
                      <div className="mb-4 p-4 bg-gradient-to-r from-green-50 to-blue-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border-2 border-green-200 dark:border-green-600">
                        <div className="flex justify-between items-center mb-3">
                          <h3 className="font-semibold text-slate-900 dark:text-white">Available Appointments</h3>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowScheduler(false)}
                            className="text-slate-500 hover:text-slate-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        
                        {selectedDoctor && (
                          <div className="mb-3 p-2 bg-white dark:bg-slate-800 rounded-lg">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                              👨‍⚕️ {selectedDoctor.name}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              {selectedDoctor.specialization}
                            </p>
                          </div>
                        )}
                        
                        {loadingSlots ? (
                          <div className="text-center py-4">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            <p className="text-sm text-slate-600 dark:text-slate-400">Checking availability...</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                            {availableSlots.map((slot) => (
                              <Button
                                key={slot.id}
                                variant="outline"
                                size="sm"
                                onClick={() => bookAppointment(slot)}
                                className="text-xs p-2 h-auto flex flex-col items-center border-green-200 hover:bg-green-50 dark:border-green-600 dark:hover:bg-green-900/20"
                              >
                                <span className="font-medium">
                                  {new Date(slot.date).toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric' 
                                  })}
                                </span>
                                <span className="text-green-600 dark:text-green-400">
                                  {slot.time}
                                </span>
                              </Button>
                            ))}
                          </div>
                        )}
                        
                        {availableSlots.length === 0 && !loadingSlots && (
                          <p className="text-center text-sm text-slate-600 dark:text-slate-400 py-4">
                            No available slots found. Please try a different doctor type.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Hidden File Input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
