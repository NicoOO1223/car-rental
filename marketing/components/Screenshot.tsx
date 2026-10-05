import { screens, type ScreenId } from "@/content/screens";
import { getTranslator } from "@/lib/i18n";

// Widths the capture script writes (public/screens/<id>-<width>.webp).
const WIDTHS = { browser: [800, 1600], phone: [390, 780] } as const;

function Picture({ id, language, priority, small: tile, wide }: { id: ScreenId; language: string; priority: boolean; small: boolean; wide: boolean }) {
  const t = getTranslator(language);
  const screen = screens[id];
  const [small, large] = WIDTHS[screen.kind];
  const style = { aspectRatio: `${screen.width} / ${screen.height}` };

  if (!screen.available) {
    // Not captured yet: a plainly labelled placeholder at the final aspect
    // ratio, so nothing shifts when the real image arrives.
    return (
      <div
        role="img"
        aria-label={t(`screens.${id}.alt`)}
        style={style}
        className="flex w-full flex-col items-center justify-center gap-1 bg-surface-sunken p-6 text-center text-ink-muted"
      >
        <span className="font-mono text-sm uppercase tracking-wide">{t("screens.placeholder", { name: t(`screens.${id}.name`) })}</span>
        <span className="text-sm">{t("screens.placeholderNote")}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- already sized webp from the capture script, served as-is
    <img
      src={`/screens/${id}-${large}.webp`}
      srcSet={`/screens/${id}-${small}.webp ${small}w, /screens/${id}-${large}.webp ${large}w`}
      sizes={
        screen.kind === "phone"
          ? "(min-width: 768px) 320px, 80vw"
          : tile
            ? "(min-width: 1200px) 300px, 50vw"
            : wide
              ? "(min-width: 1440px) 1408px, 100vw"
              : "(min-width: 1200px) 640px, 100vw"
      }
      width={screen.width}
      height={screen.height}
      alt={t(`screens.${id}.alt`)}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className="block w-full"
    />
  );
}

/** A screenshot in a minimal browser frame, or in a phone outline. */
export function Screenshot({
  id,
  language,
  priority = false,
  dark = false,
  small = false,
  wide = false,
}: {
  id: ScreenId;
  language: string;
  priority?: boolean;
  dark?: boolean;
  /** A thumbnail beside another picture: smaller frame chrome, a smaller image to download. */
  small?: boolean;
  /** Spans the page (the hero): the browser is told to fetch the large file. */
  wide?: boolean;
}) {
  const screen = screens[id];

  if (screen.kind === "phone") {
    return (
      <div className="mx-auto w-65 rounded-[2.25rem] border-[10px] border-deep bg-deep shadow-2xl md:w-[320px]">
        <div className="overflow-hidden rounded-[1.5rem]">
          <Picture id={id} language={language} priority={priority} small={small} wide={wide} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-2xl ${dark ? "border-white/10 bg-deep-raised" : "border-border-strong bg-surface"}`}
    >
      <div aria-hidden="true" className={`flex ${small ? "h-5 px-2" : "h-9 px-4"} items-center gap-1.5 ${dark ? "bg-deep-raised" : "bg-surface-sunken"}`}>
        <span className={`${small ? "size-1.5" : "size-2.5"} rounded-full bg-ink-muted/50`} />
        <span className={`${small ? "size-1.5" : "size-2.5"} rounded-full bg-ink-muted/50`} />
        <span className={`${small ? "size-1.5" : "size-2.5"} rounded-full bg-ink-muted/50`} />
      </div>
      <Picture id={id} language={language} priority={priority} small={small} wide={wide} />
    </div>
  );
}
