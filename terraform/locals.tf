locals {
  availability_zones = [
    data.aws_availability_zones.available.names[0],
    data.aws_availability_zones.available.names[1],
    data.aws_availability_zones.available.names[2]
  ]

  proxy_config_path = var.proxy_config_path == "" ? "${path.module}/../config/proxy-config.yaml" : var.proxy_config_path
  api_list          = yamldecode(trimsuffix(file(local.proxy_config_path), "#")).APIS
  base_domains = toset([
    for api in local.api_list :
    trimprefix(regex("\\..*$", api.CUSTOM_DOMAIN_URL), ".")
  ])
  name_prefix     = trimsuffix(length("${var.app_name}-${var.app_environment}") > 10 ? substr("${var.app_name}-${var.app_environment}", 0, 10) : "${var.app_name}-${var.app_environment}", "-")
  service_name    = "${local.name_prefix}_nginx"
  vpc_id          = var.external_vpc_id == null ? module.vpc[0].vpc_id : var.external_vpc_id
  private_subnets = var.external_vpc_id == null ? module.vpc[0].private_subnets : var.external_private_subnets_id
}
