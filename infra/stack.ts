import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface CoreDeskProps extends cdk.StackProps {
  /** Amazon Bedrock model ID, e.g. "amazon.nova-pro-v1:0" */
  bedrockModelId?: string;
}

export class CoreDeskStack extends cdk.Stack {
  public readonly apiUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: CoreDeskProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId
      ?? this.node.tryGetContext('bedrockModelId')
      ?? 'amazon.nova-pro-v1:0';

    // ── Lambda function ───────────────────────────────────────────────────────
    const fn = new lambda.Function(this, 'CoreDeskFn', {
      functionName: 'coredesk-api',
      // Bundle the lambda/ subfolder (handler + index.html + data.json)
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-bundle')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,   // Graviton — cheaper & faster
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),           // API GW hard limit is 30s
      environment: {
        BEDROCK_MODEL_ID: modelId,
        NODE_OPTIONS: '--enable-source-maps',
      },
      description: 'CoreDesk intake-to-billing portal (hackathon)',
    });

    // ── IAM: allow Lambda to call Bedrock Converse ────────────────────────────
    fn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'AllowBedrockConverse',
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        // Allow any Bedrock model in this region so switching model IDs
        // doesn't require a redeploy of the IAM policy.
        `arn:aws:bedrock:${this.region}::foundation-model/*`,
      ],
    }));

    // ── HTTP API (API Gateway v2) ──────────────────────────────────────────────
    const api = new apigwv2.HttpApi(this, 'CoreDeskApi', {
      apiName: 'coredesk',
      description: 'CoreDesk HTTP API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type'],
      },
    });

    const integration = new integrations.HttpLambdaIntegration(
      'CoreDeskIntegration', fn
    );

    // Catch-all route — Lambda handles all routing internally
    api.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });
    api.addRoutes({
      path: '/',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    this.apiUrl = new cdk.CfnOutput(this, 'CoreDeskUrl', {
      value: api.url ?? 'unknown',
      description: 'CoreDesk application URL',
      exportName: 'CoreDeskUrl',
    });

    new cdk.CfnOutput(this, 'BedrockModel', {
      value: modelId,
      description: 'Bedrock model in use',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: fn.functionName,
      description: 'Lambda function name (for logs)',
    });
  }
}
