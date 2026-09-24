import { redirect } from "next/navigation";

export default function ConfigurationIndexPage() {
  redirect("/admin/configuration/pricing");
}
