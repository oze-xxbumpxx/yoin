resource "aws_s3_bucket" "pwa" {
  bucket = "${local.name}-pwa-${var.aws_account_id}"
}

resource "aws_s3_bucket_public_access_block" "pwa" {
  bucket                  = aws_s3_bucket.pwa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "pwa" {
  bucket = aws_s3_bucket.pwa.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_cloudfront_origin_access_control" "pwa" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

resource "aws_cloudfront_response_headers_policy" "pwa" {
  name = local.name
  security_headers_config {
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

locals {
  caching_disabled  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  pwa_origin        = "pwa"
}

resource "aws_cloudfront_distribution" "pwa" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    origin_id                = local.pwa_origin
    domain_name              = aws_s3_bucket.pwa.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.pwa.id
  }

  default_cache_behavior {
    target_origin_id           = local.pwa_origin
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.caching_disabled
    response_headers_policy_id = aws_cloudfront_response_headers_policy.pwa.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.pwa_origin
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.pwa.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "pwa" {
  bucket = aws_s3_bucket.pwa.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "s3:GetObject"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Resource  = "${aws_s3_bucket.pwa.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.pwa.arn } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.pwa, aws_s3_bucket_ownership_controls.pwa]
}
