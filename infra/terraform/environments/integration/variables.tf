variable "aws_account_id" {
  type = string
}

variable "ses_sender_email" {
  type      = string
  sensitive = true
}

variable "alarm_email" {
  type      = string
  sensitive = true
}

variable "release_dir" {
  type = string
}

variable "release_sha" {
  type = string
}

variable "deployed_at" {
  type = string
}
