import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import type { EstimateResult } from "@/lib/domain/pricing/types";
import { EstimateTable } from "@/components/estimate-table";
import { DecideButtons } from "./decide";

export default async function PublicEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createServiceClient();
  const { data: est } = await db.from("estimates").select("id,status,result,customer_summary,version,sent_at, jobs(title, customers(name)), companies(name,phone,email)").eq("public_token", token).maybeSingle();
  if (!est) notFound();
  const job = est.jobs as unknown as { title: string; customers: { name: string } };
  const company = est.companies as unknown as { name: string; phone: string | null; email: string | null };
  const result = est.result as EstimateResult;
  const open = est.status === "sent";

  return (
    <main className="flex-1 px-5 py-8 md:py-14">
      <div className="max-w-xl mx-auto">
        <div className="text-sm text-ink-3">{company.name}</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Estimate for {job.customers?.name?.split(" ")[0]}</h1>
        <p className="text-ink-2 mt-1">{job.title}</p>
        <div className="card p-5 mt-6">
          <EstimateTable result={result} summary={est.customer_summary} />
        </div>
        <div className="mt-6">
          {open ? (
            <DecideButtons token={token} />
          ) : (
            <div className="card p-4 text-center text-ink-2">
              {est.status === "customer_approved" ? "You approved this estimate. Thank you — we'll be in touch about scheduling." : est.status === "declined" ? "You declined this estimate." : "This estimate is no longer active."}
            </div>
          )}
        </div>
        <p className="text-sm text-ink-3 mt-8 text-center">Questions? {company.phone ? `Call or text ${company.phone}` : company.email ? `Email ${company.email}` : "Reply to the message you received"}.</p>
      </div>
    </main>
  );
}
