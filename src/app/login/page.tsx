"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="h-10 w-10 rounded-xl bg-accent mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-ink-2 mt-1">We&apos;ll email you a link. No password to remember.</p>
        </div>
        {sent ? (
          <div className="card p-5">
            <p className="font-medium">Check your email</p>
            <p className="text-ink-2 text-sm mt-1">We sent a sign-in link to {email}. It expires in an hour.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input className="input" type="email" required placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            {err && <p className="text-danger text-sm">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || !email}>{busy ? "Sending…" : "Email me a link"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
