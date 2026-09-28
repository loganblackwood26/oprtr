import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Per-request client that respects the signed-in user's RLS. */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // called from a Server Component; middleware refreshes the session instead
        }
      },
    },
  });
}

/**
 * Service-role client for background jobs (routine runner, webhooks).
 * Bypasses RLS — every query MUST filter by company_id explicitly.
 */
export function createServiceClient(): SupabaseClient {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Resolve the current user and their (first) company; null if signed out or not onboarded. */
export async function currentContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("memberships")
    .select("company_id, role, display_name, companies(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return { supabase, user, membership };
}
