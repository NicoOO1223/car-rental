/**
 * Leaves the current page with a full browser load instead of a client-side
 * transition. Used on sign-in, sign-out and an expired session, where
 * everything held in memory (the current user, the language, cached lists)
 * has to be rebuilt from scratch for whoever is signed in next. A client
 * transition would keep it, which is exactly what must not happen.
 *
 * This is the one place that does it, so the reason is written down once.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
