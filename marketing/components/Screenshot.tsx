import { screens, type ScreenId } from "@/content/screens";
import { getTranslator } from "@/lib/i18n";

// Widths the capture script writes (public/screens/<id>-<width>.webp).
const WIDTHS = { browser: [800, 1600], phone: [390, 780] } as const;

function Picture({ id, language, priority }: { id: ScreenId; language: string; priority: boolean }) {
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
      sizes={screen.kind === "phone" ? "(min-width: 768px) 320px, 80vw" : "(min-width: 1200px) 640px, 100vw"}
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
}: {
  id: ScreenId;
  language: string;
  priority?: boolean;
  dark?: boolean;
}) {
  const screen = screens[id];

  if (screen.kind === "phone") {
    return (
      <div className="mx-auto w-65 rounded-[2.25rem] border-[10px] border-deep bg-deep shadow-2xl md:w-[320px]">
        <div className="overflow-hidden rounded-[1.5rem]">
          <Picture id={id} language={language} priority={priority} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-2xl ${dark ? "border-white/10 bg-deep-raised" : "border-border-strong bg-surface"}`}
    >
      <div aria-hidden="true" className={`flex h-9 items-center gap-1.5 px-4 ${dark ? "bg-deep-raised" : "bg-surface-sunken"}`}>
        <span className="size-2.5 rounded-full bg-ink-muted/50" />
        <span className="size-2.5 rounded-full bg-ink-muted/50" />
        <span className="size-2.5 rounded-full bg-ink-muted/50" />
      </div>
      <Picture id={id} language={language} priority={priority} />
    </div>
  );
}
