import * as Path from 'path'
import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources'
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { proxyDomain, elbTypeEnum, } from '../bin/Main';
import { FargateServiceConstruct } from './FargateService';
import { NetworkingConstruct } from './Networking';
import { RoutingConstruct } from './Routing';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'

type ProxyServiceStackProps = {
    proxyDomains: proxyDomain[],
    elbType: elbTypeEnum,
    createVpc: string,
    vpcCidr?: string,
    externalVpcId?: string
    externalPrivateSubnetIds?: string
    externalAlbSgId?: string
    externalFargateSgId?: string,
    externalEndpointSgId?: string,
    taskImage: string,
    hasPublicSubnets: string,
    taskScaleMin: number,
    taskScaleMax: number,
    taskScaleCpuPercentage: number
} & StackProps

export class ProxyServiceStack extends Stack
{
    constructor ( scope: Construct, id: string, props: ProxyServiceStackProps )
    {
        super( scope, id, props );
        const stackName = `${ Stack.of( this ).stackName }`
        let vpc: ec2.Vpc
        let fgSg: ec2.SecurityGroup
        let albSg: ec2.SecurityGroup | undefined
        let apiGatewayVPCInterfaceEndpointId: string = ''
        let objCustomResource

        // if ( props.elbType === 'ALB' || props.elbType === 'NLB' ) { } else
        // {
        //     this._error(
        //         `ELB_TYPE should be ALB or NLB not ${ props.elbType }`
        //     );
        // }

        props.elbType !== 'ALB' && props.elbType !== 'NLB'
            ? this._error( `ELB_TYPE should be ALB or NLB not ${ props.elbType }` )
            : undefined;

        if ( props.createVpc.toLocaleLowerCase() === "true" )
        {

            console.log( `Create Vpc -> TRUE` );
            const cidr = props.vpcCidr!;
            const networkingObject = new NetworkingConstruct(
                this,
                `${ stackName }-networking`,
                {
                    CIDR: cidr,
                    elbType: props.elbType,
                    hasPublicSubnets: props.hasPublicSubnets,
                }
            );
            vpc = networkingObject.vpc;
            albSg = networkingObject.albSG;
            fgSg = networkingObject.fgSG;

            apiGatewayVPCInterfaceEndpointId = networkingObject.apiGatewayVPCInterfaceEndpoint.vpcEndpointId;

        } else
        {
            console.log( `CREATE_VPC -> FALSE` );
            const vpcId =
                props.externalVpcId ||
                this._error( "EXTERNAL_VPC_ID value is required when CREATE_VPC is false. Check ReadMe.md for detailed instructions" );
            const fgSgId =
                props.externalFargateSgId ||
                this._error(
                    "Fargate Security Group ID EXTERNAL_FARGATE_SG_ID value is required when CREATE_VPC is false. Check ReadMe.md for detailed instructions, and Inbound and Outbound security group rules."
                );
            const albSgId: string =
                props.externalAlbSgId ||
                this._error(
                    "Application load balancer Security Group EXTERNAL_ALB_SG_ID value is required when CREATE_VPC is false and Load Balancer is ALB. Check ReadMe.md for detailed instructions, and Inbound and Outbound security group rules."
                );

            vpc = ec2.Vpc.fromLookup( this, `${ stackName }-vpc`, {
                vpcId: vpcId!,
            } ) as ec2.Vpc;

            fgSg = ec2.SecurityGroup.fromLookupById(
                this,
                `${ stackName }-fg-sg-lookup`,
                fgSgId!
            ) as ec2.SecurityGroup;

            albSg =
                props.elbType === elbTypeEnum.ALB
                    ? ( ec2.SecurityGroup.fromLookupById(
                        this,
                        `${ stackName }-alb-sg-lookup`,
                        albSgId!
                    ) as ec2.SecurityGroup )
                    : undefined;



            const customResourceLambda = new NodejsFunction(
                this,
                `${ stackName }-CustomResource-Fn`,
                {
                    entry: Path.join( __dirname, "CRExistResourceCheck.ts" ),
                    functionName: `${ stackName }-cr-get-vpc-endpoints`,
                    runtime: lambda.Runtime.NODEJS_18_X,
                    timeout: Duration.minutes( 5 ),
                    bundling: {
                        externalModules: [ "@aws-sdk/client-ec2" ],
                    },
                }
            );

            const lambdaPolicy = new PolicyStatement( {
                effect: Effect.ALLOW,
                actions: [
                    "ec2:DescribeVpcEndpoints",
                    "ec2:CreateVpcEndpoint",
                    "ec2:DeleteVpcEndpoints",
                    "ec2:UpdateVpcEndpoint",
                    "ec2:DescribeRouteTables"
                ],
                resources: [ "*" ],
            } );

            customResourceLambda.addToRolePolicy( lambdaPolicy );

            // Create a custom resource provider which wraps around the lambda above
            const customResourceProvider = new cr.Provider(
                this,
                `${ stackName }-CRProvider`,
                {
                    onEventHandler: customResourceLambda,
                    logRetention: logs.RetentionDays.FIVE_DAYS,
                    // totalTimeout: Duration.minutes(5),

                }
            );



            objCustomResource = new cdk.CustomResource(
                this,
                `CustomResourceCreateVPCEndpoints`,
                {
                    resourceType: "Custom::CheckAPIGatewayVPCEndpoint",
                    serviceToken: customResourceProvider.serviceToken,
                    properties: {
                        vpcId: props.externalVpcId,
                        externalPrivateSubnetIds: props.externalPrivateSubnetIds ||
                            this._error(
                                "List of EXTERNAL_PRIVATE_SUBNETS_ID are required in format [\"subnet-010101010101\", \"subnet-202020202021\"], when CREATE_VPC is false. Check ReadMe.md for detailed instructions."
                            ),
                        Dummy: 0,
                        ExternalFargateSg: fgSgId,
                        ExternalEndpointSg: props.externalEndpointSgId ||
                            this._error(
                                "EXTERNAL_ENDPOINT_SG_ID value is required when CREATE_VPC is false. Check ReadMe.md for detailed instructions, and Inbound and Outbound security group rules." )
                    },

                }
            )            
            apiGatewayVPCInterfaceEndpointId = objCustomResource.getAtt( 'executeAPIVpcEndpointId' ).toString();
        }

        console.log( `Load Balancer Type-> ${ props.elbType.toString() }` );
        const routingObject = new RoutingConstruct( this, `${ stackName }-routing`, {
            vpc: vpc,
            elbType: props.elbType!,
            albSG: albSg,
            proxyDomains: props.proxyDomains,
            createVpc: props.createVpc,
            externalPrivateSubnetIds: props.createVpc === "false" ? props.externalPrivateSubnetIds : undefined
        } )

        

        const FargateServiceConstructObj = new FargateServiceConstruct( this, `${ stackName }-fargate-service`, {
            vpc: vpc,
            executeApiVpceId: apiGatewayVPCInterfaceEndpointId,
            elbType: props.elbType!,
            targetGroup: routingObject.targetGroup,
            ecsPrivateSG: fgSg,
            proxyDomains: props.proxyDomains,
            taskImage: props.taskImage,
            taskScaleMin: props.taskScaleMin,
            taskScaleMax: props.taskScaleMax,
            taskScaleCpuPercentage: props.taskScaleCpuPercentage,
        } )

        if(props.createVpc.toLocaleLowerCase() === "false" && objCustomResource ){

            FargateServiceConstructObj.node.addDependency(objCustomResource)
        }

        new CfnOutput( this, 'vpc_id', { value: vpc.vpcId } )
        new CfnOutput( this, 'elb-dns', { value: routingObject.elbDns } )
        new CfnOutput( this, 'api_gateway_vpce_id', { value: apiGatewayVPCInterfaceEndpointId } )

    }
    _error ( msg: string )
    {
        throw new Error( msg );
        return ''
    }

}
