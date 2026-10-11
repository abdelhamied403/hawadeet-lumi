"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getOverview } from "@/services/veogen";

const LINKS = [
  { href: "/", label: "Desk" },
  { href: "/series", label: "Series" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { data } = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 15_000 });
  const quota = data?.quota;
  const usedHours = quota ? quota.usedSeconds / 3600 : 0;
  const allowedHours = quota ? quota.allowedSeconds / 3600 : 0;

  return (
    <header className="border-b bg-strip">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl font-extrabold tracking-[0.18em] text-primary">
          VEOGEN
        </Link>
        <nav className="flex gap-1" aria-label="Main">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" || pathname.startsWith("/episodes") : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  active && "bg-secondary text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {quota && allowedHours > 0 && (
          <div className="ml-auto min-w-44" title="Kaggle's free GPU allowance for this week">
            <div className="flex justify-between font-mono text-xs text-muted-foreground">
              <span>GPU this week</span>
              <span>
                {usedHours.toFixed(1)} / {allowedHours.toFixed(0)} h
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, (usedHours / allowedHours) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
