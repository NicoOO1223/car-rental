import { allowReport, MAX_REPORT_BYTES, summarizeCspReport } from "@/lib/cspReport";

/**
 * Where browsers send Content-Security-Policy violation reports (report-uri in
 * lib/csp.ts). It needs no sign-in: the browser posts it without one, and all it
 * does is write a line to the container log.
 *
 * Find them with, in Log Analytics:
 *   ContainerAppConsoleLogs_CL | where Log_s startswith "csp-violation"
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);

  if (length <= MAX_REPORT_BYTES) {
    const body = await request.json().catch(() => null);
    const summary = summarizeCspReport(body);

    if (summary && allowReport()) {
      console.warn(`csp-violation ${JSON.stringify(summary)}`);
    }
  }

  return new Response(null, { status: 204 });
}
