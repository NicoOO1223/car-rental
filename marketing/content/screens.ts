// The screenshots of the staff panel and booking site. They are produced by
// scripts/capture-screens.mjs against a fictional demo business ("Isola Rent",
// backend/seed_marketing_demo.py) and written to public/screens/<id>-<width>.webp.
// If a shot has not been captured, the page draws a clearly labelled placeholder.

export type ScreenId =
  | "dashboard"
  | "storefront"
  | "wizard"
  | "reservation"
  | "fleet"
  | "handover"
  | "checkout"
  | "classes"
  | "email"
  | "revenue"
  | "audit";

export type Screen = {
  id: ScreenId;
  kind: "browser" | "phone";
  /** Pixel size of the page that was captured, for the aspect ratio. */
  width: number;
  height: number;
  /** True when public/screens/<id>-<width>.webp exists (tests/screens.test.ts checks). */
  available: boolean;
};

const browser = (id: ScreenId): Screen => ({ id, kind: "browser", width: 1440, height: 900, available: true });

export const screens: Record<ScreenId, Screen> = {
  dashboard: browser("dashboard"),
  storefront: { id: "storefront", kind: "phone", width: 390, height: 844, available: true },
  wizard: browser("wizard"),
  reservation: browser("reservation"),
  fleet: browser("fleet"),
  handover: browser("handover"),
  checkout: browser("checkout"),
  classes: browser("classes"),
  email: browser("email"),
  revenue: browser("revenue"),
  audit: browser("audit"),
};
