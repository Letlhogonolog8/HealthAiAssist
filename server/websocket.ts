import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { storage } from './storage';

interface ConnectedUser {
  id: number;
  username: string;
  role: string;
  fullName: string;
  lastSeen: Date;
  ws: WebSocket;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private connectedUsers = new Map<string, ConnectedUser>();
  private userSockets = new Map<number, WebSocket>();
  private connectionCount = 0;
  private messageCount = 0;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupWebSocket();
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request) => {
      this.connectionCount++;
      console.log(`WebSocket connection established. Total connections: ${this.connectionCount}`);

      // Throttle message handling to prevent overload
      let lastMessageTime = 0;
      const messageThrottleInterval = 100; // milliseconds

      ws.on('message', async (message: string) => {
        const now = Date.now();
        if (now - lastMessageTime < messageThrottleInterval) {
          // Drop or delay message to prevent flooding
          return;
        }
        lastMessageTime = now;

        this.messageCount++;
        try {
          const data = JSON.parse(message.toString());
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        this.connectionCount = Math.max(0, this.connectionCount - 1);
        console.log(`WebSocket connection closed. Total connections: ${this.connectionCount}`);
        this.handleDisconnection(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnection(ws);
      });
    });
  }

  private async handleMessage(ws: WebSocket, data: any) {
    switch (data.type) {
      case 'user_connected':
        await this.handleUserConnection(ws, data.user);
        break;
      case 'activity_update':
        await this.broadcastActivity(data.activity);
        break;
      case 'scan_completed':
        await this.broadcastScanUpdate(data.scan);
        break;
      case 'heartbeat':
        this.updateLastSeen(data.userId);
        break;
    }
  }

  private async handleUserConnection(ws: WebSocket, user: any) {
    const connectedUser: ConnectedUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      lastSeen: new Date(),
      ws: ws
    };

    this.connectedUsers.set(`${user.id}`, connectedUser);
    this.userSockets.set(user.id, ws);

    // Broadcast user online status
    await this.broadcastUserStatus('online', connectedUser);
    
    // Send current online users to the newly connected user
    this.sendOnlineUsers(ws);
  }

  private handleDisconnection(ws: WebSocket) {
    // Find and remove the disconnected user
    this.connectedUsers.forEach((user, key) => {
      if (user.ws === ws) {
        this.connectedUsers.delete(key);
        this.userSockets.delete(user.id);
        
        // Broadcast user offline status
        this.broadcastUserStatus('offline', user);
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
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
        status: status,
        lastSeen: user.lastSeen
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

    const message = {
      type: 'online_users',
      users: onlineUsers
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private async broadcastActivity(activity: any) {
    const message = {
      type: 'new_activity',
      activity: {
        ...activity,
        timestamp: new Date()
      }
    };

    this.broadcast(message);
  }

  private async broadcastScanUpdate(scan: any) {
    const message = {
      type: 'scan_update',
      scan: {
        ...scan,
        timestamp: new Date()
      }
    };

    this.broadcast(message);
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    
    this.wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // Public methods for external use
  public async notifyActivity(activity: any) {
    await this.broadcastActivity(activity);
  }

  public async notifyScanUpdate(scan: any) {
    await this.broadcastScanUpdate(scan);
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
}

export let wsManager: WebSocketManager;

export function initializeWebSocket(server: Server) {
  wsManager = new WebSocketManager(server);
  return wsManager;
}
