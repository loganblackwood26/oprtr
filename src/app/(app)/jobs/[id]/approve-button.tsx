"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { approveEstimate } from "@/app/actions";

export function ApproveEstimateButton({ estimateId }: { estimateId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      className="btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await approveEstimate(estimateId);
        router.refresh();
        setBusy(false);
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve estimate
    </button>
  );
}
