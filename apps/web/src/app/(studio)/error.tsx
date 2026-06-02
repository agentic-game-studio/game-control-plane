import { createLogger } from "../../lib/logger";
"use client";
import { useEffect } from "react";
import Link from "next/link";
/**
 * Studio error boundary — catches any uncaught exception in the (studio) route
 * group and renders a recovery UI instead of a blank page. Without this, a
 * single bad render anywhere in /chat, /tickets, /assets, etc. would white-
 * screen the entire app with no way back.
 */
const logger = createLogger("error");

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so devs see the stack in dev tools.
    // In production, this is the only signal that a render error occurred.
    // eslint-disable-next-line no-console
    logger.error("", { err: error });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f3f2ff] p-8">
      <div className="max-w-lg w-full border-4 border-black bg-white shadow-[8px_8px_0px_#000] p-6">
        <h1 className="text-2xl font-bold font-[var(--font-label)] border-b-4 border-black pb-2 mb-4">
          Something went wrong
        </h1>
        <p className="text-sm mb-2 font-[var(--font-terminal)]">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="text-xs opacity-60 mb-4 font-[var(--font-terminal)]">
            Error ID: <code>{error.digest}</code>
          </p>
        )}
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 border-2 border-black bg-[#0055FF] text-white font-bold hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none shadow-[4px_4px_0px_#000] transition-all"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 border-2 border-black bg-white text-black font-bold hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none shadow-[4px_4px_0px_#000] transition-all no-underline"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
