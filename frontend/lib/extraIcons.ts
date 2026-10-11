import {
  Baby,
  Fuel,
  Navigation,
  Package,
  ShieldCheck,
  Snowflake,
  Sofa,
  UserPlus,
  Wifi,
  type LucideIcon,
} from "lucide-react";

// The add-ons the product ships with are known by code.
const BY_CODE: Record<string, LucideIcon> = {
  ADDITIONAL_DRIVER: UserPlus,
  REFUELING_SERVICE: Fuel,
  PASSENGER_INSURANCE: ShieldCheck,
  INTERIOR_COVERAGE: Sofa,
  BABY_SEAT: Baby,
  CHILD_SEAT: Baby,
};

// A business can add its own, so the words in the code or the name decide for those.
const BY_WORD: [RegExp, LucideIcon][] = [
  [/seat|baby|child|booster/i, Baby],
  [/driver/i, UserPlus],
  [/insur|cover|damage|protect|waiver/i, ShieldCheck],
  [/fuel|refuel|tank/i, Fuel],
  [/gps|navig|sat.?nav/i, Navigation],
  [/wi.?fi|internet|hotspot/i, Wifi],
  [/snow|chain|winter/i, Snowflake],
  [/interior|clean|seat cover/i, Sofa],
];

/** The icon for an add-on line: by its code, else by what its name says, else a box. */
export function extraIcon(code: string, name: string): LucideIcon {
  const known = BY_CODE[code.toUpperCase()];

  if (known) return known;

  const text = `${code} ${name}`;

  return BY_WORD.find(([pattern]) => pattern.test(text))?.[1] ?? Package;
}
