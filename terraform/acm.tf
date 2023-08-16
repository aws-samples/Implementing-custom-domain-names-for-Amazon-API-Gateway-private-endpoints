module "acm" {
  for_each    = local.base_domains
  source      = "terraform-aws-modules/acm/aws"
  version     = "~>4.3.1"
  domain_name = "*.${each.value}"
  zone_id     = data.aws_route53_zone.selected[each.value].id
}