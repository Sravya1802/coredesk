/**
 * CoreDesk Lambda handler (ES module, Node 22)
 *
 * Routes:
 *   GET  /              → index.html
 *   GET  /api/requests  → data.json (pre-parsed from Excel at build time)
 *   POST /api/intake/chat    → Bedrock Converse → {fields, reply}
 *   POST /api/intake/email   → Bedrock Converse → {fields, draftReply}
 *   POST /api/report/summary → Bedrock Converse → {summary}
 *
 * Env vars:
 *   BEDROCK_MODEL_ID  (required for AI features)
 *   AWS_REGION        (set automatically by Lambda runtime)
 *
 * Credentials come from the Lambda execution role — never hardcoded.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Bundled assets (copied in at build time) ─────────────────────────────────
const HTML      = readFileSync(join(__dirname, 'index.html'), 'utf8');
const REQUESTS  = JSON.parse(readFileSync(join(__dirname, 'data.json'), 'utf8'));

// ── Allowed values for the Bedrock system prompt ─────────────────────────────
const SERVICES = ['Histology Services','Tissue Banking','Microscopy & Imaging','Mass Spectrometry','Flow Cytometry','Genomic Sequencing','Bioinformatics Analysis','Biostatistical Consulting'];
const FUNDS    = ['NIH','NSF','Internal','Industry','Foundation','State'];

const INTAKE_SYSTEM = `You are an intake assistant for a research core facility. Extract form fields from the researcher's text. Return ONLY a valid JSON object — no markdown, no prose, no explanation.

The object has two keys:
1. "fields" — an object containing only the fields you can determine from the text. Omit any field you cannot determine. Never invent a value.
2. "reply" — one short, friendly sentence confirming what you filled and asking for exactly ONE item from the "missing" list. If nothing is missing, say "Everything looks complete!"

Field keys and their allowed values:
- pi: researcher full name (string)
- email: email address (string)
- dept: department name (string, free text from researcher)
- service: MUST be exactly one of: ${SERVICES.map(s => `"${s}"`).join(', ')}
- fund: MUST be exactly one of: ${FUNDS.map(f => `"${f}"`).join(', ')}
- grant: fund or grant number, at least 4 characters (string)
- samples: number of samples (integer, return as number)
- title: project title, at least 5 characters (string)
- desc: project description, at least 20 characters (string)
- human: "Yes" or "No" — whether human subjects are involved
- dua: data use agreement status — MUST be exactly one of: "Signed", "Not signed yet", "Not needed"
- irb: IRB protocol number, at least 4 characters (string)
- irbexp: IRB approval expiry date in YYYY-MM-DD format (string)

Rules:
- Only include a field in "fields" if the text clearly states it.
- For "service", map synonyms (e.g. "histology" → "Histology Services", "sequencing" → "Genomic Sequencing", "flow cyto" → "Flow Cytometry", "mass spec" → "Mass Spectrometry", "imaging" or "microscopy" → "Microscopy & Imaging", "bioinformatics" → "Bioinformatics Analysis", "biostat" → "Biostatistical Consulting", "tissue bank" → "Tissue Banking").
- For "fund", "NIH" includes R01/U01/P30/etc. grant prefixes; "NSF" includes NSF grant prefixes.
- For "irbexp", convert month/day/year or "June 30, 2027" style dates to YYYY-MM-DD.
- Return valid JSON only.`;

// ── Bedrock Converse call (uses Lambda execution role) ───────────────────────
async function callBedrock(messages) {
  const region  = process.env.AWS_REGION || 'us-east-1';
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) throw new Error('BEDROCK_MODEL_ID environment variable is not set');

  const { BedrockRuntimeClient, ConverseCommand } = await import(
    '@aws-sdk/client-bedrock-runtime'
  );
  const client = new BedrockRuntimeClient({ region });
  const resp   = await client.send(new ConverseCommand({ modelId, messages }));
  return resp.output.message.content[0].text;
}

// ── Response helpers ─────────────────────────────────────────────────────────
const html200 = body => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body
});
const json200 = obj => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});
const json400 = msg => ({
  statusCode: 400,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: msg })
});

// ── Handler ───────────────────────────────────────────────────────────────────
export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path   = event.requestContext?.http?.path   || event.path || '/';
  const body   = event.body ? (event.isBase64Encoded ? Buffer.from(event.body,'base64').toString() : event.body) : '{}';

  // GET / → index.html
  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    return html200(HTML);
  }

  // GET /api/requests
  if (method === 'GET' && path === '/api/requests') {
    return json200(REQUESTS);
  }

  // POST /api/intake/chat
  if (method === 'POST' && path === '/api/intake/chat') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return json400('Invalid JSON'); }
    const { history = [], formValues = {}, missing = [] } = parsed;
    const messages = [
      { role: 'user', content: [{ text: INTAKE_SYSTEM + '\n\n---\nCurrent missing fields: ' + (missing.length ? missing.join(', ') : 'none') + '\nCurrent form values: ' + JSON.stringify(formValues) }] },
      { role: 'assistant', content: [{ text: '{"fields":{},"reply":"Understood. I will extract fields from each message and ask for one missing item at a time."}' }] },
      ...history.map(m => ({ role: m.role, content: [{ text: String(m.content) }] }))
    ];
    try {
      const raw = await callBedrock(messages);
      const match = raw.match(/\{[\s\S]*\}/);
      const result = JSON.parse(match ? match[0] : raw);
      return json200({ ok: true, fields: result.fields || {}, reply: result.reply || 'Done.' });
    } catch (e) {
      return json200({ ok: false, aiUnavailable: true, fallback: 'AI unavailable, using basic reader.', error: e.message });
    }
  }

  // POST /api/intake/email
  if (method === 'POST' && path === '/api/intake/email') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return json400('Invalid JSON'); }
    const { subject = '', body: emailBody = '' } = parsed;
    const messages = [
      { role: 'user', content: [{ text: INTAKE_SYSTEM + '\n\nIn addition to "fields" and "reply", also include a "draftReply" key: a short professional email reply to the researcher listing what is still needed.\n\n---\nEmail:\nSubject: ' + subject + '\n\n' + emailBody }] }
    ];
    try {
      const raw = await callBedrock(messages);
      const match = raw.match(/\{[\s\S]*\}/);
      const result = JSON.parse(match ? match[0] : raw);
      return json200({ ok: true, fields: result.fields || {}, draftReply: result.draftReply || result.reply || 'Fields extracted.' });
    } catch (e) {
      return json200({ ok: false, aiUnavailable: true, fallback: 'AI unavailable, using basic reader.', error: e.message });
    }
  }

  // POST /api/report/summary
  if (method === 'POST' && path === '/api/report/summary') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return json400('Invalid JSON'); }
    const { figures } = parsed;
    if (!figures) return json400('"figures" field required');
    const prompt = `You are a research-core operations analyst. Write a 3–5 sentence leadership summary using ONLY these numbers — do not invent any data:\n\n${JSON.stringify(figures, null, 2)}`;
    try {
      const summary = await callBedrock([{ role: 'user', content: [{ text: prompt }] }]);
      return json200({ ok: true, summary });
    } catch (e) {
      return json200({ ok: false, aiUnavailable: true, error: e.message });
    }
  }

  return { statusCode: 404, body: 'Not found' };
}
