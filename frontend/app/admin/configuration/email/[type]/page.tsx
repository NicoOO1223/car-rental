"use client";

import { use } from "react";

import { EmailTypeEditor } from "@/components/email/EmailTypeEditor";

// One email: its wording per language, its switch and options, a preview and a test.
export default function EmailTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);

  return <EmailTypeEditor typeKey={type} />;
}
