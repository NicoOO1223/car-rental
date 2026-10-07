import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-surface p-6 shadow-sm ${className}`}>
      {children}
    </section>
  );
}
