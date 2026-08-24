import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocketRealTime } from "@/hooks/useWebSocketRealTime";
import { 
  MessageSquare, 
  Send, 
  Phone, 
  Video, 
  Paperclip, 
  Smile,
  Clock,
  CheckCircle,
  User,
  Stethoscope,
  Brain
} from "lucide-react";

interface Message {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  receiverId: number;
  message: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  messageType: 'text' | 'image' | 'file';
}

interface ChatParticipant {
  id: number;
  name: string;
  role: string;
  isOnline: boolean;
  lastSeen?: string;
}

interface RealTimeChatProps {
  currentUser: {
    id: number;
    name: string;
    role: string;
  };
  chatWith?: ChatParticipant;
  onClose?: () => void;
}

export default function RealTimeChat({ currentUser, chatWith, onClose }: RealTimeChatProps) {
  const [message, setMessage] = useState("");
  const [selectedParticipant, setSelectedParticipant] = useState<ChatParticipant | null>(chatWith || null);
  const [isTyping, setIsTyping] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [currentCallSid, setCurrentCallSid] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [wsError, setWsError] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // WebSocket connection for real-time messaging
  const { isConnected, sendMessage: sendWSMessage, connectionState } = useWebSocketRealTime({
    onMessage: (message) => {
      try {
        if (message.type === 'new_message' || message.type === 'new_chat_message') {
          // Update messages cache with new message
          queryClient.setQueryData(
            ['/api/chat/messages', message.data.senderId === currentUser.id ? message.data.receiverId : message.data.senderId],
            (old: Message[] | undefined) => {
              const existing = old || [];
              const newMessage = {
                id: message.data.id,
                senderId: message.data.senderId,
                senderName: message.data.senderName,
                senderRole: message.data.senderRole,
                receiverId: message.data.receiverId,
                message: message.data.message,
                timestamp: message.data.timestamp,
                status: 'delivered' as const,
                messageType: 'text' as const
              };
              
              // Avoid duplicates
              if (!existing.find(msg => msg.id === newMessage.id)) {
                return [...existing, newMessage];
              }
              return existing;
            }
          );
          
          // Show notification for received messages
          if (message.data.senderId !== currentUser.id) {
            toast({
              title: `New message from ${message.data.senderName}`,
              description: message.data.message.slice(0, 50) + (message.data.message.length > 50 ? '...' : ''),
            });
          }
        } else if (message.type === 'typing' || message.type === 'typing_indicator') {
          setIsTyping(message.data.isTyping);
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
      setWsError(true);
      toast({
        title: "Connection Error",
        description: "Lost connection to chat server. Retrying...",
        variant: "destructive"
      });
    },
    onOpen: () => {
      setWsError(false);
      console.log('WebSocket connected for chat');
      
      // Register user when connected
      if (sendWSMessage) {
        sendWSMessage({
          type: 'register',
          data: {
            id: currentUser.id,
            username: currentUser.name,
            fullName: currentUser.name,
            role: currentUser.role
          }
        });
      }
    },
    onClose: () => {
      setWsError(true);
      console.log('WebSocket disconnected from chat');
    }
  });

  // Fetch chat participants based on user role
  const { data: participants = [], error: participantsError } = useQuery<ChatParticipant[]>({
    queryKey: ['/api/chat/participants', currentUser.role],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/chat/participants?role=${currentUser.role}`, {
          credentials: 'include'
        });
        if (!response.ok) {
          return [];
        }
        return response.json();
      } catch (error) {
        console.error('Failed to fetch participants:', error);
        return [];
      }
    },
    refetchInterval: 30000,
    staleTime: 60000
  });

  // Handle participants error
  useEffect(() => {
    if (participantsError) {
      console.error('Failed to fetch participants:', participantsError);
      setChatError('Unable to load chat participants');
    }
  }, [participantsError]);

  // Fetch messages for selected conversation with real-time polling
  const { data: messages = [], isLoading: messagesLoading, error: messagesError } = useQuery<Message[]>({
    queryKey: ['/api/chat/messages', selectedParticipant?.id],
    queryFn: async () => {
      if (!selectedParticipant) return [];
      try {
        const response = await fetch(`/api/chat/messages?participantId=${selectedParticipant.id}`, {
          credentials: 'include'
        });
        if (!response.ok) {
          return [];
        }
        return response.json();
      } catch (error) {
        console.error('Failed to fetch messages:', error);
        return [];
      }
    },
    enabled: !!selectedParticipant,
    refetchInterval: isConnected ? 30000 : 5000, // Longer interval when WebSocket is connected
    staleTime: isConnected ? 30000 : 0 // Cache longer when real-time updates available
  });

  // Handle messages error
  useEffect(() => {
    if (messagesError) {
      console.error('Failed to fetch messages:', messagesError);
      setChatError('Unable to load messages');
    }
  }, [messagesError]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ receiverId, message, messageType = 'text' }: { receiverId: number; message: string; messageType?: string }) => {
      try {
        const response = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            receiverId,
            message,
            messageType,
            senderId: currentUser.id
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to send message');
        }
        return response.json();
      } catch (error) {
        console.error('Failed to send message:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      // Clear input only on successful send
      setMessage("");
      
      // Add message to local state immediately and keep it there
      const newMessage = {
        id: data.id || Date.now(),
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderRole: currentUser.role,
        receiverId: selectedParticipant?.id,
        message: data.message || message,
        timestamp: data.timestamp || new Date().toISOString(),
        status: 'sent' as const,
        messageType: 'text' as const
      };
      
      // Update messages and persist them
      queryClient.setQueryData(
        ['/api/chat/messages', selectedParticipant?.id],
        (old: any) => {
          const existing = old || [];
          // Avoid duplicates
          if (!existing.find((msg: any) => msg.id === newMessage.id)) {
            return [...existing, newMessage];
          }
          return existing;
        }
      );
      
      // Delivery and notification are handled by POST /api/chat/send itself.
      //
      // The client used to do both jobs after the message was stored: relay a
      // copy to the recipient over its own socket, and POST /api/chat/notify to
      // raise their notification. Neither was trustworthy — the relay let a
      // client address a message to anyone with any sender attached, and the
      // notify endpoint required no authentication at all — and both were
      // redundant, because the server knows the sender and the recipient the
      // moment it writes the row. It pushes to the recipient's socket and writes
      // the notification there.
    },


  });

  // Mark messages as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (senderId: number) => {
      try {
        const response = await fetch('/api/chat/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ senderId, receiverId: currentUser.id }),
        });
        if (!response.ok) {
          throw new Error('Failed to mark as read');
        }
        return response.json();
      } catch (error) {
        console.error('Mark as read error:', error);
        throw error;
      }
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Mark as read error:', errorMessage);
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark messages as read when conversation is opened
  useEffect(() => {
    if (selectedParticipant && messages.length > 0) {
      const unreadMessages = messages.filter(msg => 
        msg.senderId === selectedParticipant.id && msg.status !== 'read'
      );
      if (unreadMessages.length > 0) {
        markAsReadMutation.mutate(selectedParticipant.id);
      }
    }
  }, [selectedParticipant, messages]);

  // Typing indicators
  useEffect(() => {
    let typingTimeout: NodeJS.Timeout;
    
    const handleTyping = () => {
      if (isConnected && sendWSMessage && selectedParticipant && message.trim()) {
        sendWSMessage({
          type: 'typing',
          data: { isTyping: true, userId: currentUser.id },
          targetUserId: selectedParticipant.id
        });
        
        // Stop typing after 2 seconds of inactivity
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          sendWSMessage({
            type: 'typing',
            data: { isTyping: false, userId: currentUser.id },
            targetUserId: selectedParticipant.id
          });
        }, 2000);
      }
    };
    
    if (message) {
      handleTyping();
    }
    
    return () => {
      clearTimeout(typingTimeout);
    };
  }, [message, isConnected, sendWSMessage, selectedParticipant, currentUser.id]);

  const handleSendMessage = () => {
    if (message.trim() && selectedParticipant) {
      const messageToSend = message.trim();
      
      // Send the message
      sendMessageMutation.mutate({
        receiverId: selectedParticipant.id,
        message: messageToSend
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    try {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    } catch (error) {
      console.error('Key press error:', error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Send typing stop message when component unmounts
      if (isConnected && sendWSMessage && selectedParticipant) {
        sendWSMessage({
          type: 'typing',
          data: { isTyping: false, userId: currentUser.id },
          targetUserId: selectedParticipant.id
        });
      }
    };
  }, []);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'doctor': return <Stethoscope className="w-4 h-4" />;
      case 'radiologist': return <Brain className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'doctor': return 'text-blue-400';
      case 'radiologist': return 'text-purple-400';
      case 'patient': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return 'Now';
    }
  };
  

  // Handle voice call with Twilio (simplified)
  const handleVoiceCall = async () => {
    if (!selectedParticipant) {
      toast({
        title: "No participant selected",
        description: "Please select someone to call",
        variant: "destructive"
      });
      return;
    }

    try {
      toast({
        title: "Initiating Call",
        description: `Calling ${selectedParticipant.name}...`,
      });

      // Make direct call without tokens
      const callResponse = await fetch('/api/voice/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recipientId: selectedParticipant.id })
      });

      if (callResponse.ok) {
        const result = await callResponse.json();
        setIsCallActive(true);
        setCurrentCallSid(result.callSid);
        toast({
          title: "Call Connected",
          description: `Call active with ${selectedParticipant.name}`,
        });
      } else {
        const errorText = await callResponse.text();
        console.error('Call API error:', callResponse.status, errorText);
        throw new Error(`Failed to initiate call: ${callResponse.status}`);
      }
    } catch (error) {
      console.error('Voice call error:', error);
      const errorMessage = error instanceof Error ? error.message : "Unable to connect the call. Please try again.";
      toast({
        title: "Call Failed",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  // Handle video call with Microsoft Teams
  const handleVideoCall = async () => {
    if (!selectedParticipant) {
      toast({
        title: "No participant selected",
        description: "Please select someone to call",
        variant: "destructive"
      });
      return;
    }

    try {
      toast({
        title: "Creating Teams Meeting",
        description: `Setting up video call with ${selectedParticipant.name}...`,
      });

      // Create Teams meeting
      const response = await fetch('/api/teams/create-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participantId: selectedParticipant.id,
          participantName: selectedParticipant.name,
          subject: `Medical Consultation - ${currentUser.name} & ${selectedParticipant.name}`
        })
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          
          // Open Teams meeting in new window
          window.open(result.joinUrl, '_blank', 'width=1200,height=800');
          
          toast({
            title: "Teams Meeting Created",
            description: `Video call started with ${selectedParticipant.name}`,
          });

          // Send meeting link to participant via chat
          sendMessageMutation.mutate({
            receiverId: selectedParticipant.id,
            message: `📹 Video call invitation: ${result.joinUrl}`
          });
        } else {
          throw new Error('Invalid response format from server');
        }
      } else {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Teams video call error:', error);
      toast({
        title: "Video Call Failed",
        description: "Unable to create Teams meeting. Please try again.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden">
      {/* Participants Sidebar */}
      <div className="w-72 sm:w-80 bg-slate-800/90 backdrop-blur-sm border-r border-slate-700/50">
        <div className="p-3 sm:p-4 border-b border-slate-700/50 bg-slate-800/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold flex items-center text-white">
              <MessageSquare className="w-5 h-5 mr-2 text-blue-400" />
              Messages
            </h3>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} className="hover:bg-slate-700">
                ✕
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-2 px-2 py-1 rounded-full bg-slate-700/50">
            <div className={`w-2 h-2 rounded-full animate-pulse ${
              isConnected ? 'bg-green-400' : wsError ? 'bg-red-400' : 'bg-yellow-400'
            }`}></div>
            <span className="text-xs text-slate-300 font-medium">
              {isConnected ? 'Connected' : wsError ? 'Disconnected' : 'Connecting...'}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto h-full scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
          {!participants || participants.length === 0 ? (
            <div className="p-6 text-center text-slate-400">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-sm font-medium">{participants === undefined ? 'Loading participants...' : 'No conversations yet'}</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {(participants || []).map((participant: ChatParticipant) => (
                <div
                  key={participant.id}
                  onClick={() => setSelectedParticipant(participant)}
                  className={`p-3 rounded-xl cursor-pointer transition-all duration-200 border ${
                    selectedParticipant?.id === participant.id
                      ? 'bg-blue-600/20 border-blue-500/50 shadow-lg shadow-blue-500/10'
                      : 'hover:bg-slate-700/50 border-transparent hover:border-slate-600/50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Avatar className="w-11 h-11 ring-2 ring-slate-600/50">
                        <AvatarFallback className="bg-gradient-to-br from-slate-600 to-slate-700 text-white font-semibold">
                          {participant.name ? participant.name.split(' ').map((n: string) => n[0]).join('') : '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-800 ${
                        participant.isOnline ? 'bg-green-400' : 'bg-slate-50 dark:bg-slate-8000'
                      }`}></div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {participant.name || 'Unknown'}
                        </p>
                        <div className={`${getRoleColor(participant.role || 'unknown')} opacity-80`}>
                          {getRoleIcon(participant.role)}
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 capitalize font-medium">{participant.role || 'unknown'}</p>
                      {!participant.isOnline && participant.lastSeen && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Last seen {formatTime(participant.lastSeen)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50">
        {selectedParticipant ? (
          <>
            {/* Chat Header - Enhanced visibility and layout */}
            <div className="p-3 sm:p-4 border-b border-slate-700/50 bg-slate-800/80 backdrop-blur-sm flex-shrink-0 sticky top-0 z-10 shadow-xl">
              <div className="flex items-center justify-between gap-2 sm:gap-4">
                {/* User Info Section */}
                <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
                  <Avatar className="w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ring-2 ring-slate-600/50">
                    <AvatarFallback className="bg-gradient-to-br from-slate-600 to-slate-700 text-white text-xs sm:text-sm font-semibold">
                      {selectedParticipant?.name ? selectedParticipant.name.split(' ').map((n: string) => n[0]).join('') : '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white truncate text-sm sm:text-base">{selectedParticipant?.name || 'Select a contact'}</p>
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      {selectedParticipant && (
                        <Badge variant="outline" className={`${getRoleColor(selectedParticipant.role)} border-current text-xs font-medium`}>
                          {selectedParticipant.role}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-300 font-medium">
                        {selectedParticipant ? 'Available' : 'No contact selected'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Call Buttons Section - Always visible when participant selected */}
                {selectedParticipant && (
                  <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
                    {isCallActive ? (
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            /*
                              /api/voice/hangup is not a route this server
                              registers — only /api/voice/token and
                              /api/voice/call exist — so this request 404'd and
                              execution fell straight through to the "Call Ended"
                              toast below. The call itself was never terminated
                              at Twilio: it stayed connected and kept billing,
                              while the interface reported it as disconnected.

                              Ending a call server-side needs an endpoint that
                              looks the SID up, checks the caller is party to it,
                              and asks Twilio to complete it. That endpoint does
                              not exist yet, so the button no longer claims to
                              have done it.
                            */
                            if (currentCallSid) {
                              console.warn(
                                'No server endpoint exists to end a Twilio call; ' +
                                  'the call may still be connected.'
                              );
                            }
                            setIsCallActive(false);
                            setCurrentCallSid(null);
                            toast({
                              title: "Call closed here",
                              description: currentCallSid
                                ? "This window has stopped showing the call. Hang up on your phone to end it."
                                : "Call has been disconnected",
                            });
                          } catch (error) {
                            console.error('Hangup error:', error);
                            toast({
                              title: "Error",
                              description: "Failed to end call",
                              variant: "destructive"
                            });
                          }
                        }}
                        title="End Call"
                        className="bg-red-500 hover:bg-red-600 text-white px-2 sm:px-4 py-2 min-w-0 shadow-lg"
                      >
                        <Phone className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">End Call</span>
                      </Button>
                    ) : (
                      <>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleVoiceCall();
                          }}
                          title="Start Voice Call"
                          className="bg-green-500 hover:bg-green-600 text-white border-green-500 px-2 sm:px-3 py-2 min-w-0 shadow-lg transition-all"
                        >
                          <Phone className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline ml-1">Call</span>
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleVideoCall();
                          }}
                          title="Start Video Call"
                          className="bg-blue-500 hover:bg-blue-600 text-white border-blue-500 px-2 sm:px-3 py-2 min-w-0 shadow-lg transition-all"
                        >
                          <Video className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline ml-1">Video</span>
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
              {messagesLoading ? (
                <div className="text-center text-slate-400 py-8">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto"></div>
                  <p className="mt-3 font-medium">Loading messages...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-slate-400 py-12">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Start a conversation with {selectedParticipant.name}</p>
                  <p className="text-sm mt-1 opacity-75">Send a message to begin chatting</p>
                </div>
              ) : (
(messages || []).map((msg: Message) => {
                  try {
                    const isOwnMessage = msg.senderId === currentUser.id;
                    return (
                      <div key={msg.id || Math.random()} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-3`}>
                        <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl shadow-lg ${
                          isOwnMessage 
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' 
                            : 'bg-slate-700/80 backdrop-blur-sm text-white border border-slate-600/50'
                        }`}>
                          {!isOwnMessage && (
                            <p className="text-xs opacity-75 mb-2 font-medium">{msg.senderName || 'Unknown'}</p>
                          )}
                          <p className="text-sm leading-relaxed">{msg.message || ''}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs opacity-75 font-medium">
                              {msg.timestamp ? formatTime(msg.timestamp) : 'Now'}
                            </span>
                            {isOwnMessage && (
                              <div className="flex items-center space-x-1">
                                {msg.status === 'read' ? (
                                  <CheckCircle className="w-3 h-3 text-green-300" />
                                ) : msg.status === 'delivered' ? (
                                  <CheckCircle className="w-3 h-3 text-gray-300" />
                                ) : (
                                  <Clock className="w-3 h-3 text-gray-300" />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  } catch (error) {
                    console.error('Error rendering message:', error);
                    return null;
                  }
                })
              )}
              
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-700/80 backdrop-blur-sm rounded-2xl px-4 py-3 border border-slate-600/50">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-slate-700/50 bg-slate-800/80 backdrop-blur-sm">
              <div className="flex items-end space-x-3 bg-slate-700/50 rounded-2xl p-3 border border-slate-600/50">
                <Button variant="ghost" size="sm" className="hover:bg-slate-600/50 rounded-xl">
                  <Paperclip className="w-4 h-4 text-slate-300" />
                </Button>
                
                <div className="flex-1">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={`Message ${selectedParticipant.name}...`}
                    className="bg-transparent border-none text-white placeholder-slate-400 focus:ring-0 focus:outline-none text-sm"
                    disabled={sendMessageMutation.isPending}
                  />
                </div>
                
                <Button variant="ghost" size="sm" className="hover:bg-slate-600/50 rounded-xl">
                  <Smile className="w-4 h-4 text-slate-300" />
                </Button>
                
                <Button 
                  onClick={handleSendMessage}
                  disabled={!message.trim() || sendMessageMutation.isPending}
                  size="sm"
                  className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl px-4 shadow-lg transition-all"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center py-12">
              <MessageSquare className="w-20 h-20 mx-auto mb-6 opacity-30" />
              <p className="text-xl font-semibold mb-2">Select a conversation to start messaging</p>
              <p className="text-sm opacity-75">Choose a contact from the sidebar to begin chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}