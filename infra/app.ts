#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreDeskStack } from './stack';

const app = new cdk.App();

new CoreDeskStack(app, 'CoreDesk', {
  // Region and account come from the environment (workshop credentials)
  // Override the model via context: cdk deploy -c bedrockModelId=amazon.nova-pro-v1:0
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'CoreDesk research data request portal (hackathon)',
});
