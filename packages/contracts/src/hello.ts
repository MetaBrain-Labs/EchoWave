/** Runtime contract shared by the API producer and all clients. */
import { z } from 'zod';

export const HelloResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('echowave-api'),
  message: z.literal('HelloWorld'),
});

export type HelloResponse = z.infer<typeof HelloResponseSchema>;
