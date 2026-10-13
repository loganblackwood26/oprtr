import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "./crypto";
import { calendarAdapter, connectionStatus, gmailAdapter, quickbooksAdapter } from "./composio";
import { quoAdapter } from "./quo";
import type { AccountingAdapter, CalendarAdapter, EmailAdapter, SmsAdapter, StoredCredentials } from "./types";

/**
 * Provider → adapters.
 *   quickbooks, google  → Composio (per-company connected accounts)
 *   quo                 → direct API key stored encrypted in `integrations`
 */
type Provider = "quickbooks" | "quo" | "google";

interface Bundle {
  quickbooks: AccountingAdapter;
  sms: SmsAdapter;
  gmail: EmailAdapter;
  calendar: CalendarAdapter;
}

const NOT_CONNECTED = (p: string) => new Error(`${p} is not connected. Connect it in Settings → Connections.`);
const missing = <T extends object>(name: string): T => new Proxy({} as T, { get: () => () => Promise.reject(NOT_CONNECTED(name)) });

export async function getIntegration(db: SupabaseClient, companyId: string, provider: Provider): Promise<Bundle> {
  const { data: company } = await db.from("companies").select("name,timezone").eq("id", companyId).single();
  const tz = company?.timezone ?? "America/Denver";

  if (provider === "quo") {
    const { data: row } = await db.from("integrations").select("*").eq("company_id", companyId).eq("provider", "quo").maybeSingle();
    if (!row) throw NOT_CONNECTED("Quo");
    const creds = decryptJson<StoredCredentials>(row.credentials);
    return { sms: quoAdapter({ apiKey: creds.accessToken, fromNumber: row.external_id! }), quickbooks: missing("QuickBooks"), gmail: missing("Google"), calendar: missing("Google") };
  }

  const status = await connectionStatus(companyId);
  const has = (k: "quickbooks" | "gmail" | "googlecalendar") => status.find((s) => s.toolkit === k)?.connected;

  if (provider === "quickbooks") {
    if (!has("quickbooks")) throw NOT_CONNECTED("QuickBooks");
    const { data: row } = await db.from("integrations").select("writes_enabled").eq("company_id", companyId).eq("provider", "quickbooks").maybeSingle();
    return { quickbooks: quickbooksAdapter(companyId, !!row?.writes_enabled), sms: missing("Quo"), gmail: missing("Google"), calendar: missing("Google") };
  }

  // google
  if (!has("gmail") && !has("googlecalendar")) throw NOT_CONNECTED("Google");
  return {
    gmail: has("gmail") ? gmailAdapter(companyId) : missing("Gmail"),
    calendar: has("googlecalendar") ? calendarAdapter(companyId, tz) : missing("Google Calendar"),
    quickbooks: missing("QuickBooks"),
    sms: missing("Quo"),
  };
}

/** Quo only: store the API key + sending number. */
export async function saveQuo(db: SupabaseClient, companyId: string, apiKey: string, fromNumber: string) {
  const { error } = await db.from("integrations").upsert({ company_id: companyId, provider: "quo", external_id: fromNumber, credentials: encryptJson({ accessToken: apiKey }), connected_at: new Date().toISOString() }, { onConflict: "company_id,provider" });
  if (error) throw error;
}

/** Record that a Composio-managed provider is connected (so settings like writes_enabled have a row to live on). */
export async function markConnected(db: SupabaseClient, companyId: string, provider: "quickbooks" | "google", externalId?: string) {
  const { error } = await db.from("integrations").upsert({ company_id: companyId, provider, external_id: externalId ?? null, credentials: encryptJson({ managedBy: "composio" }), connected_at: new Date().toISOString() }, { onConflict: "company_id,provider", ignoreDuplicates: true });
  if (error) throw error;
}
