terraform {
  required_version = ">= 1.6"

  required_providers {
    aws        = { source = "hashicorp/aws", version = ">= 6.0" }
    helm       = { source = "hashicorp/helm", version = ">= 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = ">= 2.38" }
    random     = { source = "hashicorp/random", version = ">= 3.6" }
  }
}
