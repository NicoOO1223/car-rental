// Monitoring alerts. Kept out of main.bicep because they point at the
// backend Container App, which bootstrap.ps1 creates AFTER main.bicep runs.
// Deployed by bootstrap.ps1 when -AlertEmail is supplied, or by hand:
//   az deployment group create -g car-rental-rg -f alerts.bicep \
//     -p alertEmail=<address> postgresServerName=<name>

@description('Where alert emails go. Supplied by the operator, never hardcoded.')
param alertEmail string

@description('Name of the Postgres flexible server (see main.bicep output postgresServerFqdn).')
param postgresServerName string

@description('Name of the backend Container App.')
param backendAppName string = 'car-rental-backend'

resource backendApp 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: backendAppName
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresServerName
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'car-rental-alerts'
  location: 'global'
  properties: {
    groupShortName: 'carrental'
    enabled: true
    emailReceivers: [
      {
        name: 'operator'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// A crash-looping revision (bad secret, failed migration) shows up here.
resource restartsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'backend-restarts'
  location: 'global'
  properties: {
    description: 'Backend container restarted repeatedly.'
    severity: 1
    enabled: true
    scopes: [backendApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'restarts'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'RestartCount'
          metricNamespace: 'Microsoft.App/containerApps'
          operator: 'GreaterThan'
          threshold: 2
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource serverErrorsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'backend-5xx'
  location: 'global'
  properties: {
    description: 'Backend is returning server errors.'
    severity: 1
    enabled: true
    scopes: [backendApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'http5xx'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Requests'
          metricNamespace: 'Microsoft.App/containerApps'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource dbCpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'postgres-cpu'
  location: 'global'
  properties: {
    description: 'Database CPU is high. The B1ms burstable tier throttles once credits run out.'
    severity: 2
    enabled: true
    scopes: [postgres.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'cpu'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'cpu_percent'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource dbStorageAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'postgres-storage'
  location: 'global'
  properties: {
    description: 'Database storage is nearly full.'
    severity: 2
    enabled: true
    scopes: [postgres.id]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'storage'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'storage_percent'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// Spikes here usually mean a wrong password or a firewall change.
resource dbFailedConnectionsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'postgres-failed-connections'
  location: 'global'
  properties: {
    description: 'Many failed database connections.'
    severity: 2
    enabled: true
    scopes: [postgres.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'failedConnections'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'connections_failed'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}
