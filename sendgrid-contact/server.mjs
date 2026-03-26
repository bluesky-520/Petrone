/**
 * Minimal SendGrid relay for the BudgetApp contact form.
 *
 * Env:
 *   SENDGRID_API_KEY     — SendGrid API key (secret, server only)
 *   CONTACT_TO_EMAIL     — Inbox that receives inquiries (default: info@petronetechnologygroup.com)
 *   CONTACT_FROM_EMAIL   — Verified sender in SendGrid (required)
 *   CONTACT_FROM_NAME    — Optional display name for From
 *   CONTACT_API_SECRET   — Optional; if set, require Authorization: Bearer <same> on requests
 *   PORT                 — Listen port (default 8787)
 *
 * Run: node server.mjs
 * Deploy behind HTTPS (Railway, Render, Fly.io, etc.).
 */

import http from 'node:http';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL || 'info@petronetechnologygroup.com';
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL;
const CONTACT_FROM_NAME = process.env.CONTACT_FROM_NAME || 'Website contact';
const API_SECRET = process.env.CONTACT_API_SECRET;
const PORT = parseInt(process.env.PORT || '8787', 10);

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function buildMailBody(data) {
  return [
    `First Name: ${data.firstName || '-'}`,
    `Last Name: ${data.lastName || '-'}`,
    `Email: ${data.email || '-'}`,
    `Phone: ${data.phone || '-'}`,
    `Project Type: ${data.projectType || '-'}`,
    `How did you hear about us: ${data.referralSource || '-'}`,
    '',
    `Comment: ${data.comment || '-'}`,
  ].join('\n');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const path = (req.url || '').split('?')[0];
  if (req.method !== 'POST' || (path !== '/' && path !== '')) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  if (!SENDGRID_API_KEY) {
    json(res, 500, { error: 'server_misconfigured', detail: 'missing SENDGRID_API_KEY' });
    return;
  }
  if (!CONTACT_FROM) {
    json(res, 500, { error: 'server_misconfigured', detail: 'missing CONTACT_FROM_EMAIL' });
    return;
  }

  if (API_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${API_SECRET}`) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 400, { error: 'read_body_failed' });
    return;
  }

  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    json(res, 400, { error: 'invalid_json' });
    return;
  }

  const firstName = String(data.firstName || '').trim();
  const email = String(data.email || '').trim();
  if (!firstName || !email) {
    json(res, 400, { error: 'missing_fields', detail: 'firstName and email required' });
    return;
  }

  const subject = data.projectType?.trim()
    ? `Project Inquiry: ${String(data.projectType).trim()}`
    : 'Project Inquiry';

  const text = buildMailBody({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone,
    projectType: data.projectType,
    referralSource: data.referralSource,
    comment: data.comment,
  });

  const lastName = String(data.lastName || '').trim();
  const replyName = [firstName, lastName].filter(Boolean).join(' ') || firstName;

  const sgPayload = {
    personalizations: [{ to: [{ email: CONTACT_TO }] }],
    from: { email: CONTACT_FROM, name: CONTACT_FROM_NAME },
    reply_to: { email, name: replyName },
    subject,
    content: [{ type: 'text/plain', value: text }],
  };

  let sgRes;
  try {
    sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sgPayload),
    });
  } catch (e) {
    json(res, 502, { error: 'sendgrid_unreachable', detail: String(e) });
    return;
  }

  if (!sgRes.ok) {
    const detail = await sgRes.text();
    json(res, 502, { error: 'sendgrid_rejected', status: sgRes.status, detail });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log(`SendGrid contact relay listening on :${PORT}`);
});
