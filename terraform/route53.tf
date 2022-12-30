data "aws_route53_zone" "selected" {
  for_each = local.base_domains
  name     = each.value

  private_zone = false
}

resource "aws_route53_record" "api" {
  for_each = { for api in local.api_list : api.CUSTOM_DOMAIN_URL => api }

  allow_overwrite = true
  name            = each.value.CUSTOM_DOMAIN_URL
  records         = [module.load_balancer.lb_dns_name]
  ttl             = 60
  type            = "CNAME"
  zone_id         = aws_route53_zone.private[trimprefix(regex("\\..*$", each.value.CUSTOM_DOMAIN_URL), ".")].zone_id
}

resource "aws_route53_zone" "private" {
  for_each = local.base_domains
  name     = each.value
  vpc {
    vpc_id = local.vpc_id
  }
}
