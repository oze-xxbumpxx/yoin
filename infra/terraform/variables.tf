variable "environment" {
  type = string
  validation {
    condition     = contains(["integration", "production"], var.environment)
    error_message = "environment must be integration or production."
  }
}

variable "aws_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must contain 12 digits."
  }
}

variable "ses_sender_email" {
  type      = string
  sensitive = true
  nullable  = false
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.ses_sender_email))
    error_message = "Use the SES-verified sender email address."
  }
}

variable "alarm_email" {
  type      = string
  sensitive = true
  nullable  = false
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.alarm_email))
    error_message = "Use the owner's alert email address."
  }
}

variable "release_dir" {
  type        = string
  description = "Absolute or Terraform-root-relative directory of the verified CI release."
}

variable "release_sha" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_sha))
    error_message = "Use the full lowercase commit SHA."
  }
}

variable "deployed_at" {
  type = string
  validation {
    condition     = can(formatdate("YYYY", var.deployed_at))
    error_message = "Use an RFC3339 deployment timestamp."
  }
}
