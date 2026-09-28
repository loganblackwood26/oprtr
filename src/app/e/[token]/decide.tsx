"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { customerDecideEstimate } from "@/app/actions";

export function DecideButtons({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<"approve" | "decline" | null>(null);
  const router = useRouter();
  const go = (d: "approve" | "decline") => start(async () => { await customerDecideEstimate(token, d); router.refresh(); });

  if (confirm) {
    return (
      <div className="card p-4">
        <p className="font-medium">{confirm === "approve" ? "Approve this estimate?" : "Decline this estimate?"}</p>
        <p className="text-sm text-ink-2 mt-1">{confirm === "approve" ? "We'll reach out to get you on the schedule." : "No problem — we'll note it and leave you be."}</p>
        <div className="flex gap-2 mt-4">
          <button className={confirm === "approve" ? "btn-primary flex-1" : "btn-danger flex-1"} disabled={pending} onClick={() => go(confirm)}>{pending ? "…" : "Yes"}</button>
          <button className="btn-outline flex-1" disabled={pending} onClick={() => setConfirm(null)}>Back</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <button className="btn-primary flex-1 h-12 text-base" onClick={() => setConfirm("approve")}>Approve estimate</button>
      <button className="btn-outline h-12" onClick={() => setConfirm("decline")}>Decline</button>
    </div>
  );
}
