import { z } from 'zod';

/**
 * POST /chat request body. `sessionId` is optional — missing or unknown →
 * SessionService mints a fresh session. `message` is the user's turn text.
 */
export const ChatRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
