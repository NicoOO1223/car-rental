// Static, idempotent infrastructure for ONE customer stack (deployed by
// deploy/provision.ps1). The container registry is shared by every stack
// and lives in deploy/shared.bicep.
// Deliberately does NOT define the two Container Apps here — their
// images depend on each other's FQDNs (backend's URL is baked into the
// frontend's build, frontend's URL goes into the backend's CORS setting),
// which is a one-time bootstrap ordering problem better handled as a
// short sequential script (see provision.ps1) than encoded in Bicep.

@description('Azure region for all resources.')
param location string = 'swedencentral'

@description('Short unique suffix (lowercase alphanumeric) used in globally-unique resource names, e.g. "ab12cd".')
param uniqueSuffix string

@description('Administrator username for the Postgres Flexible Server.')
param postgresAdminUser string = 'carrentaladmin'

@description('Administrator password for the Postgres Flexible Server.')
@secure()
param postgresAdminPassword string

@description('Resource ID of an existing Container Apps environment to use instead of creating one. A stopgap for a subscription capped at one environment in total (or one per region) — every other resource here (database, backups) still stays this stack\'s own. Leave empty for the normal case, one environment per stack.')
param existingContainerAppsEnvironmentId string = ''

var postgresServerName = 'car-rental-pg-${uniqueSuffix}'
var logAnalyticsName = 'car-rental-logs'
var containerAppsEnvName = 'car-rental-env'
var postgresDbName = 'car_rental'
var backupStorageAccountName = 'carrentalbak${uniqueSuffix}'
var backupContainerName = 'pg-backups'
var photoStorageAccountName = 'carrentalphotos${uniqueSuffix}'
var photoContainerName = 'condition-photos'
// The storefront landing page's hero image — same account as the photos
// above (the backend's managed identity already has Storage Blob Data
// Contributor at the account scope, so this needs no separate role grant).
var landingContainerName = 'landing-images'
// Uploaded car photos — same account and reasoning as landingContainerName.
var carPhotoContainerName = 'car-photos'
var sharingEnvironment = !empty(existingContainerAppsEnvironmentId)

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!sharingEnvironment) {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = if (!sharingEnvironment) {
  name: containerAppsEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        // Bicep can't tell that this resource and logAnalytics always share
        // the same condition, so it can't rule out logAnalytics being absent
        // here — but whenever this resource actually deploys, sharingEnvironment
        // is false and logAnalytics deploys right alongside it.
        #disable-next-line BCP318 BCP422
        customerId: logAnalytics.properties.customerId
        #disable-next-line BCP318 BCP422
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

// Postgres extensions have to be allowed on the server before a migration can
// CREATE them. btree_gist backs the database's no-overlapping-bookings rule
// (backend/alembic/versions/e7a9c1d3f5b2). Nothing else uses an extension, so
// this list replaces an empty one. Server settings change one at a time, so it
// waits for the database resource.
resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'BTREE_GIST'
    source: 'user-override'
  }
  dependsOn: [
    postgresDb
  ]
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
          // Reading the server itself: the CLI looks it up before touching a rule.
          'Microsoft.DBforPostgreSQL/flexibleServers/read'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/read'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/write'
          'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/delete'
          // The CLI waits for each change to finish by polling these.
          'Microsoft.DBforPostgreSQL/locations/azureAsyncOperation/read'
          'Microsoft.DBforPostgreSQL/locations/operationResults/read'
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

// Employee-captured vehicle condition photos (see backend's
// app/services/photo_storage.py), read and written by the backend
// Container App's own managed identity rather than CI's — provision.ps1
// grants that role once the app exists, since Bicep deliberately does not
// define the Container Apps here (see the file header). Unlike the backup
// storage above, nothing here is deleted: photos are kept, only tiered to
// Cool after 90 days to keep the (already small) cost down a little.
resource photoStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: photoStorageAccountName
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

resource photoBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: photoStorage
  name: 'default'
}

resource photoContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: photoBlobService
  name: photoContainerName
  properties: {
    publicAccess: 'None'
  }
}

// The storefront landing page's hero image (see app/services/
// landing_hero.py), read and served through the backend rather than a
// public blob URL — this account has allowBlobPublicAccess: false, same as
// every container in it.
resource landingContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: photoBlobService
  name: landingContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Uploaded car photos (see app/services/car_photos.py), served the same
// way as the landing page's images — never a public blob URL.
resource carPhotoContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: photoBlobService
  name: carPhotoContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource photoLifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: photoStorage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'cool-old-photos'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${photoContainerName}/']
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 90
                }
              }
            }
          }
        }
      ]
    }
  }
}

output containerAppsEnvId string = sharingEnvironment ? existingContainerAppsEnvironmentId : containerAppsEnv.id
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
output postgresDbName string = postgresDbName
output backupStorageAccountName string = backupStorageAccountName
output photoStorageAccountName string = photoStorageAccountName
