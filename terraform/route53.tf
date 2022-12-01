data "aws_route53_zone" "selected" {
  for_each = local.base_domains
  name     = each.value

  private_zone = false
}

resource "aws_route53_record" "validation" {
  for_each = local.base_domains

  allow_overwrite = true
  name            = { for obj in aws_acm_certificate.certificate[each.value].domain_validation_options : obj.domain_name => obj }["*.${each.value}"].resource_record_name
  records         = [{ for obj in aws_acm_certificate.certificate[each.value].domain_validation_options : obj.domain_name => obj }["*.${each.value}"].resource_record_value]
  ttl             = 60
  type            = { for obj in aws_acm_certificate.certificate[each.value].domain_validation_options : obj.domain_name => obj }["*.${each.value}"].resource_record_type
  zone_id         = data.aws_route53_zone.selected[each.value].zone_id

}

resource "aws_route53_record" "api" {
  for_each = { for api in local.api_list : api.CUSTOM_DOMAIN_URL => api }

  allow_overwrite = true
  name            = each.value.CUSTOM_DOMAIN_URL
  records         = [module.load_balancer.lb_dns_name]
  ttl             = 60
  type            = "CNAME"
  zone_id = can(each.value.ROUTE53_PUBLIC_DOMAIN) ? aws_route53_zone.private[each.value.ROUTE53_PUBLIC_DOMAIN].zone_id : aws_route53_zone.private[join(".", [
    split(".", each.value.CUSTOM_DOMAIN_URL)[length(split(".", each.value.CUSTOM_DOMAIN_URL)) - 2],
    split(".", each.value.CUSTOM_DOMAIN_URL)[length(split(".", each.value.CUSTOM_DOMAIN_URL)) - 1]
  ])].zone_id
}

resource "aws_route53_zone" "private" {
  for_each = local.base_domains
  name     = each.value
  vpc {
    vpc_id = local.vpc_id
  }
}