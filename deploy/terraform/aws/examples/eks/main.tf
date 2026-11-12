# Skywake on an existing EKS cluster in eu-central-1:
#   terraform init && terraform apply -var cluster_name=my-cluster
# Everything is made in the provider's region: pick the cluster's.

variable "cluster_name" {
  type = string
}

provider "aws" {
  region = "eu-central-1"
}

data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "this" {
  name = var.cluster_name
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

module "skywake" {
  source       = "../.."
  cluster_name = var.cluster_name
  urls = {
    console = "https://console.example.com"
    api     = "https://api.example.com"
    zero    = "https://zero.example.com"
  }
  # The chart's own Ingress, for an AWS Load Balancer Controller.
  values = [yamlencode({
    ingress = {
      enabled   = true
      className = "alb"
      hosts     = { api = "api.example.com", console = "console.example.com", zero = "zero.example.com" }
    }
  })]
}

output "region" {
  value = module.skywake.region
}
