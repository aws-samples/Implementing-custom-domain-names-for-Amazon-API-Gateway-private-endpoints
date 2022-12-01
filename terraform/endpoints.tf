locals {
  endpoints = [
    "ecr.dkr",
    "ecr.api",
    "execute-api",
    "s3",
    "logs"
  ]
}

data "aws_vpc_endpoint_service" "selected" {
  for_each = { for service in local.endpoints : service => service }

  service_name = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  service_type = "Interface"

}

resource "aws_vpc_endpoint" "this" {
  for_each = { for service in local.endpoints : service => service }

  vpc_id              = local.vpc_id
  service_name        = data.aws_vpc_endpoint_service.selected[each.value].service_name
  vpc_endpoint_type   = each.value == "s3" ? "Gateway" : "Interface"
  security_group_ids  = each.value == "s3" ? null : [aws_security_group.vpc_endpoints.id]
  subnet_ids          = each.value == "s3" ? null : local.private_subnets
  route_table_ids     = each.value == "s3" ? data.aws_route_tables.selected.ids : null
  private_dns_enabled = each.value == "s3" ? false : true
}
