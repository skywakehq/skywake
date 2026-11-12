# Skywake in one AWS region: the bucket, Postgres and the cluster that runs
# the API all sit in this provider's region. Commits make several bucket
# requests one after another and every API write waits on Postgres, so a
# cross-region hop would be paid many times per operation.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_vpc" "cluster" {
  id = data.aws_eks_cluster.this.vpc_config[0].vpc_id
}

locals {
  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id
  bucket     = var.bucket_name != "" ? var.bucket_name : "${var.name}-${local.account_id}-${local.region}"
  oidc       = replace(data.aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")
  tags       = merge({ "app.kubernetes.io/name" = "skywake", "skywake/install" = var.name }, var.tags)
}
