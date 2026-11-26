resource "aws_iam_role" "function" {
  for_each = local.functions
  name     = "${local.name}-${each.key}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  role     = aws_iam_role.function[each.key].id
  name     = "runtime"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.function[each.key].arn}:*"]
      },
      {
        Sid      = "ReadOwnParameters"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = [for path in values(local.parameter_names[each.key]) : "${local.prefix_arn}:ssm:${local.region}:${var.aws_account_id}:parameter${path}"]
      }
      ], [for statement in [
        {
          Sid    = "ManageReminderSchedules"
          Effect = "Allow"
          Action = concat(
            ["scheduler:CreateSchedule", "scheduler:GetSchedule", "scheduler:DeleteSchedule"],
            each.key == "notification-sender" ? ["scheduler:UpdateSchedule"] : []
          )
          Resource = [local.schedule_arn]
        },
        {
          Sid       = "PassOnlyOwnSchedulerRole"
          Effect    = "Allow"
          Action    = ["iam:PassRole"]
          Resource  = [aws_iam_role.scheduler.arn]
          Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } }
        }
        ] : statement if each.key != "pre-sign-up"], each.key == "notification-sender" ? [{
        Sid      = "SendFailure"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = [aws_sqs_queue.failures.arn]
    }] : [])
  })
}

resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.aws_account_id
          "aws:SourceArn"     = local.schedule_group_arn
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  name = "deliver-reminder"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = local.sender_arn
      }, {
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.failures.arn
    }]
  })
}
