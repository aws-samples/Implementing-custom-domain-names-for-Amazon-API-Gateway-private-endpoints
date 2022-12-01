import { CloudFormationCustomResourceEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const region = process.env.AWS_REGION!

const ec2 = new AWS.EC2();
const interfaceEndpoints = [
  'execute-api',
  'ecr.api',
  'logs',
  'ecr.dkr',
  // 'XXX'
]
export const handler = async ( event: CloudFormationCustomResourceEvent, context: any ) =>
{
  let apiGatewayVpcEndPointId = '';
  // console.log(`event -----------> ${event}`);


  switch ( event.RequestType )
  {
    // code ran on Stack Creation
    case "Create":
    case "Update":


      const response = await ec2
        .describeVpcEndpoints( {
          Filters: [
            {
              Name: "vpc-id",
              Values: [ event.ResourceProperties.VpcId ],
            },
          ],
        } )
        .promise();
      // console.log( `describeVpcEndpoints----> ${ JSON.stringify( response, null, 2 ) }` );

      const vpcEndpoints: any = response.VpcEndpoints;
      interfaceEndpoints.forEach( ( interfaceEndpoint ) =>
      {
        const endpoint = vpcEndpoints.find(
          ( endpoint: any ) => endpoint.ServiceName === `com.amazonaws.${ region }.${ interfaceEndpoint }`
        );
        if ( endpoint )
        {
          if ( endpoint.PrivateDnsEnabled.toString() === "false" )
          {
            throw new Error(
              `Private DNS should be Enabled on VPC Endpoint com.amazonaws.${ region }.${ interfaceEndpoint } `
            );
          }

          console.log(`interfaceEndpoint -> ${interfaceEndpoint} , endpoint.VpcEndpointId --> ${endpoint.VpcEndpointId}`);

          if ( interfaceEndpoint === "execute-api" )
          {
            apiGatewayVpcEndPointId = endpoint.VpcEndpointId
          } 

          console.log( `Interface endpoint Found com.amazonaws.${ region }.${ interfaceEndpoint }, Private DNS is Enabled ` );
        }
        else
        {

          throw new Error( `Interface Endpoint com.amazonaws.${ region }.${ interfaceEndpoint } is required in your VPC to deploy the solution` );
        }

      } )

      const s3Endpoint = vpcEndpoints.find(
        ( endpoint: any ) => endpoint.ServiceName === `com.amazonaws.${ region }.s3`
      );
      if ( !s3Endpoint )
      {
        throw new Error( `Gateway Endpoint com.amazonaws.${ region }.s3 is required in your VPC to deploy the solution` );
      }


      const results = response.VpcEndpoints.find( ( item: any ) => item.ServiceName === `com.amazonaws.${ region }.execute-api` )

      // console.log( `results--------->${ JSON.stringify( results, null, 2 ) }` );



      return {
        Data: {
          Result: apiGatewayVpcEndPointId.toString()
        }
      }
      break;
    // code ran on Stack Delete
    case "Delete":
      return
  }
  // Should never run
  return {
    Data: {
      Result: "FailTest"
    }
  }
}
