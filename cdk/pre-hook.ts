import path from 'path'
import * as yaml from 'js-yaml';
import { readFileSync } from 'fs';
import extractDomain from "extract-domain";
import * as route53_sdk from "@aws-sdk/client-route-53";
import { proxyDomain } from './bin/Main';
import { parse } from 'ts-command-line-args'

type IArguments = {
    proxyFilePath: string
}
const Run = async () =>
{
    const args = parse<IArguments>(
        {
            proxyFilePath: { type: String }
        } )

    const yamlOutput: any = yaml.load( readFileSync( path.join( args.proxyFilePath ), "utf8" ) )
    const proxyDomains: proxyDomain[] = yamlOutput?.APIS as proxyDomain[]
    const publicZonesTotal: route53_sdk.HostedZone[] = await GetPublicZones()
    const domainsList = proxyDomains?.map( ( record ) =>
    {
        checkApiGatewayURLPattern( record.PRIVATE_API_URL, record.CUSTOM_DOMAIN_URL )
        return {
            ...record,
            PUBLIC_ZONE_ID: GetZoneID( record.CUSTOM_DOMAIN_URL, publicZonesTotal )
        }

    } )
    if ( !domainsList )
    {
        throw new Error( 'At least one domain needs to be in proxy-config file to add SSL certificate to load balancer listener.' )
    }

    process.stdout.write( JSON.stringify( domainsList ) )

}
const GetZoneID = function ( customDomain: string, publicZones: route53_sdk.HostedZone[] ): string
{
    let zoneId
    const extractDm = extractDomain( customDomain, { tld: false } );
    // console.log( `extractDm--> ${ extractDm }` )
    let probableBaseDomain = ( customDomain === extractDm ? customDomain : customDomain.substring( customDomain.indexOf( "." ) + 1 ) )
    const tld = customDomain.substring( customDomain.lastIndexOf( "." ) + 1 )
    while ( probableBaseDomain !== tld )
    {   // check domain exist            
        const zone = publicZones.find(
            ( zone ) => zone.Name === ( probableBaseDomain + "." )
        )
        // if exist then exit while
        if ( zone )
        {
            zoneId = zone?.Id?.substring( zone?.Id?.lastIndexOf( "/" ) + 1 )
            break;
        }
        else
        {
            // console.log( `Public hosted zone ${ probableBaseDomain } not found.` )
            // else traverse to the next dot.
            probableBaseDomain = probableBaseDomain.substring( probableBaseDomain.indexOf( "." ) + 1 )
        }

    }
    // zone id is empty throw error
    if ( !zoneId )
    {
        throw `Route53 public hosted zone for CUSTOM_DOMAIN_URL=${ customDomain } was not found in your AWS account!`
    }
    return zoneId
}

function checkApiGatewayURLPattern ( url: string, customDomain: string )
{

    const pattern = /https:\/\/[a-z0-9]*.execute-api.(us(-gov)?|ap|ca|cn|eu|sa)-(central|(north|south)?(east|west)?)-\d.amazonaws.com\/[a-z0-9]/ig
    const reg = new RegExp( pattern )
    if ( !reg.test( url ) )
    {
        const msg = `Supported pattern for PRIVATE_API_URL in proxy configuration file is https://<api-id>.execute-api.<region>.amazonaws.com/stage/ found value PRIVATE_API_URL=${ url }`
        // console.log(`${msg}`);
        throw new Error( msg )
    }
}

export const GetPublicZones = async (): Promise<route53_sdk.HostedZone[]> =>
{
    const paginator = route53_sdk.paginateListHostedZones( {
        client: new route53_sdk.Route53Client( {} ),
        pageSize: 100
    }, {} )

    let publicZonesTotal: route53_sdk.HostedZone[] = []
    for await ( const data of paginator )
    {
        const zones = data.HostedZones || [];
        const publicZones = zones.filter( ( zone ) =>
        {
            return ( zone?.Config?.PrivateZone === false )
        } )

        publicZonesTotal.push( ...publicZones );
    }
    return publicZonesTotal
}

( async function ()
{
    await Run()
} )().catch( e =>
{
    console.error( e )
    process.exit( 1 )
} )

