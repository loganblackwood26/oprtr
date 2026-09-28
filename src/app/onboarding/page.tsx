import { redirect } from "next/navigation";
import { currentContext } from "@/lib/supabase/server";
import { CreateCompanyForm } from "./create-company";
import { OnboardingShell } from "./shell";

const SECTIONS: Array<{ key: string; label: string; factKeys: string[] }> = [
  { key: "basics", label: "Basics", factKeys: ["services.offered", "hours.working", "crew.size"] },
  { key: "quoting", label: "How you quote", factKeys: ["quoting.method"] },
  { key: "money", label: "Margins & money", factKeys: ["money.target_margin", "money.deposit", "money.payment_terms"] },
  { key: "customers", label: "Customers", factKeys: ["customers.source"] },
  { key: "stories", label: "Past jobs", factKeys: [] },
  { key: "why", label: "Why you", factKeys: ["differentiators", "voice.tone"] },
  { key: "sops", label: "How you handle things", factKeys: [] },
];

export default async function OnboardingPage() {
  const ctx = await currentContext();
  if (!ctx) redirect("/login");
  if (!ctx.membership) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <CreateCompanyForm defaultEmail={ctx.user.email ?? ""} />
      </main>
    );
  }
  const companyId = ctx.membership.company_id as string;
  const company = ctx.membership.companies as unknown as { name: string; onboarding_completed_at: string | null };
  const [{ data: facts }, { count: items }, { count: chunks }, { count: sops }] = await Promise.all([
    ctx.supabase.from("memory_facts").select("key").eq("company_id", companyId),
    ctx.supabase.from("price_book_items").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ctx.supabase.from("memory_chunks").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("kind", "past_job"),
    ctx.supabase.from("sops").select("id", { count: "exact", head: true }).eq("company_id", companyId),
  ]);
  const have = new Set((facts ?? []).map((f) => f.key));
  const progress = SECTIONS.map((s) => {
    let done = s.factKeys.length > 0 && s.factKeys.every((k) => have.has(k));
    if (s.key === "quoting") done = (items ?? 0) > 0;
    if (s.key === "stories") done = (chunks ?? 0) > 0;
    if (s.key === "sops") done = (sops ?? 0) > 0;
    return { ...s, done };
  });

  return <OnboardingShell companyName={company.name} progress={progress} alreadyDone={!!company.onboarding_completed_at} />;
}
