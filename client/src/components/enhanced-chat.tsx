import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
  Send, 
  Phone, 
  Video, 
  MoreHorizontal, 
  Search,
  Paperclip,
  Smile,
  Users,
  Settings,
  WifiOff,
  SignalHigh,
  SignalMedium,
  SignalLow,
  MessageCircle
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

interface Message {
  id: string;
  content: string;
  sender: {
    id: number;
    name: string;
    role: string;
    avatar?: string;
  };
  timestamp: string;
  type: 'text' | 'image' | 'file' | 'system';
  status: 'sent' | 'delivered' | 'read';
  isEdited?: boolean;
  replyTo?: string;
}

interface Participant {
  id: number;
  name: string;
  role: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: string;
}

interface EnhancedChatProps {
  user?: {
    id: number;
    username: string;
    role: string;
    fullName: string;
  };
  participants?: Participant[];
  onSendMessage?: (message: string, targetUserId?: number) => void;
  className?: string;
}

export default function EnhancedChat({ 
  user, 
  participants = [], 
  onSendMessage,
  className = ''
}: EnhancedChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(new Map());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);
  
  // WebSocket connection
  useEffect(() => {
    if (!user) return;
    
    const connectWebSocket = () => {
      setConnectionState('connecting');
      
      // Get the proper host and port for WebSocket connection
      let host = window.location.hostname;
      let port = window.location.port;
      
      // Use backend port 5000 for WebSocket in development
      if (host === 'localhost' && port === '5173') {
        port = '5000';
      }
      
      // Validate host and port
      if (!host || port === 'undefined' || window.location.host.includes('undefined')) {
        console.warn('Invalid host or port for WebSocket connection');
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${host}:${port}/ws`;
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        setConnectionState('connected');
        // Authenticate user
        wsRef.current?.send(JSON.stringify({
          type: 'user_authenticate',
          data: user
        }));
      };
      
      wsRef.current.onclose = () => {
        setConnectionState('disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
      
      wsRef.current.onerror = () => {
        setConnectionState('error');
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    };
    
    connectWebSocket();
    
    return () => {
      wsRef.current?.close();
    };
  }, [user]);
  
  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'new_chat_message':
        const newMsg: Message = {
          id: data.data.id || Date.now().toString(),
          content: data.data.content,
          sender: data.data.sender,
          timestamp: data.data.timestamp || new Date().toISOString(),
          type: data.data.type || 'text',
          status: 'delivered'
        };
        setMessages(prev => [...prev, newMsg]);
        
        // Update unread count if message is not from current user
        if (data.data.sender.id !== user?.id) {
          setUnreadCounts(prev => {
            const newCounts = new Map(prev);
            const current = newCounts.get(data.data.sender.id) || 0;
            newCounts.set(data.data.sender.id, current + 1);
            return newCounts;
          });
        }
        break;
        
      case 'typing_indicator':
        if (data.data.isTyping && data.data.userId !== user?.id) {
          setTypingUsers(prev => new Set(prev).add(data.data.userId));
        } else {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.data.userId);
            return newSet;
          });
        }
        break;
        
      case 'user_status_update':
        // Update participant status
        break;
        
      case 'connection_established':
        console.log('WebSocket connection established');
        break;
        
      case 'authentication_success':
        console.log('User authenticated successfully');
        break;
        
      default:
        console.log('Unknown message type:', data.type);
    }
  };
  
  // Send message
  const handleSendMessage = () => {
    if (!newMessage.trim() || !wsRef.current || connectionState !== 'connected') {
      return;
    }
    
    /**
     * A message must name its recipient before it is sent.
     *
     * `selectedParticipant?.id` is undefined until a conversation is picked, and
     * the server used to broadcast an unaddressed chat message to every open
     * socket on the platform — a clinical message delivered to every signed-in
     * user, whatever their role. The server now refuses those, and this stops
     * one being composed and silently dropped.
     */
    if (!selectedParticipant?.id) {
      console.warn('No conversation is selected; not sending.');
      return;
    }

    const messageData = {
      type: 'chat_message',
      data: {
        content: newMessage.trim(),
        sender: {
          id: user?.id,
          name: user?.fullName || user?.username,
          role: user?.role
        },
        targetUserId: selectedParticipant.id,
        timestamp: new Date().toISOString()
      }
    };
    
    wsRef.current.send(JSON.stringify(messageData));
    
    // Add message to local state immediately for better UX
    const localMessage: Message = {
      id: Date.now().toString(),
      content: newMessage.trim(),
      sender: {
        id: user?.id || 0,
        name: user?.fullName || user?.username || 'You',
        role: user?.role || 'patient'
      },
      timestamp: new Date().toISOString(),
      type: 'text',
      status: 'sent'
    };
    
    setMessages(prev => [...prev, localMessage]);
    setNewMessage('');
    
    // Clear typing indicator
    sendTypingIndicator(false);
    
    // Call external handler if provided
    onSendMessage?.(newMessage.trim(), selectedParticipant.id);
  };
  
  // Handle typing indicator
  const sendTypingIndicator = (isTyping: boolean) => {
    if (!wsRef.current || connectionState !== 'connected') return;
    
    // Same reasoning as sendMessage: an unaddressed indicator has nowhere to go.
    if (!selectedParticipant?.id) return;

    wsRef.current.send(JSON.stringify({
      type: 'typing_indicator',
      data: {
        userId: user?.id,
        isTyping,
        targetUserId: selectedParticipant.id
      }
    }));
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    // Send typing indicator
    sendTypingIndicator(true);
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingIndicator(false);
    }, 1000);
  };
  
  // Connection status indicator
  const getConnectionIcon = () => {
    switch (connectionState) {
      case 'connected':
        return <SignalHigh className="w-4 h-4 text-green-500" />;
      case 'connecting':
        return <SignalMedium className="w-4 h-4 text-yellow-500 animate-pulse" />;
      case 'error':
        return <SignalLow className="w-4 h-4 text-red-500" />;
      default:
        return <WifiOff className="w-4 h-4 text-muted-foreground" />;
    }
  };
  
  // Format message timestamp
  const formatMessageTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return 'Yesterday ' + format(date, 'HH:mm');
    } else {
      return format(date, 'MMM dd, HH:mm');
    }
  };
  
  // Filter participants based on search
  const filteredParticipants = participants.filter(participant =>
    participant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    participant.role.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  // Get messages for selected conversation
  const conversationMessages = selectedParticipant 
    ? messages.filter(msg => 
        msg.sender.id === selectedParticipant.id || 
        msg.sender.id === user?.id
      )
    : messages;
  
  return (
    <div className={`flex h-full bg-background ${className}`}>
      {/* Participants Sidebar */}
      <div className="w-80 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              Messages
            </h2>
            <div className="flex items-center gap-2">
              {getConnectionIcon()}
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {/* All participants option */}
            <div
              className={`p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                !selectedParticipant ? 'bg-accent' : ''
              }`}
              onClick={() => {
                setSelectedParticipant(null);
                setUnreadCounts(new Map());
              }}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Users className="w-8 h-8 p-1 bg-primary/10 text-primary rounded-full" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">All Conversations</p>
                  <p className="text-xs text-muted-foreground">
                    General chat with all participants
                  </p>
                </div>
                {!selectedParticipant && (
                  <Badge variant="secondary" className="text-xs">
                    Active
                  </Badge>
                )}
              </div>
            </div>
            
            <Separator />
            
            {/* Individual participants */}
            {filteredParticipants.map((participant) => {
              const unreadCount = unreadCounts.get(participant.id) || 0;
              
              return (
                <div
                  key={participant.id}
                  className={`p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                    selectedParticipant?.id === participant.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => {
                    setSelectedParticipant(participant);
                    // Clear unread count for this participant
                    setUnreadCounts(prev => {
                      const newCounts = new Map(prev);
                      newCounts.delete(participant.id);
                      return newCounts;
                    });
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={participant.avatar} />
                        <AvatarFallback className="text-xs">
                          {participant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
                        participant.status === 'online' ? 'bg-green-500' :
                        participant.status === 'away' ? 'bg-yellow-500' : 'bg-gray-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{participant.name}</p>
                        <Badge variant="outline" className="text-xs capitalize">
                          {participant.role}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {participant.status === 'online' ? 'Online' : 
                         participant.lastSeen ? `Last seen ${formatMessageTime(participant.lastSeen)}` : 'Offline'}
                      </p>
                    </div>
                    {unreadCount > 0 && (
                      <Badge variant="destructive" className="text-xs min-w-[20px] h-5 rounded-full">
                        {unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
      
      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="p-3 sm:p-4 border-b bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {selectedParticipant ? (
                <>
                  <Avatar className="w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0">
                    <AvatarImage src={selectedParticipant.avatar} />
                    <AvatarFallback className="text-xs">
                      {selectedParticipant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm sm:text-base truncate">{selectedParticipant.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize">
                      {selectedParticipant.role} • {selectedParticipant.status}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Users className="w-8 h-8 sm:w-10 sm:h-10 p-1 bg-primary/10 text-primary rounded-full flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm sm:text-base">All Conversations</h3>
                    <p className="text-xs text-muted-foreground">
                      {participants.length} participants online
                    </p>
                  </div>
                </>
              )}
            </div>
            
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {selectedParticipant && (
                <>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="px-2 sm:px-3 hover:bg-green-50 hover:text-green-600"
                    title="Voice Call"
                  >
                    <Phone className="w-4 h-4 sm:mr-1" />
                    <span className="hidden sm:inline ml-1">Call</span>
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="px-2 sm:px-3 hover:bg-blue-50 hover:text-blue-600"
                    title="Video Call"
                  >
                    <Video className="w-4 h-4 sm:mr-1" />
                    <span className="hidden sm:inline ml-1">Video</span>
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="px-2">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        
        {/* Messages Area */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {conversationMessages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No messages yet. Start a conversation!</p>
              </div>
            ) : (
              conversationMessages.map((message, index) => {
                const isOwnMessage = message.sender.id === user?.id;
                const showAvatar = !isOwnMessage && (
                  index === 0 || 
                  conversationMessages[index - 1].sender.id !== message.sender.id
                );
                
                return (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isOwnMessage && (
                      <div className="w-8">
                        {showAvatar && (
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={message.sender.avatar} />
                            <AvatarFallback className="text-xs">
                              {message.sender.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )}
                    
                    <div className={`max-w-[70%] ${isOwnMessage ? 'text-right' : 'text-left'}`}>
                      {showAvatar && !isOwnMessage && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{message.sender.name}</span>
                          <Badge variant="outline" className="text-xs capitalize">
                            {message.sender.role}
                          </Badge>
                        </div>
                      )}
                      
                      <div
                        className={`inline-block px-4 py-2 rounded-2xl ${
                          isOwnMessage
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-accent text-accent-foreground'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </div>
                      
                      <div className={`text-xs text-muted-foreground mt-1 ${
                        isOwnMessage ? 'text-right' : 'text-left'
                      }`}>
                        {formatMessageTime(message.timestamp)}
                        {isOwnMessage && (
                          <span className="ml-2">
                            {message.status === 'sent' && '✓'}
                            {message.status === 'delivered' && '✓✓'}
                            {message.status === 'read' && '✓✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            
            {/* Typing indicator */}
            {typingUsers.size > 0 && (
              <div className="flex gap-3">
                <div className="w-8" />
                <div className="text-sm text-muted-foreground italic">
                  {Array.from(typingUsers).map(userId => {
                    const typingUser = participants.find(p => p.id === userId);
                    return typingUser?.name || 'Someone';
                  }).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        
        {/* Message Input */}
        <div className="p-4 border-t bg-card">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              <Paperclip className="w-4 h-4" />
            </Button>
            
            <div className="flex-1 relative">
              <Input
                placeholder={selectedParticipant 
                  ? `Message ${selectedParticipant.name}...` 
                  : "Message all participants..."
                }
                value={newMessage}
                onChange={handleInputChange}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={connectionState !== 'connected'}
                className="pr-10"
              />
              <Button 
                variant="ghost" 
                size="sm" 
                className="absolute right-1 top-1/2 transform -translate-y-1/2"
              >
                <Smile className="w-4 h-4" />
              </Button>
            </div>
            
            <Button 
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || connectionState !== 'connected'}
              size="sm"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          
          {connectionState !== 'connected' && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {connectionState === 'connecting' ? 'Connecting...' : 
               connectionState === 'error' ? 'Connection error. Retrying...' : 
               'Not connected'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
