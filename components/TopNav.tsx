"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Connect } from "./Connect";

const links = [
  { href: "/", label: "trade" },
  { href: "/whitepaper", label: "whitepaper" },
];

export function TopNav() {
  const path = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 pt-6">
      <Link href="/" className="flex items-center gap-2 font-mono text-[12px] text-bone">
        <Mark />
        rise
      </Link>
      <div className="flex items-center gap-5">
        <div className="hidden gap-5 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[11px] uppercase tracking-widest transition ${
                path === l.href ? "text-bone" : "text-ash hover:text-bone"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <Connect />
      </div>
    </nav>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <circle cx="12" cy="12" r="10" stroke="#f4a261" strokeWidth="1" fill="none" />
      <path
        d="M5 18 L9 18 L9 14 L13 14 L13 10 L17 10 L17 6 L19 6"
        stroke="#f4a261"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
