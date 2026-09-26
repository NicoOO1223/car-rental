// Numbers, money and times in the visitor language.

export function formatMoney(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    // An unknown currency code: show the number and the code.
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** "Sat, 15 Jun 2040" at a place. */
export function formatDate(iso: string, timeZone: string, language: string): string {
  return new Intl.DateTimeFormat(language, { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}

/** "10:00" at a place. */
export function formatTime(iso: string, timeZone: string, language: string): string {
  return new Intl.DateTimeFormat(language, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** A wall-clock slot such as "14:30", written the way the language writes times. */
export function formatSlot(slot: string, language: string): string {
  const [hour, minute] = slot.split(":").map(Number);

  return new Intl.DateTimeFormat(language, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }).format(
    new Date(Date.UTC(2000, 0, 1, hour, minute)),
  );
}
