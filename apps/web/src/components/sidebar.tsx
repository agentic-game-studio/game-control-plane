"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/sessions", label: "Sessions", icon: "📋" },
  { href: "/agents", label: "Agents", icon: "🤖" },
  { href: "/skills", label: "Skills", icon: "⚡" },
  { href: "/teams", label: "Teams", icon: "👥" },
  { href: "/gates", label: "Gates", icon: "🚦" },
  { href: "/design", label: "Design", icon: "📐" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r bg-card flex-shrink-0 flex flex-col">
      <div className="px-4 py-5 border-b">
        <h1 className="text-base font-bold text-foreground">Game Studio</h1>
        <p className="text-xs text-muted-foreground">Control Plane</p>
      </div>
      <nav className="flex-1 py-3">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-primary/10 text-primary border-r-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t">
        <p className="text-xs text-muted-foreground">v0.1.0</p>
      </div>
    </aside>
  );
}