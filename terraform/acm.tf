resource "aws_acm_certificate" "certificate" {
  for_each          = local.base_domains
  domain_name       = "*.${each.value}"
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "selected" {
  for_each = local.base_domains

  certificate_arn         = aws_acm_certificate.certificate[each.value].arn
  validation_record_fqdns = [aws_route53_record.validation[each.value].fqdn]
}