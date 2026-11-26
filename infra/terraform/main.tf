locals {
  region = "ap-southeast-1"
  name   = "yoin-${var.environment}"
  functions = {
    api = {
      timeout = 20
      parameters = {
        DATABASE_URL_PARAMETER    = "runtime/database-url"
        INVITE_HMAC_KEY_PARAMETER = "runtime/invite-hmac-key"
      }
    }
    pre-sign-up = {
      timeout = 4
      parameters = {
        DATABASE_URL_PARAMETER = "pre-sign-up/database-url"
      }
    }
    notification-sender = {
      timeout = 60
      parameters = {
        DATABASE_URL_PARAMETER      = "runtime/database-url"
        VAPID_PRIVATE_KEY_PARAMETER = "runtime/vapid-private-key"
      }
    }
  }
  parameter_names = {
    for name, spec in local.functions : name => {
      for key, suffix in spec.parameters : key => "/yoin/${var.environment}/${suffix}"
    }
  }
  prefix_arn         = "arn:aws"
  schedule_group_arn = "${local.prefix_arn}:scheduler:${local.region}:${var.aws_account_id}:schedule-group/${local.name}"
  schedule_arn       = "${local.prefix_arn}:scheduler:${local.region}:${var.aws_account_id}:schedule/${local.name}/reminder-*"
  sender_arn         = "${local.prefix_arn}:lambda:${local.region}:${var.aws_account_id}:function:${local.name}-notification-sender"
  function_archives  = { for name in keys(local.functions) : name => "lambda/${name}.zip" }
}

resource "terraform_data" "release" {
  input = var.release_sha
  lifecycle {
    precondition {
      condition = try(
        trimspace(file("${var.release_dir}/SHA")) == var.release_sha &&
        alltrue([
          for archive in values(local.function_archives) : contains(
            split("\n", file("${var.release_dir}/SHA256SUMS")),
            "${filesha256("${var.release_dir}/${archive}")}  ${archive}"
          )
        ]),
        false
      )
      error_message = "Use the verified CI artifact for release_sha, with all three Lambda archives matching SHA256SUMS."
    }
    precondition {
      condition     = terraform.workspace == "default"
      error_message = "Use the default workspace and this environment's dedicated state key."
    }
  }
}

resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 7
}

resource "aws_lambda_function" "function" {
  for_each         = local.functions
  function_name    = "${local.name}-${each.key}"
  filename         = "${var.release_dir}/${local.function_archives[each.key]}"
  source_code_hash = filebase64sha256("${var.release_dir}/${local.function_archives[each.key]}")
  role             = aws_iam_role.function[each.key].arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  timeout          = each.value.timeout
  memory_size      = 512

  environment {
    variables = merge(local.parameter_names[each.key], {
      YOIN_ENVIRONMENT = var.environment
      }, each.key == "pre-sign-up" ? {} : {
      SCHEDULER_GROUP_NAME           = aws_scheduler_schedule_group.reminders.name
      SCHEDULER_ROLE_ARN             = aws_iam_role.scheduler.arn
      SCHEDULER_TARGET_ARN           = local.sender_arn
      NOTIFICATION_FAILURE_QUEUE_ARN = aws_sqs_queue.failures.arn
      }, each.key == "api" ? {
      PWA_ORIGIN = "https://${aws_cloudfront_distribution.pwa.domain_name}"
      } : {}, each.key == "notification-sender" ? {
      NOTIFICATION_FAILURE_QUEUE_URL = aws_sqs_queue.failures.url
    } : {})
  }

  tags = {
    ReleaseSha = var.release_sha
    DeployedAt = var.deployed_at
  }

  depends_on = [terraform_data.release, aws_iam_role_policy.function]
}

resource "aws_lambda_function_event_invoke_config" "notification_sender" {
  function_name                = aws_lambda_function.function["notification-sender"].function_name
  maximum_event_age_in_seconds = 3600
  maximum_retry_attempts       = 2

  destination_config {
    on_failure {
      destination = aws_sqs_queue.failures.arn
    }
  }
}

resource "aws_scheduler_schedule_group" "reminders" {
  name = local.name
}

resource "aws_sqs_queue" "failures" {
  name                      = "${local.name}-notification-failures"
  message_retention_seconds = 345600
  sqs_managed_sse_enabled   = true
}
