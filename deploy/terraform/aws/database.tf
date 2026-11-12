resource "random_password" "owner" {
  length  = 32
  special = false
}

resource "random_password" "role" {
  for_each = toset(["api", "console", "zero"])
  length   = 32
  special  = false
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = length(var.database.subnet_ids) > 0 ? var.database.subnet_ids : data.aws_eks_cluster.this.vpc_config[0].subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "database" {
  name        = "${var.name}-postgres"
  description = "Postgres for Skywake, from the cluster's network only"
  vpc_id      = data.aws_vpc.cluster.id
  tags        = local.tags

  ingress {
    description = "Postgres"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = length(var.database.allowed_cidrs) > 0 ? var.database.allowed_cidrs : [data.aws_vpc.cluster.cidr_block]
  }
}

# zero-cache follows the console's tables through logical replication.
resource "aws_db_parameter_group" "this" {
  name   = var.name
  family = "postgres${split(".", var.database.engine_version)[0]}"
  tags   = local.tags

  parameter {
    name         = "rds.logical_replication"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "this" {
  identifier            = var.name
  engine                = "postgres"
  engine_version        = var.database.engine_version
  instance_class        = var.database.instance_class
  allocated_storage     = var.database.allocated_storage
  max_allocated_storage = var.database.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "skywake"
  username = "skywake"
  password = random_password.owner.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.database.multi_az

  backup_retention_period   = var.database.backup_retention_days
  deletion_protection       = var.database.deletion_protection
  skip_final_snapshot       = !var.database.deletion_protection
  final_snapshot_identifier = "${var.name}-final"
  apply_immediately         = true
  tags                      = local.tags

  lifecycle {
    precondition {
      condition     = tonumber(split(".", var.database.engine_version)[0]) >= 15
      error_message = "Skywake needs Postgres 15 or newer."
    }
  }
}
