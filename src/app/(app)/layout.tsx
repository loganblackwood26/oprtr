import Link from "next/link";
import { redirect } from "next/navigation";
import { currentContext } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await currentContext();
  if (!ctx) redirect("/login");
  if (!ctx.membership) redirect("/onboarding");
  const company = ctx.membership.companies as unknown as { name: string; onboarding_completed_at: string | null };
  if (!company?.onboarding_completed_at) redirect("/onboarding");

  const { count: pending } = await ctx.supabase.from("approvals").select("id", { count: "exact", head: true }).eq("company_id", ctx.membership.company_id).eq("status", "pending");

  return (
    <div className="flex-1 flex flex-col md:flex-row">
      <aside className="hidden md:flex md:w-60 shrink-0 flex-col border-r border-border bg-surface p-4 gap-1 sticky top-0 h-screen">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-3 mb-2">
          <div className="h-7 w-7 rounded-lg bg-accent" />
          <div className="leading-tight">
            <div className="font-semibold text-[15px] truncate">{company.name}</div>
            <div className="text-xs text-ink-3 capitalize">{ctx.membership.role as string}</div>
          </div>
        </Link>
        <Nav pending={pending ?? 0} role={ctx.membership.role as string} />
      </aside>
      <main className="flex-1 min-w-0 flex flex-col pb-20 md:pb-0">{children}</main>
      <div className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-surface/95 backdrop-blur px-2 pb-[env(safe-area-inset-bottom)]">
        <Nav pending={pending ?? 0} role={ctx.membership.role as string} mobile />
      </div>
    </div>
  );
}
