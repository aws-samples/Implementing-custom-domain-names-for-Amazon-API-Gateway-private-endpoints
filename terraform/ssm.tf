resource "aws_ssm_parameter" "certificate_pem" {
  count = var.cert_path == null ? 0 : 1
  name  = "${local.name_prefix}-cert-pem"
  type  = "String"
  value = file("${path.module}/${var.cert_path}")
}

resource "aws_ssm_parameter" "key_pem" {
  count = var.key_path == null ? 0 : 1
  name  = "${local.name_prefix}-key-pem"
  type  = "SecureString"
  value = file("${path.module}/${var.key_path}")
}