import * as ec2 from '@aws-sdk/client-ec2';
import {
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceUpdateEvent,
    CloudFormationCustomResourceDeleteEvent,
} from 'aws-lambda';

const region = process.env.AWS_REGION;

interface IEndpointsCreated {
    [key: string]: {
        endpointId: string;
        isCreated: boolean;
    };
}

const interfaceEndpoints = ['execute-api', 'ecr.api', 'logs', 'ecr.dkr', 's3'];

const client = new ec2.EC2Client({});

export const handler = async (event: CloudFormationCustomResourceEvent) => {
    console.log('event', event);

    let endpointsCreated: IEndpointsCreated;
    let executeAPIVpcEndpointId: string | undefined;
    let physicalResourceIdSend: string | undefined;

    try {
        const {
            ResourceProperties: { vpcId, externalPrivateSubnetIds, ExternalEndpointSg },
        } = event;

        const physicalResourceID =
            event.RequestType === 'Update' || event.RequestType === 'Delete' ? event.PhysicalResourceId : undefined;

        const subnetIds = externalPrivateSubnetIds ? JSON.parse(externalPrivateSubnetIds) : undefined;

        console.log(`subnetIds->-->${subnetIds}`);

        if (event.RequestType === 'Create' || event.RequestType === 'Update') {
            endpointsCreated = await handleCreateOrUpdate(vpcId, subnetIds, ExternalEndpointSg);
            executeAPIVpcEndpointId = endpointsCreated['execute-api'].endpointId;

            console.log(`executeAPIVpcEndpointId--->${executeAPIVpcEndpointId}`);

            if (event.RequestType === 'Update' && physicalResourceID) {
                const vpcEndPoints = JSON.parse(event.PhysicalResourceId) as IEndpointsCreated;
                for (const [key, value] of Object.entries(endpointsCreated)) {
                    if (value.isCreated) {
                        vpcEndPoints[key] = value;
                    }
                }

                physicalResourceIdSend = JSON.stringify(vpcEndPoints);
            } else {
                physicalResourceIdSend = JSON.stringify(endpointsCreated);
            }

            console.log(`physicalResourceIdSend--->${physicalResourceIdSend}`);
        } else if (event.RequestType === 'Delete') {
            const endPointsCreated = JSON.parse(event.PhysicalResourceId) as IEndpointsCreated;

            const endpointsCreatedIds = Object.entries(endPointsCreated)
                .filter(([, value]) => value.isCreated)
                .map(([, value]) => value.endpointId);

            for (const interfaceEndpointId of endpointsCreatedIds) {
                const command = new ec2.DeleteVpcEndpointsCommand({
                    VpcEndpointIds: [interfaceEndpointId],
                });

                await client.send(command);

                console.log(`Deleted endpoint ${interfaceEndpointId}`);

                await sleep(5000);
            }
        }
        const returnObject = {
            Status: 'SUCCESS',
            Reason: 'Handler completed successfully.',
            PhysicalResourceId: physicalResourceIdSend,
            Data: {
                executeAPIVpcEndpointId: executeAPIVpcEndpointId,
            },
        };

        console.log(`returnObject---> ${JSON.stringify(returnObject)}`);

        return returnObject;
    } catch (error) {
        console.error(error);
        return {
            Status: 'FAILED',
            Reason: (error as Error).message,
            Data: {
                EndpointId: '',
            },
            PhysicalResourceId:
                (event as CloudFormationCustomResourceUpdateEvent | CloudFormationCustomResourceDeleteEvent)
                    .PhysicalResourceId || '',
        };
    }
};

