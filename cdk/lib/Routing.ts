import { Stack } from 'aws-cdk-lib';
import * as aws_cert from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as alb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as aws_route53 from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { proxyDomain, elbTypeEnum } from '../bin/Main';
import { NagSuppressions } from 'cdk-nag';

type RoutingProps = {
    vpc: ec2.Vpc;
    albSG?: ec2.SecurityGroup;
    elbType: elbTypeEnum | void;
    proxyDomains: proxyDomain[];
    externalPrivateSubnetIds?: string;
    createVpc: string;
};
export class RoutingConstruct extends Construct {
    public readonly targetGroup: alb.ApplicationTargetGroup | alb.NetworkTargetGroup;
    public readonly elbDns: string;

    constructor(scope: Construct, id: string, props: RoutingProps) {
        super(scope, id);
        const stackName = Stack.of(this).stackName;

        let domainsList: proxyDomain[] = props.proxyDomains;

        let subnetsObj;
        if (props.createVpc.toLocaleLowerCase() === 'false') {
            //get subnets in cdk from subnet ids
            const subnetIds: string[] = props.externalPrivateSubnetIds
                ? JSON.parse(props.externalPrivateSubnetIds)
                : undefined;
            if (subnetIds && subnetIds.length > 0) {
                subnetsObj = subnetIds?.map((subnet: string) => {
                    return ec2.Subnet.fromSubnetId(this, `${stackName}-${subnet}`, subnet);
                });
            } else {
                subnetsObj = props.vpc.privateSubnets;
            }
        }

        // Create Private Route 53 Zones
        domainsList = domainsList.map((domain) => {
            const zone: aws_route53.IPrivateHostedZone = new aws_route53.PrivateHostedZone(
                this,
                `hosted-zone-${domain.CUSTOM_DOMAIN_URL}`,
                {
                    vpc: props.vpc,
                    zoneName: domain.CUSTOM_DOMAIN_URL,
                },
            );

            return {
                ...domain,
                PRIVATE_ZONE_ID: zone.hostedZoneId,
                PRIVATE_ZONE: zone,
                CERT_DOMAIN: `${domain.CUSTOM_DOMAIN_URL.substring(domain.CUSTOM_DOMAIN_URL.indexOf('.') + 1)}`,
            };
        });

        const uniqueCertWithPublicZones: {
            KEY: string;
            CERT_DOMAIN: string;
            PUBLIC_ZONE_ID: string;
        }[] = [];

        domainsList.forEach((element) => {
            const isDuplicate = uniqueCertWithPublicZones.filter(
                (predicate) => predicate.KEY === `${element.CERT_DOMAIN}_${element.PUBLIC_ZONE_ID}`,
            );
            // console.log( `isDuplicate --> ${ isDuplicate } ` );
            if (isDuplicate.length === 0) {
                uniqueCertWithPublicZones.push({
                    KEY: `${element.CERT_DOMAIN}_${element.PUBLIC_ZONE_ID}`,
                    CERT_DOMAIN: element.CERT_DOMAIN!,
                    PUBLIC_ZONE_ID: element.PUBLIC_ZONE_ID!,
                });
            }
        });

        // Create wild card certificates and add them to ELB listener
        const certs: aws_cert.Certificate[] = uniqueCertWithPublicZones.map((crt) => {
            // SSL certificate for the domain
            const cert = new aws_cert.Certificate(this, `${stackName}-certificate-${crt.CERT_DOMAIN}`, {
                domainName: `*.${crt.CERT_DOMAIN}`,
                validation: aws_cert.CertificateValidation.fromDns(
                    aws_route53.PublicHostedZone.fromHostedZoneId(
                        this,
                        `public-hosted-zone-look-${crt.CERT_DOMAIN}`,
                        `${crt.PUBLIC_ZONE_ID}`,
                    ),
                ),
            });

            return cert as aws_cert.Certificate;
        });

        if (props.elbType === elbTypeEnum.NLB) {
            // Network load balancer
            const networkLoadBalancer = new alb.NetworkLoadBalancer(this, `${stackName}-nlb`, {
                vpc: props.vpc,
                vpcSubnets: {
                    onePerAz: true,
                    subnetType:
                        props.createVpc.toLocaleLowerCase() === 'true' ? ec2.SubnetType.PRIVATE_ISOLATED : undefined,
                    subnets: props.createVpc.toLocaleLowerCase() === 'false' ? subnetsObj : undefined,
                },
                internetFacing: false,
                crossZoneEnabled: true,
            });

            const networkTargetGroupHttps = new alb.NetworkTargetGroup(this, `${stackName}-nlb-target-group`, {
                port: 80,
                vpc: props.vpc,
                protocol: alb.Protocol.TCP,
                targetType: alb.TargetType.IP,
                healthCheck: {
                    interval: cdk.Duration.seconds(10),
                },
            });
            networkTargetGroupHttps.configureHealthCheck({
                path: '/',
                protocol: alb.Protocol.HTTP,
            });
            const nlbListener = networkLoadBalancer.addListener(`${stackName}-nlb-listener`, {
                protocol: alb.Protocol.TLS,
                port: 443,
                certificates: [...certs],
            });

            nlbListener.addTargetGroups(`${stackName}-nlb-listener-target-group`, networkTargetGroupHttps);

            domainsList.forEach((record) => {
                // previously created route 53 hosted zone
                // const zone = record.PRIVATE_ZONE

                new aws_route53.ARecord(this, `${stackName}-a-record-nlb-${record.CUSTOM_DOMAIN_URL}`, {
                    zone: record.PRIVATE_ZONE,
                    target: aws_route53.RecordTarget.fromAlias(new LoadBalancerTarget(networkLoadBalancer)),
                    recordName: record.CUSTOM_DOMAIN_URL,
                    deleteExisting: true,
                });
            });

            this.targetGroup = networkTargetGroupHttps;
            this.elbDns = `dualstack.${networkLoadBalancer.loadBalancerDnsName}`;
        } else {
            // Application load balancer
            const loadBalancer = new alb.ApplicationLoadBalancer(this, `${stackName}-alb`, {
                vpc: props.vpc,
                vpcSubnets: {
                    onePerAz: true,
                    subnetType:
                        props.createVpc.toLocaleLowerCase() === 'true' ? ec2.SubnetType.PRIVATE_ISOLATED : undefined,
                    subnets: props.createVpc.toLocaleLowerCase() === 'false' ? subnetsObj : undefined,
                },
                securityGroup: props.albSG,
                internetFacing: false,
            });

            // Target group to make resources containers discoverable by the application load balancer
            const targetGroupHttps = new alb.ApplicationTargetGroup(this, `${stackName}-alb-target-group`, {
                port: 80,
                vpc: props.vpc,
                protocol: alb.ApplicationProtocol.HTTP,
                targetType: alb.TargetType.IP,
            });

            // Health check for containers to check they were deployed correctly
            targetGroupHttps.configureHealthCheck({
                path: '/',
                protocol: alb.Protocol.HTTP,
                interval: cdk.Duration.seconds(5),
                timeout: cdk.Duration.seconds(2),
            });

            // only allow HTTPS connections
            const listener = loadBalancer.addListener(`${stackName}-alb-listener`, {
                open: false,
                port: 443,
                certificates: [...certs],
            });

            listener.addTargetGroups(`${stackName}-alb-listener-target-group`, {
                targetGroups: [targetGroupHttps],
            });

            domainsList.forEach((record) => {
                // previously created route 53 hosted zone
                // const zone = record.PRIVATE_ZONE

                new aws_route53.ARecord(this, `${stackName}-a-record-alb-${record.CUSTOM_DOMAIN_URL}`, {
                    zone: record.PRIVATE_ZONE,
                    target: aws_route53.RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
                    comment: `Alias to ALB`,
                    recordName: record.CUSTOM_DOMAIN_URL,
                    deleteExisting: true,
                });
            });

            this.targetGroup = targetGroupHttps;
            this.elbDns = `dualstack.${loadBalancer.loadBalancerDnsName}`;
        }
        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-ELB2',
                    reason: 'This is designed to be a minimal solution, logging would add complexity and resources.  Users can enable access logging if required.',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'The task role requires the resource wildcard for functionality',
                    appliesTo: [
                        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                    ],
                },

            ],
            true,
        );
    }
}
