import type { ChatTurn, StopReason } from "@/lib/api-contract";
import type { ProviderId } from "@/lib/ai/settings";

/**
 * Where one request goes: a saved connection resolved on the server, key included. It never leaves the
 * server; the browser only names a connection by id.
 */
export type ConnectionTarget = {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string | null;
  model: string;
};

/** Exactly what "What gets sent" shows: the Instructions as the system prompt, then the conversation. */
export type ModelRequest = { system: string; messages: ChatTurn[] };

/** A piece of reply text, or the end of the reply and why it ended (always last, exactly once). */
export type ReplyEvent = { text: string } | { stop: StopReason };
