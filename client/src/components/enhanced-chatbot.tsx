import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageCircle, X, Send, Bot, User, Loader2, Calendar, 
  Stethoscope, FileText, AlertTriangle, RefreshCw
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
}

interface EnhancedChatbotProps {
  user?: any;
  onActionClick?: (action: { type: string; data?: any }) => void;
}

export default function EnhancedChatbot({ user, onActionClick }: EnhancedChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
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
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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

  // Smart response generator with improved pattern matching
  const generateSmartResponse = (userInput: string): ChatMessage => {
    const input = userInput.toLowerCase().trim();
    
    const responses = {
      appointment: {
        content: "I can help you schedule an appointment. What type of medical consultation do you need?",
        actions: [
          { type: 'schedule_appointment', label: 'Schedule Now' },
          { type: 'view_appointments', label: 'View Existing' }
        ]
      },
      symptoms: {
        content: "I understand you're concerned about symptoms. While I can't diagnose, I can help you find the right care.",
        actions: [
          { type: 'symptom_checker', label: 'Symptom Checker' },
          { type: 'emergency_help', label: 'Emergency Help' },
          { type: 'schedule_appointment', label: 'See Doctor' }
        ]
      },
      results: {
        content: "I can help you access your medical results and reports.",
        actions: [
          { type: 'view_results', label: 'View Results' },
          { type: 'download_reports', label: 'Download Reports' }
        ]
      },
      emergency: {
        content: "🚨 This seems urgent. For immediate medical emergencies, please call 911 or go to the nearest emergency room.",
        actions: [
          { type: 'emergency_call', label: 'Call 911', urgency: 'urgent' as const },
          { type: 'find_hospital', label: 'Find Hospital' }
        ],
        isEmergency: true
      },
      default: {
        content: "I'm here to help with your healthcare needs. What can I assist you with today?",
        suggestions: [
          "Schedule an appointment",
          "Check symptoms",
          "View test results", 
          "Medication reminders"
        ]
      }
    };

    // Match user input to appropriate response
    if (input.includes('appointment') || input.includes('schedule')) {
      return { ...responses.appointment, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('symptom') || input.includes('pain') || input.includes('sick')) {
      return { ...responses.symptoms, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('result') || input.includes('report') || input.includes('test')) {
      return { ...responses.results, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else if (input.includes('emergency') || input.includes('urgent') || input.includes('help')) {
      return { ...responses.emergency, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    } else {
      return { ...responses.default, id: Date.now().toString(), sender: 'assistant' as const, timestamp: new Date() };
    }
  };

  // Enhanced message sending with API fallback
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
          message: content,
          userId: user?.id 
        })
      });

      let assistantMessage;
      
      if (response.ok) {
        const data = await response.json();
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: data.message,
          sender: 'assistant' as const,
          timestamp: new Date(),
          suggestions: data.suggestions,
          actions: data.actions
        };
      } else {
        assistantMessage = generateSmartResponse(content);
      }

      setMessages(prev => [...prev, assistantMessage]);
      
      if (!isOpen) {
        setUnreadCount(prev => prev + 1);
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: "I'm using offline mode. I can still help with basic healthcare guidance.",
        sender: 'assistant',
        timestamp: new Date(),
        actions: [
          { type: 'schedule_appointment', label: 'Schedule Appointment' },
          { type: 'view_results', label: 'View Results' },
          { type: 'emergency_help', label: 'Emergency Help' }
        ]
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const handleActionClick = (action: { type: string; label: string; data?: any }) => {
    if (onActionClick) {
      onActionClick(action);
    }
    
    const confirmMessage: ChatMessage = {
      id: Date.now().toString(),
      content: `I'll help you with: ${action.label}`,
      sender: 'assistant',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, confirmMessage]);
  };

  // Simplified Quick Actions Component
  const SimplifiedQuickActions = () => (
    <div className="flex flex-wrap gap-2 mb-4 px-2">
      <Button
        variant="default"
        size="sm"
        onClick={() => sendMessage("Schedule appointment")}
        className="text-sm rounded-full bg-blue-600 text-white hover:bg-blue-700 px-4 py-1"
      >
        <Calendar className="w-4 h-4 mr-2" />
        Schedule
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={() => sendMessage("Check symptoms")}
        className="text-sm rounded-full bg-green-600 text-white hover:bg-green-700 px-4 py-1"
      >
        <Stethoscope className="w-4 h-4 mr-2" />
        Symptoms
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={() => sendMessage("View results")}
        className="text-sm rounded-full bg-purple-600 text-white hover:bg-purple-700 px-4 py-1"
      >
        <FileText className="w-4 h-4 mr-2" />
        Results
      </Button>
    </div>
  );

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
            className="fixed bottom-6 right-6 z-50"
          >
            <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-2xl w-96 h-[600px] flex flex-col">
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
                      {isOnline ? 'Online • Ready to help' : 'Offline'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="text-white hover:bg-white/10 p-1"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Messages */}
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex items-start space-x-2 max-w-[85%] ${
                        message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                      }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${
                          message.sender === 'user' 
                            ? 'bg-blue-600' 
                            : 'bg-gradient-to-r from-emerald-500 to-teal-600'
                        }`}>
                          {message.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>

                        <div className="flex flex-col">
                          <div className={`rounded-2xl px-4 py-3 shadow-md ${
                            message.sender === 'user'
                              ? 'bg-blue-600 text-white rounded-br-md'
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
                            className={`text-xs rounded-full px-3 py-1 shadow-md transform hover:scale-105 transition-all ${
                              action.urgency === 'urgent' 
                                ? 'bg-red-600 hover:bg-red-700 text-white'
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
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {/* Quick Actions */}
                <SimplifiedQuickActions />

                {/* Main Input */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-900 rounded-lg px-4 py-2 space-x-3">
                  <Input
                    ref={inputRef}
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(currentMessage);
                      }
                    }}
                    placeholder="Type your message..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-slate-900 dark:text-white placeholder:text-slate-500"
                    disabled={isTyping}
                  />
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
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}