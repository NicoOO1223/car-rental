import { brand } from "@/content/brand";

// A typographic wordmark: the name in the display face, with a small filled
// square in the accent colour (a key tag / a parking bay). Colours come from
// the page, so it works on the dark hero and on white.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`display inline-flex items-baseline gap-1 text-2xl font-bold lowercase ${className}`}>
      {brand.name}
      <span aria-hidden="true" className="inline-block size-2 rounded-[2px] bg-accent" />
    </span>
  );
}
