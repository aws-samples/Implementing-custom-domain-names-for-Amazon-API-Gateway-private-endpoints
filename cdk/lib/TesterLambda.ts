import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs'
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

type TesterLambdaProps = {
    vpc: ec2.Vpc,
}
export class TesterLambda extends Construct
{
    public readonly lambdaFnName: string
    constructor ( scope: Construct, id: string, props: TesterLambdaProps )
    {
        super( scope, id );
        const stackName = cdk.Stack.of( this ).stackName
        const lambdaFunctionPy = new lambda.Function( this, `${ stackName }-tester-function-py`, {
            handler: 'index.handler',
            runtime: lambda.Runtime.PYTHON_3_9,
            logRetention: RetentionDays.ONE_WEEK,
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            code: lambda.Code.fromInline( `import urllib.request
import json
def handler(event, context):
    # print(f'json.dumps(event)')
    with urllib.request.urlopen(event['CUSTOM_DOMAIN_URL']) as response:
        resp = response.read()
        print(resp.decode('ascii'))
        return {
            'statusCode': 200,}`
            )
        } );

        this.lambdaFnName = lambdaFunctionPy.functionName

    }
}