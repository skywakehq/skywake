variable "name" {
  description = "Names the bucket, the database, the IAM role and the Helm release."
  type        = string
  default     = "skywake"
}

variable "cluster_name" {
  description = "An EKS cluster in this provider's region, with an IAM OIDC provider for IRSA."
  type        = string
}

variable "namespace" {
  description = "The Kubernetes namespace to install into."
  type        = string
  default     = "skywake"
}

variable "create_namespace" {
  description = "Make the namespace. False when it already exists."
  type        = bool
  default     = true
}

variable "bucket_name" {
  description = "The bucket for branches and indexes. Empty for <name>-<account id>-<region>."
  type        = string
  default     = ""
}

variable "bucket_force_destroy" {
  description = "Let `terraform destroy` delete a bucket that still holds data."
  type        = bool
  default     = false
}

variable "database" {
  description = "The RDS Postgres instance. Every API write waits on it, so it stays in the cluster's region."
  type = object({
    instance_class        = optional(string, "db.t4g.medium")
    engine_version        = optional(string, "17")
    allocated_storage     = optional(number, 50)
    max_allocated_storage = optional(number, 500)
    multi_az              = optional(bool, false)
    backup_retention_days = optional(number, 7)
    deletion_protection   = optional(bool, true)
    # Empty for the cluster's own subnets.
    subnet_ids = optional(list(string), [])
    # Who may connect. Empty for the cluster's VPC.
    allowed_cidrs = optional(list(string), [])
  })
  default = {}
}

variable "chart" {
  description = "Where the Helm chart comes from. An empty version installs the newest."
  type = object({
    repository = optional(string, "oci://ghcr.io/skywakehq/charts")
    version    = optional(string, "")
  })
  default = {}
}

variable "urls" {
  description = "The addresses people use, behind your ingress and HTTPS."
  type = object({
    console = string
    api     = string
    zero    = string
  })
}

variable "values" {
  description = "More chart values, as YAML documents applied after this module's (ingress, sizes, images)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags for every AWS resource."
  type        = map(string)
  default     = {}
}
