const CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

/**
 * A random password for an admin to generate, copy, and hand to a new
 * or reset user out-of-band — there is no email system to deliver it
 * instead (see L5 user management). Uses the Web Crypto RNG rather than
 * Math.random, since this value ends up as someone's real credential.
 */
export function generatePassword(length = 16): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  return Array.from(values, (value) => CHARSET[value % CHARSET.length]).join("");
}
