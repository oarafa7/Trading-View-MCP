"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, setToken } from "@/lib/gateway";

const TABS = [
  { href: "/", label: "Chat" },
  { href: "/mission", label: "Mission" },
  { href: "/workflows", label: "Workflows" },
  { href: "/knowledge", label: "Knowledge" },
];

const TOKENS = [
  { token: "dev-owner", label: "owner" },
  { token: "dev-admin", label: "admin" },
  { token: "dev-operator", label: "operator" },
  { token: "dev-viewer", label: "viewer" },
];

export function TopNav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  const [token, setTok] = useState<string>("dev-owner");

  useEffect(() => {
    setTok(getToken());
  }, []);

  function onRole(t: string) {
    setToken(t);
    setTok(t);
    window.location.reload(); // re-fetch everything as the new role
  }

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
                className={`rounded-md px-3 py-1 text-sm transition ${active ? "bg-elevated text-white" : "text-muted hover:text-white"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs text-muted">
        {right}
        <label className="flex items-center gap-1.5">
          <span className="text-muted">role</span>
          <select
            value={token}
            onChange={(e) => onRole(e.target.value)}
            className="rounded border border-border bg-base px-2 py-1 text-white outline-none"
          >
            {TOKENS.map((t) => (
              <option key={t.token} value={t.token}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
