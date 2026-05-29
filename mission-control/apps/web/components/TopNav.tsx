"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Chat" },
  { href: "/mission", label: "Mission" },
  { href: "/workflows", label: "Workflows" },
];

export function TopNav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-widest text-white">
          <span className="text-accent">◢</span> MISSION CONTROL
        </span>
        <nav className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-3 py-1 text-sm transition ${
                  active ? "bg-elevated text-white" : "text-muted hover:text-white"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="font-mono text-xs text-muted">{right}</div>
    </header>
  );
}
