import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGuard } from "@/components/AuthGuard";
import { BrandProvider } from "@/components/BrandProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { NavigationProgressProvider } from "@/components/NavigationProgress";
import { t } from "@/lib/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
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

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-gray-50">
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