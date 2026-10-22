import { z } from 'zod';
import { tokenParam } from './api.js';
export const presenceHeartbeatPayload = z.object({ tokens: z.array(tokenParam).max(20), visible: z.boolean() }).strict();
export const acknowledgePayload = z.object({ token: tokenParam }).strict();
export const displayHeartbeatPayload = z.object({ soundEnabled: z.boolean() }).strict();
export const SOCKET_PATH = '/rt/';
