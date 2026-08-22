import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import type { RequestHandler } from 'express';

/**
 * The identity a socket is allowed to act as.
 *
 * Resolved from the session cookie during the HTTP upgrade and never from
 * anything the socket sends afterwards.
 */
export interface SocketIdentity {
  id: number;
  username: string;
  role: string;
  fullName: string;
  email?: string;
}

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

  private sessionMiddleware?: RequestHandler;

  constructor(server: Server, sessionMiddleware?: RequestHandler) {
    this.sessionMiddleware = sessionMiddleware;

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
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        return; // Malformed target — leave it for another listener to handle.
      }

      if (pathname !== '/ws') return; // Not ours: Vite's HMR, or anything else.

      // Authenticate before the handshake completes.
      //
      // This used to accept every upgrade (`verifyClient` returned a hardcoded
      // `true`) and then take the connecting client's word for who it was: the
      // first `user_authenticate` frame carried an id and a role, and the server
      // stored them verbatim. Sending `{id: 7, role: 'admin'}` was enough to be
      // registered as user 7, appear in the online-users roster every client
      // receives, and be handed every direct message and notification the server
      // routed to that id. Identity now comes from the session cookie, which the
      // client cannot forge, and the frame's contents are ignored.
      this.resolveIdentity(request)
        .then((identity) => {
          if (!identity) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }

          this.wss.handleUpgrade(request, socket as any, head, (ws) => {
            this.wss.emit('connection', ws, request, identity);
          });
        })
        .catch((error) => {
          console.error('WebSocket session resolution failed:', error);
          socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
          socket.destroy();
        });
    });

    this.setupWebSocket();
    this.startHeartbeat();
  }

  /**
   * Runs the Express session middleware over the upgrade request to recover the
   * logged-in user, or null when there is no valid session.
   *
   * The middleware needs a response object to hang its save hook on; a bare
   * ServerResponse is enough because nothing is ever written to it. Fails closed:
   * any error, timeout, or missing middleware yields null and the upgrade is
   * refused.
   */
  private resolveIdentity(request: IncomingMessage): Promise<SocketIdentity | null> {
    if (!this.sessionMiddleware) {
      console.error(
        'WebSocket manager started without session middleware; refusing all connections.'
      );
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (identity: SocketIdentity | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(identity);
      };

      const timer = setTimeout(() => finish(null), 5000);

      try {
        const res = new ServerResponse(request);
        this.sessionMiddleware!(request as any, res as any, () => {
          const user = (request as any).session?.user;
          if (!user || typeof user.id !== 'number') return finish(null);
          finish({
            id: user.id,
            username: user.username ?? 'unknown',
            role: user.role ?? 'patient',
            fullName: user.fullName ?? user.username ?? 'Unknown User',
            email: user.email,
          });
        });
      } catch (error) {
        console.error('WebSocket session middleware error:', error);
        finish(null);
      }
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage, identity: SocketIdentity) => {
      this.connectionCount++;
      console.log(`🔌 WebSocket connection established. Total: ${this.connectionCount}`);

      // Enhanced connection setup
      this.setupConnection(ws, request, identity);
    });

    this.wss.on('error', (error) => {
      console.error('🚨 WebSocket Server Error:', error);
    });
  }

  private setupConnection(ws: WebSocket, request: IncomingMessage, identity: SocketIdentity) {
    // Connection metadata
    const connectionId = `${Date.now()}-${Math.random()}`;
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
        
        await this.handleMessage(ws, message, connectionId, identity);
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

    // The session already said who this is, so register immediately rather than
    // waiting for a frame to ask. Clients still send `user_authenticate` and
    // still get `authentication_success`; that exchange is now a formality.
    void this.registerConnection(ws, identity, connectionId);
  }

  private async handleMessage(
    ws: WebSocket,
    message: WebSocketMessage,
    connectionId: string,
    identity: SocketIdentity
  ) {
    switch (message.type) {
      case 'register':
      case 'user_authenticate':
        // message.data is ignored: identity comes from the session.
        await this.registerConnection(ws, identity, connectionId);
        break;
      
      case 'heartbeat':
        await this.handleHeartbeat(ws, identity.id);
        break;
      
      case 'new_message':
      case 'chat_message':
        await this.handleChatMessage(message, identity);
        break;
      
      case 'typing':
      case 'typing_indicator':
        await this.handleTypingIndicator(message, identity);
        break;
      
      case 'activity_update':
      case 'scan_update':
      case 'notification':
        // Fan-out primitives, not client capabilities.
        //
        // These used to broadcast whatever the socket sent: any connected client
        // could push a fabricated scan result or a notification addressed to
        // another user, and every dashboard listening would render it as if the
        // server had said it. Server code reaches the same broadcasts through the
        // public notifyUser / notifyRole / broadcastToAll methods.
        this.sendError(ws, `\`${message.type}\` may only originate from the server`);
        break;
      
      default:
        console.warn(`🤷 Unknown message type: ${message.type}`);
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  /** Registers an already-authenticated socket under its session identity. */
  private async registerConnection(ws: WebSocket, identity: SocketIdentity, connectionId: string) {
    try {
      const key = `${identity.id}`;
      const existing = this.connectedUsers.get(key);

      // Already registered on this same socket: acknowledge and stop, so a client
      // that sends `user_authenticate` after connecting does not re-broadcast a
      // status change to everyone.
      if (existing?.ws === ws) {
        this.sendMessage(ws, {
          type: 'authentication_success',
          data: { userId: identity.id, timestamp: new Date() }
        });
        return;
      }

      if (existing) existing.ws.close(1000, 'New connection established');

      const connectedUser: ConnectedUser = {
        id: identity.id,
        username: identity.username,
        role: identity.role,
        fullName: identity.fullName,
        lastSeen: new Date(),
        ws,
        sessionId: connectionId
      };

      this.connectedUsers.set(key, connectedUser);
      this.userSockets.set(identity.id, ws);

      this.sendMessage(ws, {
        type: 'authentication_success',
        data: { userId: identity.id, timestamp: new Date() }
      });

      await this.broadcastUserStatus('online', connectedUser);
      this.sendOnlineUsers(ws);

      console.log(`👤 User connected: ${connectedUser.fullName} (${connectedUser.role})`);
    } catch (error) {
      console.error('Connection registration error:', error);
      this.sendError(ws, 'Registration failed');
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

  private async handleChatMessage(message: WebSocketMessage, identity: SocketIdentity) {
    // The sender is stamped from the session, so a client cannot put someone
    // else's name on a message.
    const data = {
      ...message.data,
      senderId: identity.id,
      senderName: identity.fullName,
      senderRole: identity.role,
    };

    /**
     * A chat message goes to its addressee, or nowhere.
     *
     * The `else` branch here used to broadcast it to every open socket on the
     * server. A clinician-to-patient message whose `targetUserId` was missing
     * was therefore delivered to every signed-in user of the platform, in
     * cleartext, whatever their role — and the field is genuinely optional in
     * practice: the chat components pass `selectedParticipant?.id`, which is
     * undefined until a conversation is selected. These messages are encrypted
     * at rest precisely because they carry clinical content, and fanning them
     * out to everyone connected undoes that in one line.
     *
     * There is no legitimate broadcast chat in this application, so the fallback
     * is refused rather than narrowed.
     */
    const targetUserId = Number(data.targetUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      console.warn(
        `Refused an unaddressed chat message from user ${identity.id}; ` +
          'chat is not broadcast.'
      );
      const senderWs = this.userSockets.get(identity.id);
      if (senderWs) this.sendError(senderWs, 'A chat message must name its recipient');
      return;
    }

    const targetWs = this.userSockets.get(targetUserId);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      this.sendMessage(targetWs, {
        type: 'new_chat_message',
        data: { ...data, targetUserId },
      });
    }
  }

  /**
   * Pushes a message to one user's open sockets, if any.
   *
   * Returns whether it was delivered, so callers can tell "sent" from "the
   * recipient is offline" instead of assuming the first. Delivery is best-effort
   * by design: the durable copy is the row the caller has already written, and a
   * user who was offline picks it up on their next fetch.
   *
   * This replaces handleNotification(), which fanned out whatever a *client*
   * sent: any connected socket could address a notification to another user, or
   * to a whole role, and every dashboard would render it as though the server
   * had said it.
   */
  public sendToUser(userId: number, message: { type: string; data: any }): boolean {
    const ws = this.userSockets.get(userId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    this.sendMessage(ws, message);
    return true;
  }

  /** Pushes to every connected user holding `role`. */
  public sendToRole(role: string, message: { type: string; data: any }): void {
    this.broadcastToRole(role, message);
  }

  private async handleTypingIndicator(message: WebSocketMessage, identity: SocketIdentity) {
    const data = { ...message.data, senderId: identity.id, senderName: identity.fullName };

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

  /**
   * broadcastScanUpdate() and broadcastActivity() stood here and are removed.
   *
   * Both spread a whole row into a message and sent it to every open socket —
   * `{ ...scan }` includes the patient id, the result string, the findings and
   * the confidence — with no role check, so a patient's own connection received
   * every other patient's scan results as they were written. Nothing called
   * either of them; they were left over from the version where inbound client
   * frames drove the fan-out.
   *
   * Routes that need to announce a scan use sendToRole('radiologist', ...) or
   * sendToUser(patientId, ...), both of which address someone specific and carry
   * an identifier rather than the record.
   */
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
    // Guarded: callers resolve a socket from a map, and a user who disconnected
    // between the lookup and the send yields undefined here.
    if (ws && ws.readyState === WebSocket.OPEN) {
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

/**
 * Starts the WebSocket manager, once.
 *
 * Idempotent on purpose. A second manager on the same HTTP server adds a second
 * 'upgrade' listener, and both call handleUpgrade on the same socket; ws throws
 * from inside the listener and the uncaught exception takes the process down on
 * the first client to connect. Returning the existing manager makes a stray
 * second call harmless instead of fatal.
 */
export function initializeEnhancedWebSocket(server: Server, sessionMiddleware?: RequestHandler) {
  if (enhancedWsManager) {
    console.warn(
      '⚠️  initializeEnhancedWebSocket() called again; returning the existing manager. ' +
        'Only the process entry point should start it.'
    );
    return enhancedWsManager;
  }

  enhancedWsManager = new EnhancedWebSocketManager(server, sessionMiddleware);
  return enhancedWsManager;
}
