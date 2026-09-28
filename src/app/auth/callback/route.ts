import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing: exchanges the code for a session and routes to onboarding or home. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const supabase = await createClient();
  if (code) await supabase.auth.exchangeCodeForSession(code);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  const { data: m } = await supabase.from("memberships").select("company_id, companies(onboarding_completed_at)").eq("user_id", user.id).limit(1).maybeSingle();
  const companies = m?.companies as unknown as { onboarding_completed_at: string | null } | null;
  if (!m) return NextResponse.redirect(new URL("/onboarding", url.origin));
  if (!companies?.onboarding_completed_at) return NextResponse.redirect(new URL("/onboarding", url.origin));
  return NextResponse.redirect(new URL("/", url.origin));
}
