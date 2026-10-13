import { Composio } from "@composio/core";
import type { AccountingAdapter, CalendarAdapter, EmailAdapter, QboCustomer, QboItem } from "./types";

/**
 * Composio-backed integrations.
 *
 * One Composio "user" = one company in our app (userId = companyId), so each
 * business's QuickBooks / Google connections are isolated. Composio handles
 * OAuth, token refresh, and credential storage; we never see tokens.
 *
 * Toolkit slugs: quickbooks, gmail, googlecalendar
 */

let client: Composio | null = null;
export function composio(): Composio {
  if (!process.env.COMPOSIO_API_KEY) throw new Error("COMPOSIO_API_KEY is not set");
  if (!client) client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return client;
}

export type Toolkit = "quickbooks" | "gmail" | "googlecalendar";
export const TOOLKIT_LABEL: Record<Toolkit, string> = { quickbooks: "QuickBooks Online", gmail: "Gmail", googlecalendar: "Google Calendar" };

/** Start a connection: returns the URL to send the owner to. */
export async function startConnection(companyId: string, toolkit: Toolkit, callbackUrl: string) {
  const session = await composio().sessions.create(companyId, { toolkits: [toolkit] });
  const req = await session.authorize(toolkit, { callbackUrl });
  return { redirectUrl: req.redirectUrl as string, connectionId: req.id as string };
}

export interface ConnectionStatus {
  toolkit: Toolkit;
  connected: boolean;
  status?: string;
  connectedAccountId?: string;
}

/** Which toolkits this company has active connections for. */
export async function connectionStatus(companyId: string): Promise<ConnectionStatus[]> {
  const res = await composio().connectedAccounts.list({ userIds: [companyId] });
  const items = (res.items ?? []) as Array<{ id: string; status: string; toolkit: { slug: string } }>;
  const kits: Toolkit[] = ["quickbooks", "gmail", "googlecalendar"];
  return kits.map((toolkit) => {
    const acct = items.find((a) => a.toolkit?.slug === toolkit && a.status === "ACTIVE") ?? items.find((a) => a.toolkit?.slug === toolkit);
    return { toolkit, connected: acct?.status === "ACTIVE", status: acct?.status, connectedAccountId: acct?.id };
  });
}

export async function disconnect(companyId: string, toolkit: Toolkit) {
  const res = await composio().connectedAccounts.list({ userIds: [companyId], toolkitSlugs: [toolkit] });
  for (const a of (res.items ?? []) as Array<{ id: string }>) await composio().connectedAccounts.delete(a.id);
}

/** Execute a Composio tool for this company and unwrap the result. */
export async function run<T = unknown>(companyId: string, slug: string, args: Record<string, unknown>): Promise<T> {
  const res = await composio().tools.execute(slug, { userId: companyId, arguments: args, dangerouslySkipVersionCheck: true });
  if (!res.successful) throw new Error(`${slug} failed: ${res.error ?? "unknown error"}`);
  return res.data as T;
}

// ---------------------------------------------------------------------------
// QuickBooks
// ---------------------------------------------------------------------------

/**
 * The QUERY_* tools accept a QuickBooks SQL-style query. The exact argument
 * name differs across toolkit versions, so resolve it once from the schema.
 */
const queryParamCache = new Map<string, string>();
async function queryParamName(slug: string): Promise<string> {
  const cached = queryParamCache.get(slug);
  if (cached) return cached;
  const tool = await composio().tools.getRawComposioToolBySlug(slug);
  const props = Object.keys((tool.inputParameters as { properties?: Record<string, unknown> })?.properties ?? {});
  const name = props.find((p) => /^query$/i.test(p)) ?? props.find((p) => /query|select|sql/i.test(p)) ?? props[0] ?? "query";
  queryParamCache.set(slug, name);
  return name;
}

async function qboQuery<T>(companyId: string, entity: string, where = "", maxResults = 1000): Promise<T[]> {
  const sql = `select * from ${entity}${where ? ` where ${where}` : ""} maxresults ${maxResults}`;
  const param = await queryParamName("QUICKBOOKS_QUERY_ENTITIES");
  const data = await run<Record<string, unknown>>(companyId, "QUICKBOOKS_QUERY_ENTITIES", { [param]: sql });
  // Responses vary: {QueryResponse:{Customer:[...]}} or already-unwrapped arrays.
  const qr = (data.QueryResponse ?? (data.data as Record<string, unknown> | undefined)?.QueryResponse ?? data) as Record<string, unknown>;
  const key = Object.keys(qr).find((k) => k.toLowerCase() === entity.toLowerCase()) ?? Object.keys(qr).find((k) => Array.isArray(qr[k]));
  return key ? ((qr[key] as T[]) ?? []) : [];
}

