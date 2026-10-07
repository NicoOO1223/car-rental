// Email sending for one stack, through Azure Communication Services Email, from
// the business's own domain.
//
// Deployed by provision.ps1 when the stack's manifest has an "email" block, in
// two passes, because Azure only links a domain to the sending service once the
// domain's DNS records have been verified:
//   1. linkDomain=false  creates the email service, the domain and the sender
//      address, and returns the DNS records the business has to add.
//   2. linkDomain=true   (after the records are verified) also creates the
//      Communication Services resource that sends, linked to the domain. Its
//      connection string is what the backend uses (EMAIL_CONNECTION_STRING).

@description('Name of the Email Communication Service (holds the domain).')
param emailServiceName string

@description('Name of the Communication Service that sends the mail.')
param communicationServiceName string

@description('The domain mail is sent from, e.g. yourcompany.com. Its DNS must be changed by the business to prove it owns it.')
param domainName string

@description('The part before the @ of the sending address, e.g. bookings.')
param senderUsername string = 'bookings'

@description('The name recipients see next to the address.')
param senderDisplayName string

@description('Link the domain to the sending service. Only once the domain is verified.')
param linkDomain bool = false

@description('Where the data is kept. Europe keeps it in the EU.')
param dataLocation string = 'Europe'

@description('Use an Azure-managed domain (<random>.azurecomm.net) instead of your own domain: no DNS records and nothing to verify, mail comes from donotreply@ that domain. For testing: such mail may land in a spam folder. domainName and senderUsername are then ignored.')
param azureManaged bool = false

// Azure fixes the name of its own managed domain.
var managedDomainName = 'AzureManagedDomain'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
  }
}

resource domain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: azureManaged ? managedDomainName : domainName
  location: 'global'
  properties: {
    domainManagement: azureManaged ? 'AzureManaged' : 'CustomerManaged'
  }
}

// An Azure-managed domain comes with its own donotreply sender.
resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-04-01' = if (!azureManaged) {
  parent: domain
  name: senderUsername
  properties: {
    username: senderUsername
    displayName: senderDisplayName
  }
}

resource communication 'Microsoft.Communication/communicationServices@2023-04-01' = if (linkDomain) {
  name: communicationServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      domain.id
    ]
  }
}

output domainId string = domain.id
output fromAddress string = azureManaged ? 'donotreply@${domain.properties.mailFromSenderDomain}' : '${senderUsername}@${domainName}'
