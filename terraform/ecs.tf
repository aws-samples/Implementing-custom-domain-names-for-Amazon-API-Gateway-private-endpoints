module "ecs" {
  source  = "terraform-aws-modules/ecs/aws"
  version = ">=4.1.1"

  cluster_name = local.name_prefix
  fargate_capacity_providers = {
    FARGATE = {
      default_capacity_provider_strategy = {
        weight = 100
      }
    }
  }
}

resource "null_resource" "proxy_config" {
  triggers = {
    config_sha1 = sha1(file("${path.module}/../config/proxy-config.yaml"))
  }
}

resource "aws_appautoscaling_target" "ecs_target" {
  max_capacity       = 4
  min_capacity       = 1
  resource_id        = "service/${module.ecs.cluster_name}/${aws_ecs_service.nginx.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_policy" {
  name               = local.name_prefix
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_target.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 80
    scale_in_cooldown  = 60
    scale_out_cooldown = 60
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.service_name
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  requires_compatibilities = ["FARGATE"]
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_platform
  }
  container_definitions = jsonencode(
    [{
      cpu         = 512
      image       = module.docker_image.image_uri
      memory      = 1024
      name        = local.service_name
      networkMode = "awsvpc"
      entrypoint  = ["/bin/sh", "-c", "echo $NGINX_CONFIG | base64 -d > /etc/nginx/nginx.conf && nginx && tail -f /dev/null"]
      environment = [
        {
          name = "NGINX_CONFIG",
          value = base64encode(templatefile(
            "${path.module}/template_files/nginx.conf.tftpl", {
              apis = zipmap(
                [for api in local.api_list : trimprefix(api.CUSTOM_DOMAIN_URL, "https://")],
                [for api in local.api_list : trimprefix(api.PRIVATE_API_URL, "https://")]
              ), dns_server = cidrhost(data.aws_vpc.selected.cidr_block, 2)
            }
            )
          )
        }
      ]
      portMappings = [
        {
          protocol      = "tcp"
          containerPort = 80
          hostPort      = 80
        }
      ]
      logConfiguration = {
        logdriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${local.service_name}"
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "stdout"
          "awslogs-create-group"  = "true"
        }
      }
    }]
  )
  execution_role_arn = aws_iam_role.ecs_service.arn
  task_role_arn      = aws_iam_role.fargate_task.arn
  lifecycle {
    replace_triggered_by = [
      null_resource.proxy_config.id
    ]
  }
}

resource "aws_ecs_service" "nginx" {
  depends_on = [
    module.vpc[0]
  ]
  name                   = local.service_name
  cluster                = module.ecs.cluster_id
  task_definition        = aws_ecs_task_definition.app.arn
  launch_type            = "FARGATE"
  scheduling_strategy    = "REPLICA"
  desired_count          = 1
  force_new_deployment   = true
  enable_execute_command = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.private_subnets
    assign_public_ip = false
    security_groups  = [aws_security_group.fg.id]
  }

  load_balancer {
    target_group_arn = module.load_balancer.target_group_arns[0]
    container_name   = local.service_name
    container_port   = 80
  }
}
