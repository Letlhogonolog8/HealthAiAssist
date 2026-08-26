import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  MessageCircle, X, Send, Bot, User, Loader2, Calendar, 
  Stethoscope, FileText, AlertTriangle, RefreshCw, Wifi, WifiOff,
  Phone, MapPin, Clock, Star, ThumbsUp, ThumbsDown, Copy, Download,
  Mic, MicOff, Volume2, VolumeX, Settings, HelpCircle, Shield, Brain
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';

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
  }>;
  isEmergency?: boolean;
  error?: boolean;
}

interface EnhancedChatbotProps {
  user?: any;
  onActionClick?: (action: { type: string; data?: any }) => void;
}

export default function EnhancedChatbot({ user, onActionClick }: EnhancedChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [userFeedback, setUserFeedback] = useState<{[key: string]: 'positive' | 'negative'}>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Initialize role-specific welcome message
  useEffect(() => {
    const getRoleSpecificWelcome = () => {
      const name = user?.fullName ? `, ${user.fullName.split(' ')[0]}` : '';
      
      switch(user?.role) {
        case 'doctor':
          return {
            content: `👨‍⚕️ Hello Dr.${name}! I'm your HAI Clinical Assistant.\n\nI can help you with:\n• Patient management & consultations\n• Scan analysis & reports\n• Clinical decision support\n• Research & medical references\n• Appointment scheduling\n\nHow can I assist you today?`,
            suggestions: ["View patient scans", "Clinical guidelines", "Schedule consultation", "Medical research"]
          };
        case 'radiologist':
          return {
            content: `🔬 Hello Dr.${name}! I'm your HAI Radiology Assistant.\n\nI can help you with:\n• Scan interpretation support\n• AI analysis results\n• Imaging protocols\n• Report generation\n• Case consultations\n\nWhat do you need assistance with?`,
            suggestions: ["Analyze scan", "Generate report", "Imaging protocols", "Case consultation"]
          };
        case 'patient':
        default:
          return {
            content: `👋 Hello${name}! I'm your HAI Health Assistant.\n\nI'm here to help you with:\n• Medical appointments & scheduling\n• Health information & guidance\n• Scan results & reports\n• Emergency assistance\n\nWhat can I help you with today?`,
            suggestions: ["Schedule appointment", "Check symptoms", "View test results", "Emergency help"]
          };
      }
    };
    
    const roleWelcome = getRoleSpecificWelcome();
    const welcomeMessage: ChatMessage = {
      id: '1',
      content: roleWelcome.content,
      sender: 'assistant',
      timestamp: new Date(),
      suggestions: roleWelcome.suggestions
    };
    setMessages([welcomeMessage]);
  }, [user?.fullName, user?.role]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setConnectionError(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setConnectionError(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Enhanced smart response generator
  const generateSmartResponse = useCallback((userInput: string): ChatMessage => {
    const input = userInput.toLowerCase().trim();
    
    const getRoleSpecificResponses = () => {
      const baseResponses = {
        appointment: {
          content: user?.role === 'patient' 
            ? "I can help you schedule an appointment. What type of consultation do you need?"
            : "I can help you manage appointments and consultations. What do you need?",
          actions: user?.role === 'patient'
            ? [
                { type: 'schedule_appointment', label: 'Schedule Now' },
                { type: 'view_appointments', label: 'View Existing' }
              ]
            : [
                { type: 'view_patient_appointments', label: 'Patient Appointments' },
                { type: 'schedule_consultation', label: 'Schedule Consultation' },
                { type: 'manage_calendar', label: 'Manage Calendar' }
              ],
          suggestions: user?.role === 'patient'
            ? ["General consultation", "Cancer screening", "Follow-up visit"]
            : ["Today's appointments", "Patient consultations", "Block time slots"]
        },
        clinical: {
          content: user?.role === 'doctor'
            ? "I can assist with clinical decisions and patient care. What do you need help with?"
            : user?.role === 'radiologist'
            ? "I can help with imaging analysis and radiology workflows. How can I assist?"
            : "I can provide general health information. What would you like to know?",
          actions: user?.role === 'doctor'
            ? [
                { type: 'patient_records', label: 'Patient Records' },
                { type: 'clinical_guidelines', label: 'Clinical Guidelines' },
                { type: 'drug_interactions', label: 'Drug Interactions' }
              ]
            : user?.role === 'radiologist'
            ? [
                { type: 'scan_analysis', label: 'Scan Analysis' },
                { type: 'imaging_protocols', label: 'Imaging Protocols' },
                { type: 'case_consultation', label: 'Case Consultation' }
              ]
            : [
                { type: 'health_info', label: 'Health Information' },
                { type: 'symptom_checker', label: 'Symptom Checker' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Patient history", "Treatment options", "Medication review"]
            : user?.role === 'radiologist'
            ? ["Image interpretation", "AI analysis", "Report templates"]
            : ["Health tips", "Preventive care", "Wellness advice"]
        },
        medication: {
          content: user?.role === 'doctor'
            ? "I can assist with medication management, drug interactions, and prescribing guidelines. What do you need?"
            : "I can help with medication information and reminders. What do you need assistance with?",
          actions: user?.role === 'doctor'
            ? [
                { type: 'drug_interactions', label: 'Drug Interactions' },
                { type: 'prescribing_guidelines', label: 'Prescribing Guidelines' },
                { type: 'dosage_calculator', label: 'Dosage Calculator' },
                { type: 'contraindications', label: 'Contraindications' }
              ]
            : [
                { type: 'medication_reminder', label: 'Set Reminder' },
                { type: 'drug_interactions', label: 'Check Interactions' },
                { type: 'pharmacy_locator', label: 'Find Pharmacy' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Drug interactions", "Prescribing guidelines", "Dosage calculations", "Contraindications"]
            : ["Medication schedule", "Side effects", "Dosage information"]
        },
        research: {
          content: user?.role === 'doctor'
            ? "I can help you access medical research, clinical studies, and evidence-based guidelines. What are you looking for?"
            : "I can provide general health information and research summaries. What would you like to know?",
          actions: user?.role === 'doctor'
            ? [
                { type: 'pubmed_search', label: 'PubMed Search' },
                { type: 'clinical_trials', label: 'Clinical Trials' },
                { type: 'medical_guidelines', label: 'Medical Guidelines' },
                { type: 'case_studies', label: 'Case Studies' }
              ]
            : [
                { type: 'health_articles', label: 'Health Articles' },
                { type: 'medical_info', label: 'Medical Information' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Latest research", "Clinical trials", "Treatment protocols", "Medical guidelines"]
            : ["Health information", "Medical articles", "Research summaries"]
        },
        protocol: {
          content: user?.role === 'doctor'
            ? "I can provide clinical protocols, treatment guidelines, and procedural information. What do you need?"
            : user?.role === 'radiologist'
            ? "I can help with imaging protocols and radiology procedures. What do you need assistance with?"
            : "I can provide general information about medical procedures. What would you like to know?",
          actions: user?.role === 'doctor'
            ? [
                { type: 'treatment_protocols', label: 'Treatment Protocols' },
                { type: 'clinical_pathways', label: 'Clinical Pathways' },
                { type: 'emergency_protocols', label: 'Emergency Protocols' },
                { type: 'diagnostic_criteria', label: 'Diagnostic Criteria' }
              ]
            : user?.role === 'radiologist'
            ? [
                { type: 'imaging_protocols', label: 'Imaging Protocols' },
                { type: 'contrast_guidelines', label: 'Contrast Guidelines' },
                { type: 'safety_protocols', label: 'Safety Protocols' }
              ]
            : [
                { type: 'procedure_info', label: 'Procedure Information' },
                { type: 'preparation_guide', label: 'Preparation Guide' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Treatment protocols", "Clinical pathways", "Emergency procedures", "Diagnostic criteria"]
            : user?.role === 'radiologist'
            ? ["Imaging protocols", "Contrast guidelines", "Safety procedures"]
            : ["Procedure information", "Preparation guidelines"]
        },
        symptoms: {
          content: user?.role === 'doctor'
            ? "I can help with differential diagnosis, symptom analysis, and clinical decision support. What symptoms are you evaluating?"
            : "I understand you're concerned about symptoms. While I can't diagnose, I can help you find the right care.",
          actions: user?.role === 'doctor'
            ? [
                { type: 'differential_diagnosis', label: 'Differential Diagnosis' },
                { type: 'clinical_decision_tree', label: 'Decision Tree' },
                { type: 'red_flags', label: 'Red Flag Symptoms' },
                { type: 'diagnostic_tests', label: 'Diagnostic Tests' }
              ]
            : [
                { type: 'symptom_checker', label: 'Symptom Checker' },
                { type: 'emergency_help', label: 'Emergency Help', urgency: 'high' as const },
                { type: 'schedule_appointment', label: 'See Doctor' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Differential diagnosis", "Clinical decision support", "Red flag symptoms", "Diagnostic workup"]
            : ["Describe symptoms", "Emergency symptoms", "When to see doctor"]
        },
        results: {
          content: user?.role === 'doctor'
            ? "I can help interpret test results, lab values, and imaging findings. What results do you need assistance with?"
            : "I can help you access your medical results and reports.",
          actions: user?.role === 'doctor'
            ? [
                { type: 'lab_interpretation', label: 'Lab Interpretation' },
                { type: 'imaging_review', label: 'Imaging Review' },
                { type: 'reference_ranges', label: 'Reference Ranges' },
                { type: 'follow_up_recommendations', label: 'Follow-up Recommendations' }
              ]
            : [
                { type: 'view_results', label: 'View Results' },
                { type: 'download_reports', label: 'Download Reports' }
              ],
          suggestions: user?.role === 'doctor'
            ? ["Lab interpretation", "Imaging findings", "Reference values", "Follow-up planning"]
            : ["Recent scans", "Lab results", "Explain results"]
        },
        emergency: {
          content: user?.role === 'doctor'
            ? "🚨 I can provide emergency protocols and critical care guidelines. What emergency situation are you managing?"
            : "🚨 This seems urgent. For immediate medical emergencies, please call 0734801665 (Medical Support) or go to the nearest emergency room.",
          actions: user?.role === 'doctor'
            ? [
                { type: 'emergency_protocols', label: 'Emergency Protocols', urgency: 'urgent' as const },
                { type: 'acls_guidelines', label: 'ACLS Guidelines', urgency: 'urgent' as const },
                { type: 'critical_care', label: 'Critical Care', urgency: 'high' as const },
                { type: 'poison_control', label: 'Poison Control', urgency: 'high' as const }
              ]
            : [
                { type: 'emergency_call', label: 'Call 0734801665', urgency: 'urgent' as const },
                { type: 'find_hospital', label: 'Find Hospital', urgency: 'high' as const }
              ],
          isEmergency: true,
          suggestions: user?.role === 'doctor'
            ? ["Emergency protocols", "ACLS guidelines", "Critical care", "Toxicology"]
            : ["Call emergency", "Find hospital", "First aid"]
        },
        default: {
          content: user?.role === 'doctor'
            ? "I'm here to assist with clinical decisions, patient management, and medical research. How can I help you today?"
            : user?.role === 'radiologist'
            ? "I'm here to help with imaging analysis, radiology workflows, and scan interpretation. What do you need?"
            : "I'm here to help with your healthcare needs. What can I assist you with today?",
          suggestions: user?.role === 'doctor'
            ? ["Patient management", "Clinical guidelines", "Medical research", "Drug interactions"]
            : user?.role === 'radiologist'
            ? ["Scan analysis", "Imaging protocols", "Report generation", "Case consultation"]
            : ["Schedule appointment", "Check symptoms", "View test results", "Medication reminders"]
        }
      
      };
      
      return baseResponses;
    };
    
    const responses = getRoleSpecificResponses();

    // Enhanced role-specific pattern matching
    if (input.includes('appointment') || input.includes('schedule') || input.includes('book')) {
      return { ...responses.appointment, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('patient') || input.includes('clinical') || input.includes('diagnosis') || input.includes('treatment')) {
      return { ...responses.clinical, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('scan') || input.includes('image') || input.includes('radiology') || input.includes('analysis')) {
      return { ...responses.clinical, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('medication') || input.includes('prescription') || input.includes('drug')) {
      return { ...responses.medication, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('symptom') || input.includes('pain') || input.includes('sick')) {
      return { ...responses.symptoms, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('research') || input.includes('study') || input.includes('literature')) {
      return { ...responses.research, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('protocol') || input.includes('guideline') || input.includes('procedure')) {
      return { ...responses.protocol, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('emergency') || input.includes('urgent') || input.includes('help')) {
      return { ...responses.emergency, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else {
      return { ...responses.default, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    }
  }, []);

  // Enhanced message sending with retry logic
  const sendMessage = useCallback(async (content: string) => {
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
    setConnectionError(false);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      // Build recent context including this user message
      const recentWithUser = [
        ...messages.slice(-5).map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant' as const,
          content: m.content
        })),
        { role: 'user' as const, content }
      ];

      const response = await fetch('/api/chatbot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ 
          message: content,
          userId: user?.id,
          messages: recentWithUser
        })
      });

      clearTimeout(timeoutId);

      let assistantMessage: ChatMessage;
      
      if (response.ok) {
        const data = await response.json();
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: data.message || "I'm here to help! How can I assist you?",
          sender: 'assistant',
          timestamp: new Date(),
          suggestions: data.suggestions,
          actions: data.actions
        };
        setRetryCount(0); // Reset retry count on success
      } else {
        throw new Error(`Server error: ${response.status}`);
      }

      setMessages(prev => [...prev, assistantMessage]);
      
      if (!isOpen) {
        setUnreadCount(prev => prev + 1);
      }
    } catch (error: any) {
      console.error('Chatbot error:', error);
      setConnectionError(true);
      
      let errorMessage: ChatMessage;
      
      if (error.name === 'AbortError') {
        errorMessage = {
          id: (Date.now() + 1).toString(),
          content: "⏱️ Request timed out. I'm switching to offline mode to continue helping you.",
          sender: 'assistant',
          timestamp: new Date(),
          error: true,
          actions: [
            { type: 'retry_connection', label: 'Retry Connection' },
            { type: 'schedule_appointment', label: 'Schedule Appointment' },
            { type: 'emergency_help', label: 'Emergency Help' }
          ]
        };
      } else if (!isOnline) {
        errorMessage = {
          id: (Date.now() + 1).toString(),
          content: "📱 You're offline. I can still help with basic guidance and when you reconnect, I'll have full functionality.",
          sender: 'assistant',
          timestamp: new Date(),
          error: true,
          suggestions: ["Schedule appointment", "Emergency help", "Basic health info"]
        };
      } else {
        // Use smart fallback response
        errorMessage = generateSmartResponse(content);
        errorMessage.content = `🤖 I'm using offline mode. ${errorMessage.content}`;
        errorMessage.error = true;
      }
      
      setMessages(prev => [...prev, errorMessage]);
      setRetryCount(prev => prev + 1);
    } finally {
      setIsTyping(false);
    }
  }, [user?.id, messages, isOpen, isOnline, generateSmartResponse]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    sendMessage(suggestion);
  }, [sendMessage]);

  const handleActionClick = useCallback((action: { type: string; label: string; data?: any }) => {
    if (action.type === 'retry_connection') {
      // Retry last message
      const lastUserMessage = messages.filter(m => m.sender === 'user').pop();
      if (lastUserMessage) {
        sendMessage(lastUserMessage.content);
      }
      return;
    }

    if (onActionClick) {
      onActionClick(action);
    }
    
    const confirmMessage: ChatMessage = {
      id: Date.now().toString(),
      content: `✅ I'll help you with: ${action.label}`,
      sender: 'assistant',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, confirmMessage]);
  }, [messages, onActionClick, sendMessage]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(currentMessage);
    }
  }, [currentMessage, sendMessage]);

  // Voice functionality
  const startListening = useCallback(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setCurrentMessage(transcript);
        sendMessage(transcript);
      };
      recognition.onerror = () => {
        setIsListening(false);
        toast({ title: "Voice recognition failed", description: "Please try again or type your message." });
      };
      
      recognition.start();
    } else {
      toast({ title: "Voice not supported", description: "Your browser doesn't support voice recognition." });
    }
  }, [sendMessage, toast]);

  // Symptom quick analyze helper
  const analyzeSymptoms = useCallback(async (text: string) => {
    try {
      const res = await fetch('/api/chatbot/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ symptoms: text, age: user?.age, gender: user?.gender })
      });
      if (!res.ok) return;
      const data = await res.json();
      const summary = `Assessment: ${data.assessment}\nUrgency: ${data.urgencyLevel}\nRecommendations: ${(data.recommendations||[]).join('; ')}`;
      setMessages(prev => [...prev, { id: Date.now().toString(), content: summary, sender: 'assistant', timestamp: new Date() }]);
    } catch {}
  }, [user?.age, user?.gender]);

  const speakMessage = useCallback((text: string) => {
    if ('speechSynthesis' in window && voiceEnabled) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      speechSynthesis.speak(utterance);
    }
  }, [voiceEnabled]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied to clipboard", description: "Message copied successfully." });
    });
  }, [toast]);

  const provideFeedback = useCallback((messageId: string, feedback: 'positive' | 'negative') => {
    setUserFeedback(prev => ({ ...prev, [messageId]: feedback }));
    toast({ 
      title: "Thank you for your feedback!", 
      description: "Your input helps us improve our service." 
    });
  }, [toast]);

  // Lightweight markdown renderer for headings/bold/lists
  const renderMessageContent = useCallback((text: string) => {
    const boldSegments = (line: string, key: string) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={key}>
          {parts.map((part, idx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={idx}>{part.slice(2, -2)}</strong>;
            }
            return <span key={idx}>{part}</span>;
          })}
        </span>
      );
    };

    const lines = text.split('\n');
    return (
      <div className="space-y-1">
        {lines.map((line, i) => {
          // bullet
          if (/^\s*[•*-]\s+/.test(line)) {
            const content = line.replace(/^\s*[•*-]\s+/, '');
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-[6px] text-slate-400">•</span>
                <span>{boldSegments(content, `b-${i}`)}</span>
              </div>
            );
          }
          // numbered
          if (/^\s*\d+\.\s+/.test(line)) {
            const match = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
            const num = match?.[2] || '1';
            const content = match?.[3] || line;
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-[2px] text-slate-400 font-medium">{num}.</span>
                <span>{boldSegments(content, `n-${i}`)}</span>
              </div>
            );
          }
          if (line.trim() === '') return <div key={i} className="h-2" />;
          return <div key={i}>{boldSegments(line, `p-${i}`)}</div>;
        })}
      </div>
    );
  }, []);

  // Role-specific Quick Actions Component
  const QuickActions = useCallback(() => {
    const getQuickActions = () => {
      switch(user?.role) {
        case 'doctor':
          return [
            { label: 'Patient Records', message: 'Show patient records', icon: FileText, color: 'bg-blue-600 hover:bg-blue-700' },
            { label: 'Clinical Guidelines', message: 'Clinical guidelines', icon: Stethoscope, color: 'bg-green-600 hover:bg-green-700' },
            { label: 'Consultations', message: 'Schedule consultation', icon: Calendar, color: 'bg-purple-600 hover:bg-purple-700' },
            { label: 'Emergency', message: 'Emergency protocols', icon: Phone, color: 'bg-red-600 hover:bg-red-700' }
          ];
        case 'radiologist':
          return [
            { label: 'Scan Analysis', message: 'Analyze medical scan', icon: FileText, color: 'bg-blue-600 hover:bg-blue-700' },
            { label: 'AI Results', message: 'View AI analysis results', icon: Brain, color: 'bg-purple-600 hover:bg-purple-700' },
            { label: 'Reports', message: 'Generate radiology report', icon: FileText, color: 'bg-green-600 hover:bg-green-700' },
            { label: 'Protocols', message: 'Imaging protocols', icon: Stethoscope, color: 'bg-orange-600 hover:bg-orange-700' }
          ];
        case 'patient':
        default:
          return [
            { label: 'Schedule', message: 'Schedule appointment', icon: Calendar, color: 'bg-blue-600 hover:bg-blue-700' },
            { label: 'Symptoms', message: 'Check symptoms', icon: Stethoscope, color: 'bg-green-600 hover:bg-green-700' },
            { label: 'Results', message: 'View results', icon: FileText, color: 'bg-purple-600 hover:bg-purple-700' },
            { label: 'Emergency', message: 'Emergency help', icon: Phone, color: 'bg-red-600 hover:bg-red-700' }
          ];
      }
    };
    
    const actions = getQuickActions();
    
    return (
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap gap-2 px-2">
          {actions.map((action, index) => {
            const IconComponent = action.icon;
            return (
              <Button
                key={index}
                variant="default"
                size="sm"
                onClick={() => sendMessage(action.message)}
                className={`text-sm rounded-full text-white px-4 py-1 ${action.color}`}
              >
                <IconComponent className="w-3 h-3 mr-1" />
                {action.label}
              </Button>
            );
          })}
        </div>
        <div className="flex justify-center">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {user?.role === 'doctor' ? 'Clinical assistance tools' : 
             user?.role === 'radiologist' ? 'Radiology workflow tools' : 
             'Quick access to common requests'}
          </div>
        </div>
      </div>
    );
  }, [sendMessage, user?.role]);

  return (
    <>
      {/* Floating Chat Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={() => setIsOpen(true)}
              /* Icon-only, so it has no text node: a screen reader announced
                 "button" and nothing else. The unread count and the connection
                 problem both go in the name, because a badge and a small orange
                 dot are visual signals only. */
              aria-label={
                connectionError
                  ? 'Open health assistant (connection problem)'
                  : unreadCount > 0
                    ? `Open health assistant, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
                    : 'Open health assistant'
              }
              className={`relative w-16 h-16 rounded-full shadow-xl hover:shadow-2xl transform hover:scale-110 transition-all duration-300 ${
                connectionError 
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400' 
                  : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500'
              }`}
            >
              <MessageCircle className="w-8 h-8 text-white" aria-hidden="true" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-2 -right-2 bg-red-500 text-white min-w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
              {connectionError && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                  <WifiOff className="w-2 h-2 text-white" />
                </div>
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
            className="fixed bottom-6 right-6 z-50"
          >
            <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-2xl w-[480px] h-[700px] flex flex-col">
              {/* Header */}
              <div className={`flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 text-white rounded-t-lg ${
                connectionError 
                  ? 'bg-gradient-to-r from-orange-500 to-red-500' 
                  : 'bg-gradient-to-r from-blue-600 to-cyan-600'
              }`}>
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold">HAI Assistant</h3>
                    <div className="text-xs opacity-90 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        connectionError ? 'bg-orange-300' : isOnline ? 'bg-green-400' : 'bg-gray-400'
                      }`}></div>
                      {connectionError ? 'Connection Issues' : isOnline ? 'Online • Ready to help' : 'Offline'}
                      {retryCount > 0 && ` • Retry ${retryCount}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {connectionError && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConnectionError(false);
                        setRetryCount(0);
                      }}
                      className="text-white hover:bg-white/10 p-1"
                      title="Retry Connection"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    className="text-white hover:bg-white/10 p-1"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="space-y-6">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex items-start space-x-3 max-w-[90%] ${
                        message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                      }`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${
                          message.sender === 'user' 
                            ? 'bg-blue-600' 
                            : message.error
                            ? 'bg-orange-500'
                            : 'bg-gradient-to-r from-emerald-500 to-teal-600'
                        }`}>
                          {message.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>

                        <div className="flex flex-col">
                        <div className="flex flex-col">
                            <div className={`rounded-2xl px-5 py-4 shadow-md max-w-full ${
                            message.sender === 'user'
                              ? 'bg-blue-600 text-white rounded-br-md'
                              : message.error
                              ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-900 dark:text-orange-200 border border-orange-200 dark:border-orange-700 rounded-bl-md'
                              : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-bl-md'
                          }`}>
                            <div className="text-base leading-relaxed whitespace-pre-wrap">{renderMessageContent(message.content)}</div>
                          </div>
                          
                          {/* Message Actions */}
                          {message.sender === 'assistant' && (
                            <div className="flex items-center space-x-2 mt-2 px-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(message.content)}
                                className="p-1 h-6 w-6 text-slate-400 hover:text-slate-600"
                                title="Copy message"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              {voiceEnabled && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => speakMessage(message.content)}
                                  className="p-1 h-6 w-6 text-slate-400 hover:text-slate-600"
                                  title="Read aloud"
                                >
                                  <Volume2 className="w-3 h-3" />
                                </Button>
                              )}
                              <div className="flex space-x-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => provideFeedback(message.id, 'positive')}
                                  className={`p-1 h-6 w-6 ${
                                    userFeedback[message.id] === 'positive' 
                                      ? 'text-green-600' 
                                      : 'text-slate-400 hover:text-green-600'
                                  }`}
                                  title="Helpful"
                                >
                                  <ThumbsUp className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => provideFeedback(message.id, 'negative')}
                                  className={`p-1 h-6 w-6 ${
                                    userFeedback[message.id] === 'negative' 
                                      ? 'text-red-600' 
                                      : 'text-slate-400 hover:text-red-600'
                                  }`}
                                  title="Not helpful"
                                >
                                  <ThumbsDown className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                          <div className={`text-xs text-slate-500 dark:text-slate-400 mt-1 px-2 ${
                            message.sender === 'user' ? 'text-right' : 'text-left'
                          }`}>
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {message.error && ' • Offline Mode'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Typing Indicator */}
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="flex items-end space-x-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-white" />
                        </div>
                        <div className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl rounded-bl-md px-4 py-3">
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
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-2">Quick suggestions:</div>
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
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-2">Available actions:</div>
                      <div className="flex flex-wrap gap-2 px-2">
                        {messages[messages.length - 1].actions?.map((action, index) => (
                          <Button
                            key={index}
                            size="sm"
                            onClick={() => handleActionClick(action)}
                            className={`text-xs rounded-full px-3 py-1 shadow-md transform hover:scale-105 transition-all ${
                              action.urgency === 'urgent' 
                                ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                                : action.urgency === 'high'
                                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white'
                            }`}
                          >
                            {action.urgency === 'urgent' && <AlertTriangle className="w-3 h-3 mr-1" />}
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input Area */}
              <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {/* Quick Actions */}
                <QuickActions />

                {/* Main Input */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-900 rounded-lg px-4 py-2 space-x-2">
                  <Input
                    ref={inputRef}
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message or use voice..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-slate-900 dark:text-white placeholder:text-slate-500"
                    disabled={isTyping}
                    maxLength={500}
                  />
                  
                  {/* Voice Input Button */}
                  <Button
                    onClick={startListening}
                    disabled={isTyping || isListening}
                    className={`rounded-full w-10 h-10 p-0 ${
                      isListening 
                        ? 'bg-red-600 hover:bg-red-700 animate-pulse' 
                        : 'bg-slate-600 hover:bg-slate-700'
                    }`}
                    title="Voice input"
                  >
                    {isListening ? (
                      <MicOff className="w-5 h-5" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                  </Button>
                  
                  {/* Settings Button */}
                  <Button
                    onClick={() => setShowSettings(!showSettings)}
                    className="rounded-full w-10 h-10 p-0 bg-slate-600 hover:bg-slate-700"
                    title="Settings"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  
                  {/* Send Button */}
                  <Button
                    onClick={() => sendMessage(currentMessage)}
                    disabled={!currentMessage.trim() || isTyping}
                    className="rounded-full w-10 h-10 p-0 bg-blue-600 hover:bg-blue-700"
                  >
                    {isTyping ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
                </div>

                {/* Smart helpers under input */}
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => currentMessage && analyzeSymptoms(currentMessage)}>Analyze symptoms</Button>
                    <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => setCurrentMessage('Schedule appointment')}>Book appt</Button>
                    <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => setCurrentMessage('View results')}>View results</Button>
                  </div>
                  <div>Max 500 chars</div>
                </div>
                
                {/* Settings Panel */}
                {showSettings && (
                  <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Voice Responses</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVoiceEnabled(!voiceEnabled)}
                        className={`p-1 h-6 w-12 rounded-full ${
                          voiceEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${
                          voiceEnabled ? 'translate-x-6' : 'translate-x-0'
                        }`} />
                      </Button>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
                      <Shield className="w-3 h-3" />
                      <span>Your conversations are encrypted and secure</span>
                    </div>
                  </div>
                )}
                
                {/* Status Bar */}
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center space-x-2">
                    {connectionError ? (
                      <div className="flex items-center text-orange-600 dark:text-orange-400">
                        <WifiOff className="w-3 h-3 mr-1" />
                        <span>Offline mode</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-green-600 dark:text-green-400">
                        <Wifi className="w-3 h-3 mr-1" />
                        <span>Connected</span>
                      </div>
                    )}
                    {isSpeaking && (
                      <div className="flex items-center text-blue-600 dark:text-blue-400">
                        <Volume2 className="w-3 h-3 mr-1 animate-pulse" />
                        <span>Speaking</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-1">
                    <HelpCircle className="w-3 h-3" />
                    <span>Need help? Just ask!</span>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}