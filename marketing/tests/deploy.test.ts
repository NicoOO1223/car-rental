import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isPlaceholderEmail } from "@/content/brand";

// The deployment files live outside this app (deploy/, .github/) but decide how it runs,
// so the rules that matter are checked here, where the site's tests run.

const repo = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

/** The file without its comment lines, so a comment that explains a rule does not trip the rule. */
const code = (path: string) =>
  read(path)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|#)/.test(line))
    .join("\n");

const DEPLOYING_FILES = [
  "deploy/marketing.bicep",
  "deploy/marketing-acrpull.bicep",
  "deploy/provision-marketing.ps1",
  "deploy/marketing.json",
  ".github/workflows/marketing.yml",
  "marketing/Dockerfile",
];

describe("what a real deployment may set", () => {
  it("never sets the two test-only switches: they would turn off the bot check or divert the mail", () => {
    for (const file of DEPLOYING_FILES) {
      expect(code(file), file).not.toMatch(/ALLOW_NO_TURNSTILE|ALLOW_FILE_MAILER|MAIL_OUTBOX_FILE/);
    }
  });

  it("keeps secrets out of plain settings", () => {
    const bicep = code("deploy/marketing.bicep");

    for (const secret of ["FORM_SECRET", "ACS_CONNECTION_STRING", "TURNSTILE_SECRET_KEY"]) {
      expect(bicep, secret).toMatch(new RegExp(`name: '${secret}', secretRef:`));
      expect(bicep, secret).not.toMatch(new RegExp(`name: '${secret}', value:`));
    }
  });

  it("stores no secret in the repository's configuration", () => {
    const config = JSON.parse(read("deploy/marketing.json"));

    expect(JSON.stringify(config)).not.toMatch(/secret|password|key=|connection/i);
  });
});

describe("the site's deployment configuration", () => {
  const config = JSON.parse(read("deploy/marketing.json"));

  it("joins the environment of a stack that has a manifest", () => {
    expect(existsSync(join(repo, "deploy", "stacks", `${config.environmentStack}.json`))).toBe(true);
  });

  it("uses an app name Azure accepts (lowercase, hyphens, at most 32 characters)", () => {
    expect(config.appName).toMatch(/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/);
  });

  it("is not a customer stack: its own resource group, never one a stack uses", () => {
    expect(config.resourceGroup).toBe("marketing-rg");
  });

  it("runs at most two replicas, because the form's rate limit is per replica", () => {
    expect(config.minReplicas).toBeLessThanOrEqual(2);
    expect(code("deploy/marketing.bicep")).toMatch(/maxReplicas: 2/);
  });

  it("works out its own address when there is no custom domain, so canonical links are never localhost", () => {
    expect(read("deploy/provision-marketing.ps1")).toMatch(/properties\.defaultDomain/);
    expect(read("deploy/provision-marketing.ps1")).toMatch(/"https:\/\/\$appName\.\$defaultDomain"/);
  });

  it("keeps placeholder contact details marked as placeholders until someone fills them in", () => {
    // The script refuses a real deployment while this is true; this keeps that gate honest.
    if (isPlaceholderEmail(config.notifyAddress)) expect(read("deploy/provision-marketing.ps1")).toMatch(/-Staging/);
  });

  it("can send mail without a domain, through an Azure-managed one, and that option is off unless asked for", () => {
    // Customer stacks use email.bicep too: the managed-domain option must default to off.
    expect(read("deploy/email.bicep")).toMatch(/param azureManaged bool = false/);
    expect(config.mail.azureManaged).toBe(true);
    expect(read("deploy/provision-marketing.ps1")).toMatch(/azureManaged=true/);
  });

  it("keeps the notified address and the bot-check keys across runs that do not repeat them", () => {
    const script = read("deploy/provision-marketing.ps1");

    expect(script).toMatch(/Get-ExistingEnv "DEMO_NOTIFY_ADDRESS"/);
    expect(script).toMatch(/Get-ExistingEnv "TURNSTILE_SITE_KEY"/);
    expect(script).toMatch(/Get-ExistingSecret "turnstile-secret-key"/);
    expect(script).toMatch(/\[switch\]\$ClearTurnstile/);
  });

  it("does not make the site indexable on its own: the brand placeholder gate stays in charge", () => {
    expect(config.indexable).toBe(false);
  });
});

describe("the image", () => {
  const dockerfile = read("marketing/Dockerfile");

  it("copies public/: the standalone output leaves out the screenshots", () => {
    expect(dockerfile).toMatch(/COPY --from=builder \/repo\/marketing\/public/);
  });

  it("is built from the repository root, because the site imports shared/", () => {
    expect(dockerfile).toMatch(/COPY shared \.\/shared/);
  });

  it("runs on Node 22 or newer, which the Azure email SDK and Lighthouse require", () => {
    expect(dockerfile.match(/^FROM node:(\d+)/gm)?.every((line) => Number(line.match(/node:(\d+)/)?.[1]) >= 22)).toBe(true);
    expect(read(".github/workflows/marketing.yml")).not.toMatch(/node-version: "(18|20)"/);
  });

  it("runs as a non-root user with a health check", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/health/);
  });

  it("bakes in the address and the indexing switch at build time, both empty by default", () => {
    expect(dockerfile).toMatch(/ARG SITE_URL=""/);
    expect(dockerfile).toMatch(/ARG SITE_INDEXABLE=""/);
  });

  it("keeps the demo stack's copies and the tests out of the build context", () => {
    const ignore = read("marketing/Dockerfile.dockerignore");

    expect(ignore).toMatch(/marketing\/\.demo-stack/);
    expect(ignore).toMatch(/\*\*\/node_modules/);
  });
});

describe("the workflow", () => {
  const workflow = read(".github/workflows/marketing.yml");

  it("runs when the shared code changes too, and is separate from the product release", () => {
    expect(workflow).toMatch(/- "shared\/\*\*"/);
    expect(workflow).toMatch(/- "marketing\/\*\*"/);
    expect(read(".github/workflows/deploy.yml")).not.toMatch(/marketing/i);
  });

  it("checks, smoke-tests and runs Lighthouse before it deploys, and never deploys a pull request", () => {
    expect(workflow).toMatch(/npm run smoke/);
    expect(workflow).toMatch(/npm run lighthouse/);
    expect(workflow).toMatch(/needs: checks/);
    expect(workflow).toMatch(/if: github\.event_name != 'pull_request'/);
  });

  it("applies the launch gate when the site is meant to be indexed", () => {
    expect(workflow).toMatch(/npm run check:launch/);
    expect(workflow).toMatch(/vars\.SITE_INDEXABLE == 'true'/);
  });

  it("gives every job and the browser download a time limit, so a stuck step fails in minutes", () => {
    expect(workflow.match(/timeout-minutes:/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toMatch(/playwright install[^
]*
\s+timeout-minutes: \d+/);
  });

  it("deploys through the marketing environment, not a customer stack's", () => {
    expect(workflow).toMatch(/environment: marketing/);
    expect(workflow).not.toMatch(/environment: stack-/);
  });
});
