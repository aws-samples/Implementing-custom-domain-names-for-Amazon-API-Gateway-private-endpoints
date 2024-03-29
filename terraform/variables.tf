variable "create_vpc" {
  type    = bool
  default = true
}

variable "app_environment" {
  description = "The Deployment environment"
  type        = string
  validation {
    condition     = can(regex("[[:alnum:]]", var.app_environment))
    error_message = "app_environment just be alphanumeric"
  }
}

variable "app_name" {
  description = "Application prefix"
  type        = string
  validation {
    condition     = can(regex("[[:alnum:]]", var.app_name))
    error_message = "app_name just be alphanumeric"
  }
}

variable "public_subnets" {
  type    = bool
  default = false
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
  validation {
    condition     = can(cidrhost(var.vpc_cidr, 32))
    error_message = "Invlalid CIDR"
  }
}

variable "external_vpc_id" {
  type    = string
  default = null
  nullable = true
  validation {
    condition     = can(regex("(vpc-[0-9a-f]+|)", var.external_vpc_id)) || var.external_vpc_id == null
    error_message = "Invalid external vpc id."
  }
}

variable "external_private_subnets_id" {
  type    = list(string)
  default = []
  validation {
    condition = can([
      for id in var.external_private_subnets_id :
      regex("(subnet-[0-9a-f]+|)", id)
    ])
    error_message = "Must be a list of valid subnet ids (i.e. [subnet-0123456789,subnet-0123456780,subnet-0123456781])"
  }
}



variable "elb_type" {
  type        = string
  default     = "NLB"
  description = "Load balancer type [ALB|NLB]"
  validation {
    condition     = can(regex("(ALB|NLB)", var.elb_type))
    error_message = "The elb_type value must be or type ALB or NLB"
  }
}

variable "task_image" {
  type        = string
  description = "Image reference for nginx ECS task"
  default     = "amazonlinux"
}

variable "task_image_tag" {
  type    = string
  default = "2"
}

variable "proxy_config_path" {
  type    = string
  default = "../config/proxy-config.yaml"
}

variable "task_platform" {
  type        = string
  default     = "ARM64"
  description = "CPU platform for ECS task."
  validation {
    condition     = can(regex("(ARM64|X86_64)", var.task_platform))
    error_message = "Valid task platforms are ARM64 and X86_64"
  }
}

variable "task_scale_min" {
  type        = number
  description = "Minimum NGINX tasks"
  default     = 1
}

variable "task_scale_max" {
  type        = number
  description = "Maximum NGINX tasks"
  default     = 4
}

variable "task_scale_cpu_pct" {
  type        = number
  description = "CPU usage percentage that will cause ECS to increase the task count."
  default     = 80
}

variable "external_endpoint_sg_id" {
  type    = string
  default = null
  nullable = true
  validation {
    condition     = can(regex("(sg-[0-9a-f]+|)", var.external_endpoint_sg_id)) || var.external_endpoint_sg_id == null
    error_message = "Invalid external security group id."
  }

}

variable "external_fargate_sg_id" {
  type    = string
  default = null
  nullable = true
  validation {
    condition     = can(regex("(sg-[0-9a-f]+|)", var.external_fargate_sg_id)) || var.external_fargate_sg_id == null
    error_message = "Invalid external security group id."
  }

}

variable "external_alb_sg_id" {
  type    = string
  default = null
  nullable = true
  validation {
    condition     = can(regex("(sg-[0-9a-f]+|)", var.external_alb_sg_id)) || var.external_alb_sg_id == null
    error_message = "Invalid external security group id."
  }

}