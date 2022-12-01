import { elbTypeEnum } from '../bin/Main'

import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as logs from 'aws-cdk-lib/aws-logs';

import { ApplicationTargetGroup, NetworkTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2'


type FargateProps = {
    vpc: ec2.Vpc,
    ecsPrivateSG: ec2.SecurityGroup,
    targetGroup: NetworkTargetGroup | ApplicationTargetGroup
    elbType: elbTypeEnum | void,
    base64EncodedNginxConf: string,
    taskImage: string
}

export class FargateServiceConstruct extends Construct
{
    constructor ( scope: Construct, id: string, props: FargateProps )
    {
        super( scope, id )
        const stackName = cdk.Stack.of( this ).stackName

        //Create pull through cache rule 
        // const cfnPullThroughCacheRule = new ecr.CfnPullThroughCacheRule( this, `${ stackName }-rule`, {
        //     ecrRepositoryPrefix: `ecr-public-1`,
        //     upstreamRegistryUrl: 'public.ecr.aws',
        // } );

        // cluster to deploy resources to
        const cluster = new ecs.Cluster( this, `${ stackName }-cluster`, {
            vpc: props.vpc,
        } )

        // the role assumed by the task and its containers
        const taskRole = new iam.Role( this, `${ stackName }-task-role`, {
            assumedBy: new iam.ServicePrincipal( "ecs-tasks.amazonaws.com" ),
            //roleName: "task-role",
            description: "Role that the api task definitions use to run the api code",
        } )

        taskRole.attachInlinePolicy(
            new iam.Policy( this, `${ stackName }-task-policy`, {
                statements: [                    
                    new iam.PolicyStatement( {
                        effect: iam.Effect.ALLOW,
                        actions: [
                            "ecr:GetAuthorizationToken",
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:BatchGetImage",
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        ],
                        resources: [ "*" ],
                        conditions: {
                            "StringEquals": {
                                "aws:sourceVpc": props.vpc.vpcId
                            }
                        }
                    } )                    
                ],
            } )
        )

        // const oneTimeTask = new ecs.FargateTaskDefinition( this, `${ stackName }-one-time-task`, {
        //     cpu: 256,
        //     memoryLimitMiB: 512,
        //     taskRole: taskRole,
        //     executionRole: taskRole,
        // } )


        // oneTimeTask.addContainer( id, {
        //     image: ecs.ContainerImage.fromRegistry( `${ cdk.Aws.ACCOUNT_ID }.dkr.ecr.${ cdk.Aws.REGION }.amazonaws.com/ecr-public-1/nginx/nginx:1.23-alpine-perl` ),
        //     logging: ecs.LogDriver.awsLogs( {
        //         streamPrefix: `${ stackName }-fargate-one-time-task`,
        //         logRetention: logs.RetentionDays.ONE_MONTH,
        //     } ),

        // } )

        // // deploy and run this task once
        // const runTaskAtOnce = new run_task.RunTask( this, `${ stackName }-RunTaskOnce`, {
        //     task: oneTimeTask,
        //     runAtOnce: true,
        //     cluster: cluster,
        //     vpc: props.vpc,
        //     vpcSubnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     },
        //     runOnResourceUpdate: true
        // } );

        const taskDefinition = new ecs.FargateTaskDefinition(
            this,
            `${ stackName }-task`,
            {
                cpu: 256,
                taskRole: taskRole,
                executionRole: taskRole,                
            }
        )       

        // The docker container including the image to use        
        const fgContainer = new ecs.ContainerDefinition(
          this,
          `${stackName}-container-def`,
          {
            taskDefinition: taskDefinition,
            memoryLimitMiB: 512,
            // image: ecs.ContainerImage.fromRegistry(
            //   "public.ecr.aws/nginx/nginx:1.23-alpine-perl",              
            //   {                
            //     credentials: cdk.aws_secretsmanager.Secret.fromSecretNameV2(this, 'id', 'secretName') 
            //   }
            // ),
            // image: ecs.ContainerImage.fromRegistry(`${cdk.Aws.ACCOUNT_ID}.dkr.ecr.${cdk.Aws.REGION}.amazonaws.com/ecr-public-1/nginx/nginx:1.23-alpine-perl` ),
            image: ecs.ContainerImage.fromAsset("./image", {
              buildArgs: {
                TASK_IMAGE: props.taskImage,
              },
              platform: ecr_assets.Platform.LINUX_AMD64,
            }),
            portMappings: [{ containerPort: 80 }],
            logging: ecs.LogDriver.awsLogs({
              streamPrefix: `${stackName}-fargate-service`,
              logRetention: logs.RetentionDays.ONE_MONTH,
            }),
            environment: {
              NGINX_CONFIG: props.base64EncodedNginxConf,
            },
            entryPoint: [
              "/bin/sh",
              "-c",
              "echo $NGINX_CONFIG | base64 -d > /etc/nginx/nginx.conf && nginx && tail -f /dev/null",
            ],
          }
        );



        // The ECS Service used for deploying tasks 
        const service = new ecs.FargateService( this, `${ stackName }-fargate-service`, {
            // enableExecuteCommand: true,
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            cluster: cluster,
            desiredCount: 1,
            taskDefinition: taskDefinition,
            securityGroups: [ props.ecsPrivateSG ],
            circuitBreaker: {
                rollback: true               
            }
        } )

        //  service.attachToApplicationTargetGroup( props.albTG )
        if ( props.elbType === elbTypeEnum.NLB )
        {
            service.attachToNetworkTargetGroup( props.targetGroup as NetworkTargetGroup )
        } else
        {
            service.attachToApplicationTargetGroup( props.targetGroup as ApplicationTargetGroup )
        }


        const scalableTaskCountObject = service.autoScaleTaskCount( {
            maxCapacity: 4,
            minCapacity: 1
        } )

        // Scale in or out based on request received
        // scalableTaskCountObject.scaleOnRequestCount( `${ stackName }-scaleonrequestcount`, {
        //     requestsPerTarget: 100,
        //     targetGroup: props.albTG
        // } )

        scalableTaskCountObject.scaleOnCpuUtilization( id, {
            targetUtilizationPercent: 80
        } )
    }
}
