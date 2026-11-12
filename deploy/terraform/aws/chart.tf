# The chart, with its two Secrets. The bootstrap Job makes the database
# roles before the API starts; the Node clients reach RDS over TLS (RDS
# requires it) inside the VPC, without checking its certificate.

resource "random_password" "secret" {
  for_each = toset(["admin-token", "better-auth-secret", "zero-admin-password", "cache-token", "peer-token"])
  length   = 48
  special  = false
}

resource "kubernetes_namespace_v1" "this" {
  count = var.create_namespace ? 1 : 0
  metadata {
    name = var.namespace
  }
}

locals {
  namespace = var.create_namespace ? kubernetes_namespace_v1.this[0].metadata[0].name : var.namespace
  db_host   = aws_db_instance.this.address
  db_url = {
    for role in ["api", "console", "zero"] :
    role => "postgres://skywake_${role}:${random_password.role[role].result}@${local.db_host}:${aws_db_instance.this.port}/skywake?sslmode=${role == "zero" ? "require" : "no-verify"}"
  }
}

resource "kubernetes_secret_v1" "skywake" {
  metadata {
    name      = "skywake"
    namespace = local.namespace
  }
  data = merge(
    { for role, url in local.db_url : "${role}-database-url" => url },
    { for key, value in random_password.secret : key => value.result },
  )
}

resource "kubernetes_secret_v1" "bootstrap" {
  metadata {
    name      = "skywake-bootstrap"
    namespace = local.namespace
  }
  data = {
    host             = local.db_host
    port             = tostring(aws_db_instance.this.port)
    user             = aws_db_instance.this.username
    password         = random_password.owner.result
    database         = aws_db_instance.this.db_name
    api-password     = random_password.role["api"].result
    console-password = random_password.role["console"].result
    zero-password    = random_password.role["zero"].result
  }
}

resource "helm_release" "skywake" {
  name       = var.name
  namespace  = local.namespace
  repository = var.chart.repository
  chart      = "skywake"
  version    = var.chart.version != "" ? var.chart.version : null
  timeout    = 900

  values = concat([yamlencode({
    secret = kubernetes_secret_v1.skywake.metadata[0].name
    store  = "s3://${aws_s3_bucket.store.bucket}"
    aws    = { region = local.region }
    serviceAccount = {
      annotations = { "eks.amazonaws.com/role-arn" = aws_iam_role.pods.arn }
    }
    bootstrap = { enabled = true, secret = kubernetes_secret_v1.bootstrap.metadata[0].name }
    console = {
      url     = var.urls.console
      apiUrl  = var.urls.api
      zeroUrl = var.urls.zero
    }
  })], var.values)

  depends_on = [aws_iam_role_policy.bucket]
}
