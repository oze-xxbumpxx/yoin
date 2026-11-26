mock_provider "aws" {
  override_during = plan

  mock_resource "aws_cognito_user_pool" {
    defaults = {
      endpoint = "cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_production"
      id       = "ap-southeast-1_production"
      arn      = "arn:aws:cognito-idp:ap-southeast-1:111122223333:userpool/ap-southeast-1_production"
    }
  }

  mock_resource "aws_cognito_user_pool_client" {
    defaults = { id = "production-client" }
  }

  mock_resource "aws_apigatewayv2_authorizer" {
    defaults = { id = "production-jwt" }
  }

  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      id            = "production-api"
      execution_arn = "arn:aws:execute-api:ap-southeast-1:111122223333:production-api"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-southeast-1:111122223333:log-group:i10" }
  }

  mock_resource "aws_sqs_queue" {
    defaults = {
      arn = "arn:aws:sqs:ap-southeast-1:111122223333:yoin-production-notification-failures"
      url = "https://sqs.ap-southeast-1.amazonaws.com/111122223333/yoin-production-notification-failures"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      id          = "production"
      domain_name = "production.cloudfront.net"
      arn         = "arn:aws:cloudfront::111122223333:distribution/production"
    }
  }
}

override_resource {
  target          = module.environment.aws_iam_role.scheduler
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-production-scheduler" }
}

override_resource {
  target          = module.environment.aws_lambda_function.function["pre-sign-up"]
  override_during = plan
  values          = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:yoin-production-pre-sign-up" }
}

variables {
  aws_account_id   = "111122223333"
  ses_sender_email = "sender@example.invalid"
  alarm_email      = "owner@example.invalid"
  release_sha      = "0123456789abcdef0123456789abcdef01234567"
  deployed_at      = "2026-11-26T00:00:00Z"
}

run "environment_plan" {
  command = plan
}
