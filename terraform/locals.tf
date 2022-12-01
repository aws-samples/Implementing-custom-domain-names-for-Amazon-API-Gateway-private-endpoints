locals {
  availability_zones = [
    data.aws_availability_zones.available.names[0],
    data.aws_availability_zones.available.names[1],
    data.aws_availability_zones.available.names[2]
  ]

  pull_through_cache = can(regex("^(public.ecr.aws|quay.io)/", var.task_image)) ? true : false
  proxy_config_path  = var.proxy_config_path == "" ? "${path.module}/../config/proxy-config.yaml" : "${path.module}/../${var.proxy_config_path}"
  api_list           = yamldecode(file(local.proxy_config_path)).APIS
  base_domains = toset([
    for api in local.api_list :
    can(api.ROUTE53_PUBLIC_DOMAIN) ? api.ROUTE53_PUBLIC_DOMAIN : join(".", [
      split(".", api.CUSTOM_DOMAIN_URL)[length(split(".", api.CUSTOM_DOMAIN_URL)) - 2],
      split(".", api.CUSTOM_DOMAIN_URL)[length(split(".", api.CUSTOM_DOMAIN_URL)) - 1]
      ]
    )
  ])
  name_prefix     = length("${var.app_name}_${var.app_environment}") > 10 ? substr("${var.app_name}_${var.app_environment}",0,10) : "${var.app_name}_${var.app_environment}"
  service_name    = "${local.name_prefix}_nginx"
  ecr_registry    = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
  # task_image      = local.pull_through_cache ? "${local.ecr_registry}/${var.task_image}" : var.task_image
  vpc_id          = var.create_vpc ? module.vpc[0].vpc_id : var.external_vpc_id
  private_subnets = var.create_vpc ? module.vpc[0].private_subnets : var.external_private_subnets_id
  alb_sg_id       = var.elb_type == "ALB" ? can(regex("^sg.*", var.external_alb_sg_id)) ? var.external_alb_sg_id : aws_security_group.alb[0].id : null
}