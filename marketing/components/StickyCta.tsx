"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// A bottom bar on phones, shown once the hero has scrolled out of view and never
// on the demo page itself.
export function StickyCta({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const onDemo = pathname.startsWith("/demo");

  useEffect(() => {
    const hero = document.getElementById("hero");

    if (!hero) {
      // Not the home page: show nothing rather than a bar with no context.
      return;
    }

    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(hero);

    return () => observer.disconnect();
  }, [pathname]);

  if (onDemo || !visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-deep p-3 md:hidden">
      <Link
        href="/demo"
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-accent-ink"
      >
        {label}
      </Link>
    </div>
  );
}
