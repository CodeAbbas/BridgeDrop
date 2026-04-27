resource "azurerm_cosmosdb_account" "main" {
  name                = "${local.prefix}-cosmos"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB" # SQL (Core) API

  free_tier_enabled          = var.cosmos_free_tier
  automatic_failover_enabled = false

  consistency_policy {
    consistency_level = var.cosmos_consistency_level
  }

  # Primary write region. Add additional geo_location blocks for multi-region reads.
  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  # Serverless mode: no RU/s provisioning needed; billed per operation.
  # Remove this block and add throughput to the container for provisioned mode.
  dynamic "capabilities" {
    for_each = var.cosmos_serverless ? [1] : []
    content {
      name = "EnableServerless"
    }
  }

  tags = local.common_tags
}

resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "${var.project_name}-db"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "room_metadata" {
  name                = "room-metadata"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name

  partition_key_paths   = ["/roomId"]
  partition_key_version = 2 # Hash V2 — recommended for new containers.

  # Documents expire after 24 hours by default; individual docs can override with a _ttl field.
  default_ttl = var.room_ttl_seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    excluded_path {
      path = "/\"_etag\"/?"
    }
  }
}
