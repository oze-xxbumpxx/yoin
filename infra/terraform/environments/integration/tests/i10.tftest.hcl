mock_provider "aws" {
  override_during = plan

  mock_resource "aws_cognito_user_pool" {
    defaults = {
      endpoint = "cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_integration"
      id       = "ap-southeast-1_integration"
      arn      = "arn:aws:cognito-idp:ap-southeast-1:111122223333:userpool/ap-southeast-1_integration"
    }
  }

  mock_resource "aws_cognito_user_pool_client" {
    defaults = { id = "integration-client" }
  }

  mock_resource "aws_apigatewayv2_authorizer" {
    defaults = { id = "integration-jwt" }
  }

  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      id            = "integration-api"
      execution_arn = "arn:aws:execute-api:ap-southeast-1:111122223333:integration-api"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-southeast-1:111122223333:log-group:i10" }
  }

  mock_resource "aws_sqs_queue" {
    defaults = {
      arn = "arn:aws:sqs:ap-southeast-1:111122223333:yoin-integration-notification-failures"
      url = "https://sqs.ap-southeast-1.amazonaws.com/111122223333/yoin-integration-notification-failures"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      id          = "integration"
      domain_name = "integration.cloudfront.net"
      arn         = "arn:aws:cloudfront::111122223333:distribution/integration"
    }
  }
}

override_resource {
  target          = module.environment.aws_iam_role.scheduler
  override_during = plan
  values          = { arn = "arn:aws:iam::111122223333:role/yoin-integration-scheduler" }
}

override_resource {
  target          = module.environment.aws_lambda_function.function["pre-sign-up"]
  override_during = plan
  values          = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:yoin-integration-pre-sign-up" }
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

run "reject_wrong_release_sha" {
  command = plan
  module {
    source = "../.."
  }
  variables {
    environment = "integration"
    release_sha = "1111111111111111111111111111111111111111"
  }
  expect_failures = [terraform_data.release]
}
