resource "aws_sesv2_account_suppression_attributes" "shared" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}

resource "aws_budgets_budget" "shared" {
  name         = "yoin-monthly"
  budget_type  = "COST"
  limit_amount = "5"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
  }

  dynamic "notification" {
    for_each = toset(["ACTUAL", "FORECASTED"])
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value
      subscriber_email_addresses = [var.alarm_email]
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "shared" {
  for_each = {
    lambda = { namespace = "AWS/Lambda", metric = "Invocations", threshold = 150 }
    ses    = { namespace = "AWS/SES", metric = "Send", threshold = 20 }
  }

  alarm_name          = "yoin-integration-shared-${each.key}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = each.value.threshold
  evaluation_periods  = 1
  period              = 3600
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [module.environment.alarm_topic_arn]
}
