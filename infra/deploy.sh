#!/usr/bin/env bash
# CoreDesk — one-shot deploy script
# Usage: ./deploy.sh [bedrock-model-id]
# Example: ./deploy.sh amazon.nova-pro-v1:0
#
# AWS credentials must already be set in the environment:
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   export AWS_SESSION_TOKEN=...   (if using temporary credentials)
#   export AWS_DEFAULT_REGION=us-east-1
#
# NEVER commit credentials to the project.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODEL_ID="${1:-amazon.nova-pro-v1:0}"
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  CoreDesk — AWS CDK Deploy                          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Bedrock model : $MODEL_ID"
echo "  Region        : ${AWS_DEFAULT_REGION:-us-east-1}"
echo ""

cd "$SCRIPT_DIR"

# 0. Make sure this terminal has working AWS credentials; CDK can't pick an account without them
if command -v aws >/dev/null 2>&1; then
  if ! ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1); then
    echo "✗ No working AWS credentials in this terminal."
    echo "  AWS said: $ACCOUNT"
    echo "  Paste the workshop's export lines (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,"
    echo "  AWS_SESSION_TOKEN, AWS_DEFAULT_REGION) into THIS terminal, then run ./deploy.sh again."
    echo "  Workshop credentials expire, so get fresh ones if this worked before."
    exit 1
  fi
  echo "  AWS account   : $ACCOUNT"
  export CDK_DEFAULT_ACCOUNT="$ACCOUNT"
  export CDK_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
  echo ""
fi

# 1. Rebuild the lambda bundle from the latest project files
echo "Step 1/4  Building lambda bundle…"
./build-lambda.sh

# 2. CDK bootstrap (safe to re-run; skips if already bootstrapped)
echo ""
echo "Step 2/4  Bootstrapping CDK (skipped if already done)…"
cdk bootstrap --no-version-reporting 2>&1 | grep -v "^$" || true

# 3. Deploy
echo ""
echo "Step 3/4  Deploying CoreDesk stack…"
cdk deploy --no-version-reporting --require-approval never \
  -c bedrockModelId="$MODEL_ID" \
  --outputs-file cdk-outputs.json

# 4. Print the URL
echo ""
echo "Step 4/4  Done!"
echo ""
URL=$(node -e "const o=require('./cdk-outputs.json');console.log(o.CoreDesk?.CoreDeskUrl||'(see cdk-outputs.json)')" 2>/dev/null || echo "(see cdk-outputs.json)")
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║  CoreDesk is live at:                                    ║"
echo "  ║  $URL"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""
