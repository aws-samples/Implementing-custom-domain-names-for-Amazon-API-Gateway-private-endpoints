data "aws_ecr_authorization_token" "token" {}

provider "docker" {
  registry_auth {
    address  = "${data.aws_caller_identity.current.id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
    username = data.aws_ecr_authorization_token.token.user_name
    password = data.aws_ecr_authorization_token.token.password
  }
}

resource "random_string" "repo_suffix" {
  length  = 5
  special = false
  upper   = false
}

resource "random_string" "image_tag" {
  length  = 5
  special = false
  upper   = false
  keepers = {
    platform   = var.task_platform
    source_img = var.task_image
    source_tag = var.task_image_tag
    dockerfile = filesha256("${path.module}/docker/Dockerfile")
  }
}

#tfsec:ignore:aws-ecr-repository-customer-key #ECR repository encrypted with default keys, end-user can adjust using customer managed KMS key if desired.
module "docker_image" {
  source               = "terraform-aws-modules/lambda/aws//modules/docker-build"
  version              = "~>4.7.1"
  create_ecr_repo      = true
  ecr_repo             = "${local.name_prefix}_${random_string.repo_suffix.result}"
  ecr_force_delete     = true
  source_path          = "${path.module}/docker"
  image_tag_mutability = "IMMUTABLE"
  scan_on_push         = true
  image_tag            = random_string.image_tag.result
  build_args = {
    PLATFORM = var.task_platform == "ARM64" ? "linux/arm64" : "linux/amd64"
    IMAGE    = "${var.task_image}:${var.task_image_tag}"
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
        Effect = "Allow"
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