export function quickbooksAdapter(companyId: string, writesEnabled: boolean): AccountingAdapter {
  const guard = () => {
    if (!writesEnabled) throw new Error("QuickBooks writes are disabled for this company. Enable them in Settings → Connections.");
  };
  return {
    async listCustomers(): Promise<QboCustomer[]> {
      type C = { Id: string; DisplayName: string; PrimaryPhone?: { FreeFormNumber: string }; PrimaryEmailAddr?: { Address: string }; BillAddr?: Record<string, unknown> };
      const rows = await qboQuery<C>(companyId, "Customer", "Active = true");
      return rows.map((c) => ({ id: c.Id, name: c.DisplayName, phone: c.PrimaryPhone?.FreeFormNumber, email: c.PrimaryEmailAddr?.Address, address: c.BillAddr }));
    },
    async listItems(): Promise<QboItem[]> {
      type I = { Id: string; Name: string; Description?: string; UnitPrice?: number; Type: string };
      const rows = await qboQuery<I>(companyId, "Item", "Active = true");
      return rows.map((i) => ({ id: i.Id, name: i.Name, description: i.Description, unitPriceCents: i.UnitPrice !== undefined ? Math.round(i.UnitPrice * 100) : undefined, type: i.Type }));
    },
    async createCustomer(c) {
      guard();
      const data = await run<Record<string, unknown>>(companyId, "QUICKBOOKS_CREATE_CUSTOMER", {
        display_name: c.name,
        ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}),
        ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
      });
      const cust = (data.Customer ?? data) as { Id: string };
      return { id: cust.Id };
    },
    async createEstimate(est) {
      guard();
      if (!est.quickbooks_customer_id) throw new Error("Customer is not linked to QuickBooks yet; sync the customer first.");
      const lines = est.result.lines.map((l) => ({
        DetailType: "SalesItemLineDetail",
        Amount: l.subtotalCents / 100,
        Description: l.name,
        SalesItemLineDetail: { Qty: l.quantity, UnitPrice: l.unitPriceCents / 100 },
      }));
      const data = await run<Record<string, unknown>>(companyId, "QUICKBOOKS_CREATE_ESTIMATE", {
        customer_id: est.quickbooks_customer_id,
        lines,
        private_note: `App estimate ${est.id}`,
      });
      const e = (data.Estimate ?? data) as { Id: string };
      return { id: e.Id };
    },
  };
}

// ---------------------------------------------------------------------------
// Gmail + Google Calendar
// ---------------------------------------------------------------------------

export function gmailAdapter(companyId: string): EmailAdapter {
  return {
    async send({ to, subject, body, html }) {
      const data = await run<{ id?: string; response_data?: { id?: string } }>(companyId, "GMAIL_SEND_EMAIL", {
        recipient_email: to,
        subject,
        body: html ?? body,
        is_html: !!html,
      });
      return { id: data.id ?? data.response_data?.id ?? "sent" };
    },
  };
}

export function calendarAdapter(companyId: string, timezone: string): CalendarAdapter {
  return {
    async freeBusy({ from, to }) {
      const data = await run<Record<string, unknown>>(companyId, "GOOGLECALENDAR_FREE_BUSY_QUERY", { items: ["primary"], timeMin: from, timeMax: to, timeZone: timezone });
      const cals = (data.calendars ?? (data.response_data as Record<string, unknown> | undefined)?.calendars ?? {}) as Record<string, { busy?: Array<{ start: string; end: string }> }>;
      return Object.values(cals).flatMap((c) => c.busy ?? []);
    },
    async createEvent({ title, startAt, endAt, description, attendees }) {
      const data = await run<Record<string, unknown>>(companyId, "GOOGLECALENDAR_CREATE_EVENT", {
        summary: title,
        description,
        start_datetime: startAt,
        end_datetime: endAt,
        timezone,
        attendees,
        create_meeting_room: false,
        send_updates: attendees?.length ? "all" : "none",
      });
      const ev = (data.response_data ?? data) as { id: string; htmlLink?: string };
      return { id: ev.id, htmlLink: ev.htmlLink };
    },
  };
}
