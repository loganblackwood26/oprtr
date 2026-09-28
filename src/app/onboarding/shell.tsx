"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { Chat } from "@/components/chat";
import { completeOnboarding } from "@/app/actions";

export function OnboardingShell({ companyName, progress, alreadyDone }: { companyName: string; progress: Array<{ key: string; label: string; done: boolean }>; alreadyDone: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const doneCount = progress.filter((p) => p.done).length;

  return (
    <div className="flex-1 flex flex-col md:flex-row h-dvh">
      <aside className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface p-5 flex flex-col">
        <div className="text-xs text-ink-3 uppercase tracking-wide">Setting up</div>
        <div className="font-semibold text-lg mt-0.5">{companyName}</div>
        <p className="text-sm text-ink-2 mt-2 hidden md:block">This is the one long conversation. The more you tell it, the less you&apos;ll ever have to explain again.</p>
        <ol className="mt-5 space-y-1.5 hidden md:block">
          {progress.map((p) => (
            <li key={p.key} className={`flex items-center gap-2.5 text-sm ${p.done ? "text-ink" : "text-ink-2"}`}>
              {p.done ? <span className="h-5 w-5 rounded-full bg-accent text-white flex items-center justify-center"><Check className="h-3 w-3" /></span> : <Circle className="h-5 w-5 text-border" />}
              {p.label}
            </li>
          ))}
        </ol>
        <div className="md:hidden text-sm text-ink-2 mt-1">{doneCount} of {progress.length} sections done</div>
        <div className="mt-auto pt-5">
          <button
            className={doneCount >= 3 || alreadyDone ? "btn-primary w-full" : "btn-outline w-full"}
            disabled={pending}
            onClick={() => start(async () => { await completeOnboarding(); router.push("/"); })}
          >
            {alreadyDone ? "Back to the app" : doneCount >= 3 ? "I'm done for now" : "Skip to the app"}
          </button>
          <p className="text-xs text-ink-3 mt-2 text-center">You can come back any time — just tell the assistant to &ldquo;teach you something.&rdquo;</p>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          skillId="onboarding"
          placeholder="Type or dictate — take your time"
          starter={`Hey — I'm going to be your office manager. Before I can quote, follow up, or schedule anything, I need to learn how ${companyName} actually works.\n\nLet's start simple: what services do you offer, and where do you work?`}
        />
      </div>
    </div>
  );
}
