import type { CalendarAdapter, EmailAdapter, StoredCredentials } from "./types";

/**
 * Google — Gmail (send as the owner) + Calendar (free/busy, create events).
 * Uses a refresh token obtained at connect time; access tokens refreshed on demand.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "openid",
  "email",
];

export function googleAuthUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleExchangeCode(code: string, redirectUri: string): Promise<StoredCredentials & { email?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  let email: string | undefined;
  if (j.id_token) {
    try {
      email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email;
    } catch {}
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(), email };
}

async function freshToken(creds: StoredCredentials, onRefresh: (c: StoredCredentials) => Promise<void>): Promise<string> {
  if (creds.expiresAt && Date.parse(creds.expiresAt) > Date.now() + 60_000) return creds.accessToken;
  if (!creds.refreshToken) throw new Error("Google: no refresh token; reconnect.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: creds.refreshToken, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Google refresh failed: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  const next = { ...creds, accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString() };
  await onRefresh(next);
  return next.accessToken;
}

export function googleAdapters(creds: StoredCredentials, onRefresh: (c: StoredCredentials) => Promise<void>, opts: { fromName?: string; timezone: string }) {
  const auth = async () => ({ Authorization: `Bearer ${await freshToken(creds, onRefresh)}`, "Content-Type": "application/json" });

  const gmail: EmailAdapter = {
    async send({ to, subject, body, html }) {
      const from = opts.fromName ? `${opts.fromName} <${creds.email ?? ""}>` : undefined;
      const mime = [from ? `From: ${from}` : null, `To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", html ? "Content-Type: text/html; charset=UTF-8" : "Content-Type: text/plain; charset=UTF-8", "", html ?? body]
        .filter((l) => l !== null)
        .join("\r\n");
      const raw = Buffer.from(mime).toString("base64url");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: await auth(), body: JSON.stringify({ raw }) });
      if (!res.ok) throw new Error(`Gmail send failed ${res.status}: ${await res.text()}`);
      return { id: ((await res.json()) as { id: string }).id };
    },
  };

  const calendar: CalendarAdapter = {
    async freeBusy({ from, to }) {
      const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", { method: "POST", headers: await auth(), body: JSON.stringify({ timeMin: from, timeMax: to, timeZone: opts.timezone, items: [{ id: "primary" }] }) });
      if (!res.ok) throw new Error(`Calendar freeBusy failed: ${await res.text()}`);
      const j = (await res.json()) as { calendars: { primary: { busy: Array<{ start: string; end: string }> } } };
      return j.calendars.primary.busy;
    },
    async createEvent({ title, startAt, endAt, description, attendees }) {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: await auth(),
        body: JSON.stringify({ summary: title, description, start: { dateTime: startAt, timeZone: opts.timezone }, end: { dateTime: endAt, timeZone: opts.timezone }, attendees: attendees?.map((email) => ({ email })) }),
      });
      if (!res.ok) throw new Error(`Calendar create failed: ${await res.text()}`);
      const j = (await res.json()) as { id: string; htmlLink?: string };
      return { id: j.id, htmlLink: j.htmlLink };
    },
  };

  return { gmail, calendar };
}
