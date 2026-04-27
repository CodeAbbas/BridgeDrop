variable "project_name" {
  description = "Project name used as a prefix for all resources."
  type        = string
  default     = "bridgedrop"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Must be one of: dev, staging, prod."
  }
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "eastus"
}

variable "storage_replication_type" {
  description = "Storage account replication type (LRS, ZRS, GRS, GZRS)."
  type        = string
  default     = "LRS"
}

variable "allowed_origins" {
  description = "Allowed origins for Storage CORS. Restrict to your frontend domain(s) in production."
  type        = list(string)
  default     = ["*"]
}

variable "cosmos_consistency_level" {
  description = "Cosmos DB default consistency level."
  type        = string
  default     = "Session"

  validation {
    condition     = contains(["BoundedStaleness", "ConsistentPrefix", "Eventual", "Session", "Strong"], var.cosmos_consistency_level)
    error_message = "Invalid Cosmos DB consistency level."
  }
}

variable "cosmos_free_tier" {
  description = "Enable Cosmos DB free tier. Only one free-tier account is allowed per Azure subscription."
  type        = bool
  default     = false
}

variable "cosmos_serverless" {
  description = "Enable Cosmos DB serverless mode (cost-efficient for variable/low traffic). Set false for provisioned throughput."
  type        = bool
  default     = true
}

variable "room_ttl_seconds" {
  description = "Default TTL in seconds for room-metadata documents (86400 = 24 hours)."
  type        = number
  default     = 86400
}
