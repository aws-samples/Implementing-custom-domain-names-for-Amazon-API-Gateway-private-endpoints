resource "local_file" "proxy-config" {
  filename = "${path.module}/../outputs/terraform/${var.app_name}-${var.app_environment}-proxy-conf.yaml"
  content  = templatefile("${path.module}/template_files/proxy-config.tftpl", yamldecode(file(local.proxy_config_path)))
}

resource "local_file" "output" {
    filename = "${path.module}/../outputs/terraform/outputs.json"
    content = jsonencode({
        vpc_id = local.vpc_id
        api_gateway_vpce_id = aws_vpc_endpoint.this["execute-api"].id
        elb_dns_uri = module.load_balancer.lb_dns_name
        mapping = [for api in local.api_list : {
                CUSTOM_DOMAIN_URL = api.CUSTOM_DOMAIN_URL
                PRIVATE_API_URL = api.PRIVATE_API_URL
                ROUTE53_PUBLIC_DOMAIN = can(api.ROUTE53_PUBLIC_DOMAIN) ? api.ROUTE53_PUBLIC_DOMAIN : join(".", [
                                          split(".", api.CUSTOM_DOMAIN_URL)[length(split(".", api.CUSTOM_DOMAIN_URL)) - 2],
                                          split(".", api.CUSTOM_DOMAIN_URL)[length(split(".", api.CUSTOM_DOMAIN_URL)) - 1]
                                          ]
                                        )
                VERBS = can(api.VERBS) ? api.VERBS : ["*"]
                PRIVATE_RESOURCE_POLICY = [jsondecode(data.aws_iam_policy_document.this[api.CUSTOM_DOMAIN_URL].json)]
        }]
    })
}

data "aws_iam_policy_document" "this" {
  for_each = { for api in local.api_list : api.CUSTOM_DOMAIN_URL => {
    api_stage     = split("/", api.PRIVATE_API_URL)[3],
    resource_path = can(split(regex("(https://(.*/){2})", api.PRIVATE_API_URL), api.PRIVATE_API_URL)[1]) ? split(regex("(https://(.*/){2})", api.PRIVATE_API_URL), api.PRIVATE_API_URL)[1] : "*",
    verbs         = can(api.VERBS) ? api.VERBS : ["*"]
    vpce          = aws_vpc_endpoint.this["execute-api"].id,
    }
  }
  statement {
    sid    = "${var.app_name}-${var.app_environment}-allow"
    effect = "Allow"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions = [
      "execute-api:Invoke"
    ]
    resources = [for verb in each.value.verbs :
      "execute-api:/${each.value.api_stage}/${verb}/${each.value.resource_path}"
    ]
  }
  statement {
    sid    = "${var.app_name}-${var.app_environment}-deny"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions = [
      "execute-api:Invoke"
    ]
    resources = [for verb in each.value.verbs :
      "execute-api:/${each.value.api_stage}/${verb}/${each.value.resource_path}"
    ]
    condition {
      test     = "StringNotEquals"
      variable = "aws:SourceVpce"
      values = [
        each.value.vpce
      ]
    }
  }
}