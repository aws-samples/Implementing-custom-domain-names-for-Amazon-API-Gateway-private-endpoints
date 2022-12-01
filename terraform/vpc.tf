locals {
  public_cidr          = cidrsubnets(var.vpc_cidr, 2, 2)[0]
  private_cidr         = cidrsubnets(var.vpc_cidr, 2, 2)[1]
  public_subnet_cidrs  = cidrsubnets(local.public_cidr, 2, 2)
  private_subnet_cidrs = cidrsubnets(local.private_cidr, 2, 2)
}

module "vpc" {
  count   = var.create_vpc ? 1 : 0
  source  = "terraform-aws-modules/vpc/aws"
  version = ">=3.18.0"

  name                 = local.name_prefix
  cidr                 = var.vpc_cidr
  azs                  = local.availability_zones
  private_subnets      = local.private_subnet_cidrs
  public_subnets       = var.public_subnets ? local.public_subnet_cidrs : []
  create_igw           = var.public_subnets ? true : false
  enable_dns_hostnames = true
  enable_dns_support   = true
}
