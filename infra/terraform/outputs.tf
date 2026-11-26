output "deployment" {
  value = {
    api_url                 = aws_apigatewayv2_api.http.api_endpoint
    cognito_user_pool_id    = aws_cognito_user_pool.users.id
    cognito_client_id       = aws_cognito_user_pool_client.pwa.id
    pwa_origin              = "https://${aws_cloudfront_distribution.pwa.domain_name}"
    pwa_bucket              = aws_s3_bucket.pwa.id
    cloudfront_distribution = aws_cloudfront_distribution.pwa.id
  }
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}
