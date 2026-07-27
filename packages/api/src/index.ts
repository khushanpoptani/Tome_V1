import { z } from "zod";

export const healthStatusSchema = z.object({
  application: z.literal("Tome"),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export const agentEnvelopeSchema = z.object({
  schemaVersion: z.string().min(1),
  requestId: z.string().min(1),
  agent: z.enum([
    "router",
    "technical",
    "planning",
    "strategy",
    "code-generation",
    "diagnosis",
    "repair",
    "documentation",
    "research",
  ]),
  payload: z.unknown(),
});

export interface OllamaTransport {
  readonly getHealth: (signal?: AbortSignal) => Promise<unknown>;
  readonly invokeAgent: (
    request: z.input<typeof agentEnvelopeSchema>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly streamAgent: (
    request: z.input<typeof agentEnvelopeSchema>,
    signal?: AbortSignal,
  ) => AsyncIterable<unknown>;
}
