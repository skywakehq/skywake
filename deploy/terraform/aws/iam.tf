# The pods' own identity (IRSA): the chart's service account, named after
# the release, may use the bucket and nothing else. No keys are made.

data "aws_iam_openid_connect_provider" "cluster" {
  url = data.aws_eks_cluster.this.identity[0].oidc[0].issuer
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.cluster.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.name}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    actions   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.store.arn]
  }
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.store.arn}/*"]
  }
}

resource "aws_iam_role" "pods" {
  name               = "${var.name}-${local.region}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = local.tags
}

resource "aws_iam_role_policy" "bucket" {
  name   = "bucket"
  role   = aws_iam_role.pods.id
  policy = data.aws_iam_policy_document.bucket.json
}
