import type { AccountingAdapter, QboCustomer, QboItem, StoredCredentials } from "./types";

/**
 * QuickBooks Online (Intuit) — OAuth2 + v3 REST.
 * Reads are always allowed once connected. Writes are refused unless the
 * integration row has writes_enabled = true AND the approval gate passed.
 */
export const QBO_SCOPES = ["com.intuit.quickbooks.accounting"];

function apiBase(): string {
  return process.env.QBO_ENVIRONMENT === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
}

export function qboAuthUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({ client_id: process.env.QBO_CLIENT_ID!, response_type: "code", scope: QBO_SCOPES.join(" "), redirect_uri: redirectUri, state });
  return `https://appcenter.intuit.com/connect/oauth2?${p}`;
}

function basicAuth(): string {
  return "Basic " + Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
}

export async function qboExchangeCode(code: string, redirectUri: string, realmId: string): Promise<StoredCredentials & { realmId: string }> {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`QBO token exchange failed: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(), realmId };
}

async function freshToken(creds: StoredCredentials, onRefresh: (c: StoredCredentials) => Promise<void>): Promise<string> {
  if (creds.expiresAt && Date.parse(creds.expiresAt) > Date.now() + 60_000) return creds.accessToken;
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken! }),
  });
  if (!res.ok) throw new Error(`QBO refresh failed: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const next = { ...creds, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString() };
  await onRefresh(next);
  return next.accessToken;
}

export function qboAdapter(creds: StoredCredentials & { realmId: string }, onRefresh: (c: StoredCredentials) => Promise<void>, writesEnabled: boolean): AccountingAdapter {
  const base = `${apiBase()}/v3/company/${creds.realmId}`;
  const headers = async () => ({ Authorization: `Bearer ${await freshToken(creds, onRefresh)}`, Accept: "application/json", "Content-Type": "application/json" });

  async function query<T>(q: string): Promise<T[]> {
    const res = await fetch(`${base}/query?query=${encodeURIComponent(q)}&minorversion=75`, { headers: await headers() });
    if (!res.ok) throw new Error(`QBO query failed ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { QueryResponse: Record<string, T[]> };
    const key = Object.keys(j.QueryResponse).find((k) => Array.isArray(j.QueryResponse[k]));
    return key ? j.QueryResponse[key] : [];
  }

  async function post<T>(entity: string, body: unknown): Promise<T> {
    if (!writesEnabled) throw new Error("QuickBooks writes are disabled for this company. Enable them in Settings → Integrations.");
    const res = await fetch(`${base}/${entity}?minorversion=75`, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`QBO ${entity} create failed ${res.status}: ${await res.text()}`);
    return ((await res.json()) as Record<string, T>)[entity.charAt(0).toUpperCase() + entity.slice(1)];
  }

  return {
    async listCustomers(): Promise<QboCustomer[]> {
      type C = { Id: string; DisplayName: string; PrimaryPhone?: { FreeFormNumber: string }; PrimaryEmailAddr?: { Address: string }; BillAddr?: Record<string, unknown> };
      const rows = await query<C>("select * from Customer where Active = true maxresults 1000");
      return rows.map((c) => ({ id: c.Id, name: c.DisplayName, phone: c.PrimaryPhone?.FreeFormNumber, email: c.PrimaryEmailAddr?.Address, address: c.BillAddr }));
    },
    async listItems(): Promise<QboItem[]> {
      type I = { Id: string; Name: string; Description?: string; UnitPrice?: number; Type: string };
      const rows = await query<I>("select * from Item where Active = true maxresults 1000");
      return rows.map((i) => ({ id: i.Id, name: i.Name, description: i.Description, unitPriceCents: i.UnitPrice !== undefined ? Math.round(i.UnitPrice * 100) : undefined, type: i.Type }));
    },
    async createCustomer(c) {
      const r = await post<{ Id: string }>("customer", { DisplayName: c.name, PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : undefined, PrimaryEmailAddr: c.email ? { Address: c.email } : undefined });
      return { id: r.Id };
    },
    async createEstimate(est) {
      const customerRef = est.quickbooks_customer_id;
      if (!customerRef) throw new Error("Customer is not linked to QuickBooks yet; sync the customer first.");
      const Line = est.result.lines.map((l) => ({
        DetailType: "SalesItemLineDetail",
        Amount: l.subtotalCents / 100,
        Description: l.name,
        SalesItemLineDetail: { Qty: l.quantity, UnitPrice: l.unitPriceCents / 100 },
      }));
      const r = await post<{ Id: string }>("estimate", { CustomerRef: { value: customerRef }, Line, PrivateNote: `App estimate ${est.id}` });
      return { id: r.Id };
    },
  };
}
