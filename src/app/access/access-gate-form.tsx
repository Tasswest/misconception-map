"use client";

import { useState } from "react";

export function AccessGateForm({ nextPath }: { nextPath: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="mt-7"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/access", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accessCode: form.get("accessCode") }),
          });
          const payload = (await response.json()) as {
            error?: { message?: string };
          };
          if (!response.ok) {
            setMessage(payload.error?.message ?? "The access code was not accepted.");
            return;
          }
          window.location.assign(nextPath);
        } catch {
          setMessage("The shared demo could not be reached. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-semibold" htmlFor="accessCode">
        Judge access code
      </label>
      <input
        autoComplete="current-password"
        autoFocus
        className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base outline-none transition focus:border-[var(--sage)] focus:ring-4 focus:ring-[var(--sage)]/15"
        id="accessCode"
        name="accessCode"
        required
        type="password"
      />
      {message ? (
        <p className="mt-3 rounded-xl bg-[var(--amber)]/15 px-3 py-2 text-sm leading-5 text-[#765725]" role="alert">
          {message}
        </p>
      ) : null}
      <button
        className="mt-4 w-full rounded-xl bg-[var(--sidebar)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#214d43] disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Checking…" : "Open the shared demo"}
      </button>
    </form>
  );
}
