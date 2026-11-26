resource "aws_cognito_user_pool" "users" {
  name                     = local.name
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = "ACTIVE"

  username_configuration {
    case_sensitive = false
  }

  sign_in_policy {
    allowed_first_auth_factors = ["EMAIL_OTP"]
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  email_configuration {
    email_sending_account  = "DEVELOPER"
    source_arn             = "arn:aws:ses:${local.region}:${var.aws_account_id}:identity/${var.ses_sender_email}"
    from_email_address     = var.ses_sender_email
    reply_to_email_address = var.ses_sender_email
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.function["pre-sign-up"].arn
  }
}

resource "aws_lambda_permission" "cognito" {
  statement_id   = "CognitoPreSignUp"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.function["pre-sign-up"].function_name
  principal      = "cognito-idp.amazonaws.com"
  source_arn     = aws_cognito_user_pool.users.arn
  source_account = var.aws_account_id
}

resource "aws_cognito_user_pool_client" "pwa" {
  name                          = "${local.name}-pwa"
  user_pool_id                  = aws_cognito_user_pool.users.id
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  explicit_auth_flows           = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  supported_identity_providers  = ["COGNITO"]
}

resource "aws_apigatewayv2_api" "http" {
  name          = local.name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://${aws_cloudfront_distribution.pwa.domain_name}"]
    allow_headers = ["authorization", "content-type"]
    allow_methods = sort(tolist(local.api_methods))
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"

  jwt_configuration {
    issuer   = "https://${aws_cognito_user_pool.users.endpoint}"
    audience = [aws_cognito_user_pool_client.pwa.id]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function["api"].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

locals {
  api_methods = toset(["GET", "POST", "PATCH", "PUT", "DELETE"])
}

resource "aws_apigatewayv2_route" "api" {
  for_each           = local.api_methods
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "${each.key} /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format = jsonencode({
      requestId = "$context.requestId"
      method    = "$context.httpMethod"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "HttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["api"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/${aws_apigatewayv2_stage.api.name}/*/*"
}
