output "resource_group_name" {
  description = "Name of the Azure Resource Group."
  value       = azurerm_resource_group.main.name
}

output "storage_account_name" {
  description = "Name of the Azure Storage Account."
  value       = azurerm_storage_account.main.name
}

output "storage_primary_blob_endpoint" {
  description = "Primary blob service endpoint (base URL for direct uploads)."
  value       = azurerm_storage_account.main.primary_blob_endpoint
}

output "storage_primary_access_key" {
  description = "Primary access key — used server-side to generate SAS tokens."
  value       = azurerm_storage_account.main.primary_access_key
  sensitive   = true
}

output "cosmosdb_account_name" {
  description = "Name of the Cosmos DB account."
  value       = azurerm_cosmosdb_account.main.name
}

output "cosmosdb_endpoint" {
  description = "Cosmos DB account endpoint URI."
  value       = azurerm_cosmosdb_account.main.endpoint
}

output "cosmosdb_primary_key" {
  description = "Cosmos DB primary master key."
  value       = azurerm_cosmosdb_account.main.primary_key
  sensitive   = true
}
