locals {
  repository   = "oze-xxbumpxx/yoin"
  environments = toset(["integration", "production"])
  scopes       = setunion(local.environments, ["bootstrap"])
  bucket_name  = "yoin-terraform-state-${var.aws_account_id}-ap-southeast-1"
  keys         = { for scope in local.scopes : scope => "${scope}/terraform.tfstate" }
  locks        = { for scope, key in local.keys : scope => "${key}.tflock" }
  backends = {
    for scope, key in local.keys : scope => {
      bucket               = local.bucket_name
      key                  = key
      region               = "ap-southeast-1"
      allowed_account_ids  = [var.aws_account_id]
      encrypt              = true
      use_lockfile         = true
      workspace_key_prefix = "workspaces/${scope}"
    }
  }
  parameters = jsondecode(file("${path.module}/parameters.json"))
  parameter_names = {
    for environment in local.environments : environment => {
      for scope, names in local.parameters : scope => {
        for name in names : name => "/yoin/${environment}/${scope}/${name}"
      }
    }
  }
  parameter_arns = {
    for environment, scopes in local.parameter_names : environment => {
      for scope, names in scopes : scope => {
        for name, path in names : name => "arn:aws:ssm:ap-southeast-1:${var.aws_account_id}:parameter${path}"
      }
    }
  }
  workflows = {
    terraform = "deploy-terraform.yml"
    migration = "deploy-migration.yml"
    seed      = "deploy-seed.yml"
  }
  jobs = {
    for pair in setproduct(local.environments, keys(local.workflows)) : "${pair[0]}-${pair[1]}" => {
      environment = pair[0]
      scope       = pair[1]
      subject     = "repo:${local.repository}:environment:${pair[0]}:job_workflow_ref:${local.repository}/.github/workflows/${local.workflows[pair[1]]}@refs/heads/main"
    }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid       = "RequireTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }],
      [for key, job in local.jobs : {
        Sid       = "Isolate${replace(key, "-", "")}"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [for scope in local.scopes : "${aws_s3_bucket.state.arn}/${scope}/*" if scope != job.environment]
        Condition = { ArnEquals = { "aws:PrincipalArn" = aws_iam_role.ci[key].arn } }
      } if job.scope == "terraform"],
      [{
        Sid       = "DenySecretReadersStateAccess"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { ArnEquals = { "aws:PrincipalArn" = [for key, job in local.jobs : aws_iam_role.ci[key].arn if job.scope != "terraform"] } }
      }]
    )
  })
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "ci" {
  for_each = local.jobs
  name     = "yoin-${each.key}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = each.value.subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "state" {
  for_each = local.environments
  name     = "terraform-state"
  role     = aws_iam_role.ci["${each.key}-terraform"].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ListOwnState"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = [aws_s3_bucket.state.arn]
        Condition = { StringEquals = { "s3:prefix" = [local.keys[each.key], "${local.backends[each.key].workspace_key_prefix}/"] } }
      },
      {
        Sid      = "ReadWriteState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.state.arn}/${local.keys[each.key]}"]
      },
      {
        Sid      = "ManageLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.state.arn}/${local.locks[each.key]}"]
      }
    ]
  })
}

resource "aws_iam_role_policy" "secrets" {
  for_each = { for key, job in local.jobs : key => job if job.scope != "terraform" }
  name     = "read-own-parameters"
  role     = aws_iam_role.ci[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = values(local.parameter_arns[each.value.environment][each.value.scope])
    }]
  })
}
