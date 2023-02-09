import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { proxyDomain, elbTypeEnum, } from '../bin/Main';
import { FargateServiceConstruct } from './FargateService';
import { NetworkingConstruct } from './Networking';
import { RoutingConstruct } from './Routing';


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
        let objCustomResource
        
        props.elbType !== 'ALB' && props.elbType !== 'NLB'
            ? this._error( `ELB_TYPE should be ALB or NLB not ${ props.elbType }` )
            : undefined;
        
        console.log( `Load Balancer Type-> ${ props.elbType.toString() }` );

        const networkingObject = new NetworkingConstruct(
            this,
            `${ stackName }-networking`,
            {
                CIDR: props.vpcCidr,
                elbType: props.elbType,
                hasPublicSubnets: props.hasPublicSubnets,
                createVpc: props.createVpc,
                externalVpcId: props.externalVpcId,
                externalAlbSgId: props.externalAlbSgId,
                externalFargateSgId: props.externalFargateSgId,
                externalEndpointSgId:props.externalEndpointSgId,
                externalPrivateSubnetIds: props.createVpc === "false" ? 
                                                (props.externalPrivateSubnetIds ? props.externalPrivateSubnetIds : 
                                                    this._error("List of EXTERNAL_PRIVATE_SUBNETS_ID are required in format [\"subnet-a1b2c3d4e5f6g7h8i\", \"subnet-a1b2c3d4e5f6g7h8j\"], when CREATE_VPC is false. Check ReadMe.md for detailed instructions.")) 
                                                    : undefined
            }
        );

        const routingObject = new RoutingConstruct( this, `${ stackName }-routing`, {
            vpc: networkingObject.vpc,
            elbType: props.elbType!,
            albSG: albSg,
            proxyDomains: props.proxyDomains,
            createVpc: props.createVpc,
            externalPrivateSubnetIds: props.createVpc === "false" ? 
            (props.externalPrivateSubnetIds ? props.externalPrivateSubnetIds : 
                this._error("List of EXTERNAL_PRIVATE_SUBNETS_ID are required in format [\"subnet-a1b2c3d4e5f6g7h8i\", \"subnet-a1b2c3d4e5f6g7h8j\"], when CREATE_VPC is false. Check ReadMe.md for detailed instructions.")) 
                : undefined
        } )

        const fargateServiceConstructObj = new FargateServiceConstruct( this, `${ stackName }-fargate-service`, {
            vpc: networkingObject.vpc,
            executeApiVpceId: networkingObject.apiGatewayVPCInterfaceEndpointId,
            elbType: props.elbType!,
            targetGroup: routingObject.targetGroup,
            ecsPrivateSG: networkingObject.fgSG,
            proxyDomains: props.proxyDomains,
            taskImage: props.taskImage,
            taskScaleMin: props.taskScaleMin,
            taskScaleMax: props.taskScaleMax,
            taskScaleCpuPercentage: props.taskScaleCpuPercentage,
        } )
        
        new CfnOutput( this, 'vpc_id', { value: networkingObject.vpc.vpcId } )
        new CfnOutput( this, 'elb-dns', { value: routingObject.elbDns } )
        new CfnOutput( this, 'api_gateway_vpce_id', { value: networkingObject.apiGatewayVPCInterfaceEndpointId } )

    }
    _error ( msg: string )
    {
        throw new Error( msg );
        return ''
    }

}
