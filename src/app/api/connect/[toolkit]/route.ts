import { NextResponse } from "next/server";
import { currentContext } from "@/lib/supabase/server";
import { disconnect, startConnection, type Toolkit } from "@/lib/integrations/composio";
import { markConnected, saveQuo } from "@/lib/integrations/registry";

export const runtime = "nodejs";

const TOOLKITS: Toolkit[] = ["quickbooks", "gmail", "googlecalendar"];

/**
 * GET  /api/connect/:toolkit            → redirect the owner to Composio's hosted consent screen
 * GET  /api/connect/:toolkit?done=1     → landing after consent; mark connected and go to Settings
 * POST /api/connect/quo                 → { apiKey, fromNumber } (Quo uses API keys, not OAuth)
 * DELETE /api/connect/:toolkit          → disconnect
 */
export async function GET(req: Request, { params }: { params: Promise<{ toolkit: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role !== "owner") return NextResponse.redirect(new URL("/login", req.url));
  const { toolkit } = await params;
  if (!TOOLKITS.includes(toolkit as Toolkit)) return NextResponse.json({ error: "Unknown toolkit" }, { status: 404 });
  const companyId = ctx.membership.company_id as string;
  const app = process.env.NEXT_PUBLIC_APP_URL!;
  const url = new URL(req.url);

  if (url.searchParams.get("done")) {
    await markConnected(ctx.supabase, companyId, toolkit === "quickbooks" ? "quickbooks" : "google");
    return NextResponse.redirect(new URL(`/settings/integrations?connected=${toolkit}`, app));
  }

  try {
    const { redirectUrl } = await startConnection(companyId, toolkit as Toolkit, `${app}/api/connect/${toolkit}?done=1`);
    return NextResponse.redirect(redirectUrl);
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings/integrations?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`, app));
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ toolkit: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role !== "owner") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { toolkit } = await params;
  if (toolkit !== "quo") return NextResponse.json({ error: "Unsupported" }, { status: 400 });
  const { apiKey, fromNumber } = (await req.json()) as { apiKey: string; fromNumber: string };
  if (!apiKey || !fromNumber) return NextResponse.json({ error: "apiKey and fromNumber required" }, { status: 400 });
  await saveQuo(ctx.supabase, ctx.membership.company_id as string, apiKey, fromNumber);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ toolkit: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role !== "owner") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { toolkit } = await params;
  const companyId = ctx.membership.company_id as string;
  if (toolkit === "quo") {
    await ctx.supabase.from("integrations").delete().eq("company_id", companyId).eq("provider", "quo");
    return NextResponse.json({ ok: true });
  }
  if (!TOOLKITS.includes(toolkit as Toolkit)) return NextResponse.json({ error: "Unknown toolkit" }, { status: 404 });
  await disconnect(companyId, toolkit as Toolkit);
  return NextResponse.json({ ok: true });
}
