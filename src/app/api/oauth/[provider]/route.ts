import { NextResponse } from "next/server";
import { currentContext } from "@/lib/supabase/server";
import { qboAuthUrl, qboExchangeCode } from "@/lib/integrations/quickbooks";
import { googleAuthUrl, googleExchangeCode, GOOGLE_SCOPES } from "@/lib/integrations/google";
import { saveIntegration } from "@/lib/integrations/registry";

export const runtime = "nodejs";

/**
 * GET /api/oauth/:provider            → redirect to provider consent
 * GET /api/oauth/:provider?code=...   → callback, store credentials
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role !== "owner") return NextResponse.redirect(new URL("/login", req.url));
  const { provider } = await params;
  const url = new URL(req.url);
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/${provider}`;
  const companyId = ctx.membership.company_id as string;
  const code = url.searchParams.get("code");

  if (provider === "quickbooks") {
    if (!code) return NextResponse.redirect(qboAuthUrl(companyId, redirectUri));
    const realmId = url.searchParams.get("realmId")!;
    const creds = await qboExchangeCode(code, redirectUri, realmId);
    await saveIntegration(ctx.supabase, companyId, "quickbooks", creds, realmId, ["com.intuit.quickbooks.accounting"]);
    return NextResponse.redirect(new URL("/settings/integrations?connected=quickbooks", process.env.NEXT_PUBLIC_APP_URL));
  }
  if (provider === "google") {
    if (!code) return NextResponse.redirect(googleAuthUrl(companyId, redirectUri));
    const creds = await googleExchangeCode(code, redirectUri);
    await saveIntegration(ctx.supabase, companyId, "google", creds, creds.email, GOOGLE_SCOPES);
    return NextResponse.redirect(new URL("/settings/integrations?connected=google", process.env.NEXT_PUBLIC_APP_URL));
  }
  return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
}

/** POST /api/oauth/quo { apiKey, fromNumber } — Quo uses API keys, not OAuth. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role !== "owner") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await params;
  if (provider !== "quo") return NextResponse.json({ error: "Unsupported" }, { status: 400 });
  const { apiKey, fromNumber } = (await req.json()) as { apiKey: string; fromNumber: string };
  if (!apiKey || !fromNumber) return NextResponse.json({ error: "apiKey and fromNumber required" }, { status: 400 });
  await saveIntegration(ctx.supabase, ctx.membership.company_id as string, "quo", { accessToken: apiKey }, fromNumber);
  return NextResponse.json({ ok: true });
}
