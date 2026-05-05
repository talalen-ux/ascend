"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect, useEnsName } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

const truncate = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Connect() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: ensName } = useEnsName({ address, query: { enabled: !!address && chain?.id === 1 } });
  const { data: balance } = useBalance({ address });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!isConnected || !address) {
    // Pick injected if present, else first connector. Show a small dropdown
    // when there are multiple options.
    const injectedConn = connectors.find((c) => c.id === "injected" || c.type === "injected");
    const showMulti = connectors.length > 1;

    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => {
            if (!showMulti && injectedConn) connect({ connector: injectedConn });
            else setOpen((o) => !o);
          }}
          disabled={isPending}
          className={clsx(
            "rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-accent transition",
            "hover:bg-accent/15 hover:shadow-glow",
            isPending && "opacity-50",
          )}
        >
          {isPending ? "connecting…" : "connect wallet"}
        </button>
        <AnimatePresence>
          {open && showMulti && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-edge bg-canvas shadow-soft"
            >
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  onClick={() => {
                    connect({ connector: c });
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-[12px] text-bone/90 transition hover:bg-glass"
                >
                  <span>{c.name}</span>
                  <span className="text-[10px] text-ash">{c.type}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className="mt-2 max-w-[220px] text-[10px] text-accent2">{error.message}</p>}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-edge bg-glass px-3 py-2 text-[11px] font-mono text-bone/90 transition hover:border-accent/40"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>{ensName ?? truncate(address)}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-edge bg-canvas shadow-soft"
          >
            <div className="space-y-1 px-4 py-3 text-[11px]">
              <div className="text-ash">connected</div>
              <div className="font-mono text-bone/90">{ensName ?? truncate(address)}</div>
              <div className="font-mono text-ash">
                {chain?.name ?? "unknown"} ·{" "}
                {balance ? `${Number(balance.formatted).toFixed(4)} ${balance.symbol}` : "—"}
              </div>
            </div>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="block w-full border-t border-edge px-4 py-3 text-left text-[11px] text-bone/80 transition hover:bg-glass"
            >
              disconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
