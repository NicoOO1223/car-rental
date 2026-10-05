// Server-side check of a Cloudflare Turnstile response. The marketing site has no
// backend to ask (the storefront's check lives in backend/app/services/turnstile.py),
// so it asks Cloudflare itself. Any failure counts as "not verified".

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile({
  token,
  ip,
  secret,
  fetchImpl = fetch,
  timeoutMs = 5000,
}: {
  token: string;
  ip: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<boolean> {
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });

    if (ip && ip !== "unknown") body.set("remoteip", ip);

    const response = await fetchImpl(SITEVERIFY, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return false;

    const result = (await response.json()) as { success?: boolean };

    return result.success === true;
  } catch {
    return false;
  }
}
