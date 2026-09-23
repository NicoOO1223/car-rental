/**
 * ISO 3166-1 alpha-2 country codes, for the customer nationality field.
 * Deliberately not exhaustive of every territory — covers the countries
 * customers of a Sardinia-based car rental are realistically from.
 */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "IT", name: "Italy" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "LU", name: "Luxembourg" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czechia" },
  { code: "SK", name: "Slovakia" },
  { code: "HU", name: "Hungary" },
  { code: "RO", name: "Romania" },
  { code: "BG", name: "Bulgaria" },
  { code: "GR", name: "Greece" },
  { code: "HR", name: "Croatia" },
  { code: "SI", name: "Slovenia" },
  { code: "EE", name: "Estonia" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "MT", name: "Malta" },
  { code: "CY", name: "Cyprus" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "CN", name: "China" },
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "ZA", name: "South Africa" },
  { code: "RU", name: "Russia" },
  { code: "UA", name: "Ukraine" },
  { code: "TR", name: "Turkey" },
  { code: "IL", name: "Israel" },
  { code: "AL", name: "Albania" },
  { code: "RS", name: "Serbia" },
];

/**
 * Renders an ISO alpha-2 code as its flag emoji via Unicode regional
 * indicator symbols — no image assets or icon library needed. Returns
 * an empty string for anything that isn't exactly two letters.
 */
export function countryFlagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";

  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";

  const codePoints = [...upper].map(
    (char) => 127397 + char.charCodeAt(0),
  );

  return String.fromCodePoint(...codePoints);
}

export function countryName(code: string | null | undefined): string {
  return COUNTRIES.find((country) => country.code === code)?.name ?? "";
}
