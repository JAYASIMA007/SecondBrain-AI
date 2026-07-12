const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const crypto = require('crypto');

// Initialize AWS Clients
const region = process.env.AWS_REGION || 'ap-south-1';
const TABLE_NAME = process.env.TABLE_NAME || 'notes';
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';
// ap-south-1 requires cross-region inference profile (apac. prefix) for Nova models
const LLM_MODEL_ID = process.env.LLM_MODEL_ID || 'apac.amazon.nova-lite-v1:0';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockClient = new BedrockRuntimeClient({ region });

/**
 * Returns CORS headers dynamically matching ALLOWED_ORIGIN environment variable.
 */
function getCorsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
  
  let originHeader = '';
  if (allowedOrigin) {
    const allowedOrigins = allowedOrigin.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      originHeader = origin;
    } else if (allowedOrigins.includes('*')) {
      originHeader = origin || '*';
    } else {
      originHeader = allowedOrigins[0];
    }
  } else {
    originHeader = origin || '*';
  }

  return {
    'Access-Control-Allow-Origin': originHeader,
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
    'Access-Control-Allow-Credentials': 'true'
  };
}

/**
 * Parses request body, handling base64 decoding if API Gateway encoded it.
 */
function parseBody(event) {
  if (!event.body) return {};
  try {
    const bodyStr = event.isBase64Encoded 
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(bodyStr);
  } catch (err) {
    console.error('Failed to parse request body:', err);
    return {};
  }
}

/**
 * Performs a retry with exponential backoff on Bedrock throttling errors.
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const isThrottling = 
        error.name === 'ThrottlingException' || 
        error.name === 'LimitExceededException' ||
        error.name === 'RequestLimitExceeded' ||
        error.$metadata?.httpStatusCode === 429;
      
      if (isThrottling && attempt <= maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(`Bedrock throttling encountered. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Computes cosine similarity between two vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Handler for POST /ingest
 */
async function handleIngest(event, corsHeaders) {
  const body = parseBody(event);
  const text = body.text;

  // Validation
  if (text === undefined || text === null) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Text field is missing.' })
    };
  }
  if (typeof text !== 'string') {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Text must be a string.' })
    };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Text cannot be empty or only whitespace.' })
    };
  }
  if (text.length > 4000) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Text exceeds maximum length of 4000 characters.' })
    };
  }

  // Get Embedding from Bedrock
  let embedding;
  try {
    embedding = await retryWithBackoff(async () => {
      const command = new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
          dimensions: 1024,
          normalize: true
        })
      });
      const res = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(res.body));
      return responseBody.embedding;
    });
  } catch (err) {
    console.error('Bedrock embedding generation failed:', err);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to generate embedding from Bedrock.' })
    };
  }

  // Store in DynamoDB
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  try {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id,
        text,
        embedding,
        timestamp,
        lastSurfaced: null
      }
    }));
  } catch (err) {
    console.error('DynamoDB put item failed:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to write note to database.' })
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ id, timestamp })
  };
}

/**
 * Handler for POST /ask
 */
