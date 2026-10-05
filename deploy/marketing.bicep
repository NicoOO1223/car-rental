// The marketing site: ONE Container App, nothing else. No database, no storage:
// the demo form sends email and stores nothing (marketing/lib/demoRequest.ts).
//
// It is not a customer stack (no manifest, no canary, no customer data), so it has
// its own resource group and its own script, deploy/provision-marketing.ps1. It joins an
// EXISTING Container Apps environment, because an Azure subscription can be capped at
// one (see deploy/PROVISIONING.md); its resource group is its own, so deleting a
// customer stack can never touch it.
//
// Deployed in two phases by the script, because a role assignment can take a minute to
// take effect and the app pulls its image the moment it is created:
//   1. deployApp=false  creates the identity and lets it pull from the registry.
//   2. deployApp=true   creates the app, pulling with that identity.
// Both are idempotent: running either again changes only what differs.
//
// Email (Azure Communication Services) is set up by the script with deploy/email.bicep,
// the same module a customer stack uses, because it needs DNS records added by a person.

@description('Azure region.')
param location string = 'swedencentral'

@description('Name of the Container App.')
param appName string = 'marketing-site'

@description('Resource id of the existing Container Apps environment to join.')
param containerAppsEnvironmentId string

@description('Name of the shared container registry (deploy/shared.json).')
param registryName string

@description('Resource group of the shared container registry.')
param registryResourceGroup string

@description('false: only the identity and its registry role. true: also the app.')
param deployApp bool = true

@description('Full image reference, e.g. <registry>.azurecr.io/marketing:<tag>.')
param image string = ''

@description('Replicas kept running. 0 lets the site scale to nothing when idle (a visitor then waits a second or two); 1 keeps it warm for about 6 USD a month.')
@minValue(0)
@maxValue(2)
param minReplicas int = 0

@description('The public address the site is served at, for canonical links. Read when the image is built, so this only documents it for the container.')
param siteUrl string = ''

@description('Who is told about a demo request.')
param notifyAddress string

@description('The address mail is sent from (needs a verified sending domain). Leave empty until email is set up: the form then tells the visitor to write instead.')
param mailFromAddress string = ''

@description('Cloudflare Turnstile site key (public).')
param turnstileSiteKey string = ''

@description('Enforce the Content-Security-Policy instead of only reporting. Switch on after a clean week of reports.')
param cspEnforce bool = false

@secure()
@description('Signs the form token. Required: without it the form skips its timing check.')
param formSecret string = ''

@secure()
@description('Connection string of the Communication Services resource that sends mail.')
param acsConnectionString string = ''

@secure()
@description('Cloudflare Turnstile secret key. Without it the form refuses to send in production.')
param turnstileSecretKey string = ''

// ---- identity: pulls images, nothing else --------------------------------------------

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-pull'
  location: location
}

module pull 'marketing-acrpull.bicep' = {
  name: '${appName}-acrpull'
  scope: resourceGroup(registryResourceGroup)
  params: {
    registryName: registryName
    principalId: identity.properties.principalId
  }
}

// ---- the app --------------------------------------------------------------------------

var secrets = concat(
  empty(formSecret) ? [] : [ { name: 'form-secret', value: formSecret } ],
  empty(acsConnectionString) ? [] : [ { name: 'acs-connection-string', value: acsConnectionString } ],
  empty(turnstileSecretKey) ? [] : [ { name: 'turnstile-secret-key', value: turnstileSecretKey } ]
)

// Settings, never the two test-only switches (ALLOW_NO_TURNSTILE, ALLOW_FILE_MAILER):
// marketing/tests/deploy.test.ts fails if either appears in anything under deploy/.
var env = concat(
  [
    { name: 'DEMO_NOTIFY_ADDRESS', value: notifyAddress }
    { name: 'SITE_URL', value: siteUrl }
    { name: 'CSP_ENFORCE', value: cspEnforce ? 'true' : 'false' }
  ],
  empty(formSecret) ? [] : [ { name: 'FORM_SECRET', secretRef: 'form-secret' } ],
  empty(acsConnectionString) ? [] : [ { name: 'ACS_CONNECTION_STRING', secretRef: 'acs-connection-string' } ],
  empty(mailFromAddress) ? [] : [ { name: 'MAIL_FROM_ADDRESS', value: mailFromAddress } ],
  empty(turnstileSiteKey) ? [] : [ { name: 'TURNSTILE_SITE_KEY', value: turnstileSiteKey } ],
  empty(turnstileSecretKey) ? [] : [ { name: 'TURNSTILE_SECRET_KEY', secretRef: 'turnstile-secret-key' } ]
)

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: '${registryName}.azurecr.io'
          identity: identity.id
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'marketing'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: env
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        // The in-memory rate limit is per replica, so more than two would multiply a visitor's budget.
        maxReplicas: 2
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    pull
  ]
}

output identityId string = identity.id
output identityPrincipalId string = identity.properties.principalId
// The app only exists in phase 2; the ternary guards the read, which Bicep cannot see.
#disable-next-line BCP318
output appFqdn string = deployApp ? app.properties.configuration.ingress.fqdn : ''
output appName string = appName
