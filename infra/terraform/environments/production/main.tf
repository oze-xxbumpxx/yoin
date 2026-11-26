terraform {
  required_version = "~> 1.12.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }

  backend "s3" {
    region               = "ap-southeast-1"
    key                  = "production/terraform.tfstate"
    workspace_key_prefix = "workspaces/production"
    encrypt              = true
    use_lockfile         = true
  }
}

provider "aws" {
  region              = "ap-southeast-1"
  allowed_account_ids = [var.aws_account_id]
}

module "environment" {
  source = "../.."

  environment      = "production"
  aws_account_id   = var.aws_account_id
  ses_sender_email = var.ses_sender_email
  alarm_email      = var.alarm_email
  release_dir      = var.release_dir
  release_sha      = var.release_sha
  deployed_at      = var.deployed_at
}

output "deployment" {
  value = module.environment.deployment
}
