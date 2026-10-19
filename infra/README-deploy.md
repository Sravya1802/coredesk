# CoreDesk — AWS CDK Deployment

## Architecture

```
Browser → API Gateway v2 (HTTP API) → Lambda (Node 22, ARM64)
                                           ↓
                                    Bedrock Converse API
                                    (foundation model)
```

- **Lambda** serves the HTML, the requests data, and all API routes
- **API Gateway v2** (HTTP API) routes all traffic to Lambda
- **IAM role** on the Lambda grants `bedrock:InvokeModel` — no hardcoded keys
- **Data** (300 requests) is bundled into the Lambda zip at deploy time
- **Credentials** come from the workshop environment, never stored in code

## Prerequisites

```bash
node --version   # need v18+
cdk --version    # need v2+; install: npm install -g aws-cdk
```

## Deploy (one command)

1. Set your workshop credentials in the terminal:

```bash
export AWS_ACCESS_KEY_ID=<from workshop>
export AWS_SECRET_ACCESS_KEY=<from workshop>
export AWS_SESSION_TOKEN=<from workshop>          # if using temp creds
export AWS_DEFAULT_REGION=us-east-1
```

2. Run the deploy script from the `infra/` folder:

```bash
cd infra/
./deploy.sh amazon.nova-pro-v1:0
```

Replace `amazon.nova-pro-v1:0` with the model ID the workshop has enabled.
Common options:
- `amazon.nova-pro-v1:0`
- `anthropic.claude-3-5-sonnet-20241022-v2:0`
- `anthropic.claude-3-haiku-20240307-v1:0`

3. The script prints the live URL at the end. It also saves it to `cdk-outputs.json`.

## What the script does

1. Builds `lambda-bundle/` (handler + HTML + data.json — 260 KB total)
2. CDK bootstrap (safe no-op if already done)
3. `cdk deploy` — creates/updates the CloudFormation stack `CoreDesk`
4. Prints the API Gateway URL

## Tear down

```bash
cd infra/
cdk destroy --no-version-reporting
```

## Change the Bedrock model without re-deploying CDK

Update the Lambda environment variable directly:

```bash
aws lambda update-function-configuration \
  --function-name coredesk-api \
  --environment Variables={BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0}
```

## Local development (no AWS needed)

```bash
cd project/
npm start           # http://localhost:3000
```

AI features work locally once you set:
```bash
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=amazon.nova-pro-v1:0
# + AWS credentials
```
