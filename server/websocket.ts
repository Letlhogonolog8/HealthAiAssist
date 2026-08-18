import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import cookie from 'cookie';

interface ConnectedUser {
  id: number;
  username: string;
  role: string;
  fullName: string;
  lastSeen: Date;
  ws: WebSocket;
  sessionId?: string;
}

interface WebSocketMessage {
  type: string;
  data?: any;
  timestamp?: Date;
  userId?: number;
  targetUserId?: number;
}

export class EnhancedWebSocketManager {
  private wss: WebSocketServer;
  private connectedUsers = new Map<string, ConnectedUser>();
  private userSockets = new Map<number, WebSocket>();
  private connectionCount = 0;
  private messageCount = 0;
  private heartbeatInterval: NodeJS.Timeout;

  constructor(server: Server) {
    // `noServer` plus a manual upgrade route, rather than `{ server, path }`.
    //
    // With `{ server, path: '/ws' }` the ws library attaches its own upgrade
    // listener and calls abortHandshake(400) on any upgrade whose path does not
    // match — it rejects them rather than ignoring them. In development Vite
    // serves HMR over this same HTTP server at `/?token=...`, so every HMR
    // connection was being killed by this class before Vite could see it. The
    // browser then fell back to the configured Vite port and failed there too,
    // which is the "failed to connect to websocket" the client reports.
    //
    // Routing upgrades by hand lets anything that is not ours pass through
    // untouched.
    this.wss = new WebSocketServer({
      noServer: true,
      verifyClient: this.verifyClient.bind(this),
    });

    server.on('upgrade', (request, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        return; // Malformed target — leave it for another listener to handle.
      }

      if (pathname !== '/ws') return; // Not ours: Vite's HMR, or anything else.

      this.wss.handleUpgrade(request, socket as any, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.setupWebSocket();
    this.startHeartbeat();
  }

  private verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }): boolean {
    try {
      // Parse cookies to get session information
      const cookies = cookie.parse(info.req.headers.cookie || '');
      
      // Allow connection if we have a session cookie
      // In production, you'd want to validate the session more thoroughly
      return true; // For now, accept all connections
    } catch (error) {
      console.error('WebSocket verification error:', error);
      return false;
    }
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.connectionCount++;
      console.log(`🔌 WebSocket connection established. Total: ${this.connectionCount}`);

      // Enhanced connection setup
      this.setupConnection(ws, request);
    });

    this.wss.on('error', (error) => {
      console.error('🚨 WebSocket Server Error:', error);
    });
  }

  private setupConnection(ws: WebSocket, request: IncomingMessage) {
    // Connection metadata
    const connectionId = `${Date.now()}-${Math.random()}`;
    let userId: number | null = null;
    let lastMessageTime = 0;
    const messageThrottleInterval = 100; // milliseconds

    // Enhanced error handling
    ws.on('error', (error) => {
      console.error(`🚨 WebSocket Error (${connectionId}):`, error.message);
      this.handleDisconnection(ws);
    });

    ws.on('close', (code, reason) => {
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      console.log(`🔌 WebSocket disconnected (${connectionId}): ${code} - ${reason.toString()}`);
      this.handleDisconnection(ws);
    });

    // Enhanced message handling
    ws.on('message', async (rawMessage) => {
      const now = Date.now();
      
      // Throttle messages
      if (now - lastMessageTime < messageThrottleInterval) {
        return;
      }
      lastMessageTime = now;

      try {
        const message: WebSocketMessage = JSON.parse(rawMessage.toString());
        message.timestamp = new Date();
        
        await this.handleMessage(ws, message, connectionId);
        this.messageCount++;
      } catch (error) {
        console.error(`🚨 Message parsing error (${connectionId}):`, error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    // Send welcome message
    this.sendMessage(ws, {
      type: 'connection_established',
      data: { connectionId, timestamp: new Date() }
    });
  }

  private async handleMessage(ws: WebSocket, message: WebSocketMessage, connectionId: string) {
    switch (message.type) {
      case 'register':
      case 'user_authenticate':
        await this.handleUserAuthentication(ws, message.data, connectionId);
        break;
      
      case 'heartbeat':
        await this.handleHeartbeat(ws, message.data?.userId);
        break;
      
      case 'new_message':
      case 'chat_message':
        await this.handleChatMessage(message);
        break;
      
      case 'typing':
      case 'typing_indicator':
        await this.handleTypingIndicator(message);
        break;
      
      case 'activity_update':
        await this.broadcastActivity(message.data);
        break;
      
      case 'scan_update':
        await this.broadcastScanUpdate(message.data);
        break;
      
      case 'notification':
        await this.handleNotification(message);
        break;
      
      default:
        console.warn(`🤷 Unknown message type: ${message.type}`);
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  private async handleUserAuthentication(ws: WebSocket, userData: any, connectionId: string) {
    try {
      if (!userData || !userData.id) {
        this.sendError(ws, 'Invalid user data');
        return;
      }

      const connectedUser: ConnectedUser = {
        id: userData.id,
        username: userData.username || 'Unknown',
        role: userData.role || 'patient',
        fullName: userData.fullName || userData.username || 'Unknown User',
        lastSeen: new Date(),
        ws: ws,
        sessionId: connectionId
      };

      // Remove existing connection for this user
      const existingUserKey = `${userData.id}`;
      if (this.connectedUsers.has(existingUserKey)) {
        const existingUser = this.connectedUsers.get(existingUserKey);
        if (existingUser && existingUser.ws !== ws) {
          existingUser.ws.close(1000, 'New connection established');
        }
      }

      this.connectedUsers.set(existingUserKey, connectedUser);
      this.userSockets.set(userData.id, ws);

      // Send authentication success
      this.sendMessage(ws, {
        type: 'authentication_success',
        data: { userId: userData.id, timestamp: new Date() }
      });

      // Broadcast user online status
      await this.broadcastUserStatus('online', connectedUser);
      
      // Send current online users
      this.sendOnlineUsers(ws);

      console.log(`👤 User authenticated: ${connectedUser.fullName} (${connectedUser.role})`);
    } catch (error) {
      console.error('Authentication error:', error);
      this.sendError(ws, 'Authentication failed');
    }
  }

  private async handleHeartbeat(ws: WebSocket, userId?: number) {
    if (userId) {
      this.updateLastSeen(userId);
    }
    
    this.sendMessage(ws, {
      type: 'heartbeat_ack',
      data: { timestamp: new Date() }
    });
  }

  private async handleChatMessage(message: WebSocketMessage) {
    const { data } = message;
    
    if (data.targetUserId) {
      // Direct message to specific user
      const targetWs = this.userSockets.get(data.targetUserId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        this.sendMessage(targetWs, {
          type: 'new_chat_message',
          data: data
        });
      }
    } else {
      // Broadcast to all users
      this.broadcast({
        type: 'new_chat_message',
        data: data
      });
    }
  }

  private async handleNotification(message: WebSocketMessage) {
    const { data } = message;
    
    if (data.targetUserId) {
      // Send to specific user
      const targetWs = this.userSockets.get(data.targetUserId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        this.sendMessage(targetWs, {
          type: 'notification',
          data: data
        });
      }
    } else if (data.targetRole) {
      // Send to all users with specific role
      this.broadcastToRole(data.targetRole, {
        type: 'notification',
        data: data
      });
    }
  }

  private async handleTypingIndicator(message: WebSocketMessage) {
    const { data } = message;
    
    if (data.targetUserId) {
      const targetWs = this.userSockets.get(data.targetUserId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        this.sendMessage(targetWs, {
          type: 'typing_indicator',
          data: data
        });
      }
    }
  }

  private handleDisconnection(ws: WebSocket) {
    // Find and remove the disconnected user
    this.connectedUsers.forEach((user, key) => {
      if (user.ws === ws) {
        this.connectedUsers.delete(key);
        this.userSockets.delete(user.id);
        
        // Broadcast user offline status (don't await to avoid blocking)
        this.broadcastUserStatus('offline', user).catch(console.error);
        
        console.log(`👤 User disconnected: ${user.fullName}`);
      }
    });
  }

  private updateLastSeen(userId: number) {
    const user = this.connectedUsers.get(`${userId}`);
    if (user) {
      user.lastSeen = new Date();
    }
  }

  private async broadcastUserStatus(status: 'online' | 'offline', user: ConnectedUser) {
    const message = {
      type: 'user_status_update',
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          fullName: user.fullName,
          status: status,
          lastSeen: user.lastSeen
        }
      }
    };

    this.broadcast(message);
  }

  private sendOnlineUsers(ws: WebSocket) {
    const onlineUsers = Array.from(this.connectedUsers.values()).map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      status: 'online',
      lastSeen: user.lastSeen
    }));

    this.sendMessage(ws, {
      type: 'online_users',
      data: { users: onlineUsers }
    });
  }

  private async broadcastActivity(activity: any) {
    this.broadcast({
      type: 'activity_update',
      data: { ...activity, timestamp: new Date() }
    });
  }

  private async broadcastScanUpdate(scan: any) {
    this.broadcast({
      type: 'scan_update',
      data: { ...scan, timestamp: new Date() }
    });
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let failCount = 0;

    this.wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
          successCount++;
        } catch (error) {
          console.error('Broadcast error:', error);
          failCount++;
        }
      }
    });

    if (failCount > 0) {
      console.warn(`📡 Broadcast: ${successCount} success, ${failCount} failed`);
    }
  }

  private broadcastToRole(role: string, message: any) {
    const messageStr = JSON.stringify(message);
    
    this.connectedUsers.forEach((user) => {
      if (user.role === role && user.ws.readyState === WebSocket.OPEN) {
        try {
          user.ws.send(messageStr);
        } catch (error) {
          console.error(`Role broadcast error for ${user.fullName}:`, error);
        }
      }
    });
  }

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Send message error:', error);
        return false;
      }
    }
    return false;
  }

  private sendError(ws: WebSocket, errorMessage: string) {
    this.sendMessage(ws, {
      type: 'error',
      data: { message: errorMessage, timestamp: new Date() }
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const timeout = 60000; // 1 minute timeout

      // Check for stale connections
      this.connectedUsers.forEach((user, key) => {
        const timeSinceLastSeen = now.getTime() - user.lastSeen.getTime();
        if (timeSinceLastSeen > timeout) {
          console.log(`⏰ Removing stale connection: ${user.fullName}`);
          user.ws.close(1001, 'Connection timeout');
          this.connectedUsers.delete(key);
          this.userSockets.delete(user.id);
        }
      });

      // Send heartbeat to all connected clients
      this.broadcast({
        type: 'heartbeat',
        data: { timestamp: now }
      });
    }, 30000); // Every 30 seconds
  }

  // Public methods for external use
  public async notifyUser(userId: number, notification: any) {
    const userWs = this.userSockets.get(userId);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      this.sendMessage(userWs, {
        type: 'notification',
        data: notification
      });
      return true;
    }
    return false;
  }

  public async notifyRole(role: string, notification: any) {
    this.broadcastToRole(role, {
      type: 'notification',
      data: notification
    });
  }

  public async broadcastToAll(message: any) {
    this.broadcast(message);
  }

  public getOnlineUsers() {
    return Array.from(this.connectedUsers.values()).map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      status: 'online',
      lastSeen: user.lastSeen
    }));
  }

  public isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(`${userId}`);
  }

  public getConnectionCount(): number {
    return this.connectionCount;
  }

  public getMessageCount(): number {
    return this.messageCount;
  }

  public getStats() {
    return {
      connections: this.connectionCount,
      messages: this.messageCount,
      onlineUsers: this.connectedUsers.size,
      roles: this.getRoleDistribution()
    };
  }

  private getRoleDistribution() {
    const roles: { [key: string]: number } = {};
    this.connectedUsers.forEach(user => {
      roles[user.role] = (roles[user.role] || 0) + 1;
    });
    return roles;
  }

  public shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.wss.clients.forEach(ws => {
      ws.close(1001, 'Server shutdown');
    });
    
    this.wss.close();
    console.log('🔌 WebSocket server shut down');
  }
}

export let enhancedWsManager: EnhancedWebSocketManager;

export function initializeEnhancedWebSocket(server: Server) {
  enhancedWsManager = new EnhancedWebSocketManager(server);
  return enhancedWsManager;
}
