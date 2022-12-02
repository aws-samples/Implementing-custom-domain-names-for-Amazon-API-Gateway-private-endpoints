import path from 'path'
import * as yaml from 'js-yaml';
import { readFileSync, writeFileSync } from 'fs';
import extractDomain from "extract-domain";
import * as route53_sdk from "@aws-sdk/client-route-53";
import { proxyDomain } from './bin/Main';
import { parse } from 'ts-command-line-args'

type IArguments = {
    proxyFilePath: string
}


export const Run = async () =>
{
    const args = parse<IArguments>(
    {
        proxyFilePath: { type: String }
    } )

    const yamlOutput: any = yaml.load( readFileSync( path.join( args.proxyFilePath ), "utf8" ) ) 
    const proxyDomains: proxyDomain[] = yamlOutput?.APIS as proxyDomain[]    
    const publicZones: route53_sdk.HostedZone[] = await GetPublicZones()
    const domainsList = proxyDomains?.map( ( record ) =>
    {
        checkApiGatewayURLPattern(record.PRIVATE_API_URL)
        return {
            ...record,
            // TLD: extractDomain( record.CUSTOM_DOMAIN_URL, { tld: true } ),
            PUBLIC_ZONE_ID: GetZoneID( record.CUSTOM_DOMAIN_URL, publicZones )
        }

    } )
    if ( !domainsList )
    {
        throw new Error( 'At least one domain needs to be in proxy-config file to add SSL certificate to load balancer listener.' )
    }
    
    process.stdout.write(JSON.stringify(domainsList))

}


export const GetPublicZones = async (): Promise<route53_sdk.HostedZone[]> =>
{
    //TODO - Make sure to use access proper keys, or given profile
    //TODO - Iterate through next token to get all domains

    const client = new route53_sdk.Route53Client( {} );
    const data = await client.send( new route53_sdk.ListHostedZonesCommand( {} ) );
    const zones = data.HostedZones || [];
    const publicZones = zones.filter( ( zone ) =>
    {
        return ( zone?.Config?.PrivateZone === false )
    } )
    // console.log( `ZONES found ----------> ${ JSON.stringify( publicZones ) }` );

    return publicZones
}

const GetZoneID = function ( customDomain: string, publicZones: route53_sdk.HostedZone[] ): string
{
    const extractDm = extractDomain( customDomain, { tld: false } );
    // console.log( `extractDm--> ${ extractDm }` )
    let probableBaseDomain = ( customDomain === extractDm ? customDomain : customDomain.substring( customDomain.indexOf( "." ) + 1 ) )
    const tld = customDomain.substring( customDomain.lastIndexOf( "." ) + 1 )
    let zoneId
    while ( probableBaseDomain !== tld )
    {   // check domain exist
        // console.log( `Checking probableBaseDomain if exist-->  ${ probableBaseDomain }` )
        const zone = publicZones.find(
            ( zone ) => zone.Name === ( probableBaseDomain + "." )
        );
        // if exist then exit while
        if ( zone )
        {
            // console.log( `${ probableBaseDomain } exist, getting zone Id` )
            zoneId = zone.Id?.substring( zone.Id.lastIndexOf( "/" ) + 1 );
            break;
        }
        else
        {
            // console.log( `Public hosted zone ${ probableBaseDomain } not found.` )
            // else move to the next dot.
            probableBaseDomain = probableBaseDomain.substring( probableBaseDomain.indexOf( "." ) + 1 )
        }

    }

    // zone id is empty throw error
    if ( !zoneId )
    {
        throw `Public hosted zone for ${ customDomain } not found!!!`
    }

    return zoneId
}

function checkApiGatewayURLPattern(url:string) {    

    const pattern = /https:\/\/[a-z0-9]*.execute-api.(us(-gov)?|ap|ca|cn|eu|sa)-(central|(north|south)?(east|west)?)-\d.amazonaws.com\/[a-z0-9]/ig
    const reg =  new RegExp(pattern)
    if (!reg.test(url)){
        const msg = `privateApiProxy in file proxy-config.yaml with value ${url} does not follow a pattern https://<api-id>.execute-api.<region>.amazonaws.com/stage/`
        // console.log(`${msg}`);
        throw new Error(msg)
    }    
}


Run()
