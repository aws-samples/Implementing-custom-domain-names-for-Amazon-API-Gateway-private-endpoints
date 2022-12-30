# Enabling Private APIs with Custom Domain Names with multi-domain and multi-account support

This repository implements a feature-rich reverse proxy ingress layer, which supports requirements for enabling private API(s) with custom domain(s) with support for multi-account environment. This solution also supports a simple way to add/ update/ delete mapping between your custom domain(s) and their respective private API(s).

See this blog [post] (future...)

- [Enabling Private APIs with Custom Domain Names with multi-domain and multi-account support](#enabling-private-apis-with-custom-domain-names-with-multi-domain-and-multi-account-support)
  - [Services Used](#services-used)
  - [Architecture](#architecture)
  - [Traffic Flow](#traffic-flow)
  - [Pre Deployment Steps](#pre-deployment-steps)
    - [Dependencies](#dependencies)
    - [Clone the Repository](#clone-the-repository)
    - [Proxy Configuration](#proxy-configuration)
      - [Example proxy-config.yaml file:](#example-proxy-configyaml-file)
    - [Deployment Variables](#deployment-variables)
      - [Example vars.yaml file:](#example-varsyaml-file)
  - [Dt Steps](#dt-steps)
    - [AWS Cloud Development Kit (CDK)](#aws-cloud-development-kit-cdk)
    - [Terraform](#terraform)
      - [Networking Components](#networking-components)
      - [Rest of the Components](#rest-of-the-components)
    - [Add or Update Resource Policy for private endpoints](#add-or-update-resource-policy-for-private-endpoints)
      - [Update Mapping File](#update-mapping-file)
      - [Testing](#testing)
      - [Clean Up](#clean-up)

## Services Used

- [AWS Certificate Manager](https://aws.amazon.com/certificate-manager/)
- [AWS Network Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)
- [AWS Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [Amazon VPC Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [Amazon Route 53](https://aws.amazon.com/route53/)
- [Amazon API Gateway](https://aws.amazon.com/api-gateway/)
- [AWS Fargate](https://aws.amazon.com/fargate/)
- [Amazon Elastic Container Registry](https://aws.amazon.com/ecr/)

## Architecture

The architecture diagram below illustrates the interactions between the components in the solution and leverages NLB (AWS Network Load Balancer ) or ALB (AWS Application Load Balancer) for routing traffic and AWS Fargate (ECS) for hosting the Nginx reverse proxy to map traffic between the custom domains and their respective private API Gateway endpoints.

![A diagram of the architecture solution Overview](./assets/overview_nlb_alb.png "Solution Overview")

## Traffic Flow

A user or application makes an API request to the fully qualified domain name (FQDN) of the custom domain name, in this example private.internal.example.com or private.internal.example2.com. We use respective private hosted zone(s) in association with the VPC. An alias record of the Route53 private hosted zone resolves to the FQDN of the private load balancer. For more details, refer to the [documentation](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zone-private-creating.html) on private hosted zones. The load balancer terminates TLS with the AWS Certificate Manager (ACM) for respective custom domain. The listener redirects to associated target group. The target group of the load balancer is registered with ECS service for AWS Fargate. Fargate service hosts an Nginx-based container that acts as a reverse proxy to private API Gateway endpoints in service account(s). Fargate service is auto-scaled using a given target tracking metric. There is an YAML based mapping file deployed with application, which maintains the mapping between a custom domain and its respective private API endpoint.

## Pre Deployment Steps

### Dependencies

Deployment dependencies differ by deployment tool chosen. Reference the following list to find dependencies for your deployment tool.

| Application                                                                                                          | Tested Version   | CDK Deployment | Terraform Deployment |
| -------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------- | -------------------- |
| [Node.js](https://nodejs.org/en/)                                                                                    | 19.2.0 > 16.15.0 | X              |                      |
| [Git](https://git-scm.com/downloads)                                                                                 | ≥ 2.0            | X              | X                    |
| [Typescript](https://www.typescriptlang.org/download/)                                                               | ≥ 4.7.0          | X              |                      |
| [JQ](https://stedolan.github.io/jq/)                                                                                 | ≥ 1.6            | X              | X                    |
| [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html)                            | ≥ 2.0            | X              | X                    |
| [Docker](https://docs.docker.com/get-docker/)                                                                        | ≥ 4.0            | X              | X                    |
| [CDK (Cloud Development Kit)](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) | ≥ 2.51.0         | X              |                      |
| [Terraform](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli)                         | ≥ 1.2.0          |                | X                    |

### Clone the Repository

```bash
git clone git@ssh.gitlab.aws.dev:sddoshi/enabling-custom-domain-names-for-private-api-gateway-endpoints.git
```

### Proxy Configuration

Create a yaml list describing the private apis. The default location for the proxy configuration file is _./config/proxy-config.yaml_.

<details><summary>Full description of proxy configuration values.</summary>

| Property              | Required | Example Values                                                                     | Description                                                                                                                                                                                         |
| --------------------- | -------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CUSTOM_DOMAIN_URL** | true     | private.api1.internal.example.com<br>api2.internal.example.com                     | Desired custom url for private api.                                                                                                                                                                 |
| **PRIVATE_API_URL**   | true     | https://_\<api-id\>_.execute-api._\<region\>_.amazonaws.com/_\<stage\>_/_\<path\>_ | Execution URL of targeted private API.                                                                                                                                                              |
| **VERBS**             | false    | [\"GET\"]<br>[\"GET\", \"DELETE\"]                                                 | Comma separated list of authorized [HTTP methods/verbs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-settings-method-request.html#setup-method-add-http-method). |

</details>

#### Example proxy-config.yaml file:

```yaml
---
APIS:
  - CUSTOM_DOMAIN_URL: private_api1.internal.example.com
    PRIVATE_API_URL: https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/
  - CUSTOM_DOMAIN_URL: private_api2.example.com
    PRIVATE_API_URL: https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/
    VERBS: ["GET", "PUT"]
```

&nbsp;&nbsp;&nbsp;&nbsp;_Template is available in repository at [./samples/proxy-config.yaml](https://gitlab.aws.dev/sddoshi/enabling-custom-domain-names-for-private-api-gateway-endpoints/-/blob/main/config/proxy-config.yaml)_

### Deployment Variables

Deployment has multiple options which are declared using a variables file. The default variables file is at _./config/vars.yaml_.

<details><summary>Full description and default values for variables.</summary>

| Variable                        | Type           | Default                    | Description                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **APP_ENVIRONMENT**             | String         | dev                        | Environment name, used for resource names and tagging (e.g., dev, prod)                                                                                                                                                                                                                                          |
| **APP_NAME**                    | String         | reverse-proxy              | Deployment application name, used for resource names and tagging (e.g., reverse-proxy)                                                                                                                                                                                                                           |
| **CREATE_VPC**                  | Boolean        | true                       | Should the deployment create a new VPC and all associated [networking components](#networking-components)?                                                                                                                                                                                                       |
| **ELB_TYPE**                    | String         | NLB                        | An Elastic Load Balancer is included in the deployment; which type of load balancer should be deployed (options: ALB or NLB)                                                                                                                                                                                     |
| **EXTERNAL_VPC_ID**             | String         | _null_                     | If you would prefer to use an existing VPC provide the VPC id here and set CREATE_VPC to false                                                                                                                                                                                                                   |
| **EXTERNAL_PRIVATE_SUBNETS_ID** | List of String | [ ]                        | List of existing private subnets in the vpc referenced in EXTERNAL*VPC_ID<br>\_Example: ["subnet-0123456789","subnet-0123456789"]*                                                                                                                                                                               |
| **EXTERNAL_ALB_SG_ID**          | String         | _null_                     | If you would like to apply an existing security group to the load balancer instead of the solution creating one, provide the security group id                                                                                                                                                                   |
| **EXTERNAL_FARGATE_SG_ID**      | String         | _null_                     | If you would like to apply an existing security group to the ECS cluster instead of the solution creating one, provide the security group id                                                                                                                                                                     |
| **EXTERNAL_VPC_ENDPOINT_ID**    | String         | \*null                     | VPC endpoint id for execute-api endpoint in external VPC                                                                                                                                                                                                                                                         |
| **TASK_IMAGE**                  | String         | public.ecr.aws/nginx/nginx | Provide nginx container image reference.<br><details><summary>_Important Image Notes_</summary>_Images are sourced locally and pushed to an ECR repository for deployment. Private repository sources are permitted and will require you to configure your local docker environment's authentication._</details> |
| **TASK_IMAGE_TAG**              | String         | 1.23-alpine-perl           | Image tag for nginx container image referenced in TASK_IMAGE                                                                                                                                                                                                                                                     |
| **PROXY_CONFIG_PATH**           | String         | ./config/proxy-config.yaml | Relative path to the proxy configuration file.                                                                                                                                                                                                                                                                   |
| **PUBLIC_SUBNETS**              | Boolean        | false                      | If CREATE_VPC is true, should the new VPC have public subnets?                                                                                                                                                                                                                                                   |
| **VPC_CIDR**                    | String         | 10.0.0.0/16                | If CREATE_VPC is true, what CIDR block should the new VPC use.                                                                                                                                                                                                                                                   |

</details>

#### Example vars.yaml file:

```yaml
---
VARIABLES:
  - CREATE_VPC: true
    APP_ENVIRONMENT: dev
    APP_NAME: reverse-proxy
    ELB_TYPE: NLB
    VPC_CIDR: 10.0.0.0/16
    PUBLIC_SUBNETS: true
    EXTERNAL_VPC_ID:
    EXTERNAL_PRIVATE_SUBNETS_ID: []
    EXTERNAL_ALB_SG_ID:
    EXTERNAL_FARGATE_SG_ID:
    TASK_IMAGE: public.ecr.aws/nginx/nginx
    TASK_IMAGE_TAG: 1.23-alpine-perl
    PROXY_CONFIG_PATH:
    CREATE_TESTER_LAMBDA: true # Optional field, default is false, Used for testing connectivity to private API gateway using custom domain
```

&nbsp;&nbsp;&nbsp;&nbsp;_Template is available in repository at [./samples/vars.yaml](https://gitlab.aws.dev/sddoshi/enabling-custom-domain-names-for-private-api-gateway-endpoints/-/blob/main/samples/vars.yaml)
## Dt Steps

### AWS Cloud Development Kit (CDK)

If this is your first deployment of the solution, it is recommended you start with a synth. This will serve to validate your variables and proxy configuration files and you can review the output to verify the solution will deploy as expected.

Once comfortable with the synthesized or planned changes; move on to using deploy.

<details><summary>Script Usage</summary>

```bash

Usage: $0 --tool cdk --action <action> [args] <downstream args>

available actions:
  Action    | Description
  ----------|---------------------------------------------------------
  deploy    | Updates existing environment or creates new environment.
  destroy   | Destroys all resources created with deploy or apply.
  diff      | Compares synth planned deploy with existing environment.
  synth     | Synthesizes a deployment without creating any resources.

optional args:
  --vars <relative path to vars file>
    [Overrides default vars file location.]
  --proxyconf <relative path to proxy configuration file>
    [Overrides default proxy config file location.]
  --auto-approve
    [Bypasses implementation confirmation prompt]

downstream args:
  Any arguments passed that are not listed above will be passed to the CDK execution.
```

</details>

**Synthesize (Synth)**

```bash
# Synthesizes and prints the CloudFormation template for this stack

cd <cloned repository>
./exec.sh --tool cdk --action synth

```

**Deploy**

```bash
# Deploys the stack into your AWS account

cd <cloned repository>
./exec.sh --tool cdk --action deploy

```

Review any security related changes which require your approval (y/n)? y

### Terraform

If this is your first deployment of the solution, it is recommended you start with a plan. This will serve to validate your variables and proxy configuration files and you can review the output to verify the solution will deploy as expected.

Once comfortable with the synthesized or planned changes; move on to using apply.

<details><summary>Script Usage</summary>

```bash
Usage: $0 --tool terraform --action <action> [args] <downstream args>

available actions:
  Action    | Description
  ----------|-----------------------------------------------
  apply     | Updates existing environment or creates new environment.
  destroy   | Destroys all resources created with deploy or apply.
  plan      | Shows expected resource changes without modifying any resources.

optional args:
  --vars <relative path to vars file>
    [Overrides default vars file location.]
  --proxyconf <relative path to proxy configuration file>
    [Overrides default proxy config file location.]
  --auto-approve
    [Bypasses implementation confirmation prompt]
  --configure-backend (local|remote)
    [Configures state and lock backend, defaults to local.]

downstream args:
  Any arguments passed that are not listed above will be passed to the terraform execution.
```

</details>

**Configure Remote Backend (Optional)**

```bash
cd <cloned repository>
./exec.sh --tool terraform --configure-backend remote

```

Respond to prompts to provide S3 bucket and DynamoDB table details.

_Notes: The configure backend argument may also be passed inline while performing any terraform action. S3 Bucket and DynamoDB table must be created with appropriate configurations and permissions following vendor guidance [here](https://developer.hashicorp.com/terraform/language/settings/backends/s3)._

**Plan**

```bash
cd <cloned repository>
./exec.sh --tool terraform --action plan

```

Review the deployment plan and validate resource create, destroy and modify actions.<br>_Note: Plan may exceed your terminal's scroll buffer, you may need to redirect the output to a file to review in a text editor._

**Apply**

```bash
cd <cloned repository>
./exec.sh --tool terraform --action apply

```

Review the apply plan, and respond as appropriate.

```bash
Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes
```

This Infrastructure-as-code (IaC) deployment will create the following components and services in your AWS Account

#### Networking Components

- VPC with given CIDR
- Private and an optional Public Subnet in 2 Availability Zones
- A security group with rules for your Application load balancer alb-sg, with the following rules
  - Ingress on TCP 443 on local from all of VPC CIDR
  - Egress allowed Fargate Security Group fargate-sg
- A security group with rules for your Fargate ECS service fargate-sg (Which will host Nginx proxy)
  - IF you chose ELB_TYPE as ALB (Application Load Balancer)
    - Allow Ingress from alb-sg
    - Allow Egress outbound all ports/ destinations
  - IF you chose ELB_TYPE as NLB (Network Load Balancer)
    - Ingress on TCP 80 from all VPC private subnets
    - Allow Egress outbound all ports/ destinations
- A security group which will be attached to your interface endpoints
- Private links endpoints for following services
  - Interface endpoint for API Gateway
    - DNS name enabled
  - Interface endpoint for ECR API
    - DNS name enabled
  - Interface endpoint for ECR Registry
    - DNS name enabled
  - Interface endpoint for Logs
    - DNS name enabled
  - Gateway endpoint for S3

#### Rest of the Components

- Respective Amazon Route53 private hosted zones, this is based on unique domains found in proxy-config.yaml file.
- An Application Load Balancer or Network Load balancer, in your given VPC private subnet.
- ACM certificates for SSL offloading on ELB (Elastic Load Balancer), this is based on domains found in proxy-config.yaml file.
  **Note**: Creation of SSL certificate for domains in mapping file requires validation with a Route 53 hosted zone. To automate the validation while deploying of the mapping file we have chosen DNS based validation of SSL certificates with the Route 53 **public hosted zone**. A Public hosted zone in Route53 needs to be present for base top level domain(e.g. if you have a domain private.internal.example.com in your mapping file then a top base level domain example.com should be a public hosted zone present in your account for DNS based validation of certificate hosted in ACM to succeed)
- DNS of ELB would be added as alias record set in respective private Route53 private hosted zones.
- IaC application parses proxy-config.yaml file, and creates Nginx configuration file.
- IaC application builds a Docker image provided Nginx image, and uploads it to Amazon Elastic Container Repository.
- Finally CDK deployment creates an auto scaled Fargate service, and downloads Nginx image (Hosting Nginx as a reverse proxy to private API gateway endpoints).

Note: Initial IaC application deployment could take roughly 10 - 15 minutes to deploy.

### Add or Update Resource Policy for private endpoints

Once the IaC execution is complete. Before private API(s) can be accessed, [You need to create or update an API resource policy referencing VPC Endpoint Id of API gateway interface endpoint](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-endpoint-policies.html#apigateway-vpc-endpoint-policies-examples). This grants access to the API(s) from your VPCs and VPC endpoints or from VPCs and VPC endpoints in other AWS accounts that you explicitly grant access. You need to deploy your API for the change to take effect on API.

- You can perform these updates using the API Gateway console, the AWS CLI, an AWS SDK for API Gateway or using your deployment pipelines.
- There are currently multiple ways to update resource policy configuration on your API(s).
  - You can manually copy VPC Endpoint Id (Interface Endpoint of API Gateway) found in Account A  (Id can be found in generated outputs/outputs.json file as well) into the resource policy of the private API gateway in service accounts, and deploy respective private API using their deployment pipelines. Find API Gateway policy examples [here](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-endpoint-policies.html#apigateway-vpc-endpoint-policies-examples)
  - You can copy resource policy for a specific private API from outputs/outputs.json file. Sample outputs file is available in repository at [./samples/outputs.json](https://gitlab.aws.dev/sddoshi/enabling-custom-domain-names-for-private-api-gateway-endpoints/-/blob/main/samples/outputs.json)
  
  - You can use scripts/update_api_resource_policy.sh to update and deploy specific api as follows.

     ```bash
       AWS_PROFILE=<your_account_B_profile>
       AWS_REGION=<you_aws_region>
       PRIVATE_API_ID=<private_api_id>
       PRIVATE_API_STAGE_NAME=<private_api_stage_name>
       OUTPUT_FILE_PATH=<output_file_path> # Optional

       ./scripts/update_api_resource_policy.sh --private_api_id $PRIVATE_API_ID  \   
                                        --private_api_stage_name $PRIVATE_API_STAGE_NAME \
                                        --aws_profile $AWS_PROFILE \
                                        --aws_region $AWS_REGION \
                                        --output_file_path $OUTPUT_FILE_PATH 
      
      ```

#### Update Mapping File

  Deploy the IaC application again [similar to](#Deployment Steps) with updated mapping file values.

#### Testing

You can test API request against private custom domain name. From a bastion host within the VPC or other device that can route to the VPC, execute curl -s -XGET <https://api.private.example.com/stage> | jq .
Response will include something like the following:

```json
{
  "api": "api-id",
  "Referer": "api.private.example.com",
  "x-amzn-vpc-id": "vpc-2b2b2b2b2b2b2b2b2",
  "x-amzn-vpce-config": "1",
  "x-amzn-vpce-id": "vpce-1a1a1a1a1a1a1a1a1",
  "X-Forwarded-For": "10.0.94.52",
  }
```

Note that the x-forwarded-for header will be an IP address from your Fargate Service Task.

#### Clean Up

To cleanup this implementation, follow commands given below...

```bash
# Terraform

cd <cloned repository>
./exec.sh --tool terraform --action destroy

Do you really want to destroy all resources?

  Enter a value: yes
```

```bash

# CDK

cd <cloned repository>
./exec.sh --tool cdk --action destroy

Are you sure you want to delete: <stack-name> (y/n)?

Enter a value: y

```
