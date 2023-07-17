import * as Path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Effect } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';

import { elbTypeEnum } from '../bin/Main';

type NetworkingConstructProps = {
    CIDR?: string;
    elbType: elbTypeEnum;
    hasPublicSubnets: string;
    externalAlbSgId?: string;
    externalFargateSgId?: string;
    createVpc: string;
    externalEndpointSgId?: string;
    externalVpcId?: string;
    externalPrivateSubnetIds?: string;
};

export class NetworkingConstruct extends Construct {
    public readonly vpc: ec2.Vpc;
    public readonly privateSubnets: ec2.ISubnet[];
    public readonly albSG: ec2.SecurityGroup;
    public readonly fgSG: ec2.SecurityGroup;
    public readonly endpointSG: ec2.SecurityGroup;
    public readonly apiGatewayVPCInterfaceEndpointId: string;

    constructor(scope: Construct, id: string, props: NetworkingConstructProps) {
        super(scope, id);
        const stackName = cdk.Stack.of(this).stackName;

        if (props.createVpc.toLocaleLowerCase() === 'true') {
            console.log(`CREATE_VPC -> TRUE`);
            const subnets: ec2.SubnetConfiguration[] = [
                {
                    name: `${stackName}-private-subnet`,
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ];

            if (props.hasPublicSubnets.toLocaleLowerCase() === 'true')
                subnets.push({
                    name: `${stackName}-public-subnet`,
                    subnetType: ec2.SubnetType.PUBLIC,
                });

            this.vpc = new ec2.Vpc(this, `${stackName}-vpc`, {
                maxAzs: 2,
                subnetConfiguration: subnets,
                ipAddresses: props.CIDR ? ec2.IpAddresses.cidr(props.CIDR) : undefined,
            });

            const logGroup = new logs.LogGroup(this, 'MyCustomLogGroup');

            const role = new iam.Role(this, 'MyCustomRole', {
                assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
            });

            new ec2.FlowLog(this, 'FlowLog', {
                resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
                destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup, role),
            });

            this.privateSubnets = this.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }).subnets;
        } else {
            console.log(`CREATE_VPC -> FALSE`);
            const vpcId =
                props.externalVpcId ||
                this._error(
                    'EXTERNAL_VPC_ID value is required when CREATE_VPC is false. Check ReadMe.md for detailed instructions',
                );
            this.vpc = ec2.Vpc.fromLookup(this, `${stackName}-vpc`, {
                vpcId: vpcId as string,
            }) as ec2.Vpc;
        }

        // if create VPC = true, then create FGSG, if create VPC is false and external FGSG present then reuse, else create FGSG
        if (props.createVpc.toLocaleLowerCase() === 'true' || !props.externalFargateSgId) {
            this.fgSG = new ec2.SecurityGroup(this, `${stackName}-fargate-sg`, {
                vpc: this.vpc,
                description: 'Security Group attached to Fargate Task',
                allowAllOutbound: false,
            });
            cdk.Tags.of(this.fgSG).add('Name', 'fargate-sg');
            console.log(`Create Fargate SG`);

            const prefixListsRole = new iam.Role(this, 'prefixListsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                inlinePolicies: {
                    prefixListsPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: [
                                    'ec2:DescribePrefixLists',
                                    'ec2:DescribeMangedPrefixLists',
                                    'ec2:GetManagedPrefixListEntries',
                                ],
                                resources: [
                                    // eslint-disable-next-line prettier/prettier
                                    `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${
                                        cdk.Stack.of(this).account
                                    }:prefix-list/*`,
                                    // eslint-disable-next-line prettier/prettier
                                    `arn:${cdk.Stack.of(this).partition}:ec2:${
                                        cdk.Stack.of(this).region
                                    }:aws:prefix-list/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                                resources: ['*'],
                            }),
                        ],
                    }),
                },
            });

            // Get S3 Gateway Endpoint Prefix Lists from Custom Resource
            const prefixLists = new cr.AwsCustomResource(this, `${stackName}-prefixLists`, {
                onCreate: {
                    service: 'EC2',
                    action: 'describePrefixLists',
                    parameters: {
                        Filters: [
                            {
                                Name: 'prefix-list-name',
                                Values: [`com.amazonaws.${cdk.Stack.of(this).region}.s3`],
                            },
                        ],
                    },
                    physicalResourceId: {},
                },
                onUpdate: {
                    service: 'EC2',
                    action: 'describePrefixLists',
                    parameters: {
                        Filters: [
                            {
                                Name: 'prefix-list-name',
                                Values: [`com.amazonaws.${cdk.Stack.of(this).region}.s3`],
                            },
                        ],
                    },
                    physicalResourceId: {},
                },
                role: prefixListsRole,
                logRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
            });

            this.fgSG.addEgressRule(
                ec2.Peer.prefixList(prefixLists.getResponseField('PrefixLists.0.PrefixListId')),
                ec2.Port.tcp(443),
                'Allow 443 traffic only from local CIDR',
            );

            this.fgSG.node.addDependency(prefixLists);
        } else {
            this.fgSG = ec2.SecurityGroup.fromLookupById(
                this,
                `${stackName}-fg-sg`,
                props.externalFargateSgId,
            ) as ec2.SecurityGroup;

            console.log(`Found external Fargate SG`);
        }
        //ALB SG
        if (props.elbType === elbTypeEnum.ALB) {
            //ALB
            if (props.createVpc.toLocaleLowerCase() === 'true' || !props.externalAlbSgId) {
                // SG connected to Alb
                this.albSG = new ec2.SecurityGroup(this, `${stackName}-alb-sg`, {
                    vpc: this.vpc,
                    description: 'Security Group attached to ALB',
                    allowAllOutbound: false,
                });
                cdk.Tags.of(this.albSG).add('Name', 'alb-sg');

                //only allow traffic current VPC Cidr block
                this.albSG.addIngressRule(
                    ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
                    ec2.Port.tcp(443),
                    'Allow 443 traffic only from local CIDR',
                );

                this.albSG.connections.allowTo(
                    new ec2.Connections({
                        securityGroups: [this.fgSG],
                    }),
                    ec2.Port.tcp(80),
                );

                this.fgSG.connections.allowFrom(
                    new ec2.Connections({
                        securityGroups: [this.albSG],
                    }),
                    ec2.Port.tcp(80),
                );

                console.log(`Create ALB SG`);
            } else {
                this.albSG = ec2.SecurityGroup.fromLookupById(
                    this,
                    `${stackName}-alb-sg`,
                    props.externalAlbSgId,
                ) as ec2.SecurityGroup;

                console.log(`Found external ALB SG`);
            }
        } else {
            //NLB
            if (props.createVpc.toLocaleLowerCase() === 'true') {
                //Egress / Ingress rules for security group
                this.privateSubnets.forEach((subnet) => {
                    this.fgSG.addIngressRule(
                        ec2.Peer.ipv4(subnet.ipv4CidrBlock),
                        ec2.Port.tcp(80),
                        'Allow ingress traffic from private subnets CIDR, where network load balancer is hosted to reach Fargate service',
                    );
                });
            }
        }

        //Endpoint SG
        if (props.createVpc.toLocaleLowerCase() === 'true' || !props.externalEndpointSgId) {
            this.endpointSG = new ec2.SecurityGroup(this, `${stackName}-interface-endpoint-sg`, {
                vpc: this.vpc,
                description: 'Security group attached to interface endpoints',
                allowAllOutbound: false,
            });

            cdk.Tags.of(this.endpointSG).add('Name', 'interface-endpoint-sg');

            this.fgSG.connections.allowTo(
                new ec2.Connections({
                    securityGroups: [this.endpointSG],
                }),
                ec2.Port.tcp(443),
            );

            console.log(`Create Endpoint SG`);
        } else {
            this.endpointSG = ec2.SecurityGroup.fromLookupById(
                this,
                `${stackName}-interface-endpoint-sg`,
                props.externalEndpointSgId,
            ) as ec2.SecurityGroup;

            console.log(`Found external Endpoint SG`);
        }

        if (props.createVpc.toLocaleLowerCase() === 'true') {
            // Create Interface Endpoint for Api Gateway
            const apiGatewayVPCInterfaceEndpoint = new ec2.InterfaceVpcEndpoint(
                this,
                `${stackName}-api-gateway-interface-endpoint`,
                {
                    vpc: this.vpc,
                    service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY, // new ec2.InterfaceVpcEndpointService( `com.amazonaws.${ Stack.of( this ).region }.execute-api` ),
                    securityGroups: [
                        this.endpointSG,
                        // defaultSG
                    ],
                    privateDnsEnabled: false, //Private DNS is not required for API Gateway, we will pass header of api id as required to call the api
                },
            );

            // Create Interface Endpoint for Logs Gateway
            new ec2.InterfaceVpcEndpoint(this, `${stackName}-logs-interface-endpoint`, {
                vpc: this.vpc,
                service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
                securityGroups: [
                    this.endpointSG,
                    // defaultSG
                ],
                privateDnsEnabled: true,
            });

            // Create Interface Endpoint for -ecr-api-
            new ec2.InterfaceVpcEndpoint(this, `${stackName}-ecr-api-interface-endpoint`, {
                vpc: this.vpc,
                service: ec2.InterfaceVpcEndpointAwsService.ECR,
                securityGroups: [
                    this.endpointSG,
                    // defaultSG
                ],
                privateDnsEnabled: true,
            });

            // Create Interface Endpoint for ecr-dkr
            new ec2.InterfaceVpcEndpoint(this, `${stackName}-ecr-dkr-interface-endpoint`, {
                vpc: this.vpc,
                service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
                securityGroups: [
                    this.endpointSG,
                    // defaultSG
                ],
                privateDnsEnabled: true,
            });

            // Create Interface Endpoint for S3
            new ec2.GatewayVpcEndpoint(this, `${stackName}-s3-gateway-endpoint`, {
                vpc: this.vpc,
                service: ec2.GatewayVpcEndpointAwsService.S3,
            });

            this.apiGatewayVPCInterfaceEndpointId = apiGatewayVPCInterfaceEndpoint.vpcEndpointId;
        } else {
            let extPrivateSubnetIds: string;
            if (props.externalPrivateSubnetIds && (JSON.parse(props.externalPrivateSubnetIds) as string[]).length > 0) {
                extPrivateSubnetIds = props.externalPrivateSubnetIds;
            } else {
                //get all private subnets
                extPrivateSubnetIds = JSON.stringify(
                    this.vpc.privateSubnets.map((subnet) => {
                        return subnet.subnetId;
                    }),
                );
            }
            console.log(`extPrivateSubnetIds--->${extPrivateSubnetIds}`);

            const customResourceLambdaRole = new iam.Role(this, `${stackName}-CustomResource-Role`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                description:
                    'Role that the custom resource uses to run the lambda function and get vpc endpoint information',
                inlinePolicies: {
                    'lambda-inline-policy': new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: Effect.ALLOW,
                                actions: [
                                    'logs:CreateLogGroup',
                                    'logs:CreateLogStream',
                                    'logs:PutLogEvents',
                                    'ec2:DescribeVpcEndpoints',
                                    'ec2:CreateVpcEndpoint',
                                    'ec2:DeleteVpcEndpoints',
                                    'ec2:UpdateVpcEndpoint',
                                    'ec2:DescribeRouteTables',
                                ],
                                resources: ['*'],
                            }),
                        ],
                    }),
                },
            });

            const customResourceLambda = new NodejsFunction(this, `${stackName}-CustomResource-Fn`, {
                entry: Path.join(__dirname, 'CRExistResourceCheck.ts'),
                functionName: `${stackName}-cr-get-vpc-endpoints`,
                role: customResourceLambdaRole,
                timeout: Duration.minutes(5),
                runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
                bundling: {
                    externalModules: ['@aws-sdk/client-ec2'],
                },
            });

            new logs.LogGroup(this, `${stackName}-CustomResource-LogGroup`, {
                logGroupName: `/aws/lambda/${customResourceLambda.functionName}`,
                retention: RetentionDays.FIVE_DAYS,
            });

            // create an iam role for the lambda function
            const customResourceProviderRole = new iam.Role(this, `${stackName}-customResourceProvider-role`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                description: 'Role that the custom resource uses to run the lambda function',
                inlinePolicies: {
                    'lambda-inline-policy': new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: Effect.ALLOW,
                                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                                resources: ['*'],
                            }),
                        ],
                    }),
                },
            });

            // Create a custom resource provider which wraps around the lambda above
            const customResourceProvider = new cr.Provider(this, `${stackName}-CRProvider`, {
                onEventHandler: customResourceLambda,
                logRetention: RetentionDays.FIVE_DAYS,
                role: customResourceProviderRole,
                // totalTimeout: Duration.minutes(5),
            });

            const objCustomResource = new cdk.CustomResource(this, `CustomResourceCreateVPCEndpoints`, {
                resourceType: 'Custom::CheckAPIGatewayVPCEndpoint',
                serviceToken: customResourceProvider.serviceToken,
                properties: {
                    vpcId: props.externalVpcId,
                    externalPrivateSubnetIds: extPrivateSubnetIds,
                    Dummy: 1,
                    ExternalFargateSg: this.fgSG.securityGroupId,
                    ExternalEndpointSg: this.endpointSG.securityGroupId,
                },
            });
            this.apiGatewayVPCInterfaceEndpointId = objCustomResource.getAtt('executeAPIVpcEndpointId').toString();
        }
        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The lambda function requires the resource wildcard for functionality',
                    appliesTo: [
                        // eslint-disable-next-line prettier/prettier
                        `Resource::arn:<AWS::Partition>:ec2:${cdk.Stack.of(this).region}:${
                            cdk.Stack.of(this).account
                        }:prefix-list/*`,
                        `Resource::arn:<AWS::Partition>:ec2:${cdk.Stack.of(this).region}:aws:prefix-list/*`,
                        'Action::ec2:DescribePrefixLists',
                        'Action::ec2:DescribeMangedPrefixLists',
                        'Action::ec2:GetManagedPrefixListEntries',
                    ],
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The lambda function requires the resource wildcard for functionality',
                    appliesTo: [
                        'Action::logs:CreateLogGroup',
                        'Action::logs:CreateLogStream',
                        'Action::logs:PutLogEvents',
                        'Resource::*',
                    ],
                },
                {
                    id: 'CdkNagValidationFailure',
                    reason: 'Rendered template references intrisic function',
                },
                // {
                //     id: 'AwsSolutions-IAM5',
                //     reason: 'The custom resource wrappers create a lambda function that requires the resource wildcard for the listed actions to set log retention.',
                //     appliesTo: [
                //         'Action::logs:DeleteRetentionPolicy',
                //         'Action::logs:CreateLogStream',
                //         'Action::logs:PutLogEvents',
                //         'Action::logs:CreateLogGroup',
                //         'Action::logs:PutRetentionPolicy',
                //         'Resource::*',
                //     ],
                // },
            ],
            true,
        );
    }
    _error(msg: string) {
        throw new Error(msg);
    }
}
