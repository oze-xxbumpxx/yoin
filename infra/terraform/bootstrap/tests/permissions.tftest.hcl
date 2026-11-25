mock_provider "aws" {
  override_during = plan

  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::yoin-terraform-state-111122223333-ap-southeast-1"
    }
  }

  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    }
  }
}

override_resource {
  target          = aws_iam_role.ci["integration-terraform"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-integration-terraform" }
}

override_resource {
  target          = aws_iam_role.ci["production-terraform"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-production-terraform" }
}

override_resource {
  target          = aws_iam_role.ci["integration-migration"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-integration-migration" }
}

override_resource {
  target          = aws_iam_role.ci["production-migration"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-production-migration" }
}

override_resource {
  target          = aws_iam_role.ci["integration-seed"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-integration-seed" }
}

override_resource {
  target          = aws_iam_role.ci["production-seed"]
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-production-seed" }
}

variables {
  aws_account_id = "111122223333"
}

run "separate_backends_and_locks" {
  command = plan

  assert {
    condition = (
      toset(keys(output.backends)) == toset(["bootstrap", "integration", "production"]) &&
      alltrue([for scope, backend in output.backends :
        backend.key == "${scope}/terraform.tfstate" &&
        output.state_lock_keys[scope] == "${backend.key}.tflock" &&
        backend.bucket == "yoin-terraform-state-111122223333-ap-southeast-1" &&
        backend.region == "ap-southeast-1" && backend.encrypt && backend.use_lockfile
      ])
    )
    error_message = "Every scope must use a unique state and lock in the encrypted Singapore backend."
  }

  assert {
    condition = toset(keys(aws_iam_role_policy.state)) == toset(["integration", "production"]) && alltrue([for environment, policy in aws_iam_role_policy.state :
      policy.role == aws_iam_role.ci["${environment}-terraform"].name &&
      length(jsondecode(policy.policy).Statement) == 3 &&
      alltrue([for statement in jsondecode(policy.policy).Statement : statement.Effect == "Allow"]) &&
      toset(jsondecode(policy.policy).Statement[0].Action) == toset(["s3:ListBucket"]) &&
      toset(jsondecode(policy.policy).Statement[0].Resource) == toset([aws_s3_bucket.state.arn]) &&
      toset(jsondecode(policy.policy).Statement[0].Condition.StringEquals["s3:prefix"]) == toset([output.backends[environment].key, "workspaces/${environment}/"]) &&
      toset(jsondecode(policy.policy).Statement[1].Action) == toset(["s3:GetObject", "s3:PutObject"]) &&
      toset(jsondecode(policy.policy).Statement[1].Resource) == toset(["${aws_s3_bucket.state.arn}/${output.backends[environment].key}"]) &&
      toset(jsondecode(policy.policy).Statement[2].Action) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]) &&
      toset(jsondecode(policy.policy).Statement[2].Resource) == toset(["${aws_s3_bucket.state.arn}/${output.state_lock_keys[environment]}"])
    ])
    error_message = "Each Terraform role must only list its own prefixes, read/write its own state, and manage its own lock."
  }

  assert {
    condition = alltrue([for environment, other in { integration = "production", production = "integration" } :
      one([for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement :
        statement.Effect == "Deny" && statement.Principal == "*" && statement.Action == "s3:*" &&
        toset(statement.Resource) == toset(["${aws_s3_bucket.state.arn}/bootstrap/*", "${aws_s3_bucket.state.arn}/${other}/*"]) &&
        statement.Condition.ArnEquals["aws:PrincipalArn"] == aws_iam_role.ci["${environment}-terraform"].arn
      if statement.Sid == "Isolate${environment}terraform"])
    ])
    error_message = "The bucket must explicitly deny each Terraform role all actions on the bootstrap and other environment's state and lock."
  }

  assert {
    condition = one([for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement :
      statement.Effect == "Deny" && statement.Principal == "*" && statement.Action == "s3:*" &&
      toset(statement.Resource) == toset([aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]) &&
      toset(statement.Condition.ArnEquals["aws:PrincipalArn"]) == toset([
        for key, role in aws_iam_role.ci : role.arn if !endswith(key, "-terraform")
      ])
    if statement.Sid == "DenySecretReadersStateAccess"])
    error_message = "Migration and seed roles must be explicitly denied all access to the state bucket."
  }
}

run "scope_oidc_and_parameter_reads" {
  command = plan

  assert {
    condition = length(aws_iam_role.ci) == 6 && alltrue(flatten([for environment in ["integration", "production"] : [
      for scope in ["terraform", "migration", "seed"] :
      one(jsondecode(aws_iam_role.ci["${environment}-${scope}"].assume_role_policy).Statement).Action == "sts:AssumeRoleWithWebIdentity" &&
      one(jsondecode(aws_iam_role.ci["${environment}-${scope}"].assume_role_policy).Statement).Effect == "Allow" &&
      one(jsondecode(aws_iam_role.ci["${environment}-${scope}"].assume_role_policy).Statement).Principal.Federated == aws_iam_openid_connect_provider.github.arn &&
      one(jsondecode(aws_iam_role.ci["${environment}-${scope}"].assume_role_policy).Statement).Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com" &&
      one(jsondecode(aws_iam_role.ci["${environment}-${scope}"].assume_role_policy).Statement).Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:oze-xxbumpxx/yoin:environment:${environment}:job_workflow_ref:oze-xxbumpxx/yoin/.github/workflows/deploy-${scope}.yml@refs/heads/main"
    ]]))
    error_message = "Each role must trust only its own repository, environment and reusable workflow on main."
  }

  assert {
    condition = alltrue([for environment in ["integration", "production"] :
      toset(values(output.ssm_parameter_names[environment].runtime)) == toset([
        "/yoin/${environment}/runtime/database-url", "/yoin/${environment}/runtime/invite-hmac-key", "/yoin/${environment}/runtime/vapid-private-key"
      ]) &&
      toset(values(output.ssm_parameter_names[environment].migration)) == toset(["/yoin/${environment}/migration/database-url"]) &&
      toset(values(output.ssm_parameter_names[environment].seed)) == toset(["/yoin/${environment}/seed/owner-email", "/yoin/${environment}/seed/owner-display-name"])
    ])
    error_message = "SSM names must be separated by exact environment and usage."
  }

  assert {
    condition = (
      toset(keys(aws_iam_role_policy.secrets)) == toset(["integration-migration", "integration-seed", "production-migration", "production-seed"]) &&
      alltrue(flatten([for environment in ["integration", "production"] : [
        for scope in ["migration", "seed"] :
        aws_iam_role_policy.secrets["${environment}-${scope}"].role == aws_iam_role.ci["${environment}-${scope}"].name &&
        one(jsondecode(aws_iam_role_policy.secrets["${environment}-${scope}"].policy).Statement).Effect == "Allow" &&
        toset(one(jsondecode(aws_iam_role_policy.secrets["${environment}-${scope}"].policy).Statement).Action) == toset(["ssm:GetParameter"]) &&
        toset(one(jsondecode(aws_iam_role_policy.secrets["${environment}-${scope}"].policy).Statement).Resource) == toset([
          for name in values(output.ssm_parameter_names[environment][scope]) : "arn:aws:ssm:ap-southeast-1:111122223333:parameter${name}"
        ])
      ]]))
    )
    error_message = "Migration and seed must only read their exact own parameters and Terraform roles must read none."
  }
}
