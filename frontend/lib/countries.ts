import { getLocale } from "@/lib/format";

/**
 * Every ISO 3166-1 alpha-2 country and territory code. Names are not stored
 * here: they come from the browser's own Intl.DisplayNames in the business
 * locale, so the list is complete, correctly spelled, and follows the
 * business's language for free.
 */
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

let namesCache: { locale: string | undefined; names: Intl.DisplayNames | null } | null = null;

function displayNames(): Intl.DisplayNames | null {
  const locale = getLocale();

  if (!namesCache || namesCache.locale !== locale) {
    let names: Intl.DisplayNames | null = null;

    try {
      names = new Intl.DisplayNames(locale ? [locale, "en"] : ["en"], { type: "region" });
    } catch {
      names = null;
    }

    namesCache = { locale, names };
  }

  return namesCache.names;
}

/** The country's name in the business locale, or its code if unknown. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";

  const upper = code.toUpperCase();

  return displayNames()?.of(upper) ?? upper;
}

/** Every country, alphabetical in the business locale, for select lists. */
export function getCountries(): { code: string; name: string }[] {
  const locale = getLocale();

  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort(
    (a, b) => a.name.localeCompare(b.name, locale),
  );
}
