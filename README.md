# Implementing Custom Domain names with a Reverse Proxy for Amazon API Gateway Private Endpoints

[Amazon API Gateway](https://aws.amazon.com/api-gateway/) enables developers to create private REST APIs that can only be accessed from a [Virtual Private Cloud (VPC)](https://aws.amazon.com/vpc/). Traffic to the private API is transmitted over secure connections and stays within the AWS network, protecting it from the public internet. This makes private API Gateway endpoints suitable for publishing internal APIs, such as those used by microservices and data APIs.

In microservice architectures, teams often build and manage components in separate AWS accounts and prefer to access those private API endpoints using company-specific custom domain names. Custom domain names serve as an alias for a hostname and path to your API. This makes it easier for clients to connect using an easy-to-remember vanity URL and also maintains a stable URL in case the underlying API endpoint URL changes. Custom domain names can also improve the organization of APIs according to their functions within the enterprise. For example, the standard API Gateway URL format: "https<nolink>://api-id.execute-api.region.amazonaws.com/stage" can be transformed into "https</nolink>://api.private.example.com/myservice".

See this blog [post](https://aws.amazon.com/blogs/compute/implementing-custom-domain-names-for-amazon-api-gateway-private-endpoints-using-a-reverse-proxy/).

## Implementing Custom Domain names with a Reverse Proxy for Amazon API Gateway Private Endpoints
  - [Services Used](#services-used)
  - [Architecture](#architecture)
  - [Traffic Flow](#traffic-flow)
  - [Pre Deployment Steps](#pre-deployment-steps)
    - [Dependencies](#dependencies)
    - [Clone the Repository](#clone-the-repository)
    - [Proxy Configuration](#proxy-configuration)
      - [Example proxy-config.yaml file:](#example-proxy-configyaml-file)
    - [Deployment Variables](#deployment-variables)
      - [Example vars.yaml file](#example-varsyaml-file)
  - [Deployment Steps](#deployment-steps)
    - [AWS Cloud Development Kit (CDK)](#aws-cloud-development-kit-cdk)
    - [Terraform](#terraform)
      - [Networking Components](#networking-components)
      - [Rest of the Components](#rest-of-the-components)
    - [Add or Update Resource Policy for private endpoints](#add-or-update-resource-policy-for-private-endpoints)
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

![A diagram of the architecture solution Overview][def]

## Traffic Flow

1. A request to your API is made using a private custom domain from within a VPC or another device that is able to route to the VPC. For example, the request might be made using the domain https<nolink>://api.private.example.com.

1. An alias record in Amazon Route53 private hosted zone resolves to the fully qualified domain name of the private Elastic Load balancer (ELB). The ELB can be configured to be either a Network Load Balancer (NLB) or an Application Load Balancer (ALB).

1. The ELB uses an AWS Certificate Manager (ACM) certificate to terminate TLS (Transport Layer Security) for corresponding custom private domain.

1. The ELB listener redirects requests to an associated ELB target group, which in turn forwards the request to an Amazon Elastic Container Service task running on AWS Fargate.

1. The Fargate service uses a task based on NGINX which acts as a reverse proxy to the private API endpoint in one or more provider accounts. The Fargate service is configured to automatically scale using a metric that tracks CPU utilization.

1. The Fargate task appends the x-apigw-api-id header containing the target API ID to the request[^headersnote] , and forwards traffic to the appropriate private endpoints in provider Account B or Account C through a PrivateLink VPC Endpoint.

1. The API Gateway resource policy limits access to the private endpoint(s) based on a specific VPC endpoint, HTTP verb(s), and source domain used to request the API.

[^headersnote]: The solution will pass any additional information found in headers from upstream calls, such as authentication headers, content type headers, or custom data headers unmodified to private endpoints in provider accounts (Account B and Account C).

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

### Important Notes

- Automation is not supported for certificate validation when the Route 53 public-hosted zone is in another AWS account, the public-hosted zone is hosted by another registrar, SSL certificates are imported from external sources into ACM, or certificate validation is requested using an email.

- The solution requires presence of specific VPC Endpoints, namely execute-api, logs, ecr.dkr, ecr.api and s3 gateway in shared services account (Account A). If an option to create new VPC is chosen during solution deployment, the necessary endpoints will be automatically created. If an existing VPC is utilized for deployment, the solution will identify any missing endpoints and create them as required. Existing VPC must have DNS resolution enabled. Solution requires enabling Private DNS on logs, ecr.dkr, ecr.api. Enabling of Private DNS on the execute-api VPC endpoint is optional and will not impact the functionality of the solution.

### Clone the Repository

```bash
git clone https://github.com/aws-samples/Implementing-custom-domain-names-for-Amazon-API-Gateway-private-endpoints.git
```

### Proxy Configuration

This solution utilizes a YAML-based mapping file to add, update, or delete a mapping between a custom domain and a private API endpoint. During deployment, the automated infrastructure-as-code (IaC) script will parse the provided YAML file and
-	Create an NGINX configuration file
-	Apply the NGINX configuration file to the standard NGINX container image
-	The infrastructure-as-code script parses the mapping file and creates necessary Route53 private hosted zone(s) in Account A.
-	During the deployment process, wildcard-based SSL certificates (such as *.example.com) will be created in Account A. ACM will validate these certificates using its respective public hosted zone (such as example.com) and attach them to the ELB listener. By default, an ELB listener supports up to 25 SSL certificates. Wildcards are used to secure an unlimited number of subdomains, making it easier to manage and scale multiple sub-domains.


Create a yaml list describing the private apis. The default location for the proxy configuration file is _./config/proxy-config.yaml_.

<details><summary>Full description of proxy configuration values.</summary>

| Property              | Required | Example Values                                                                     | Description                                                                                                                                                                                         |
| --------------------- | -------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CUSTOM_DOMAIN_URL** | true     | api.private.example.com                     | Desired custom url for private api.                                                                                                                                                                 |
| **PRIVATE_API_URL**   | true     | https://_\<api-id\>_.execute-api._\<region\>_.amazonaws.com/_\<stage\>_/_\<path\>_ | Execution URL of targeted private API.                                                                                                                                                              |
| **VERBS**             | false    | [\"GET\"]<br>[\"GET\", \"DELETE\"]                                                 | Comma separated list of authorized [HTTP methods/verbs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-settings-method-request.html#setup-method-add-http-method). |

</details>

#### Example proxy-config.yaml file:

```yaml
---
APIS:
  - CUSTOM_DOMAIN_URL: api1.internal.private.example.com # URL to proxy access to the private API
    PRIVATE_API_URL: https://api-id1.execute-api.us-east-1.amazonaws.com/dev # Example AWS Account B with verbs
    VERBS: ["GET", "POST"]
  - CUSTOM_DOMAIN_URL: api2.private.example2.com # URL to proxy access to the private API
    PRIVATE_API_URL: https://api-id2.execute-api.us-east-1.amazonaws.com/dev/path1/path2 # Example AWS Account C
```

&nbsp;&nbsp;&nbsp;&nbsp;_Example template is available in repository at [./samples/proxy-config.yaml](samples/proxy-config.yaml)_

### Deployment Variables

Deployment has multiple options which are declared using a variables file. The default variables file is at _./config/vars.yaml_.

<details><summary>Full description and default values for variables.</summary>

| Variable                        | Type           | Default                    | Description                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **APP_ENVIRONMENT**             | String         | dev                        | Environment name, used for resource names and tagging (e.g., dev, prod)                                                                                                                                                                                                                                          |
| **APP_NAME**                    | String         | reverse-proxy              | Deployment application name, used for resource names and tagging (e.g., reverse-proxy)                                                                                                                                                                                                                           |
| **CREATE_VPC**                  | Boolean        | true                       | Should the deployment create a new VPC and all associated [networking components](#networking-components)?                                                                                                                                                                                                       |
| <a id="elb_type" />**ELB_TYPE**                    | String         | NLB                        | An Elastic Load Balancer is included in the deployment; which type of load balancer should be deployed (options: ALB or NLB)                                                                                                                                                                                     |
| **EXTERNAL_VPC_ID**             | String         | _null_                     | If you would prefer to use an existing VPC provide the VPC id here and set CREATE_VPC to false                                                                                                                                                                                                                   |
| **EXTERNAL_PRIVATE_SUBNETS_ID** | List of String | [ ]                        | List of existing private subnets in the vpc referenced in EXTERNAL*VPC_ID<br>\_Example: ["subnet-0123456789","subnet-0123456789"]*                                                                                                                                                                               |
| **EXTERNAL_ALB_SG_ID**  [link to sg table]()        | String         | _null_                     | If you would like to apply an existing security group to the load balancer instead of the solution creating one, provide the security group id                                                                                                                                                                   |
| **EXTERNAL_ENDPOINT_SG_ID** | String | _null_ | If you would like to apply an existing security group to the VPC endpoints instead of the solution creating one, provide the security group id |
| **EXTERNAL_FARGATE_SG_ID**      | String         | _null_                     | If you would like to apply an existing security group to the ECS cluster instead of the solution creating one, provide the security group id|
| **TASK_IMAGE**                  | String         | amazonlinux | Provide nginx container image reference.<br><details><summary>_Important Image Notes_</summary>_Images are sourced locally and pushed to an ECR repository for deployment. Private repository sources are permitted and will require you to configure your local docker environment's authentication._</details> |
| **TASK_IMAGE_TAG**              | String         | 2           | Image tag for nginx container image referenced in TASK_IMAGE                                                                                                                                                                                                                                                     |
| **PROXY_CONFIG_PATH**           | String         | ./config/proxy-config.yaml | Relative path to the proxy configuration file.
| **TASK_SCALE_CPU_PCT**          | Number         |     80                     | Metric used to scale fargate task- CPU utilization across all tasks in the service. Number between 0 and 100
| **TASK_SCALE_MIN**              | Number         |     1                      | Minimum capacity to scale Fargate task
| **TASK_SCALE_MAX**              | Number         |     4                      | Maximum capacity to scale Fargate task                                                                                                                                                                                                                                             |
| **PUBLIC_SUBNETS**              | Boolean        | false                      | If CREATE_VPC is true, should the new VPC have public subnets?                                                                                                                                                                                                                                                   |
| **VPC_CIDR**                    | String         | 10.0.0.0/16                | If CREATE_VPC is true, what CIDR block should the new VPC use.                                                                                                                                                                                                                                                   |

</details>

#### Example vars.yaml file

```yaml
---
VARIABLES:
  - CREATE_VPC: false
    APP_ENVIRONMENT: Dev
    APP_NAME: reverse-proxy
    ELB_TYPE: NLB
    VPC_CIDR: 10.0.0.0/16
    PUBLIC_SUBNETS: true
    EXTERNAL_VPC_ID: vpc-a1b2c3d4e5f6g7h8i
    EXTERNAL_PRIVATE_SUBNETS_ID: ["subnet-a1b2c3d4e5f6g7h8i", "subnet-a1b2c3d4e5f6g7h8j"]
    EXTERNAL_ALB_SG_ID: sg-a1b2c3d4e5f6g7h8i
    EXTERNAL_ENDPOINT_SG_ID: sg-a1b2c3d4e5f6g7h8i
    EXTERNAL_FARGATE_SG_ID: sg-a1b2c3d4e5f6g7h8i
    TASK_IMAGE: amazonlinux
    TASK_IMAGE_TAG: 2
    TASK_SCALE_CPU_PCT: 80 
    TASK_SCALE_MIN: 1
    TASK_SCALE_MAX: 2
    PROXY_CONFIG_PATH: ./config/proxy-config.yaml
```

&nbsp;&nbsp;&nbsp;&nbsp;_Example template is available in repository at [./samples/vars.yaml](samples/vars.yaml)_

## Deployment Steps

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

- VPC with given CIDR (DNS resolution enabled)
- Private and an optional Public Subnet in 2 Availability Zones
- Security groups for:
  - [Application Load Balancer](#alb_sg) (only when [ELB_TYPE](#elb_type) = ALB)
  - [Fargate Tasks](#fg_sg)
  - [VPC Endpoints](#vpce_sg)


#### Security Groups

| Security Group | Ingress/Egress | Source/Destination | Protocol | Port |
|:-:|:-:|:-:|:-:|:-:|
|<a id=alb_sg /> ALB[^alb] | Ingress | 0.0.0.0/0 | TCP | 443 |
| ALB[^alb] | Egress | Fargate Security Group | TCP | 443 |
| <a id=fg_sg />Fargate | Ingress | ELB Security Group **or** <br/>VIPC CIDR[^elb] | TCP | 443 |
| Fargate | Egress | VPC Endpoint Security Group | TCP | 443 |
| Fargate | Egress | [AWS Managed S3 Prefix List](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html) | TCP | 443 |
| <a id=vpce_sg />VPC Endpoint | Ingress | VPC CIDR | TCP | 443 |

[^elb]: If [ELB_TYPE](#elb_type) = ALB, traffic is only permitted from the ELB security group.  If [ELB_TYPE](#elb_type) = NLB, traffic must be permitted from the client CIDR or VPC CIDR[^nlb_sg].
[^alb]: Only deployed if [ELB_TYPE](#elb_type) = ALB
[^nlb_sg]: NLB's do not support security group association, sources for these ELB types must be an IP CIDR Block [reference](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-register-targets.html#target-security-groups).

#### Rest of the Components

- Respective Amazon Route53 private hosted zones, this is based on unique domains found in proxy-config.yaml file.
- An Application Load Balancer or Network Load balancer, in your given VPC private subnet.
- ACM certificates for SSL offloading on ELB (Elastic Load Balancer), this is based on domains found in proxy-config.yaml file.
  **Note**: This solution uses ACM to [validate ownership](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) of domain names that you specify in your configuration during the deployment. A Public hosted zone in Amazon Route53 needs to be present in the same AWS account for a base domain (i.e., example.com) for [DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html) to succeed with any private child domain(s) (e.g., api.private.example.com) used to request your private API endpoints. DNS-based validation allows Infrastructure-As-Code (IaC) deployment to automate certificate validation with the respective public base domain while deploying the solution. Further DNS-based validation also has the added advantage of automatically renewing the ACM certificate before expiry.
  Automation does not support certificate validation when Route 53 public-hosted zone is another AWS account; The public-hosted zone is hosted by another registrar, Email based certificate validation and importing of external SSL certificates in ACM.
- DNS of ELB would be added as alias record set in respective private Route53 private hosted zones.
- IaC application parses proxy-config.yaml file, and creates Nginx configuration file.
- IaC application builds a Docker image provided Nginx image, and uploads it to Amazon Elastic Container Repository.
- Auto scaled Fargate service, and downloads Nginx image (Hosting Nginx as a reverse proxy to private API gateway endpoints).

Note: Initial IaC application deployment could take roughly 10 - 15 minutes to deploy.

### Add or Update Resource Policy for private endpoints

Once the IaC execution is complete. Before private API(s) can be accessed, [You need to create or update an API resource policy referencing VPC Endpoint Id of API gateway interface endpoint](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-endpoint-policies.html#apigateway-vpc-endpoint-policies-examples). This grants access to the API(s) from your VPCs and VPC endpoints or from VPCs and VPC endpoints in other AWS accounts that you explicitly grant access. You need to deploy your API for the change to take effect on API. You can perform these updates using in multiple ways.

- Using API Gateway console, the AWS CLI, an AWS SDK for API Gateway or using your deployment pipelines.
- You can manually copy VPC Endpoint Id (Interface Endpoint of API Gateway) found in Account A  (Id can be found in generated outputs/outputs.json file) into the resource policy of the private API gateway in service accounts, and deploy respective private API using their deployment pipelines. Find API Gateway policy examples [here](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-endpoint-policies.html#apigateway-vpc-endpoint-policies-examples)
- You can copy API Gateway resource policy for a specific private API from your ./outputs/outputs.json file. Sample outputs file is available in repository at [./samples/outputs.json](/samples/outputs.json)  
- You can use provided sample script [update_api_resource_policy.sh](samples/update_api_resource_policy.sh) to update and deploy specific API resource policy as follows.

   ```bash
     export AWS_PROFILE=<your_account_B_profile>
     export AWS_REGION=<you_aws_region>
     export PRIVATE_API_ID=<private_api_id>
     export PRIVATE_API_STAGE_NAME=<private_api_stage_name>
     export OUTPUT_FILE_PATH=<output_file_path> # Optional, if not provided, checks for outputs.json file in outputs directory

     ./samples/update_api_resource_policy.sh --private_api_id $PRIVATE_API_ID  \   
                                      --private_api_stage_name $PRIVATE_API_STAGE_NAME \
                                      --aws_profile $AWS_PROFILE \
                                      --aws_region $AWS_REGION \
                                      --output_file_path $OUTPUT_FILE_PATH 
    
    ```

#### Update Mapping File

Whenever you want to add, update, or delete a mapping between your custom domain and private endpoint, you can update the mapping file and then rerun the deployment using the same steps as before. 
Deploying subsequent updates to the mapping file using the existing infrastructure-as-code pipeline reduces the risk of human error, adds traceability, prevents configuration drift, and allows the deployment process to follow your existing DevOps and governance processes in place.

#### Testing

You can test API request against private custom domain name. From a bastion host within the VPC or other device that can route to the VPC run following command,

```bash
curl -s -XGET <https://api.private.example.com/stage> | jq .

```

Response will include something like the following, this is a return response from the Lambda function behind the Private API in service account. Response includes some of the details captured from event object of the Lambda function.

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

# CDK

cd <cloned repository>
./exec.sh --tool cdk --action destroy

Are you sure you want to delete: <stack-name> (y/n)?

Enter a value: y

```

```bash
# Terraform

cd <cloned repository>
./exec.sh --tool terraform --action destroy

Do you really want to destroy all resources?

  Enter a value: yes
```


[def]: ./assets/overview.png "Solution Overview"
