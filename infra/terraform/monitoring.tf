resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "owner" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_sns_topic_policy" "alarms" {
  arn = aws_sns_topic.alarms.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Owner"
        Effect    = "Allow"
        Action    = "sns:*"
        Resource  = aws_sns_topic.alarms.arn
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
      },
      {
        Sid       = "PublishOwnAlarms"
        Effect    = "Allow"
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alarms.arn
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Condition = { ArnLike = { "aws:SourceArn" = "arn:aws:cloudwatch:${local.region}:${var.aws_account_id}:alarm:${local.name}-*" } }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "failures" {
  alarm_name          = "${local.name}-notification-failures"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.failures.name }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_count" {
  alarm_name          = "${local.name}-api-count"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Count"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 125
  evaluation_periods  = 1
  period              = 3600
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  dimensions          = { ApiId = aws_apigatewayv2_api.http.id }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
