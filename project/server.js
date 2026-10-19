/**
 * CoreDesk – local server
 *
 * Endpoints:
 *   GET  /               → public/index.html
 *   GET  /api/requests   → 300 rows from Team3Dataset.xlsx
 *   POST /api/intake/chat    → Bedrock Converse → {fields, reply}
 *   POST /api/intake/email   → Bedrock Converse → {fields, draftReply}
 *   POST /api/report/summary → Bedrock Converse → {summary}
 *
 * Env vars required for Bedrock (steps 2 & 3):
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, BEDROCK_MODEL_ID
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PORT      = process.env.PORT || 3000;
const XLSX_PATH = path.join(__dirname, 'Team3Dataset.xlsx');
const HTML_PATH = path.join(__dirname, 'public', 'index.html');

// ── Allowed field values (used in the Bedrock system prompt) ─────────────────
const SERVICES = ['Histology Services','Tissue Banking','Microscopy & Imaging','Mass Spectrometry','Flow Cytometry','Genomic Sequencing','Bioinformatics Analysis','Biostatistical Consulting'];
const FUNDS    = ['NIH','NSF','Internal','Industry','Foundation','State'];

// ── Load & cache the spreadsheet ─────────────────────────────────────────────
function loadRequests() {
  const wb  = XLSX.readFile(XLSX_PATH);
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return raw.map(row => {
    const out = {};
    Object.keys(row).forEach(k => { out[k.trim()] = row[k]; });
    return out;
  });
}

let REQUESTS;
try {
  REQUESTS = loadRequests();
  console.log(`✓ Loaded ${REQUESTS.length} requests from Team3Dataset.xlsx`);
} catch (e) {
  console.error('✗ Could not read Team3Dataset.xlsx:', e.message);
  process.exit(1);
}

// ── Read JSON body ────────────────────────────────────────────────────────────
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function jsonRes(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ── Bedrock Converse helper ───────────────────────────────────────────────────
async function callBedrock(messages) {
  const region  = process.env.AWS_REGION;
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!region || !modelId) {
    throw new Error('AWS_REGION and BEDROCK_MODEL_ID environment variables must be set');
  }

  const { BedrockRuntimeClient, ConverseCommand } = await import(
    '@aws-sdk/client-bedrock-runtime'
  );
  const client = new BedrockRuntimeClient({ region });
  const cmd    = new ConverseCommand({ modelId, messages });
  const resp   = await client.send(cmd);
  return resp.output.message.content[0].text;
}

// ── Shared Bedrock system prompt for intake ───────────────────────────────────
const INTAKE_SYSTEM = `You are an intake assistant for a research core facility. Extract form fields from the researcher's text. Return ONLY a valid JSON object — no markdown, no prose, no explanation.

The object has two keys:
1. "fields" — an object containing only the fields you can determine from the text. Omit any field you cannot determine. Never invent a value.
2. "reply" — one short, friendly sentence confirming what you filled and asking for exactly ONE item from the "missing" list. If nothing is missing, say "Everything looks complete!"

Field keys and their allowed values:
- pi: researcher full name (string)
- email: email address (string)
- dept: department name — must be one of the departments listed in the system (string, free text from researcher)
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
- For "service", map common synonyms (e.g. "histology" → "Histology Services", "sequencing" → "Genomic Sequencing", "flow cyto" → "Flow Cytometry", "mass spec" → "Mass Spectrometry", "imaging" or "microscopy" → "Microscopy & Imaging", "bioinformatics" → "Bioinformatics Analysis", "biostat" → "Biostatistical Consulting", "tissue bank" → "Tissue Banking").
- For "fund", "NIH" includes R01/U01/P30/etc. grant prefixes; "NSF" includes NSF grant prefixes.
- For "irbexp", convert month/day/year or "June 30, 2027" style dates to YYYY-MM-DD.
- Return valid JSON only.`;

// ── POST /api/intake/chat ─────────────────────────────────────────────────────
async function handleIntakeChat(req, res) {
  let body;
  try { body = await readJSON(req); }
  catch { jsonRes(res, 400, { error: 'Invalid JSON body' }); return; }

  const { history = [], formValues = {}, missing = [] } = body;

  // Build message list for Bedrock
  // We inject the system prompt as the first user turn, then interleave the rest
  const messages = [
    {
      role: 'user',
      content: [{ text: INTAKE_SYSTEM + '\n\n---\nCurrent missing fields: ' + (missing.length ? missing.join(', ') : 'none') + '\nCurrent form values: ' + JSON.stringify(formValues) }]
    },
    {
      role: 'assistant',
      content: [{ text: '{"fields":{},"reply":"Understood. I will extract fields from each message and ask for one missing item at a time."}' }]
    },
    ...history.map(m => ({
      role: m.role,
      content: [{ text: String(m.content) }]
    }))
  ];

  try {
    const raw = await callBedrock(messages);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    jsonRes(res, 200, { ok: true, fields: parsed.fields || {}, reply: parsed.reply || 'Done.' });
  } catch (e) {
    console.error('Bedrock chat error:', e.message);
    jsonRes(res, 200, {
      ok: false, aiUnavailable: true,
      fallback: 'AI unavailable, using basic reader.',
      error: e.message
    });
  }
}

// ── POST /api/intake/email ────────────────────────────────────────────────────
async function handleIntakeEmail(req, res) {
  let body;
  try { body = await readJSON(req); }
  catch { jsonRes(res, 400, { error: 'Invalid JSON body' }); return; }

  const { subject = '', body: emailBody = '' } = body;
  const fullText = `Subject: ${subject}\n\n${emailBody}`;

  const messages = [
    {
      role: 'user',
      content: [{ text: INTAKE_SYSTEM + '\n\nIn addition to "fields" and "reply", also include a "draftReply" key: a short, professional email reply to the researcher listing the specific items still needed. Address it generically.\n\n---\nEmail to parse:\n' + fullText }]
    }
  ];

  try {
    const raw = await callBedrock(messages);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    jsonRes(res, 200, {
      ok: true,
      fields: parsed.fields || {},
      draftReply: parsed.draftReply || parsed.reply || 'Fields extracted from email.'
    });
  } catch (e) {
    console.error('Bedrock email error:', e.message);
    jsonRes(res, 200, {
      ok: false, aiUnavailable: true,
      fallback: 'AI unavailable, using basic reader.',
      error: e.message
    });
  }
}

// ── POST /api/report/summary ──────────────────────────────────────────────────
async function handleReportSummary(req, res) {
  let body;
  try { body = await readJSON(req); }
  catch { jsonRes(res, 400, { error: 'Invalid JSON body' }); return; }

  const { figures } = body;
  if (!figures) { jsonRes(res, 400, { error: '"figures" field required' }); return; }

  const prompt = `You are a research-core operations analyst writing a brief leadership summary. Use ONLY the numbers provided — do not invent, extrapolate, or add any numbers not given. Write 3–5 sentences in plain business English.

Figures:
${JSON.stringify(figures, null, 2)}`;

  try {
    const summary = await callBedrock([
      { role: 'user', content: [{ text: prompt }] }
    ]);
    jsonRes(res, 200, { ok: true, summary });
  } catch (e) {
    console.error('Bedrock report error:', e.message);
    jsonRes(res, 200, { ok: false, aiUnavailable: true, error: e.message });
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/requests
  if (req.method === 'GET' && url === '/api/requests') {
    jsonRes(res, 200, REQUESTS);
    return;
  }

  // POST /api/intake/chat
  if (req.method === 'POST' && url === '/api/intake/chat') {
    await handleIntakeChat(req, res);
    return;
  }

  // POST /api/intake/email
  if (req.method === 'POST' && url === '/api/intake/email') {
    await handleIntakeEmail(req, res);
    return;
  }

  // POST /api/report/summary
  if (req.method === 'POST' && url === '/api/report/summary') {
    await handleReportSummary(req, res);
    return;
  }

  // GET / → serve HTML
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('Cannot read index.html: ' + e.message);
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  CoreDesk → http://localhost:${PORT}        ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
  console.log(`  Bedrock model : ${process.env.BEDROCK_MODEL_ID || '(not set — AI endpoints will return aiUnavailable)'}`);
  console.log(`  AWS region    : ${process.env.AWS_REGION || '(not set)'}\n`);
});
