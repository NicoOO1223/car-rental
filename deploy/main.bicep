// Static, idempotent infrastructure for the car-rental prototype.
// Deliberately does NOT define the two Container Apps here — their
// images depend on each other's FQDNs (backend's URL is baked into the
// frontend's build, frontend's URL goes into the backend's CORS setting),
// which is a one-time bootstrap ordering problem better handled as a
// short sequential script (see bootstrap.ps1) than encoded in Bicep.

@description('Azure region for all resources.')
param location string = 'swedencentral'

@description('Short unique suffix (lowercase alphanumeric) used in globally-unique resource names, e.g. "ab12cd".')
param uniqueSuffix string

@description('Administrator username for the Postgres Flexible Server.')
param postgresAdminUser string = 'carrentaladmin'

@description('Administrator password for the Postgres Flexible Server.')
@secure()
param postgresAdminPassword string

var acrName = 'carrentalacr${uniqueSuffix}'
var postgresServerName = 'car-rental-pg-${uniqueSuffix}'
var logAnalyticsName = 'car-rental-logs'
var containerAppsEnvName = 'car-rental-env'
var postgresDbName = 'car_rental'
var backupStorageAccountName = 'carrentalbak${uniqueSuffix}'
var backupContainerName = 'pg-backups'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      // Azure's max for Flexible Server. A free, complementary improvement
      // to the scripted blob-based backups below (see backupStorage) —
      // PITR within this window needs no restore drill of its own.
      backupRetentionDays: 35
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    // Free-tier billing (12 months, Burstable B1ms + <=32GB) isn't a
    // property you set — Azure applies it automatically at billing time
    // if this subscription hasn't already used its one free-tier server
    // elsewhere. Confirm actual billing in Cost Management after deploy.
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDbName
}

// Lets Container Apps reach the server. The 0.0.0.0 rule is Azure's special
// "any Azure service" marker: it admits traffic from every Azure customer's
// resources, not just ours, so the login and SSL still matter. Container
// Apps on the Consumption plan have a pool of 100+ outbound IPs, which makes
// a per-IP allowlist impractical; closing this fully needs a VNet with a
// private endpoint (a bigger change, deferred).
//
// There is deliberately NO rule for the internet at large. The daily
// db-backup.yml workflow opens a rule for its own runner IP for the length
// of the job and deletes it afterwards.
resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

@description('Object ID of the GitHub OIDC service principal that runs db-backup.yml. Leave empty to skip the role assignment.')
param backupPrincipalObjectId string = ''

// The backup job only needs to add and remove its own firewall rule, so it
// gets exactly those actions on this one server rather than Contributor.
resource firewallRuleManagerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'postgres-firewall-rule-manager')
  properties: {
    roleName: 'Postgres firewall rule manager (${uniqueSuffix})'
    description: 'Create, read and delete firewall rules on a Postgres flexible server.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/read'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/write'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/delete'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/operationResults/read'
        ]
      }
    ]
    assignableScopes: [
      resourceGroup().id
    ]
  }
}

resource backupFirewallRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(backupPrincipalObjectId)) {
  scope: postgres
  name: guid(postgres.id, backupPrincipalObjectId, 'postgres-firewall-rule-manager')
  properties: {
    roleDefinitionId: firewallRuleManagerRole.id
    principalId: backupPrincipalObjectId
    principalType: 'ServicePrincipal'
  }
}

// Offsite copy of scripted pg_dump backups, retained far longer than the
// server's own 35-day PITR window (see db-backup.yml / deploy/backup/).
resource backupStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: backupStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource backupBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: backupStorage
  name: 'default'
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: backupBlobService
  name: backupContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Ages backups out automatically instead of relying on someone to prune
// them by hand: tiered to Cool after a week (cheaper, still readily
// restorable), deleted after 35 days to bound storage cost.
resource backupLifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: backupStorage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-old-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${backupContainerName}/']
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 7
                }
                delete: {
                  daysAfterModificationGreaterThan: 35
                }
              }
            }
          }
        }
      ]
    }
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acrName
output containerAppsEnvId string = containerAppsEnv.id
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
output postgresDbName string = postgresDbName
output backupStorageAccountName string = backupStorageAccountName
