output "region" {
  description = "Where everything was made. Run agents here too."
  value       = local.region
}

output "bucket" {
  value = aws_s3_bucket.store.bucket
}

output "database_address" {
  value = aws_db_instance.this.address
}

output "role_arn" {
  description = "The pods' IAM role."
  value       = aws_iam_role.pods.arn
}

output "namespace" {
  value = local.namespace
}

output "admin_token" {
  description = "Creates organizations through the API."
  value       = random_password.secret["admin-token"].result
  sensitive   = true
}
