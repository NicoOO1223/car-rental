import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border-subtle bg-surface p-6 ${className}`}>
      {children}
    </section>
  );
}