const handleCreateOrUpdate = async (
    vpcId: string,
    externalPrivateSubnetIds: string[],
    externalEndpointSg: string,
): Promise<IEndpointsCreated> => {
    const command = new ec2.DescribeVpcEndpointsCommand({
        Filters: [
            {
                Name: 'vpc-id',
                Values: [vpcId],
            },
        ],
    });

    const vpcEndpoints: ec2.DescribeVpcEndpointsCommandOutput = await client.send(command);
    const allEndpoints: IEndpointsCreated = {};

    for (const interfaceEndpoint of interfaceEndpoints) {
        const endpointFound = vpcEndpoints.VpcEndpoints?.find(
            (endpoint: ec2.VpcEndpoint) =>
                endpoint.ServiceName === `com.amazonaws.${region}.${interfaceEndpoint}` &&
                (endpoint.State === 'available' || endpoint.State === 'pending'),
        );

        if (endpointFound) {
            console.log(`endpointFound22222---> ${JSON.stringify(endpointFound.ServiceName)}`);

            if (interfaceEndpoint === 's3' && endpointFound.VpcEndpointType === 'Interface') {
                console.log(`S3 endpoint gateway not found , so creating---> ${JSON.stringify(interfaceEndpoint)}`);
                allEndpoints[interfaceEndpoint] = {
                    endpointId: await createEndpoint(
                        vpcId,
                        interfaceEndpoint,
                        'Gateway',
                        externalEndpointSg,
                        externalPrivateSubnetIds,
                    ),
                    isCreated: true,
                };
            } else {
                if (
                    (interfaceEndpoint === 'ecr.api' ||
                        interfaceEndpoint === 'ecr.dkr' ||
                        interfaceEndpoint === 'logs') &&
                    !endpointFound.PrivateDnsEnabled
                ) {
                    const ModifyVpcEndpointCommand = new ec2.ModifyVpcEndpointCommand({
                        PrivateDnsEnabled: true,
                        VpcEndpointId: endpointFound.VpcEndpointId,
                    });

                    console.log(`Private DNS is Disabled on ${interfaceEndpoint}, enabling now....`);

                    const ModifyVpcEndpointCommandResp = await client.send(ModifyVpcEndpointCommand);
                    console.log(`ModifyVpcEndpointCommandResp---> ${JSON.stringify(ModifyVpcEndpointCommandResp)}`);
                }

                console.log(`endpointFound444444---> ${JSON.stringify(endpointFound.ServiceName)}`);
                allEndpoints[interfaceEndpoint] = {
                    endpointId: endpointFound.VpcEndpointId!,
                    isCreated: false,
                };
            }
        } else {
            console.log(`endpoint Not Found 7777---> ${interfaceEndpoint}`);
            allEndpoints[interfaceEndpoint] = {
                endpointId: await createEndpoint(
                    vpcId,
                    interfaceEndpoint,
                    interfaceEndpoint === 's3' ? 'Gateway' : 'Interface',
                    externalEndpointSg,
                    externalPrivateSubnetIds,
                ),
                isCreated: true,
            };
        }

        await sleep(5000);
    }

    return allEndpoints;
};
async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const createEndpoint = async (
    vpcId: string,
    endpoint: string,
    type: 'Interface' | 'Gateway',
    externalEndpointSg: string,
    externalPrivateSubnetIds?: string[],
) => {
    console.log('creating Endpoint', endpoint, type);

    // create VPCEndpoint
    const command = new ec2.CreateVpcEndpointCommand({
        VpcId: vpcId,
        ServiceName: `com.amazonaws.${region}.${endpoint}`,
        VpcEndpointType: type,
        PrivateDnsEnabled: type === 'Interface' ? (endpoint === 'execute-api' ? false : true) : false,
        RouteTableIds: type === 'Gateway' ? await getPrivateRouteTableIds(vpcId, externalPrivateSubnetIds) : undefined,
        SubnetIds: type === 'Interface' ? externalPrivateSubnetIds : undefined,
        SecurityGroupIds: type === 'Interface' ? [externalEndpointSg] : undefined,
    });

    const endpointResponse = await client.send(command);

    return endpointResponse.VpcEndpoint?.VpcEndpointId;
};

const getPrivateRouteTableIds = async (
    vpcId: string,
    externalPrivateSubnetIds?: string[],
): Promise<string[] | undefined> => {
    const commandRouteTable = new ec2.DescribeRouteTablesCommand({
        Filters: [
            {
                Name: 'vpc-id',
                Values: [vpcId],
            },
            {
                Name: 'association.subnet-id',
                Values: externalPrivateSubnetIds,
            },
        ],
    });

    const routeTablesResponse: ec2.DescribeRouteTablesCommandOutput = await client.send(commandRouteTable);

    return routeTablesResponse.RouteTables?.map((route) => route.RouteTableId!);
};
