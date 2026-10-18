import type { Server } from 'socket.io';

let io: Server | null = null;

export function setRealtimeServer(server: Server): void {
  io = server;
}

export function emitToConversation(conversationId: string, event: string, payload: unknown): void {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}
