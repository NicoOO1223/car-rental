"use client";

import { useState } from "react";

import { EmailMessageLog } from "@/components/email/EmailMessageLog";
import { EmailPartsEditor } from "@/components/email/EmailPartsEditor";
import { EmailStatusCard } from "@/components/email/EmailStatusCard";
import { EmailTypeList } from "@/components/email/EmailTypeList";

// Email: is it working, which emails exist and what they say, and what was sent.
// Administrators only; the server refuses everyone else.
export default function EmailConfigurationPage() {
  // Pausing or resuming changes what the log is about to show.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <EmailStatusCard onChanged={() => setRefreshKey((key) => key + 1)} />
      <EmailTypeList />
      <EmailPartsEditor />
      <EmailMessageLog refreshKey={refreshKey} />
    </>
  );
}
