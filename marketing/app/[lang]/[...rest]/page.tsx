import { notFound } from "next/navigation";

// Every address that matches no page lands here and becomes a 404 INSIDE the site
// layout (header, footer, the right <html lang>), instead of Next's bare default
// page. See app/[lang]/not-found.tsx for what it shows.
export default function NoSuchPage() {
  notFound();
}
