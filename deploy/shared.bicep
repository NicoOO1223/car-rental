// Infrastructure shared by every customer stack: the container registry.
// Kept in its own resource group so deleting a stack never touches it, and
// so every stack pulls the same image builds.
//
// Deployed by deploy/provision.ps1 (idempotent). Names and the CI app id
// are in deploy/shared.json.

@description('Azure region.')
param location string = 'swedencentral'

@description('Globally unique registry name (lowercase alphanumeric, 5 to 50 characters).')
param registryName string

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    // Stacks pull with their managed identity and CI pushes with OIDC, so
    // there is no registry password to leak.
    adminUserEnabled: false
  }
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
