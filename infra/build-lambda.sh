#!/usr/bin/env bash
# Assembles the lambda-bundle/ directory for CDK deployment.
# Run from the infra/ folder: ./build-lambda.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/../project"
BUNDLE_DIR="$SCRIPT_DIR/lambda-bundle"

echo "→ Cleaning lambda-bundle/"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "→ Copying Lambda handler"
cp "$SCRIPT_DIR/lambda/index.mjs" "$BUNDLE_DIR/index.mjs"

echo "→ Copying index.html"
cp "$PROJECT_DIR/public/index.html" "$BUNDLE_DIR/index.html"

echo "→ Copying data.json"
cp "$PROJECT_DIR/public/data.json" "$BUNDLE_DIR/data.json"

# The Lambda runtime (Node 22) includes the AWS SDK v3 built in,
# so @aws-sdk/client-bedrock-runtime is available without bundling it.
# No node_modules needed.

echo "→ Writing package.json (type: module)"
cat > "$BUNDLE_DIR/package.json" << 'EOF'
{
  "name": "coredesk-lambda",
  "version": "1.0.0",
  "type": "module"
}
EOF

echo "✓ lambda-bundle/ is ready ($(du -sh "$BUNDLE_DIR" | cut -f1))"
ls -lh "$BUNDLE_DIR"
