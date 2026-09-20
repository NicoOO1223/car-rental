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

// Lets Container Apps (which don't have stable outbound IPs without a
// VNet) reach the server. Broad for a prototype — fine here since the
// server also requires SSL and a real login; tighten with VNet
// integration if this ever needs to be more production-hardened.
resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// GitHub-hosted Actions runners aren't covered by the rule above (they're
// not an Azure service) and publish no small, stable IP range worth
// allowlisting here. Opened wide for the same reason AllowAllAzureServices
// is: SSL + password auth is the real access boundary, not the firewall.
// Needed so the scheduled db-backup.yml workflow can reach this server to
// run pg_dump. Do not narrow this back down without also breaking backups.
resource postgresFirewallGithubActions 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowGithubActionsRunners'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '255.255.255.255'
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
