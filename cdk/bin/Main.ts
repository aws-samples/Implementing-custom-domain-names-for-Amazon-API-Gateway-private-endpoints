#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ProxyServiceStack } from '../lib/ProxyServiceStack';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { AwsSolutionsChecks } from 'cdk-nag';

export type proxyDomain = {
    // TLD: string,
    CUSTOM_DOMAIN_URL: string;
    PRIVATE_API_URL: string;
    PRIVATE_ZONE_ID?: string;
    PRIVATE_ZONE: IHostedZone;
    ROUTE53_PUBLIC_DOMAIN?: string;
    VERBS?: string[];
    PUBLIC_ZONE_ID?: string;
    CERT_DOMAIN?: string;
};
export enum elbTypeEnum {
    ALB = 'ALB',
    NLB = 'NLB',
}
const environment: string = process.env.APP_ENVIRONMENT || 'dev';
const appName: string = process.env.APP_NAME || 'ReverseProxy';
const proxyDomains: proxyDomain[] = JSON.parse(process.env.PROXY_DOMAINS!) as proxyDomain[];
const elbType: elbTypeEnum = (process.env.ELB_TYPE || 'NLB') as elbTypeEnum;
const createVpc: string = process.env.CREATE_VPC || 'true';
const vpcCidr: string = process.env.VPC_CIDR || '10.0.64.0/20';
const externalVpcId: string = process.env.EXTERNAL_VPC_ID || '';
const externalPrivateSubnetIds: string = process.env.EXTERNAL_PRIVATE_SUBNETS_ID || '';
const externalAlbSgId: string = process.env.EXTERNAL_ALB_SG_ID || '';
const externalFargateSgId: string = process.env.EXTERNAL_FARGATE_SG_ID || '';
const externalEndpointSgId: string = process.env.EXTERNAL_ENDPOINT_SG_ID || '';
const taskImage: string =
    (process.env.TASK_IMAGE || 'public.ecr.aws/nginx/nginx') + ':' + (process.env.TASK_IMAGE_TAG || '1.23-alpine-perl');
const hasPublicSubnets: string = process.env.PUBLIC_SUBNETS || 'false';
const taskScaleMin: number = Number(process.env.TASK_SCALE_MIN || '1');
const taskScaleMax: number = Number(process.env.TASK_SCALE_CPU || '4');
const taskScaleCpuPercentage: number = Number(process.env.TASK_SCALE_MAX || '80');

const Main = () => {
    const app = new cdk.App();
    cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
    console.table(proxyDomains, [
        'CUSTOM_DOMAIN_URL',
        'PRIVATE_API_URL',
        'VERBS',
        // "PUBLIC_ZONE_ID",
    ]);

    const mainStack = new ProxyServiceStack(app, `${appName}-${environment}`, {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
        proxyDomains: proxyDomains,
        elbType: elbType,
        createVpc,
        vpcCidr,
        externalVpcId,
        externalPrivateSubnetIds,
        externalAlbSgId,
        externalFargateSgId,
        externalEndpointSgId,
        taskImage,
        hasPublicSubnets,
        taskScaleMin,
        taskScaleMax,
        taskScaleCpuPercentage,
    });

    cdk.Tags.of(mainStack).add('App', appName);
    cdk.Tags.of(mainStack).add('Environment', environment);
};

Main();
