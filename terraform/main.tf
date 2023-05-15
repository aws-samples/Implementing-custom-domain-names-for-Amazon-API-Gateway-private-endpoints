terraform {
  required_version = ">=1.2, ~>1.4"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~>4.0"
    }
    local = {
      version = "~>2.2.3"
    }
    random = {
      version = "~>3.4.3"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~>2.22.0"
    }
    null = {
      version = "~>3.2.0"
    }
    external = {
      version = "~>2.2.2"
    }
    jq = {
      source  = "massdriver-cloud/jq"
      version = "~>0.2.1"
    }
  }
}
provider "aws" {
  default_tags {
    tags = {
      Environment  = var.app_environment
      Application  = var.app_name
      DeployedWith = "Terraform"
    }
  }
}
