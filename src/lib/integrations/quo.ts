import type { SmsAdapter } from "./types";

/**
 * Quo (formerly OpenPhone) — sends from the business's own approved number.
 * API: https://www.quo.com/docs (OpenPhone v1 API remains the base).
 */
export function quoAdapter(opts: { apiKey: string; fromNumber: string; baseUrl?: string }): SmsAdapter {
  const base = opts.baseUrl ?? process.env.QUO_API_BASE ?? "https://api.openphone.com/v1";
  return {
    async send({ to, body }) {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { Authorization: opts.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.fromNumber, to: [to], content: body }),
      });
      if (!res.ok) throw new Error(`Quo send failed ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data?: { id: string }; id?: string };
      return { id: json.data?.id ?? json.id ?? "unknown" };
    },
  };
}

/** Shape of an inbound message webhook from Quo (message.received). */
export interface QuoInboundEvent {
  type: string;
  data?: { object?: { id: string; from: string; to: string[]; text?: string; body?: string; direction: string; createdAt: string } };
}
