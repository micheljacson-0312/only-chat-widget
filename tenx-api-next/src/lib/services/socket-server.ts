import type { Server as HTTPServer } from 'http';
import { Server as ServerIO, type Socket } from 'socket.io';
import { verifyAccessToken } from '../auth';
import {
  createMessageWithCredits,
  getConversationParticipants,
  isConversationParticipant,
  InsufficientCreditsError,
} from './chat';

export const SOCKET_PATH = '/api/socket/io';

let io: ServerIO | null = null;

/** Return the shared Socket.IO instance, or null if not yet initialised. */
export function getIO(): ServerIO | null {
  return io;
}

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
    role?: string;
  };
}

/**
 * Initialise (once) the Socket.IO server attached to the given HTTP server.
 * Safe to call multiple times — returns the existing instance if present.
 *
 * Uses `transports: ['polling', 'websocket']` so chat works over HTTP
 * long-polling where incoming WebSocket upgrades are blocked (Hostinger
 * hPanel Node hosting) and automatically upgrades to WebSocket where allowed
 * (Hostinger VPS).
 */
export function initSocketServer(httpServer: HTTPServer): ServerIO {
  if (io) return io;

  io = new ServerIO(httpServer, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
    transports: ['polling', 'websocket'],
    cors: { origin: true, credentials: true },
  });

  // Authenticate every connection from the handshake token (Edge middleware
  // does NOT protect the socket path).
  io.use((socket: AuthedSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      return next(new Error('Unauthorized'));
    }
    socket.data.userId = payload.userId;
    socket.data.role = payload.role;
    next();
  });

  io.on('connection', (socket: AuthedSocket) => {
    const userId = socket.data.userId!;
    socket.join(`user:${userId}`);

    socket.on('join_conversation', async (conversationId: string) => {
      try {
        if (!conversationId) return;
        const allowed = await isConversationParticipant(conversationId, userId);
        if (!allowed) {
          socket.emit('error', { message: 'Not a participant of this conversation' });
          return;
        }
        socket.join(`conversation:${conversationId}`);
      } catch {
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    socket.on('leave_conversation', (conversationId: string) => {
      if (conversationId) socket.leave(`conversation:${conversationId}`);
    });

    // Typing indicators broadcast to the rest of the room.
    socket.on('typing_start', (conversationId: string) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing_start', {
          conversationId,
          userId,
        });
      }
    });

    socket.on('typing_stop', (conversationId: string) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing_stop', {
          conversationId,
          userId,
        });
      }
    });

    socket.on('send_message', async (data: {
      conversationId: string;
      body: string;
      messageType?: string;
      attachmentUrl?: string | null;
      replyToId?: string | null;
    }) => {
      try {
        const { conversationId, body, messageType, attachmentUrl, replyToId } = data || {};
        if (!conversationId) {
          socket.emit('error', { message: 'conversationId is required' });
          return;
        }

        const allowed = await isConversationParticipant(conversationId, userId);
        if (!allowed) {
          socket.emit('error', { message: 'Not a participant of this conversation' });
          return;
        }

        const message = await createMessageWithCredits({
          conversationId,
          senderId: userId,
          body: body || '',
          messageType: messageType || 'text',
          attachmentUrl: attachmentUrl ?? null,
          replyToId: replyToId ?? null,
        });

        io!.to(`conversation:${conversationId}`).emit('receive_message', message);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          socket.emit('error', { message: err.message, code: 'INSUFFICIENT_CREDITS' });
        } else {
          socket.emit('error', { message: 'Failed to send message' });
        }
      }
    });

    // WebRTC signalling — secured by verifying the caller may contact the
    // target via a shared conversation.
    socket.on('call_user', async (data: {
      userToCall: string;
      signalData: unknown;
      type: 'voice' | 'video';
      conversationId: string;
    }) => {
      try {
        const info = await getConversationParticipants(data.conversationId);
        if (
          !info ||
          !info.participantUserIds.includes(userId) ||
          !info.participantUserIds.includes(data.userToCall)
        ) {
          socket.emit('error', { message: 'Not allowed to call this user' });
          return;
        }
        io!.to(`user:${data.userToCall}`).emit('call_user', {
          signal: data.signalData,
          from: userId,
          type: data.type,
          conversationId: data.conversationId,
        });
      } catch {
        socket.emit('error', { message: 'Call failed' });
      }
    });

    socket.on('answer_call', (data: { to: string; signal: unknown }) => {
      if (data?.to) {
        io!.to(`user:${data.to}`).emit('call_accepted', data.signal);
      }
    });

    socket.on('disconnect', () => {
      // no-op; rooms are cleaned up automatically
    });
  });

  return io;
}
