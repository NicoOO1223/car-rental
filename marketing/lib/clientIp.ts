/**
 * The visitor's address as the platform reports it. The platform's ingress
 * appends the real client address, so the LAST entry is the one to trust; the
 * earlier ones are whatever the client claimed (the same rule as
 * backend/app/services/client_ip.py).
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    const last = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .pop();

    if (last) return last;
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}