async function handleAsk(event, corsHeaders) {
  const body = parseBody(event);
  const question = body.question;

  // Validation
  if (question === undefined || question === null) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Question field is missing.' })
    };
  }
  if (typeof question !== 'string') {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Question must be a string.' })
    };
  }
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Question cannot be empty or only whitespace.' })
    };
  }
  if (question.length > 4000) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Question exceeds maximum length of 4000 characters.' })
    };
  }

  // Get Question Embedding from Bedrock
  let questionEmbedding;
  try {
    questionEmbedding = await retryWithBackoff(async () => {
      const command = new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: question,
          dimensions: 1024,
          normalize: true
        })
      });
      const res = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(res.body));
      return responseBody.embedding;
    });
  } catch (err) {
    console.error('Bedrock question embedding generation failed:', err);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to generate embedding for the question.' })
    };
  }

  // Fetch all notes from DynamoDB
  let allNotes = [];
  try {
    let lastEvaluatedKey = null;
    do {
      const scanParams = { TableName: TABLE_NAME };
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      const scanRes = await docClient.send(new ScanCommand(scanParams));
      if (scanRes.Items) {
        allNotes.push(...scanRes.Items);
      }
      lastEvaluatedKey = scanRes.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (err) {
    console.error('DynamoDB scan failed in ask:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to retrieve notes from database.' })
    };
  }

  // Empty state handling
  if (allNotes.length === 0) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        answer: "I don't have any notes on that yet. Try adding some notes first!",
        sourceNoteIds: []
      })
    };
  }

  // Calculate similarities — rank ALL notes and take top matches
  // For MVP with small note counts, use a very low threshold (0.1) so the LLM
  // receives context and can decide relevance. This prevents false "no notes" 
  // responses caused by mixed-topic notes diluting embedding vectors.
  const threshold = 0.1;
  const notesWithSimilarity = allNotes.map(note => {
    const similarity = cosineSimilarity(questionEmbedding, note.embedding);
    return { ...note, similarity };
  });

  // Sort ALL notes by similarity descending
  notesWithSimilarity.sort((a, b) => b.similarity - a.similarity);

  // Take top 5 notes above threshold, or top 3 regardless if none cross threshold
  let matchedNotes = notesWithSimilarity.filter(note => note.similarity > threshold);
  if (matchedNotes.length === 0) {
    // Fallback: give LLM the 3 best-matching notes even if similarity is very low
    matchedNotes = notesWithSimilarity.slice(0, 3);
  }
  
  if (matchedNotes.length === 0) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        answer: "I don't have any notes on that yet. Try rephrasing your question or adding notes related to this topic.",
        sourceNoteIds: []
      })
    };
  }

  // Sort descending by similarity and take top 5
  matchedNotes.sort((a, b) => b.similarity - a.similarity);
  const topNotes = matchedNotes.slice(0, 5);

  // Construct context and run LLM Generation
  const contextText = topNotes.map((note, idx) => `[Note ${idx + 1}] (ID: ${note.id})\n${note.text}`).join('\n\n');
  const systemPrompt = `You are SecondBrain AI, a personal memory assistant. You are helping a user answer questions based ONLY on their notes provided below.
Rules:
1. Base your answer solely on the context provided.
2. If the context does not contain the answer, say clearly that you cannot find this in their notes. Do not hallucinate or search external knowledge.
3. Be concise, accurate, and direct.
4. Refer to the notes as "your notes" rather than "the provided context" or "the notes provided below".

Context:
${contextText}`;

  let answer = '';
  try {
    answer = await retryWithBackoff(async () => {
      const command = new ConverseCommand({
        modelId: LLM_MODEL_ID,
        messages: [
          {
            role: 'user',
            content: [{ text: question }]
          }
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: 1000,
          temperature: 0.2
        }
      });
      const res = await bedrockClient.send(command);
      
      if (!res.output?.message?.content?.[0]?.text) {
        throw new Error('Malformed Bedrock response content.');
      }
      return res.output.message.content[0].text;
    });
  } catch (err) {
    console.error('Bedrock generation failed:', err);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to generate answer from Bedrock.' })
    };
  }

  const sourceNoteIds = topNotes.map(n => n.id);
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      answer,
      sourceNoteIds
    })
  };
}

/**
 * Handler for GET /resurface
 */
async function handleResurface(event, corsHeaders) {
  // Retrieve all notes
  let allNotes = [];
  try {
    let lastEvaluatedKey = null;
    do {
      const scanParams = { TableName: TABLE_NAME };
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      const scanRes = await docClient.send(new ScanCommand(scanParams));
      if (scanRes.Items) {
        allNotes.push(...scanRes.Items);
      }
      lastEvaluatedKey = scanRes.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (err) {
    console.error('DynamoDB scan failed in resurface:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to scan notes.' })
    };
  }

  // Gracefully return null if fewer than 2 notes total
  if (allNotes.length < 2) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ note: null })
    };
  }

  // Exclude notes created/updated in the last 24 hours
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const eligibleNotes = allNotes.filter(note => note.timestamp <= oneDayAgo);

  if (eligibleNotes.length === 0) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ note: null })
    };
  }

  // Pick the note that hasn't been surfaced, or was surfaced the longest time ago (lastSurfaced ASC)
  eligibleNotes.sort((a, b) => {
    const valA = a.lastSurfaced || 0;
    const valB = b.lastSurfaced || 0;
    return valA - valB;
  });

  const selectedNote = eligibleNotes[0];
  const currentTimestamp = Date.now();

  // Update selectedNote's lastSurfaced in DynamoDB
  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: selectedNote.id },
      UpdateExpression: 'SET lastSurfaced = :t',
      ExpressionAttributeValues: {
        ':t': currentTimestamp
      }
    }));
  } catch (err) {
    console.error('DynamoDB update lastSurfaced failed:', err);
    // Non-blocking failure - log it but still return the selected note
  }

  // Strip embedding for transfer size efficiency
  const { embedding, ...noteData } = selectedNote;
  noteData.lastSurfaced = currentTimestamp;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ note: noteData })
  };
}

/**
 * Main Unified Router Handler
 */
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const path = event.rawPath || event.path || '';
  const corsHeaders = getCorsHeaders(event);

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    if (path === '/ingest' && method === 'POST') {
      return await handleIngest(event, corsHeaders);
    } else if (path === '/ask' && method === 'POST') {
      return await handleAsk(event, corsHeaders);
    } else if (path === '/resurface' && method === 'GET') {
      return await handleResurface(event, corsHeaders);
    } else {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Route not found: ${method} ${path}` })
      };
    }
  } catch (err) {
    console.error('Unhandled Lambda handler exception:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error.' })
    };
  }
};
