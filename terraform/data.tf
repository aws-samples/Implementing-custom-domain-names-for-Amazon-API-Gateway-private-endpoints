data "aws_region" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_caller_identity" "current" {}

data "aws_vpc" "selected" {
  id = var.external_vpc_id != "" ? var.external_vpc_id : module.vpc[0].vpc_id
}

data "aws_partition" "current" {}

data "aws_route_tables" "selected" {
  vpc_id = local.vpc_id
}

data "external" "vpc_dns_support" {
  program = ["sh", "${path.module}/scripts/enable_dns_support.sh",local.vpc_id]
}