data "aws_iam_policy" "ecs" {
  name = "AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_service" {
  name = "${local.name_prefix}_ecs_service"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          Service = [
            "ecs-tasks.amazonaws.com"
          ]
        }
      },
    ]
  })
}

resource "aws_iam_role" "fargate_task" {
  name = "${local.name_prefix}_fargate_task"
  assume_role_policy = jsonencode(
    {
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = "sts:AssumeRole"
          Principal = {
            Service = [
              "ecs-tasks.amazonaws.com"
            ]
          }
        }
      ]
    }
  )
}

resource "aws_iam_policy" "ecs_service" {
  name = "${local.name_prefix}_ecs_service"
  policy = jsonencode(
    {
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "logs:CreateLogGroup"
          ]
          Resource = "arn:${data.aws_partition.current.id}:logs::${data.aws_caller_identity.current.account_id}:/ecs/${local.service_name}"
        }
      ]
    }
  )
}

resource "aws_iam_policy" "fargate_task" {
  name = "${local.name_prefix}_fargate_task"
  policy = jsonencode(
    {
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "s3:GetObject"
          ]
          Resource = "arn:aws:s3:::prod-${data.aws_region.current.name}-starport-layer-bucket/*"
        }
      ]
    }
  )
}

resource "aws_iam_role_policy_attachment" "ecs_service_managed_policy" {
  role       = aws_iam_role.ecs_service.name
  policy_arn = data.aws_iam_policy.ecs.arn
}

resource "aws_iam_role_policy_attachment" "ecs_service" {
  role       = aws_iam_role.ecs_service.name
  policy_arn = aws_iam_policy.ecs_service.arn
}

resource "aws_iam_role_policy_attachment" "fargate_task_managed_policy" {
  role       = aws_iam_role.fargate_task.name
  policy_arn = data.aws_iam_policy.ecs.arn
}

resource "aws_iam_role_policy_attachment" "fargate_task" {
  role       = aws_iam_role.fargate_task.name
  policy_arn = aws_iam_policy.fargate_task.arn
}
