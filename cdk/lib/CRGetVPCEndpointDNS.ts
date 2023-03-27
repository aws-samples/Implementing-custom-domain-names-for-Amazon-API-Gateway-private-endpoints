import * as ec2 from '@aws-sdk/client-ec2'
import { CloudFormationCustomResourceCreateEvent, CloudFormationCustomResourceEvent, CloudFormationCustomResourceUpdateEvent, CloudFormationCustomResourceDeleteEvent } from 'aws-lambda'

const region = process.env.AWS_REGION;
const client = new ec2.EC2Client( {} )
export const handler = async ( event: CloudFormationCustomResourceEvent ) =>
{
  let apiGatewayVpcDNSName: string | undefined = ''
  console.log( "event", event )

  try
  {
    const {
      RequestType,
      ResourceProperties: { VpcId },
    } = event;


    if ( ( RequestType === 'Create' ) || ( RequestType === 'Update' ) )
    {

      const command = new ec2.DescribeVpcEndpointsCommand( {
        Filters: [
          {
            Name: 'service-name',
            Values: [ `com.amazonaws.${ region }.execute-api` ]
          },
          {
            Name: 'vpc-id',
            Values: [ VpcId ]
          }
        ],
      } )

      const vpcEndpointsObj: ec2.DescribeVpcEndpointsCommandOutput = await client.send( command )
      let timer = 0;
      while ( typeof vpcEndpointsObj === 'undefined' || 
              typeof vpcEndpointsObj.VpcEndpoints === 'undefined' || 
              typeof vpcEndpointsObj.VpcEndpoints[ 0 ] === 'undefined' || 
              typeof vpcEndpointsObj.VpcEndpoints[ 0 ].DnsEntries === 'undefined' || 
              typeof vpcEndpointsObj.VpcEndpoints[ 0 ].DnsEntries[ 0 ] === 'undefined' || 
              typeof vpcEndpointsObj.VpcEndpoints[ 0 ].DnsEntries[ 0 ].DnsName === 'undefined' )
      {
        if ( timer >= 300 )
        {
          console.error( 'The required object values were not found within 300 seconds.' );
          break;
        }
        timer++;
        console.log( 'Waiting for object values...' );
        await new Promise( resolve => setTimeout( resolve, 10000 ) );
      }

      if ( vpcEndpointsObj?.VpcEndpoints && vpcEndpointsObj.VpcEndpoints[ 0 ]?.DnsEntries && vpcEndpointsObj.VpcEndpoints[ 0 ].DnsEntries[ 0 ]?.DnsName )
      {
        apiGatewayVpcDNSName = vpcEndpointsObj.VpcEndpoints[ 0 ].DnsEntries[ 0 ].DnsName;
        console.log( 'API Gateway VPC DNS name:', apiGatewayVpcDNSName );
      } else
      {
        console.error( 'API Gateway VPC DNS name, The required object values were not found within 300 seconds.' );
      }
      



      return {
        Status: 'SUCCESS',
        Data: {
          Result: apiGatewayVpcDNSName
        }
      }
    } else
    {
      return
    }
  }
  catch ( error )
  {
    console.error( error );
    return {
      Status: 'FAILED',
      Reason: ( error as any ).message,
      Data: {
        EndpointId: '',
      },
    };
  }

}
