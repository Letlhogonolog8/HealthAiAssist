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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Real-time WebSocket connection
  const { isConnected, sendMessage: sendWSMessage } = useWebSocketRealTime({
    onMessage: (wsMessage) => {
      try {
        if (wsMessage.type === 'new_message') {
          // Refresh messages when new message arrives
          queryClient.invalidateQueries({ queryKey: ['/api/chat/messages', selectedParticipant?.id] });
          
          // Show notification if message is from another user
          if (wsMessage.data.senderId !== currentUser.id) {
            toast({
              title: "New Message",
              description: `${wsMessage.data.senderName}: ${wsMessage.data.message.substring(0, 50)}...`,
            });
          }
        } else if (wsMessage.type === 'typing_indicator') {
          setIsTyping(wsMessage.data.userId !== currentUser.id && wsMessage.data.isTyping);
        } else if (wsMessage.type === 'user_status') {
          // Update participant online status
          queryClient.invalidateQueries({ queryKey: ['/api/chat/participants'] });
        }
      } catch (error) {
        console.error('WebSocket message handling error:', error);
      }
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
      toast({
        title: "Connection Error",
        description: "Real-time messaging may be affected.",
        variant: "destructive"
      });
    }
  });

  // Fetch chat participants based on user role
  const { data: participants = [], error: participantsError } = useQuery<ChatParticipant[]>({
    queryKey: ['/api/chat/participants', currentUser.role],
    queryFn: async () => {
      const response = await fetch(`/api/chat/participants?role=${currentUser.role}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch participants');
      }
      return response.json();
    },
    refetchInterval: 10000
  });

  // Handle participants error
  useEffect(() => {
    if (participantsError) {
      console.error('Failed to fetch participants:', participantsError);
      toast({
        title: "Connection Error",
        description: "Unable to load chat participants.",
        variant: "destructive"
      });
    }
  }, [participantsError, toast]);

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: messagesLoading, error: messagesError } = useQuery<Message[]>({
    queryKey: ['/api/chat/messages', selectedParticipant?.id],
    queryFn: async () => {
      if (!selectedParticipant) return [];
      const response = await fetch(`/api/chat/messages?participantId=${selectedParticipant.id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }
      return response.json();
    },
    enabled: !!selectedParticipant,
    refetchInterval: isConnected ? false : 5000, // Only poll if WebSocket is disconnected
    staleTime: 1000 * 60 // Consider data fresh for 1 minute
  });

  // Handle messages error
  useEffect(() => {
    if (messagesError) {
      console.error('Failed to fetch messages:', messagesError);
    }
  }, [messagesError]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ receiverId, message, messageType = 'text' }: { receiverId: number; message: string; messageType?: string }) => {
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
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    },
    onSuccess: (data) => {
      setMessage("");
      
      // Send real-time notification via WebSocket if connected
      if (isConnected && sendWSMessage) {
        try {
          sendWSMessage({
            type: 'new_message',
            data: {
              senderId: currentUser.id,
              senderName: currentUser.name,
              receiverId: selectedParticipant?.id,
              message: data.message,
              timestamp: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error('Failed to send WebSocket message:', error);
        }
      }
      
      // Refresh messages
      queryClient.invalidateQueries({ queryKey: ['/api/chat/messages', selectedParticipant?.id] });
    },
    onError: (error) => {
      console.error('Send message error:', error);
      toast({
        title: "Failed to send message",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mark messages as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (senderId: number) => {
      const response = await fetch('/api/chat/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ senderId, receiverId: currentUser.id }),
      });
      if (!response.ok) throw new Error('Failed to mark as read');
      return response.json();
    },
    onError: (error) => {
      console.error('Mark as read error:', error);
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

  // Handle typing indicators
  useEffect(() => {
    let typingTimeout: NodeJS.Timeout;
    
    if (message && selectedParticipant && isConnected && sendWSMessage) {
      try {
        sendWSMessage({
          type: 'typing_indicator',
          data: {
            userId: currentUser.id,
            receiverId: selectedParticipant.id,
            isTyping: true
          }
        });
        
        typingTimeout = setTimeout(() => {
          if (sendWSMessage) {
            sendWSMessage({
              type: 'typing_indicator',
              data: {
                userId: currentUser.id,
                receiverId: selectedParticipant.id,
                isTyping: false
              }
            });
          }
        }, 2000);
      } catch (error) {
        console.error('Typing indicator error:', error);
      }
    }

    return () => {
      if (typingTimeout) clearTimeout(typingTimeout);
    };
  }, [message, selectedParticipant, isConnected, sendWSMessage]);

  const handleSendMessage = () => {
    if (message.trim() && selectedParticipant) {
      sendMessageMutation.mutate({
        receiverId: selectedParticipant.id,
        message: message.trim()
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop typing indicator when component unmounts
      if (selectedParticipant && isConnected && sendWSMessage) {
        try {
          sendWSMessage({
            type: 'typing_indicator',
            data: {
              userId: currentUser.id,
              receiverId: selectedParticipant.id,
              isTyping: false
            }
          });
        } catch (error) {
          console.error('Cleanup typing indicator error:', error);
        }
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
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex h-full bg-slate-900 text-white">
      {/* Participants Sidebar */}
      <div className="w-80 bg-slate-800 border-r border-slate-700">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center">
              <MessageSquare className="w-5 h-5 mr-2" />
              Messages
            </h3>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                ✕
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-slate-400">
              {isConnected ? 'Online' : 'Connecting...'}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto h-full">
          {participants.length === 0 ? (
            <div className="p-4 text-center text-slate-400">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No conversations yet</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {participants.map((participant: ChatParticipant) => (
                <div
                  key={participant.id}
                  onClick={() => setSelectedParticipant(participant)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedParticipant?.id === participant.id
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'hover:bg-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback className="bg-slate-600 text-white">
                          {participant.name.split(' ').map((n: string) => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-800 ${
                        participant.isOnline ? 'bg-green-500' : 'bg-gray-400'
                      }`}></div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white truncate">
                          {participant.name}
                        </p>
                        <div className={getRoleColor(participant.role)}>
                          {getRoleIcon(participant.role)}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 capitalize">{participant.role}</p>
                      {!participant.isOnline && participant.lastSeen && (
                        <p className="text-xs text-slate-500">
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
      <div className="flex-1 flex flex-col">
        {selectedParticipant ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-slate-700 bg-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-slate-600 text-white">
                      {selectedParticipant.name.split(' ').map((n: string) => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-white">{selectedParticipant.name}</p>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className={`${getRoleColor(selectedParticipant.role)} border-current`}>
                        {selectedParticipant.role}
                      </Badge>
                      <span className="text-xs text-slate-400">
                        {selectedParticipant.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <Button variant="ghost" size="sm">
                    <Phone className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Video className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messagesLoading ? (
                <div className="text-center text-slate-400">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                  <p className="mt-2">Loading messages...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-slate-400">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Start a conversation with {selectedParticipant.name}</p>
                </div>
              ) : (
                messages.map((msg: Message) => {
                  const isOwnMessage = msg.senderId === currentUser.id;
                  return (
                    <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        isOwnMessage 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-slate-700 text-white'
                      }`}>
                        {!isOwnMessage && (
                          <p className="text-xs opacity-75 mb-1">{msg.senderName}</p>
                        )}
                        <p className="text-sm">{msg.message}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs opacity-75">
                            {formatTime(msg.timestamp)}
                          </span>
                          {isOwnMessage && (
                            <div className="flex items-center space-x-1">
                              {msg.status === 'read' ? (
                                <CheckCircle className="w-3 h-3 text-green-400" />
                              ) : msg.status === 'delivered' ? (
                                <CheckCircle className="w-3 h-3 text-gray-400" />
                              ) : (
                                <Clock className="w-3 h-3 text-gray-400" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-700 rounded-lg px-4 py-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-slate-700 bg-slate-800">
              <div className="flex items-end space-x-2">
                <Button variant="ghost" size="sm">
                  <Paperclip className="w-4 h-4" />
                </Button>
                
                <div className="flex-1">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={`Message ${selectedParticipant.name}...`}
                    className="bg-slate-700 border-slate-600 text-white"
                    disabled={sendMessageMutation.isPending}
                  />
                </div>
                
                <Button variant="ghost" size="sm">
                  <Smile className="w-4 h-4" />
                </Button>
                
                <Button 
                  onClick={handleSendMessage}
                  disabled={!message.trim() || sendMessageMutation.isPending}
                  size="sm"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a conversation to start messaging</p>
              <p className="text-sm">Choose a contact from the sidebar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}