"use client";

import { useState } from "react";

import { EmailMessageLog } from "@/components/email/EmailMessageLog";
import { EmailStatusCard } from "@/components/email/EmailStatusCard";
import { EmailWordingEditor } from "@/components/email/EmailWordingEditor";

// Email to renters: is it working, what does it say, what was sent. Administrators
// only; the server refuses everyone else.
export default function EmailConfigurationPage() {
  // Pausing or resuming changes what the log is about to show.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <EmailStatusCard onChanged={() => setRefreshKey((key) => key + 1)} />
      <EmailWordingEditor />
      <EmailMessageLog refreshKey={refreshKey} />
    </>
  );
}
