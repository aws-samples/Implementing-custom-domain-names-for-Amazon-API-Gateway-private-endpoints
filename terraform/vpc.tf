locals {
  public_cidr          = cidrsubnets(var.vpc_cidr, 2, 2)[0]
  private_cidr         = cidrsubnets(var.vpc_cidr, 2, 2)[1]
  public_subnet_cidrs  = cidrsubnets(local.public_cidr, 2, 2)
  private_subnet_cidrs = cidrsubnets(local.private_cidr, 2, 2)
}

#tfsec:ignore:aws-ec2-require-vpc-flow-logs-for-all-vpcs #Flow logs implemented in module, false finding
module "vpc" {
  count   = var.create_vpc ? 1 : 0
  source  = "terraform-aws-modules/vpc/aws"
  version = ">=3.18.0"

  name                                 = local.name_prefix
  cidr                                 = var.vpc_cidr
  azs                                  = local.availability_zones
  private_subnets                      = local.private_subnet_cidrs
  public_subnets                       = var.public_subnets ? local.public_subnet_cidrs : []
  create_igw                           = var.public_subnets ? true : false
  enable_dns_hostnames                 = true
  enable_dns_support                   = true
  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true

  flow_log_max_aggregation_interval         = 60
  flow_log_cloudwatch_log_group_name_prefix = "/aws/${var.app_environment}/"
  flow_log_cloudwatch_log_group_name_suffix = var.app_name
}

resource "null_resource" "enable_vpc_dns" {
  provisioner "local-exec" {
    command = <<EOT
if [ "$(aws ec2 describe-vpc-attribute --vpc-id "${local.vpc_id}" --attribute enableDnsSupport --query "EnableDnsSupport.Value" --output text)" = "True" ]; then
  echo "{\"value\":\"previously enabled\"}"
else
  aws ec2 modify-vpc-attribute --enable-dns-support --vpc-id "${local.vpc_id}"
  echo "{\"value\":\"terraform enabled\"}"
fi
EOT
  }
}
