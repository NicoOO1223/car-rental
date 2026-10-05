// Lets the marketing site's identity pull images from the shared registry.
// A module of marketing.bicep, deployed into the REGISTRY's resource group (the
// registry lives apart from every stack: see shared.bicep).

@description('Name of the shared container registry.')
param registryName string

@description('Principal id of the identity that pulls images.')
param principalId string

// The built-in AcrPull role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, principalId, acrPullRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
