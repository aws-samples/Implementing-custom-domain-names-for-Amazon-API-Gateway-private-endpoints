#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';
import extractDomain from 'extract-domain';
import { readFileSync, writeFileSync } from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';

import { ProxyServiceStack } from '../lib/ProxyServiceStack';

export type proxyDomain = {
  // TLD: string,
  CUSTOM_DOMAIN_URL: string,
  PRIVATE_API_URL: string,
  PRIVATE_ZONE_ID?: string,
  PRIVATE_ZONE?: any
  ROUTE53_PUBLIC_DOMAIN?: string,
  VERBS?: string[],
  PUBLIC_ZONE_ID?: string,
  CERT_DOMAIN?:string
}
export enum elbTypeEnum
{
  ALB = 'ALB',
  NLB = 'NLB'
}
const environment: string = process.env.APP_ENVIRONMENT || 'dev'
const appName: string = process.env.APP_NAME || 'ReverseProxy'
// const proxyDomains_str: string =  process.env.PROXY_DOMAINS!
const proxyDomains: proxyDomain[] = JSON.parse( process.env.PROXY_DOMAINS! ) as proxyDomain[]
const elbType: elbTypeEnum = ( process.env.ELB_TYPE || 'NLB' ) as elbTypeEnum
const createVpc: string = process.env.CREATE_VPC || 'true'
const vpcCidr: string = process.env.VPC_CIDR || '10.0.64.0/20'
const externalVpcId: string = process.env.EXTERNAL_VPC_ID || ''
const externalPrivateSubnetIds: string = process.env.EXTERNAL_PRIVATE_SUBNETS_ID || ''
const externalAlbSgId: string = process.env.EXTERNAL_ALB_SG_ID || ''
const externalFargateSgId: string = process.env.EXTERNAL_FARGATE_SG_ID || ''
const taskImage: string = ( process.env.TASK_IMAGE || 'public.ecr.aws/nginx/nginx' ) + ":" + ( process.env.TASK_IMAGE_TAG || '1.23-alpine-perl' )
const hasPublicSubnets: string = process.env.PUBLIC_SUBNETS || 'false'



const Main = () =>
{
  
  const app = new cdk.App();
  console.table(proxyDomains)
  const mainStack = new ProxyServiceStack( app, `${ appName }-${ environment }`, {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    proxyDomains: proxyDomains,
    elbType: elbType,
    create_vpc: createVpc,
    vpc_cidr: vpcCidr,
    base64EncodedNginxConf: btoa( GenerateNginxConfig( proxyDomains ) ), //base 64 encoded Nginx config file 
    externalVpcId,
    externalPrivateSubnetIds,
    externalAlbSgId,
    externalFargateSgId,
    taskImage,
    hasPublicSubnets
  } );


  cdk.Tags.of( mainStack ).add( 'App', appName );
  cdk.Tags.of( mainStack ).add( 'Environment', environment );

}

const GetDomains = ( sourceYamlPath: string ): proxyDomain[] =>
{
  const yamlOutput: any = yaml.load( readFileSync( sourceYamlPath, "utf8" ) )
  const proxyDomains: proxyDomain[] = yamlOutput?.APIS as proxyDomain[]
  const domainsList = proxyDomains?.map( ( record ) =>
  {
    checkApiGatewayURLPattern( record.PRIVATE_API_URL )
    return {
      ...record,
      CUSTOM_DOMAIN_URL: record.CUSTOM_DOMAIN_URL.replace( 'https://', '' ),
      //ROUTE53_PUBLIC_DOMAIN provided by application then use that as a top level domain
      TLD: record.ROUTE53_PUBLIC_DOMAIN ? extractDomain( record.ROUTE53_PUBLIC_DOMAIN, { tld: false } ) : extractDomain( record.CUSTOM_DOMAIN_URL, { tld: false } )
    }

  } )
  if ( !domainsList )
  {
    throw new Error( 'At least one domain needs to be in proxy-config file to add SSL certificate to load balancer listener.' )
  }


  // console.log( `############## Domain Mapping #################` );
  // console.table( domainsList );
  // console.log( `##############################################` );

  return domainsList
}

function checkApiGatewayURLPattern ( url: string )
{

  const pattern = /https:\/\/[a-z0-9]*.execute-api.(us(-gov)?|ap|ca|cn|eu|sa)-(central|(north|south)?(east|west)?)-\d.amazonaws.com\/[a-z0-9]/ig
  const reg = new RegExp( pattern )
  if ( !reg.test( url ) )
  {
    const msg = `PRIVATE_API_URL in file proxy-config.yaml with value ${ url } does not follow a pattern https://<api-id>.execute-api.<region>.amazonaws.com/stage/`
    // console.log(`${msg}`);
    throw new Error( msg )
  }
}

export const GenerateNginxConfig = ( domainsList: proxyDomain[] ): string =>
{

  let conf_file_str = `user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log info;
pid        /var/run/nginx.pid;


events {
    worker_connections  1024;
}


http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    server_names_hash_bucket_size 128;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    #tcp_nopush     on;

    keepalive_timeout  65;

    #gzip  on;
    server {
      listen 80 default_server;      
      location / {
        return 200 '<html><body>Private API URL not implemented.</body></html>';
        add_header Content-Type text/html;
      }        
    }
    `
  domainsList.forEach( ( record ) =>
  {
    const conf_file_item = `
    server {
      listen 80;            
      server_name ${ record.CUSTOM_DOMAIN_URL };
      location / {
          proxy_set_header X-Upstream-Domain  $server_name;
          proxy_set_header Referer  $server_name;
          set $apiUrl ${ record.PRIVATE_API_URL };
          proxy_pass ${ record.PRIVATE_API_URL };
      }
    }
`

    conf_file_str = conf_file_str + conf_file_item
  } )
  conf_file_str = conf_file_str + "}"
  // console.log(conf_file_str)
  return conf_file_str

}

Main()

