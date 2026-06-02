import { prisma } from '../prisma';
import type { Message, Prisma } from '@prisma/client';

/**
 * Canonical, safe message payload. This exact shape is emitted by BOTH the
 * REST endpoints and the Socket.IO server so the client never has to
 * reconcile differing structures. NEVER include sender.passwordHash or any
 * other sensitive AppUser field here.
 */
export interface SafeMessage {
  id: string;
  messageId: string; // alias of id for backwards compatibility with the client
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  messageType: string;
  attachmentUrl: string | null;
  replyToId: string | null;
  sentAt: Date;
  isRead: boolean;
}

type MessageWithSender = Message & {
  sender: { id: string; userName: string };
};

export function toSafeMessage(m: MessageWithSender): SafeMessage {
  return {
    id: m.id,
    messageId: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: m.sender?.userName ?? '',
    body: m.body,
    messageType: m.messageType,
    attachmentUrl: m.attachmentUrl ?? null,
    replyToId: m.replyToId ?? null,
    sentAt: m.sentAt,
    isRead: m.isRead,
  };
}

export const safeSenderSelect = {
  select: { id: true, userName: true },
} satisfies Prisma.AppUserDefaultArgs;

/**
 * Resolve a conversation and the two AppUser ids that participate in it
 * (the customer's user id and the consultant's user id). Returns null if the
 * conversation does not exist.
 */
export async function getConversationParticipants(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: { select: { id: true, userId: true } },
      consultant: { select: { id: true, userId: true } },
    },
  });

  if (!conversation) return null;

  return {
    conversation,
    customerUserId: conversation.customer.userId,
    consultantUserId: conversation.consultant.userId,
    participantUserIds: [
      conversation.customer.userId,
      conversation.consultant.userId,
    ] as const,
  };
}

/** Returns true if `userId` is a participant of the conversation. */
export async function isConversationParticipant(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const info = await getConversationParticipants(conversationId);
  if (!info) return false;
  return info.participantUserIds.includes(userId);
}

export class InsufficientCreditsError extends Error {
  constructor(message = 'Insufficient credits') {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

/**
 * Determine the credit cost of a message based on MessagePricing.
 * Falls back to 0 (free) when no pricing row exists for the type, so chat
 * keeps working in environments where pricing has not been seeded.
 */
async function computeMessageCost(
  tx: Prisma.TransactionClient,
  messageType: string,
  body: string
): Promise<number> {
  const pricing = await tx.messagePricing.findUnique({
    where: { messageType },
  });
  if (!pricing || pricing.pricePerUnit <= 0) return 0;

  // For text we charge per `unitSize` characters; for time-based media
  // (voice/video) we charge a minimum of one unit per message since duration
  // is not tracked server-side.
  if (pricing.unitType === 'char') {
    const units = Math.max(1, Math.ceil((body?.length || 0) / pricing.unitSize));
    return units * pricing.pricePerUnit;
  }
  return pricing.pricePerUnit;
}

interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  body: string;
  messageType?: string;
  attachmentUrl?: string | null;
  replyToId?: string | null;
}

/**
 * Atomically: verify enough credits, deduct them, create the message, bump
 * the conversation's lastMessageAt, and write a CreditTransaction. Throws
 * InsufficientCreditsError when the sender cannot afford the message.
 * Returns the safe message projection.
 */
export async function createMessageWithCredits(
  input: CreateMessageInput
): Promise<SafeMessage> {
  const {
    conversationId,
    senderId,
    body,
    messageType = 'text',
    attachmentUrl = null,
    replyToId = null,
  } = input;

  const created = await prisma.$transaction(async (tx) => {
    const cost = await computeMessageCost(tx, messageType, body);

    if (cost > 0) {
      const balance = await tx.creditBalance.findUnique({
        where: { userId: senderId },
      });
      const available = balance?.amount ?? 0;
      if (available < cost) {
        throw new InsufficientCreditsError();
      }

      const updated = await tx.creditBalance.update({
        where: { userId: senderId },
        data: { amount: { decrement: cost }, updatedAt: new Date() },
      });

      await tx.creditTransaction.create({
        data: {
          creditBalanceId: updated.id,
          amount: -cost,
          type: 'Debit',
          description: `Message (${messageType}) in conversation ${conversationId}`,
        },
      });
    }

    const message = await tx.message.create({
      data: {
        conversationId,
        senderId,
        body: body ?? '',
        messageType,
        attachmentUrl,
        replyToId,
      },
      include: { sender: safeSenderSelect },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  });

  return toSafeMessage(created as MessageWithSender);
}

/** Mark all messages in a conversation not sent by `userId` as read. */
export async function markConversationRead(
  conversationId: string,
  userId: string
) {
  const result = await prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

/** Count unread messages in a conversation not sent by `userId`. */
export async function getUnreadCount(conversationId: string, userId: string) {
  return prisma.message.count({
    where: { conversationId, senderId: { not: userId }, isRead: false },
  });
}

/**
 * Emit a `receive_message` event to the conversation room via the shared
 * Socket.IO instance, if it has been initialised on this process. Used by the
 * REST send endpoints so REST and socket stay in sync. No-op if the socket
 * server is not running (e.g. during tests).
 */
export function emitReceiveMessage(message: SafeMessage) {
  try {
    // Lazy require so importing this module never pulls socket.io into the
    // Edge runtime / build graph where it is not needed.
    const { getIO } = require('./socket-server') as typeof import('./socket-server');
    const io = getIO();
    if (io) {
      io.to(`conversation:${message.conversationId}`).emit(
        'receive_message',
        message
      );
    }
  } catch {
    // Socket server not available in this context; REST response still works.
  }
}
