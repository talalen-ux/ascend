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
        ascend
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

// Mark is rendered as <img src="/logo.svg" /> via the shared component.
// Inlined here as a lightweight wrapper to keep the navbar static.
function Mark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="ascend" width={20} height={20} style={{ display: "block" }} />;
}
