# SecondBrain AI

**Personal Memory Assistant & RAG Engine**

SecondBrain AI is a full-stack app that lets you:
- ingest personal notes,
- ask natural-language questions over those notes,
- and resurface older notes as daily memory prompts.

It combines:
- **Frontend**: React + Vite UI
- **Backend**: AWS Lambda (Node.js, CommonJS)
- **Storage**: DynamoDB
- **AI**: Amazon Bedrock (Titan embeddings + Nova Lite generation)

---

## Live Demo

Staging URL:  
👉 https://staging.d3tm4qejgiq8cc.amplifyapp.com/

---

## Repository Structure

```text
SecondBrain-AI/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── backend/
    ├── index.js
    ├── package.json
    └── package-lock.json
```

---

## Architecture Overview

### Frontend (React + Vite)
- Stores backend API URL in `localStorage` (`secondbrain_api_url`)
- Allows users to:
  - **Memorize note** → `POST /ingest`
  - **Ask question** → `POST /ask`
  - **Get resurfaced memory** → `GET /resurface`
- Displays source note IDs returned by backend for transparency
- Includes modern glassmorphism UI and status/error states

### Backend (Lambda + Bedrock + DynamoDB)
Single Lambda handler routes 3 endpoints:
- `POST /ingest`
- `POST /ask`
- `GET /resurface`

Core backend behavior:
- Validates input (required, non-empty, max 4000 chars)
- Generates embeddings with Bedrock Titan (`amazon.titan-embed-text-v2:0`)
- Stores notes in DynamoDB with:
  - `id`
  - `text`
  - `embedding`
  - `timestamp`
  - `lastSurfaced`
- For `/ask`:
  - embeds question
  - scans notes
  - computes cosine similarity
  - selects top notes
  - sends grounded prompt to Nova Lite (`apac.amazon.nova-lite-v1:0`)
- For `/resurface`:
  - excludes recent notes (<24h)
  - returns least recently resurfaced note
  - updates `lastSurfaced`

---

## API Endpoints

### `POST /ingest`
Request:
```json
{ "text": "My note content..." }
```

Response:
```json
{ "id": "uuid", "timestamp": 1720000000000 }
```

### `POST /ask`
Request:
```json
{ "question": "What did I note about budget?" }
```

Response:
```json
{
  "answer": "Based on your notes...",
  "sourceNoteIds": ["uuid1", "uuid2"]
}
```

### `GET /resurface`
Response:
```json
{
  "note": {
    "id": "uuid",
    "text": "Older note...",
    "timestamp": 1719900000000,
    "lastSurfaced": 1720000000000
  }
}
```
If not enough eligible notes:
```json
{ "note": null }
```

---

## Local Development

## 1) Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on: `http://localhost:5173`

When app opens, set backend URL in config modal (top-right badge), for example:
`https://<api-id>.execute-api.<region>.amazonaws.com`

## 2) Backend

```bash
cd backend
npm install
```

Deploy Lambda + API Gateway in AWS (manual or IaC), then configure env vars listed below.

---

## Backend Environment Variables

Required for Lambda:

- `AWS_REGION` (default in code: `ap-south-1`)
- `TABLE_NAME` (default: `notes`)
- `EMBEDDING_MODEL_ID` (default: `amazon.titan-embed-text-v2:0`)
- `LLM_MODEL_ID` (default: `apac.amazon.nova-lite-v1:0`)
- `ALLOWED_ORIGIN`  
  - Comma-separated allowed origins  
  - Example:  
    `https://staging.d3tm4qejgiq8cc.amplifyapp.com,http://localhost:5173`

---

## AWS Requirements

- Bedrock model access enabled for:
  - Titan Embeddings v2
  - Nova Lite (or compatible model configured in env)
- DynamoDB table with partition key:
  - `id` (String)
- Lambda IAM permissions:
  - `dynamodb:PutItem`
  - `dynamodb:Scan`
  - `dynamodb:UpdateItem`
  - `bedrock:InvokeModel`
  - `bedrock:Converse` (or model invoke permissions required by your account setup)
- API Gateway HTTP API integrated with Lambda routes

---

## Notable Implementation Details

- Retries with exponential backoff for Bedrock throttling (`429`, throttling exceptions)
- Dynamic CORS handling based on incoming `Origin` + `ALLOWED_ORIGIN`
- Graceful empty-state handling for no notes
- Source note IDs returned in answers for explainability

---

## Scripts

### Frontend
- `npm run dev` – start Vite dev server
- `npm run build` – production build
- `npm run preview` – preview production build

### Backend
- `npm test` – run Jest tests (if/when test files are added)

---

## Future Improvements

- Replace full-table scan with vector index / ANN search for scalability
- Add auth (Cognito/JWT) and per-user note partitioning
- Add note update/delete endpoints
- Add infrastructure-as-code (SAM/CDK/Terraform) for one-command deployment

---

## License

Add your preferred license (MIT/Apache-2.0/etc.) in a `LICENSE` file.
