import * as ec2 from '@aws-sdk/client-ec2'
import { CloudFormationCustomResourceCreateEvent, CloudFormationCustomResourceEvent, CloudFormationCustomResourceUpdateEvent, CloudFormationCustomResourceDeleteEvent } from 'aws-lambda'

const region = process.env.AWS_REGION;
const client = new ec2.EC2Client( {} )
export const handler = async ( event: CloudFormationCustomResourceEvent ) =>
{
  let apiGatewayVpcEndPointId = ''
  let apiGatewayVpcDNSName = ''
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

      const vpcEndpoints: ec2.DescribeVpcEndpointsCommandOutput = await client.send( command )
      if ( typeof vpcEndpoints.VpcEndpoints !== 'undefined' )
      {
        if ( typeof vpcEndpoints.VpcEndpoints[ 0 ].DnsEntries !== 'undefined' )
        {
          apiGatewayVpcDNSName = vpcEndpoints.VpcEndpoints[ 0 ].DnsEntries[ 0 ].DnsName
          console.log( `execute-api DnsEntry---> ${ apiGatewayVpcDNSName }` );

        }
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
