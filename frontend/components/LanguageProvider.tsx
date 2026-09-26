"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { IntlProvider } from "use-intl";

import { useBrand } from "@/components/BrandProvider";
import { updateMyLanguage } from "@/lib/api";
import {
  DEFAULT_LANGUAGE,
  PSEUDO,
  isLanguage,
  loadMessages,
  setActiveLanguage,
  type Messages,
} from "@/lib/i18n";

const STORAGE_KEY = "ui_language";

// --- The language last used on this device ------------------------------------
//
// Remembered so the sign-in page, which has no signed-in person to ask, opens
// in the language the last person used. localStorage does not exist on the
// server, so it is read through useSyncExternalStore, like the sidebar's
// collapsed state.

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);

  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

// A language picked on the sign-in page, before anyone was signed in. Held for
// this tab only, until the person signs in and it can go onto their account.
const PENDING_KEY = "ui_language_pending";

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function writePending(language: string | null) {
  try {
    if (language) sessionStorage.setItem(PENDING_KEY, language);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do: the pick simply is not carried over.
  }
}

function writeStored(language: string) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private windows can refuse storage; the choice still applies this session.
  }

  listeners.forEach((listener) => listener());
}

/** English, Italian, Polish, and the development-only pseudo-language. */
function usable(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isLanguage(value)) return value;
  if (value === PSEUDO && process.env.NODE_ENV !== "production") return value;

  return null;
}

// --- Context --------------------------------------------------------------------

type LanguageContextValue = {
  /** The language showing now. */
  language: string;
  /** Whether a person is signed in, i.e. a choice is saved to their account. */
  signedIn: boolean;
  /** Changes the language, saving it to the account when signed in. */
  setLanguage: (language: string) => Promise<void>;
  /**
   * Called once the signed-in person is known. `null` means they never chose
   * one, so the business default applies.
   */
  setUserLanguage: (language: string | null) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  signedIn: false,
  setLanguage: async () => {},
  setUserLanguage: () => {},
});

/**
 * Decides which language the interface is in, loads its catalog, and hands
 * it to every component (through use-intl) and to lib/i18n.ts's plain `t`.
 *
 * Which language wins:
 *   1. A signed-in person's own choice, else the business default. The
 *      device's remembered language is deliberately ignored here: on a
 *      shared computer, one person's choice must not become the next
 *      person's.
 *   2. Signed out (the sign-in page): the language last used on this device,
 *      else the business default.
 *   3. English.
 *
 * Nothing renders until the catalog is loaded, so there is no flash of
 * English and nothing to mismatch on hydration.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const brand = useBrand();
  const stored = useSyncExternalStore(subscribe, readStored, () => "");

  // undefined: not known yet (signed out, or the account is still loading).
  const [userLanguage, setUserLanguageState] = useState<string | null | undefined>(
    undefined,
  );
  const [catalog, setCatalog] = useState<{ language: string; messages: Messages } | null>(
    null,
  );

  const businessDefault = brand.loaded ? usable(brand.defaultLanguage) : null;

  // The development pseudo-language is never saved to an account, so it
  // sticks to the device instead: a page reload keeps it while testing.
  const devPseudo = stored === PSEUDO ? usable(PSEUDO) : null;

  const wanted =
    devPseudo ??
    (userLanguage !== undefined
      ? (usable(userLanguage) ?? businessDefault)
      : (usable(stored) ?? businessDefault));

  // A person who is offline or whose branding call failed still gets English.
  const resolved = wanted ?? (brand.loaded ? DEFAULT_LANGUAGE : null);

  useEffect(() => {
    if (!resolved) return;

    let cancelled = false;

    loadMessages(resolved)
      .then((messages) => {
        if (cancelled) return;

        setActiveLanguage(resolved, messages);
        setCatalog({ language: resolved, messages });
        document.documentElement.lang = resolved === PSEUDO ? "en" : resolved;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [resolved]);

  // What the sign-in page will open in next time.
  useEffect(() => {
    if (resolved && usable(resolved) && stored !== resolved) writeStored(resolved);
  }, [resolved, stored]);

  // The account's language is applied once per session. Changing language
  // rebuilds the components below, including the one that loads the account
  // and calls this, and that second call must not put back the saved value
  // over a choice just made.
  const accountApplied = useRef(false);

  const setUserLanguage = useCallback((language: string | null) => {
    if (accountApplied.current) return;
    accountApplied.current = true;

    // Someone who chose a language on the sign-in page and has none saved
    // keeps that choice: it goes onto their account now that we know who
    // they are. Someone who already chose one keeps theirs.
    const pending = usable(readPending());
    writePending(null);

    if (language === null && pending && pending !== PSEUDO) {
      setUserLanguageState(pending);
      updateMyLanguage(pending).catch(() => {});
      return;
    }

    setUserLanguageState(language);
  }, []);

  const setLanguage = useCallback(
    async (language: string) => {
      if (userLanguage === undefined) {
        // Signed out: this device remembers it, and it is offered to the
        // account of whoever signs in next in this tab.
        writeStored(language);
        writePending(language);
        return;
      }

      // Development pseudo-language is not an account setting.
      if (language !== PSEUDO) await updateMyLanguage(language);

      setUserLanguageState(language);
    },
    [userLanguage],
  );

  const value = useMemo(
    () => ({
      language: resolved ?? DEFAULT_LANGUAGE,
      signedIn: userLanguage !== undefined,
      setLanguage,
      setUserLanguage,
    }),
    [resolved, userLanguage, setLanguage, setUserLanguage],
  );

  if (!catalog) return null;

  return (
    <LanguageContext.Provider value={value}>
      {/* Keyed by language so every component, and every helper that calls
          the plain `t`, is rebuilt with the new words. */}
      <IntlProvider
        key={catalog.language}
        locale={catalog.language === PSEUDO ? "en" : catalog.language}
        messages={catalog.messages}
        onError={() => {}}
        getMessageFallback={({ namespace, key }) =>
          namespace ? `${namespace}.${key}` : key
        }
      >
        {children}
      </IntlProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
