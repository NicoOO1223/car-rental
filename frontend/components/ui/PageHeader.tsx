import type { ReactNode } from "react";

/**
 * The title / description / actions row every page opens with. Ten pages
 * hand-rolled this same flex arrangement with the same type scale.
 */
export function PageHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>

        {description && (
          <p className="mt-1.5 text-sm text-ink-secondary sm:text-base">{description}</p>
        )}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * The standard page shell: canvas background, consistent padding, and one
 * of a small set of content widths. Page padding used to be a flat `p-8`
 * everywhere except the fleet page, which burned 64px of a 375px phone
 * screen on gutters.
 */
export function PageShell({
  children,
  width = "wide",
  className = "",
}: {
  children: ReactNode;
  width?: "narrow" | "medium" | "wide" | "full";
  className?: string;
}) {
  const maxWidth = {
    narrow: "max-w-3xl",
    medium: "max-w-5xl",
    wide: "max-w-7xl",
    full: "max-w-[1800px]",
  }[width];

  return (
    <main className={`min-h-screen bg-canvas p-4 sm:p-6 lg:p-8 ${className}`}>
      <div className={`mx-auto ${maxWidth}`}>{children}</div>
    </main>
  );
}
