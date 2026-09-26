// What the search form and the booking steps share through the address.

/** Place ids and local times ("2040-06-15T10:00") for the pickup and the return. */
export type SearchValues = { pickup: string; return: string; from: string; to: string };

export function searchHref(language: string, values: SearchValues): string {
  return `/${language}/book?${new URLSearchParams(values)}`;
}

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The search in an address, or null when any part is missing or malformed. */
export function readSearch(params: URLSearchParams): SearchValues | null {
  const values = {
    pickup: params.get("pickup") ?? "",
    return: params.get("return") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };

  if (!values.pickup || !values.return || !LOCAL_TIME.test(values.from) || !LOCAL_TIME.test(values.to)) {
    return null;
  }

  return values;
}
