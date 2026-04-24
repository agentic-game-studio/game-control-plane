"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import type { DashboardData } from "@game-studio/types";

const navItems = [
  { href: "/dashboard", icon: "dashboard", label: "Dashboard", fill: false },
  { href: "/chat", icon: "chat", label: "Comms", fill: false },
  { href: "/agents", icon: "smart_toy", label: "Agents", fill: false },
  { href: "/skills", icon: "psychology", label: "Skills", fill: false },
  { href: "/teams", icon: "groups", label: "Teams", fill: false },
  { href: "/gates", icon: "verified", label: "Gates", fill: false },
  { href: "/sessions", icon: "history", label: "Sessions", fill: false },
  { href: "/tickets", icon: "checklist", label: "Quests", fill: false },
  { href: "/assets", icon: "grid_on", label: "Assets", fill: false },
  { href: "/wiki", icon: "auto_stories", label: "Wiki", fill: false },
  { href: "/settings", icon: "account_balance_wallet", label: "Ledger", fill: false },
];

export default function SideNavBar() {
  const pathname = usePathname();
  const [credits, setCredits] = useState<{ current: number; max: number }>({ current: 100, max: 100 });

  useEffect(() => {
    apiFetch<DashboardData>("/api/dashboard")
      .then((data) => setCredits(data.summary.credits))
      .catch(() => {
        // Keep default credits on error
      });
  }, []);

  return (
    <nav className="hidden md:flex flex-col h-full w-64 border-r-2 border-black bg-white z-40 shrink-0">
      {/* Studio Identity */}
      <div className="p-4 border-b-2 border-black">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>sports_esports</span>
          </div>
          <div>
            <div className="font-[var(--font-headline)] text-sm font-bold uppercase text-black leading-tight">
              GAME_STUDIO
            </div>
            <div className="font-[var(--font-terminal)] text-xs text-black mt-1">
              HP: {credits.current}/{credits.max} CREDITS
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 overflow-y-auto py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive
                  ? "bg-[#0055FF] text-white flex items-center gap-3 p-4 border-y-2 border-black -ml-[2px] w-[calc(100%+4px)] font-[var(--font-terminal)] text-sm font-bold uppercase"
                  : "text-black flex items-center gap-3 p-4 hover:bg-[#0055FF] hover:text-white font-[var(--font-terminal)] text-sm font-bold uppercase transition-colors"
              }
            >
              <span
                className="material-symbols-outlined"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Footer Links */}
      <div className="mt-auto border-t-2 border-black p-4">
        <Link
          href="#"
          className="text-black flex items-center gap-3 p-2 hover:bg-[#0055FF] hover:text-white font-[var(--font-terminal)] text-sm font-bold uppercase transition-colors"
        >
          <span className="material-symbols-outlined">help</span>
          Support
        </Link>
        <Link
          href="#"
          className="text-black flex items-center gap-3 p-2 hover:bg-[#0055FF] hover:text-white font-[var(--font-terminal)] text-sm font-bold uppercase transition-colors"
        >
          <span className="material-symbols-outlined">logout</span>
          Logout
        </Link>
      </div>
    </nav>
  );
}
