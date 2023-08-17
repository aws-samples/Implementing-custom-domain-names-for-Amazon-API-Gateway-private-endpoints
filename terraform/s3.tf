resource "aws_s3_bucket" "truststore" {
  count         = var.truststore_path == null ? 0 : 1
  bucket_prefix = "${local.name_prefix}-truststore"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "truststore" {
  count  = var.truststore_path == null ? 0 : 1
  bucket = aws_s3_bucket.truststore[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "truststore" {
  count  = var.truststore_path == null ? 0 : 1
  bucket = aws_s3_bucket.truststore[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "truststore" {
  count  = var.truststore_path == null ? 0 : 1
  bucket = aws_s3_bucket.truststore[0].id
  key    = "${local.name_prefix}/truststore.pem"
  source = "${path.module}/${var.truststore_path}"
}