data "aws_ecr_authorization_token" "token" {}

provider "docker" {
  registry_auth {
    address  = "${data.aws_caller_identity.current.id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
    username = data.aws_ecr_authorization_token.token.user_name
    password = data.aws_ecr_authorization_token.token.password
  }
}

resource "random_string" "repo_suffix" {
  length = 5
  special = false
  upper = false
}

module "docker_image" {
  source = "terraform-aws-modules/lambda/aws//modules/docker-build"

  create_ecr_repo = true
  ecr_repo = "${local.name_prefix}_${random_string.repo_suffix.result}"
  ecr_force_delete = true
  source_path     = "${path.module}/docker"
  build_args      = {
      PLATFORM = var.task_platform == "ARM64" ? "linux/arm64" : "linux/amd64"
      IMAGE = "${var.task_image}:${var.task_image_tag}"
  }
}

resource "aws_ecr_repository_policy" "ecr_policy" {
  depends_on = [
    module.docker_image
  ]
  repository = "${local.name_prefix}_${random_string.repo_suffix.result}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect= "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Principal = {
          AWS = [
            aws_iam_role.fargate_task.arn
          ]
        }
      }
    ]
  })
}