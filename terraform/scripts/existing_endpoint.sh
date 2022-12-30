#!/bin/bash

serviceName="${1}"
vpcId="${2}"
vpceId=$(aws ec2 describe-vpc-endpoints --query "VpcEndpoints[?contains(ServiceName, '${serviceName}') && VpcId=='${vpcId}'].VpcEndpointId" --output text)
if [[ "${vpceId}" =~ (vpce-)[a-z0-9].* ]]; then
	echo "{\"value\":\"${vpceId}\"}"
else
	echo '{"value":"false"}'
fi
