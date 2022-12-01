resource "aws_security_group" "alb" {
  count = var.elb_type == "ALB" ? can(regex("^sg.*", var.external_alb_sg_id)) ? 0 : 1 : 0

  name = "${local.name_prefix}_alb"
  vpc_id = local.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.fg.id]
  }
}

resource "aws_security_group" "fg" {
  name = "${local.name_prefix}_fg"
  vpc_id = local.vpc_id
  egress {
    from_port       = "443"
    to_port         = "443"
    protocol        = "tcp"
    security_groups = [aws_security_group.vpc_endpoints.id]
  }
  egress {
    from_port       = "443"
    to_port         = "443"
    protocol        = "tcp"
    prefix_list_ids = [aws_vpc_endpoint.this["s3"].prefix_list_id]
  }
  egress {
    from_port = "53"
    to_port ="53"
    protocol ="udp"
    cidr_blocks = ["${cidrhost(data.aws_vpc.selected.cidr_block, 2)}/32"]
  }
}

resource "aws_security_group_rule" "fg_ingress" {
  type              = "ingress"
  security_group_id = aws_security_group.fg.id
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"

  source_security_group_id = var.elb_type == "ALB" ? local.alb_sg_id : null
  cidr_blocks              = var.elb_type == "NLB" ? ["0.0.0.0/0"] : null
}

resource "aws_security_group" "vpc_endpoints" {
  name = "${local.name_prefix}_vpc_endpoints"
  vpc_id = local.vpc_id
  ingress {
    from_port   = "443"
    to_port     = "443"
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
  }
}