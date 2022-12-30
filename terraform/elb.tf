module "load_balancer" {
  source  = "terraform-aws-modules/alb/aws"
  version = ">=8.1.0"

  name               = local.name_prefix
  load_balancer_type = var.elb_type == "ALB" ? "application" : "network"
  vpc_id             = local.vpc_id
  internal           = true
  subnets            = local.private_subnets
  security_groups    = var.elb_type == "ALB" ? can(regex("^sg.*", var.external_alb_sg_id)) ? [var.external_alb_sg_id] : [aws_security_group.alb[0].id] : null
  target_groups = [
    {
      name_prefix      = length(local.name_prefix) > 6 ? substr(local.name_prefix, 0, 6) : local.name_prefix
      backend_protocol = var.elb_type == "ALB" ? "HTTP" : "TCP"
      backend_port     = "80"
      target_type      = "ip"
      health_check = {
        protocol            = var.elb_type == "ALB" ? "HTTP" : "TCP"
        healthy_threshold   = 3
        unhealthy_threshold = 3
        interval            = var.elb_type == "ALB" ? 5 : 10
        timeout             = var.elb_type == "ALB" ? 2 : null
      }
    }
  ]
}

resource "aws_lb_listener" "this" {
  load_balancer_arn = module.load_balancer.lb_arn
  port              = 443
  protocol          = var.elb_type == "ALB" ? "HTTPS" : "TLS"
  certificate_arn   = module.acm[tolist(local.base_domains)[0]].acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-Ext-2018-06"
  default_action {
    type             = "forward"
    target_group_arn = module.load_balancer.target_group_arns[0]
  }
}

resource "aws_lb_listener_certificate" "load_balancer" {
  for_each = local.base_domains

  listener_arn    = aws_lb_listener.this.arn
  certificate_arn = module.acm[each.value].acm_certificate_arn
}
