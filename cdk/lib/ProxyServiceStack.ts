import { Construct } from 'constructs';
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { proxyDomain, elbTypeEnum } from '../bin/Main';
import { FargateServiceConstruct } from './FargateService';
import { NetworkingConstruct } from './Networking';
import { RoutingConstruct } from './Routing';
import { NagSuppressions } from 'cdk-nag';

type ProxyServiceStackProps = {
    proxyDomains: proxyDomain[];
    elbType: elbTypeEnum;
    createVpc: string;
    vpcCidr?: string;
    externalVpcId?: string;
    externalPrivateSubnetIds?: string;
    externalAlbSgId?: string;
    externalFargateSgId?: string;
    externalEndpointSgId?: string;
    taskImage: string;
    hasPublicSubnets: string;
    taskScaleMin: number;
    taskScaleMax: number;
    taskScaleCpuPercentage: number;
} & StackProps;

export class ProxyServiceStack extends Stack {
    constructor(scope: Construct, id: string, props: ProxyServiceStackProps) {
        super(scope, id, props);
        const stackName = `${Stack.of(this).stackName}`;
        props.elbType !== 'ALB' && props.elbType !== 'NLB'
            ? this._error(`ELB_TYPE should be ALB or NLB not ${props.elbType}`)
            : undefined;

        console.log(`Load Balancer Type-> ${props.elbType.toString()}`);

        const networkingObject = new NetworkingConstruct(this, `${stackName}-networking`, {
            CIDR: props.vpcCidr,
            elbType: props.elbType,
            hasPublicSubnets: props.hasPublicSubnets,
            createVpc: props.createVpc,
            externalVpcId: props.externalVpcId,
            externalAlbSgId: props.externalAlbSgId,
            externalFargateSgId: props.externalFargateSgId,
            externalEndpointSgId: props.externalEndpointSgId,
            externalPrivateSubnetIds: props.createVpc === 'false' ? props.externalPrivateSubnetIds : undefined,
        });

        const routingObject = new RoutingConstruct(this, `${stackName}-routing`, {
            vpc: networkingObject.vpc,
            elbType: props.elbType!,
            albSG: networkingObject.albSG,
            proxyDomains: props.proxyDomains,
            createVpc: props.createVpc,
            externalPrivateSubnetIds: props.createVpc === 'false' ? props.externalPrivateSubnetIds : undefined,
        });

        const fargateServiceConstructObj = new FargateServiceConstruct(this, `${stackName}-fargate-service`, {
            vpc: networkingObject.vpc,
            executeApiVpceId: networkingObject.apiGatewayVPCInterfaceEndpointId,
            elbType: props.elbType,
            targetGroup: routingObject.targetGroup,
            ecsPrivateSG: networkingObject.fgSG,
            proxyDomains: props.proxyDomains,
            taskImage: props.taskImage,
            taskScaleMin: props.taskScaleMin,
            taskScaleMax: props.taskScaleMax,
            taskScaleCpuPercentage: props.taskScaleCpuPercentage,
        });

        fargateServiceConstructObj.node.addDependency(networkingObject);

        new CfnOutput(this, 'vpc_id', { value: networkingObject.vpc.vpcId });
        new CfnOutput(this, 'elb_dns', { value: routingObject.elbDns });
        new CfnOutput(this, 'api_gateway_vpce_id', {
            value: networkingObject.apiGatewayVPCInterfaceEndpointId,
        });
        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'The task role requires the resource wildcard for functionality',
                    appliesTo: [
                        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                    ],
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The task role requires the resource wildcard for functionality',
                    appliesTo: [
                        'Resource::<reverseproxyDevfargateservicereverseproxyDevcrFninterfaceDNS898D1FFA.Arn>:*',
                    ],
                },
            ],
            true,
        );
    }
    _error(msg: string) {
        throw new Error(msg);
    }
}
