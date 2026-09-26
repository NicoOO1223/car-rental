// Liveness for the container health check and the platform probes. It touches
// nothing else, so a slow API never makes a healthy site restart.
export function GET() {
  return Response.json({ status: "ok" });
}
