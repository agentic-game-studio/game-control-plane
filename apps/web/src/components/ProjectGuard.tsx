"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useProject } from "@/contexts/ProjectContext";

/**
 * Renders children only when a project is currently selected. Otherwise
 * shows a full-bleed overlay prompting the user to pick or create one
 * via the dashboard. Used to gate pages whose content is meaningless
 * without project context (chat, tickets, assets).
 */
export function ProjectGuard({ children }: { children: ReactNode }) {
  const { currentProject, loading } = useProject();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading projects...
          </span>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-8">
        <div className="border-2 border-black bg-yellow-300 shadow-[6px_6px_0_0_rgba(0,0,0,1)] p-8 max-w-lg w-full">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-2xl">warning</span>
            <h2 className="font-[var(--font-headline)] text-xl font-black uppercase tracking-tighter">
              No Project Selected
            </h2>
          </div>
          <p className="font-[var(--font-terminal)] text-sm uppercase mb-4 leading-relaxed">
            This page is project-scoped. Pick an existing project from the
            switcher in the header, or open the dashboard to create one.
          </p>
          <Link
            href="/dashboard"
            className="block w-full text-center border-2 border-black bg-black text-white px-4 py-2 font-[var(--font-terminal)] text-sm font-bold uppercase tracking-wider hover:bg-white hover:text-black retro-press"
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
