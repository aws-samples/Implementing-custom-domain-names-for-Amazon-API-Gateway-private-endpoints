import { elbTypeEnum } from '../bin/Main';
import * as Path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture } from 'aws-cdk-lib/aws-lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

import { ApplicationTargetGroup, NetworkTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { proxyDomain } from '../bin/Main';
import { GenerateNginxConfig } from './Utils';
import { NagSuppressions } from 'cdk-nag';

type FargateProps = {
    vpc: ec2.Vpc;
    executeApiVpceId: string;
    ecsPrivateSG: ec2.SecurityGroup;
    targetGroup: NetworkTargetGroup | ApplicationTargetGroup;
    elbType: elbTypeEnum | void;
    proxyDomains: proxyDomain[];
    taskImage: string;
    taskScaleMin: number;
    taskScaleMax: number;
    taskScaleCpuPercentage: number;
};

export class FargateServiceConstruct extends Construct {
    constructor(scope: Construct, id: string, props: FargateProps) {
        super(scope, id);
        const stackName = cdk.Stack.of(this).stackName;

        // cluster to deploy resources to
        const cluster = new ecs.Cluster(this, `${stackName}-cluster`, {
            vpc: props.vpc,
            containerInsights: true,
        });

        // the role assumed by the task and its containers
        const taskRole = new iam.Role(this, `${stackName}-task-role`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Role that the api task definitions use to run the api code',
        });

        taskRole.attachInlinePolicy(
            new iam.Policy(this, `${stackName}-task-policy`, {
                statements: [
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: [
                            'ecr:GetAuthorizationToken',
                            'ecr:BatchCheckLayerAvailability',
                            'ecr:GetDownloadUrlForLayer',
                            'ecr:BatchGetImage',
                            'logs:CreateLogStream',
                            'logs:PutLogEvents',
                        ],
                        resources: ['*'],
                        conditions: {
                            StringEquals: {
                                'aws:sourceVpc': props.vpc.vpcId,
                            },
                        },
                    }),
                ],
            }),
        );

        const taskDefinition = new ecs.FargateTaskDefinition(this, `${stackName}-task`, {
            cpu: 512,
            memoryLimitMiB: 1024,
            taskRole: taskRole,
            executionRole: taskRole,
            runtimePlatform: {
                cpuArchitecture: ecs.CpuArchitecture.ARM64,
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            },
        });

        const customResourceLambda = new NodejsFunction(this, `${stackName}-crFn-interfaceDNS`, {
            entry: Path.join(__dirname, 'CRGetVPCEndpointDNS.ts'),
            functionName: `${stackName}-cr-get-vpc-endpoints-dns`,
            architecture: Architecture.ARM_64,
            runtime: Runtime.NODEJS_18_X,
            initialPolicy: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['ec2:DescribeVpcEndpoints'],
                    resources: ['*'],
                }),
            ],

            bundling: {
                externalModules: ['@aws-sdk/client-ec2'],
            },
            timeout: cdk.Duration.minutes(5),
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
        const customResourceProvider = new cr.Provider(this, `${stackName}-CRProvider-interfaceDNS`, {
            onEventHandler: customResourceLambda,
            logRetention: logs.RetentionDays.FIVE_DAYS,
            role: customResourceProviderRole,
        });

        // Create a new custom resource consumer
        const objCustomResource = new cdk.CustomResource(this, 'CustomResourceGetVPCEndpointsDns', {
            resourceType: 'Custom::CheckAPIGatewayVPCEndpointDns',
            serviceToken: customResourceProvider.serviceToken,
            properties: {
                VpcId: props.vpc.vpcId,
                Dummy: 0,
            },
        });

        const apiGatewayVPCInterfaceEndpointDNSName = objCustomResource.getAtt('Result').toString();

        // The docker container including the image to use
        const fgContainer = new ecs.ContainerDefinition(this, `${stackName}-container-def`, {
            taskDefinition: taskDefinition,
            memoryLimitMiB: 1024,
            image: ecs.ContainerImage.fromAsset('./image', {
                buildArgs: {
                    IMAGE: props.taskImage,
                    PLATFORM: 'linux/arm64',
                },
            }),
            portMappings: [{ containerPort: 80 }],
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: `${stackName}-fargate-service`,
                logRetention: logs.RetentionDays.ONE_MONTH,
            }),
            environment: {
                NGINX_CONFIG: btoa(GenerateNginxConfig(props.proxyDomains)), //base 64 encoded Nginx config file
                API_GATEWAY_VPC_DNS: apiGatewayVPCInterfaceEndpointDNSName,
            },
            healthCheck: {
                command: ['CMD-SHELL', 'curl http://localhost || exit 1'],
            },
        });

        fgContainer.node.addDependency(objCustomResource);

        // The ECS Service used for deploying tasks
        const service = new ecs.FargateService(this, `${stackName}-fargate-service`, {
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            cluster: cluster,
            desiredCount: 1,
            taskDefinition: taskDefinition,
            securityGroups: [props.ecsPrivateSG],
            circuitBreaker: {
                rollback: true,
            },
        });

        if (props.elbType === elbTypeEnum.NLB) {
            service.attachToNetworkTargetGroup(props.targetGroup as NetworkTargetGroup);
        } else {
            service.attachToApplicationTargetGroup(props.targetGroup as ApplicationTargetGroup);
        }

        const scalableTaskCountObject = service.autoScaleTaskCount({
            minCapacity: props.taskScaleMin,
            maxCapacity: props.taskScaleMax,
        });

        scalableTaskCountObject.scaleOnCpuUtilization(id, {
            targetUtilizationPercent: props.taskScaleCpuPercentage,
        });

        NagSuppressions.addResourceSuppressionsByPath(
            cdk.Stack.of(this),
            `${customResourceProviderRole.node.path}/DefaultPolicy/Resource`,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The custom resource wrappers create a lambda function that requires the resource wildcard for the listed actions to set log retention.',
                },
            ],
        ),
            NagSuppressions.addResourceSuppressions(
                this,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'The custom resource wrappers create a lambda function that requires the resource wildcard for the listed actions to set log retention.',
                        appliesTo: [
                            'Action::logs:DeleteRetentionPolicy',
                            'Action::logs:CreateLogStream',
                            'Action::logs:PutLogEvents',
                            'Action::logs:CreateLogGroup',
                            'Action::logs:PutRetentionPolicy',
                            'Resource::*',
                        ],
                    },
                    {
                        id: 'AwsSolutions-ECS2',
                        reason: 'No sensitive data is stored in the example environment variables, users can migrate data to secrets if needed',
                    },
                ],
                true,
            );
    }
}
