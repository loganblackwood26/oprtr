import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "./crypto";
import { googleAdapters } from "./google";
import { qboAdapter } from "./quickbooks";
import { quoAdapter } from "./quo";
import type { AccountingAdapter, CalendarAdapter, EmailAdapter, SmsAdapter, StoredCredentials } from "./types";

type Provider = "quickbooks" | "quo" | "google";

interface Bundle {
  quickbooks: AccountingAdapter;
  sms: SmsAdapter;
  gmail: EmailAdapter;
  calendar: CalendarAdapter;
}

const NOT_CONNECTED = (p: string) => new Error(`${p} is not connected. Connect it in Settings → Integrations.`);

/**
 * Resolve a provider's adapters for a company. Throws a friendly error if the
 * provider isn't connected — the AI relays that to the owner in one line.
 */
export async function getIntegration(db: SupabaseClient, companyId: string, provider: Provider): Promise<Bundle> {
  const [{ data: row }, { data: company }] = await Promise.all([
    db.from("integrations").select("*").eq("company_id", companyId).eq("provider", provider).maybeSingle(),
    db.from("companies").select("name,timezone").eq("id", companyId).single(),
  ]);
  if (!row) throw NOT_CONNECTED(label(provider));
  const creds = decryptJson<StoredCredentials>(row.credentials);
  const onRefresh = async (next: StoredCredentials) => {
    await db.from("integrations").update({ credentials: encryptJson(next) }).eq("id", row.id);
  };

  const missing = <T extends object>(name: string): T => new Proxy({} as T, { get: () => () => Promise.reject(NOT_CONNECTED(name)) });

  switch (provider) {
    case "quickbooks":
      return { quickbooks: qboAdapter({ ...creds, realmId: row.external_id! }, onRefresh, row.writes_enabled), sms: missing<SmsAdapter>("Quo"), gmail: missing<EmailAdapter>("Google"), calendar: missing<CalendarAdapter>("Google") };
    case "quo":
      return { sms: quoAdapter({ apiKey: creds.accessToken, fromNumber: row.external_id! }), quickbooks: missing<AccountingAdapter>("QuickBooks"), gmail: missing<EmailAdapter>("Google"), calendar: missing<CalendarAdapter>("Google") };
    case "google": {
      const g = googleAdapters(creds, onRefresh, { fromName: company?.name, timezone: company?.timezone ?? "America/Denver" });
      return { ...g, quickbooks: missing<AccountingAdapter>("QuickBooks"), sms: missing<SmsAdapter>("Quo") };
    }
  }
}

function label(p: Provider) {
  return p === "quickbooks" ? "QuickBooks" : p === "quo" ? "Quo" : "Google";
}

export async function saveIntegration(db: SupabaseClient, companyId: string, provider: Provider, creds: StoredCredentials, externalId?: string, scopes?: string[]) {
  const { error } = await db.from("integrations").upsert({ company_id: companyId, provider, external_id: externalId ?? null, credentials: encryptJson(creds), scopes: scopes ?? null, connected_at: new Date().toISOString() }, { onConflict: "company_id,provider" });
  if (error) throw error;
}
