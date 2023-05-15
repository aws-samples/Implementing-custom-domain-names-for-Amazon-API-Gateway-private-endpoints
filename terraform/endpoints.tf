locals {
  endpoints = [
    "ecr.dkr",
    "ecr.api",
    "execute-api",
    "logs",
    "s3"
  ]
  endpoint_ids = {
    "ecr.dkr"     = can(regex("(vpce-)[a-z0-9].*", data.external.existing_endpoint["ecr.dkr}"].result)) ? null : true
    "ecr.api"     = can(regex("(vpce-)[a-z0-9].*", data.external.existing_endpoint["ecr.dkr}"].result)) ? null : true
    "execute-api" = can(regex("(vpce-)[a-z0-9].*", data.external.existing_endpoint["ecr.dkr}"].result)) ? null : true
    "logs"        = can(regex("(vpce-)[a-z0-9].*", data.external.existing_endpoint["ecr.dkr}"].result)) ? null : true
    "s3"          = can(regex("(vpce-)[a-z0-9].*", data.external.existing_endpoint["ecr.dkr}"].result)) ? null : true
  }
}

data "external" "existing_endpoint" {
  for_each = { for endpoint in local.endpoints : endpoint => {
    endpoint = endpoint
    vpc_id   = data.aws_vpc.selected.id
    }
  }

  program = ["/bin/bash", "${path.module}/scripts/existing_endpoint.sh", each.value.endpoint, each.value.vpc_id]
}

data "aws_route_tables" "selected" {
  vpc_id = data.aws_vpc.selected.id
}

module "endpoints" {
  source  = "terraform-aws-modules/vpc/aws//modules/vpc-endpoints"
  version = "~>3.18.1"

  security_group_ids = [data.aws_security_group.endpoints.id]
  subnet_ids= local.private_subnets
  vpc_id             = data.aws_vpc.selected.id
  endpoints = { for endpoint in local.endpoints : endpoint => {

    create  = lookup(local.endpoint_ids, endpoint, false)
    service = endpoint
    private_dns_enabled = endpoint != "s3" ? true : null
    service_type = endpoint == "s3" ? "Gateway" : "Interface"
    route_table_ids = endpoint == "s3" ? data.aws_route_tables.selected.ids : null
    }
  }
}


resource "aws_security_group" "vpc_endpoints" {
  count = var.external_endpoint_sg_id == null ? 1 : 0
  name        = "${local.name_prefix}_vpc_endpoints"
  description = "Ingress to Service Endpoints"
  vpc_id      = local.vpc_id
  ingress {
    description = "HTTPS Ingress from VPC"
    from_port   = "443"
    to_port     = "443"
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
  }
}

data "aws_security_group" "endpoints" {
  id = var.external_endpoint_sg_id != null ? var.external_endpoint_sg_id : aws_security_group.vpc_endpoints[0].id
}