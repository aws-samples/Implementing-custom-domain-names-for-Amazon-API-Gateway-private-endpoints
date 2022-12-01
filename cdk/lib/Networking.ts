import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs'
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as cr from 'aws-cdk-lib/custom-resources'

import { elbTypeEnum } from '../bin/Main'


type NetworkingConstructProps = {
    CIDR: string,
    elbType: elbTypeEnum,
    hasPublicSubnets: string,
    externalAlbSgId?: string,
    externalFargateSgId?: string,    
}

export class NetworkingConstruct extends Construct
{
    public readonly vpc: ec2.Vpc
    public readonly privateSubnets: ec2.ISubnet[]
    public readonly albSG: ec2.SecurityGroup
    public readonly fgSG: ec2.SecurityGroup
    public readonly apiGatewayVPCInterfaceEndpoint: ec2.InterfaceVpcEndpoint


    constructor ( scope: Construct, id: string, props: NetworkingConstructProps )
    {
        super( scope, id );
        const stackName = cdk.Stack.of( this ).stackName

        let vpc: ec2.Vpc  

        let subnets: ec2.SubnetConfiguration[] = [ {
            name: `${ stackName }-private-subnet`,
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        } ]

        if (props.hasPublicSubnets.toLocaleLowerCase() === "true")
          subnets.push({
            name: `${stackName}-public-subnet`,
            subnetType: ec2.SubnetType.PUBLIC,
          });
        // console.log(`, ${props.hasPublicSubnets}, subnets--->${JSON.stringify(subnets,null,2)} `);    

        vpc = new ec2.Vpc( this, `${ stackName }-vpc`, {
            maxAzs: 2,
            // cidr: props.CIDR,
            subnetConfiguration: subnets,
            ipAddresses: ec2.IpAddresses.cidr(props.CIDR)
        } );


        this.privateSubnets = vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_ISOLATED } ).subnets;

        const defaultSG = ec2.SecurityGroup.fromSecurityGroupId( this, `${ stackName }-default-sg`, vpc.vpcDefaultSecurityGroup )

        // SG connected to Fargate Service
        this.fgSG = new ec2.SecurityGroup( this, `${ stackName }-security-group-fg`, {
            vpc: vpc,
            description: 'Security Group attached to Fargate Task',
            allowAllOutbound: false,            
        } )
        cdk.Tags.of( this.fgSG ).add( 'Name', 'fargate-sg' );

        if ( props.elbType === elbTypeEnum.ALB )
        {
            // SG connected to Alb
            this.albSG = new ec2.SecurityGroup( this, `${ stackName }-security-group-alb`, {
                vpc: vpc,
                description: 'Security Group attached to ALB',
                allowAllOutbound: false,
                      
            } )

            cdk.Tags.of( this.albSG ).add( 'Name', 'alb-sg' );

            //only allow traffic current VPC Cidr block
            this.albSG.addIngressRule(
                ec2.Peer.ipv4( vpc.vpcCidrBlock ),
                ec2.Port.tcp( 443 ),
                'Allow 443 traffic only from local CIDR'
            )

            this.albSG.connections.allowTo( new ec2.Connections( {
                securityGroups: [ this.fgSG ]
            } ), ec2.Port.tcp( 80 ) )

            this.fgSG.connections.allowFrom( new ec2.Connections( {
                securityGroups: [ this.albSG ]
            } ), ec2.Port.tcp( 80 ) )

        }
        else
        {
            //Egress / Ingress rules for security group
            this.privateSubnets.forEach( ( subnet ) =>
            {
                this.fgSG.addIngressRule( ec2.Peer.ipv4( subnet.ipv4CidrBlock ), ec2.Port.tcp( 80 ), 'Allow ingress traffic from private subnets CIDR, where network load balancer is hosted to reach Fargate service' )
            } )

        }

        // Get S3 Gateway Endpoint Prefix Lists from Custom Resource
        const prefixLists = new cr.AwsCustomResource( this, `${ stackName }-prefixLists`, {
            onCreate: {
                service: 'EC2',
                action: 'describePrefixLists',
                parameters: {
                    Filters: [
                        {
                            Name: 'prefix-list-name',
                            Values: [ `com.amazonaws.${ cdk.Stack.of( this ).region }.s3` ],
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
                            Values: [ `com.amazonaws.${ cdk.Stack.of( this ).region }.s3` ],
                        },
                    ],
                },
                physicalResourceId: {},
            },
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls( { resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE } ),
            logRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
        } );

        this.fgSG.addEgressRule(
            ec2.Peer.prefixList( prefixLists.getResponseField('PrefixLists.0.PrefixListId') ),
            ec2.Port.tcp( 443 ),
            'Allow 443 traffic only from local CIDR'
        )
        
        this.fgSG.node.addDependency(prefixLists)

        const endpointSG = new ec2.SecurityGroup( this, `${ stackName }-security-group-endpoint`, {
            vpc: vpc,
            description: 'Security group attached to interface endpoints',
            allowAllOutbound: false,            
        } )
        cdk.Tags.of( endpointSG ).add( 'Name', 'interface-endpoint-sg' );

        endpointSG.addIngressRule(
            ec2.Peer.ipv4( vpc.vpcCidrBlock ),
            ec2.Port.tcp( 443 ),
            'Allow 443 traffic only from local CIDR'
        )

        this.fgSG.connections.allowTo( new ec2.Connections( {
            securityGroups: [ endpointSG ]
        } ), ec2.Port.tcp( 443 ) )



        // Create Interface Endpoint for Api Gateway
        this.apiGatewayVPCInterfaceEndpoint = new ec2.InterfaceVpcEndpoint( this, `${ stackName }-api-gateway-interface-endpoint`, {
            vpc: vpc,
            service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY, // new ec2.InterfaceVpcEndpointService( `com.amazonaws.${ Stack.of( this ).region }.execute-api` ),            
            securityGroups: [ endpointSG, defaultSG ]
        } );

        // Create Interface Endpoint for Logs Gateway
        new ec2.InterfaceVpcEndpoint( this, `${ stackName }-logs-interface-endpoint`, {
            vpc: vpc,
            service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, // new ec2.InterfaceVpcEndpointService( `com.amazonaws.${ Stack.of( this ).region }.logs`),            
            securityGroups: [ endpointSG, defaultSG ]
        } );

        // Create Interface Endpoint for -ecr-api-
        new ec2.InterfaceVpcEndpoint( this, `${ stackName }-ecr-api-interface-endpoint`, {
            vpc: vpc,
            service: ec2.InterfaceVpcEndpointAwsService.ECR, //new ec2.InterfaceVpcEndpointService( `com.amazonaws.${ Stack.of( this ).region }.ecr.api`),            
            securityGroups: [ endpointSG, defaultSG ]
        } );

        // Create Interface Endpoint for ecr-dkr
        const ecrDkrVPCInterfaceEndpoint = new ec2.InterfaceVpcEndpoint( this, `${ stackName }-ecr-dkr-interface-endpoint`, {
            vpc: vpc,
            service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER, //  new ec2.InterfaceVpcEndpointService( `com.amazonaws.${ Stack.of( this ).region }.ecr.dkr`),            
            securityGroups: [ endpointSG, defaultSG ]
        } );

        // Create Interface Endpoint for S3        
        const s3Gateway = new ec2.GatewayVpcEndpoint( this, `${ stackName }-s3-gateway-endpoint`, {
            vpc: vpc,
            service: ec2.GatewayVpcEndpointAwsService.S3,// new ec2.GatewayVpcEndpointAwsService(`com.amazonaws.${ Stack.of( this ).region }.s3`),                        
        } );

        // // endpoints for ecs exec
        // new ec2.InterfaceVpcEndpoint( this, `${ stackName }-ssm-interface-endpoint`, {
        //     vpc: vpc,
        //     service: ec2.InterfaceVpcEndpointAwsService.SSM,            
        //     securityGroups: [ defaultSG ]
        // } );

        // new ec2.InterfaceVpcEndpoint( this, `${ stackName }-ssm-messages-interface-endpoint`, {
        //     vpc: vpc,
        //     service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,            
        //     securityGroups: [ defaultSG ]
        // } );

        // new ec2.InterfaceVpcEndpoint( this, `${ stackName }-ec2-messages-interface-endpoint`, {
        //     vpc: vpc,
        //     service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,            
        //     securityGroups: [ defaultSG ]
        // } );

        this.vpc = vpc

    }
}
