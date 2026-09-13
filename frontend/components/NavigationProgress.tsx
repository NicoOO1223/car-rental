"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";

type NavigationProgressContextValue = {
  navigate: (action: () => void) => void;
  isPending: boolean;
};

const NavigationProgressContext =
  createContext<NavigationProgressContextValue | null>(null);

// Wraps the whole app once (see app/layout.tsx). useTransition gives an
// "is a navigation still in flight" boolean for free, per call, without
// any page needing to manage its own loading flag — every page's
// useNavigate() call shares this same pending state, so one top bar
// reacts consistently no matter which page triggered the navigation.
export function NavigationProgressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  function navigate(action: () => void) {
    startTransition(action);
  }

  return (
    <NavigationProgressContext.Provider value={{ navigate, isPending }}>
      {isPending && (
        <div
          role="progressbar"
          aria-busy="true"
          aria-label="Loading page"
          className="fixed left-0 top-0 z-[100] h-0.5 w-full overflow-hidden bg-gray-200"
        >
          <div className="h-full w-1/3 animate-[progress-slide_0.9s_ease-in-out_infinite] bg-gray-900" />
        </div>
      )}
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function useNavigationProgress() {
  const context = useContext(NavigationProgressContext);

  if (!context) {
    throw new Error(
      "useNavigationProgress must be used within a NavigationProgressProvider",
    );
  }

  return context;
}
