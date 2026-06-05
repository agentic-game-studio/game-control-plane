"use client";

import TopAppBar from "./TopAppBar";
import SideNavBar from "./SideNavBar";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";

interface MobileNavItem {
  href: Route;
  icon: string;
  label: string;
}

const mobileNavItems: MobileNavItem[] = [
  { href: "/dashboard", icon: "dashboard", label: "DASH" },
  { href: "/chat", icon: "chat", label: "COMMS" },
  { href: "/tickets", icon: "checklist", label: "QUESTS" },
  { href: "/assets", icon: "menu", label: "MORE" },
];

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <TopAppBar />
      <div className="flex pt-16 h-screen overflow-hidden">
        <SideNavBar />
        <main className="flex-1 overflow-y-auto bg-surface-container-lowest">
          {children}
        </main>
      </div>
      {/* Mobile Bottom Nav */}
      {/* 14-FH8-mobile-nav-a11y: nav role + aria-label for screen
          readers, aria-current="page" on the active item, and
          the active item gets a top border + primary colour. The
          previous version had no active state at all — a user on
          /tickets saw no visual confirmation they were in the right
          tab, and SR users got no programmatic hint either. */}
      <nav
        aria-label="Mobile studio navigation"
        className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t-2 border-black flex justify-around items-center h-16 z-50"
      >
        {mobileNavItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center w-full h-full font-[var(--font-label)] text-xs font-bold uppercase mt-1 ${
                isActive
                  ? "text-primary border-t-4 border-primary"
                  : "text-black hover:bg-zinc-100 border-t-4 border-transparent"
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
