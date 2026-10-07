import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthGuard } from "@/components/AuthGuard";
import { BrandProvider } from "@/components/BrandProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { NavigationProgressProvider } from "@/components/NavigationProgress";
import { accentVariables } from "@/lib/accent";
import { t } from "@/lib/i18n";
import { runtimeConfigScript, serverRuntimeConfig } from "@/lib/runtimeConfig";

// The same family as the storefront. Latin-ext carries the Polish and Italian accented letters.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The tab title is the business's own name, read from the public branding
// endpoint on the server and refreshed every minute. If the API cannot be
// reached (for instance while this page is built) it falls back to a
// neutral title rather than failing.
export async function generateMetadata(): Promise<Metadata> {
  const apiUrl = serverRuntimeConfig().apiUrl;
  let name = "";

  try {
    const response = await fetch(`${apiUrl}/api/branding`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      name = (await response.json()).business_name ?? "";
    }
  } catch {
    // Keep the neutral title.
  }

  return {
    title: name ? t("s.layout.management", { name }) : t("s.layout.rentalManagement"),
    description: t("s.layout.vehicleRentalManagement"),
  };
}

export default async function RootLayout({
  children,
}: LayoutProps<"/">) {
  // Render per request: this stack's addresses come from the container's
  // environment, and must never be frozen into a page built beforehand.
  await connection();

  // The business's brand colour, set on the page before anything is drawn.
  // Without the API (or with a bad value) the default near-black stays.
  let accent: string | null = null;

  try {
    const response = await fetch(`${serverRuntimeConfig().apiUrl}/api/branding`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) accent = (await response.json()).accent_color ?? null;
  } catch {
    // Keep the default.
  }

  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
      style={accentVariables(accent) as React.CSSProperties}
    >
      <head>
        {/* Hands this stack's runtime values to the browser before any script runs. */}
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript(serverRuntimeConfig()) }} />
      </head>
      <body className="min-h-full bg-canvas">
        <NavigationProgressProvider>
          <BrandProvider>
            <LanguageProvider>
              <AuthGuard>{children}</AuthGuard>
            </LanguageProvider>
          </BrandProvider>
        </NavigationProgressProvider>
      </body>
    </html>
  );
}