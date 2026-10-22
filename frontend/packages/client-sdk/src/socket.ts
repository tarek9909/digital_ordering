import type { ClientToServerEvents, ServerToClientEvents } from '@dop/contracts';
import { io, type Socket } from 'socket.io-client';

// Socket client (TRD §10): same-origin `/rt/`, WebSocket first with long-polling fallback, reconnect with
// exponential back-off 0.5 s → 10 s with jitter (TR-RT-03). On every (re)connect the app refetches its
// snapshot before applying events (TR-RT-05).

/** Same value as SOCKET_PATH in the contract; inlined so the customer bundle does not pull in Zod (TR-FE-05). */
const SOCKET_PATH = '/rt/';

export type DopSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(auth: Record<string, unknown>, handlers: { onConnect?: () => void; onDisconnect?: (reason: string) => void; onError?: (e: Error) => void } = {}): DopSocket {
  const s: DopSocket = io({
    path: SOCKET_PATH,
    auth,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
  });
  if (handlers.onConnect) s.on('connect', handlers.onConnect);
  if (handlers.onDisconnect) s.on('disconnect', handlers.onDisconnect);
  if (handlers.onError) s.on('connect_error', handlers.onError);
  return s;
}
