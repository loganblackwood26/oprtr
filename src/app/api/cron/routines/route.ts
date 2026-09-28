import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDueRoutines } from "@/lib/ai/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Called every 10 minutes by Vercel Cron (see vercel.json). */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceClient();
  const results = await runDueRoutines(db);
  return NextResponse.json({ fired: results.length, results });
}
