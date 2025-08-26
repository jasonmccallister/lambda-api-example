#!/usr/bin/env bash
set -euo pipefail

# Config you may tweak
FUNC_NAME="lambda-example"
ARCH="arm64"                   # or x86_64
RUNTIME="nodejs20.x"
ROLE_NAME="lambda-example-role"
ZIP="function.zip"

echo "▶ Building…"
npm run build --silent
npm run zip --silent

# Create IAM role if missing
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)
if [ -z "${ROLE_ARN}" ]; then
  echo "▶ Creating IAM role $ROLE_NAME"
  TRUST=$(cat <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
)
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST" > /dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:policy/service-role/AWSLambdaBasicExecutionRole
  # small wait to let role propagate
  echo "   Waiting for role to propagate…"
  sleep 8
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
fi

# Create or update function
EXISTS=$(aws lambda get-function --function-name "$FUNC_NAME" --query 'Configuration.FunctionArn' --output text 2>/dev/null || true)

if [ -z "$EXISTS" ] || [ "$EXISTS" = "None" ]; then
  echo "▶ Creating Lambda $FUNC_NAME"
  aws lambda create-function \
    --function-name "$FUNC_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler "index.handler" \
    --architectures "$ARCH" \
    --timeout 10 \
    --memory-size 256 \
    --environment "Variables={}" \
    --zip-file "fileb://$ZIP" \
    --description "Simple Tailwind HTML + JSON API via Lambda Function URL" > /dev/null
else
  echo "▶ Updating code for $FUNC_NAME"
  aws lambda update-function-code --function-name "$FUNC_NAME" --zip-file "fileb://$ZIP" > /dev/null
fi

# Create Function URL (public, CORS open) if missing
FURL=$(aws lambda get-function-url-config --function-name "$FUNC_NAME" --query 'FunctionUrl' --output text 2>/dev/null || true)
if [ -z "$FURL" ] || [ "$FURL" = "None" ]; then
  echo "▶ Creating Function URL"
  aws lambda create-function-url-config \
    --function-name "$FUNC_NAME" \
    --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["*"],"AllowHeaders":["*"],"AllowCredentials":false}' > /dev/null
  FURL=$(aws lambda get-function-url-config --function-name "$FUNC_NAME" --query 'FunctionUrl' --output text)
fi

# Add permission so the URL is callable by anyone (public)
aws lambda add-permission \
  --function-name "$FUNC_NAME" \
  --statement-id "public-url" \
  --action "lambda:InvokeFunctionUrl" \
  --principal "*" \
  --function-url-auth-type "NONE" >/dev/null 2>&1 || true

echo ""
echo "✅ Deployed!"
echo "URL: ${FURL}"
echo "Home: ${FURL}"
echo "API : ${FURL}api/info"