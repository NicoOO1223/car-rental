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
      backupRetentionDays: 7
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

output acrLoginServer string = acr.properties.loginServer
output acrName string = acrName
output containerAppsEnvId string = containerAppsEnv.id
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
output postgresDbName string = postgresDbName
