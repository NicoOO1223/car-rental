import Link from "next/link";

type Variant = "accent" | "dark" | "outline";

const STYLES: Record<Variant, string> = {
  // Accent is a fill with dark ink on it, never text on white.
  accent: "bg-accent text-accent-ink hover:brightness-95",
  dark: "bg-ink text-on-deep hover:bg-deep-raised",
  outline: "border border-border-strong bg-surface text-ink hover:bg-surface-sunken",
};

export function buttonClass(variant: Variant = "accent", extra = ""): string {
  return `inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 text-base font-semibold transition ${STYLES[variant]} ${extra}`;
}

export function ButtonLink({
  href,
  variant = "accent",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}
