"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
  { href: "/chat", icon: "chat", label: "Comms" },
  { href: "/tickets", icon: "checklist", label: "Quests" },
  { href: "/assets", icon: "grid_on", label: "Assets" },
  { href: "/wiki", icon: "auto_stories", label: "Wiki" },
  { href: "/settings", icon: "account_balance_wallet", label: "Ledger" },
];

export default function TopAppBar() {
  return (
    <header className="fixed top-0 left-0 w-full h-16 flex justify-between items-center px-6 z-50 bg-white border-b-2 border-black">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="font-[var(--font-headline)] text-xl font-black text-black uppercase tracking-tighter">
          STUDIO_OS v1.0
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <div className="border-2 border-black flex items-center px-2 py-1 bg-white hidden md:flex">
          <span className="material-symbols-outlined text-black mr-2 text-sm">search</span>
          <input
            className="bg-transparent border-none outline-none text-black font-[var(--font-terminal)] text-sm p-0 w-32 focus:ring-0 placeholder:text-black"
            placeholder="SEARCH_"
            type="text"
          />
        </div>
        <button className="border-2 border-black bg-white p-1 hover:bg-black hover:text-white transition-colors retro-press">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <Link href="/settings">
          <button className="border-2 border-black bg-white p-1 hover:bg-black hover:text-white transition-colors retro-press">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </Link>
        <div className="w-8 h-8 border-2 border-black bg-surface-container-high overflow-hidden">
          <div className="w-full h-full bg-zinc-300" />
        </div>
      </div>
    </header>
  );
}
