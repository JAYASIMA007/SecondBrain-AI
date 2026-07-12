# Backend Setup (AWS Lambda) — SecondBrain AI

This guide explains how to set up and deploy the `backend/index.js` Lambda for SecondBrain AI.

## What this Lambda does

It exposes 3 routes behind API Gateway:

- `POST /ingest` → store a note + embedding
- `POST /ask` → answer question using RAG over stored notes
- `GET /resurface` → return an older note for resurfacing

Uses:
- DynamoDB for note storage
- Amazon Bedrock for embedding + generation

---

## 1) Prerequisites

- AWS account with access to:
  - Lambda
  - API Gateway (HTTP API)
  - DynamoDB
  - Bedrock
- AWS CLI configured (optional but recommended)
- Node.js (recommended **v20+** due to AWS SDK package engine requirements in lockfile)

---

## 2) Install dependencies

```bash
cd backend
npm install
```

---

## 3) Create DynamoDB table

Create a table named `notes` (or your custom name) with:

- Partition key: `id` (String)

No sort key required.

If you use another table name, set `TABLE_NAME` env var accordingly.

---

## 4) Create Lambda function

- Runtime: **Node.js 20.x**
- Handler: `index.handler`
- Architecture: x86_64 or arm64 (either works)
- Timeout: recommend 15–30s
- Memory: start at 512MB+ (tune as needed)

Zip and upload backend code (including `node_modules`), or deploy through your preferred pipeline.

---

## 5) Configure Lambda environment variables

Set these in Lambda → Configuration → Environment variables:

- `AWS_REGION=ap-south-1`
- `TABLE_NAME=notes`
- `EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0`
- `LLM_MODEL_ID=apac.amazon.nova-lite-v1:0`
- `ALLOWED_ORIGIN=https://staging.d3tm4qejgiq8cc.amplifyapp.com,http://localhost:5173`

> `ALLOWED_ORIGIN` supports comma-separated origins.

---

## 6) IAM permissions for Lambda role

Attach permissions for:

### DynamoDB
- `dynamodb:PutItem`
- `dynamodb:Scan`
- `dynamodb:UpdateItem`

### Bedrock
- `bedrock:InvokeModel`
- Bedrock converse/inference permission required for your selected model and account policy

Scope these permissions to:
- your specific DynamoDB table ARN
- only the Bedrock model resources you use

---

## 7) Enable Bedrock model access

In Bedrock console, ensure your account/region has access to:

- **Titan Text Embeddings v2** (`amazon.titan-embed-text-v2:0`)
- **Nova Lite** (`apac.amazon.nova-lite-v1:0`)  
  (or update `LLM_MODEL_ID` to an allowed model in your account)

---

## 8) Create API Gateway HTTP API routes

Integrate API Gateway HTTP API with this Lambda and add routes:

- `POST /ingest`
- `POST /ask`
- `GET /resurface`
- `OPTIONS /{proxy+}` (optional if you want explicit preflight handling at gateway level)

Deploy a stage (e.g. `$default`) and copy invoke URL:

```text
https://<api-id>.execute-api.<region>.amazonaws.com
```

Use this in frontend config modal.

---

## 9) CORS notes

The Lambda already returns CORS headers dynamically using `ALLOWED_ORIGIN`.

If API Gateway has CORS enabled too, ensure it does not conflict with Lambda headers.

Recommended:
- Allow `Content-Type, Authorization, X-Api-Key, X-Amz-Date, X-Amz-Security-Token`
- Methods: `OPTIONS, GET, POST`
- Credentials: true (as currently returned by Lambda)

---

## 10) Smoke test with curl

## Ingest
```bash
curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/ingest" \
  -H "Content-Type: application/json" \
  -d '{"text":"My garage keycode is 9872"}'
```

## Ask
```bash
curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is my garage keycode?"}'
```

## Resurface
```bash
curl "https://<api-id>.execute-api.<region>.amazonaws.com/resurface"
```

---

## Troubleshooting

- **502 from /ingest or /ask**
  - Bedrock model access missing or wrong model ID
  - Region mismatch between Lambda and Bedrock model setup
- **500 from DynamoDB operations**
  - Missing IAM permissions
  - Wrong `TABLE_NAME`
- **CORS errors in browser**
  - `ALLOWED_ORIGIN` missing frontend domain
  - API URL mismatch in frontend localStorage
- **Throttling**
  - Code already retries with exponential backoff; increase limits or reduce request rate if persistent

---

## Production recommendations

- Add auth and user-level partitioning (multi-tenant safety)
- Replace scan + cosine in Lambda with dedicated vector store/index for scale
- Add structured logging and CloudWatch dashboards/alarms
- Introduce IaC (AWS SAM/CDK/Terraform) for reproducible deployment
