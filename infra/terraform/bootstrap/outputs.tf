output "backends" {
  value = local.backends
}

output "state_lock_keys" {
  value = local.locks
}

output "ci_role_arns" {
  value = { for key, role in aws_iam_role.ci : key => role.arn }
}

output "ssm_parameter_names" {
  value = local.parameter_names
}

output "ssm_parameter_arns" {
  value = local.parameter_arns
}
