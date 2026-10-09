'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '20kb', type: 'application/json' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: isProduction ? '1h' : 0 }));

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Te veel aanmeldpogingen. Probeer het over 15 minuten opnieuw.' }
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Serverconfiguratie ontbreekt: ${name}`);
  return value.trim();
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max) : '';
}

function getPath(obj, dottedPath) {
  return String(dottedPath).split('.').reduce((value, key) => value == null ? undefined : value[key], obj);
}

function buildMappedPayload(mapping, source) {
  const result = {};
  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    if (typeof sourcePath !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(targetKey)) continue;
    const value = getPath(source, sourcePath);
    if (value !== undefined) result[targetKey] = value;
  }
  return result;
}

function loadCustomerMapping() {
  const mappingPath = path.resolve(__dirname, process.env.CUSTOMER_API_MAPPING_FILE || './customer-api-mapping.json');
  if (!fs.existsSync(mappingPath)) {
    const examplePath = path.join(__dirname, 'customer-api-mapping.example.json');
    if (!fs.existsSync(examplePath)) throw new Error('Customer API mappingbestand ontbreekt.');
    return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  }
  return JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
}

function nextcloudBase() {
  return requiredEnv('NEXTCLOUD_BASE_URL').replace(/\/+$/, '');
}

function ocsUrl(pathname) {
  return `${nextcloudBase()}/ocs/v2.php/cloud/${pathname}`;
}

async function nextcloudRequest(pathname, method, formData) {
  const user = requiredEnv('NEXTCLOUD_ADMIN_USER');
  const password = requiredEnv('NEXTCLOUD_ADMIN_APP_PASSWORD');
  const headers = {
    'OCS-APIRequest': 'true',
    'Accept': 'application/json',
    'Authorization': `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  };
  const options = { method, headers, signal: AbortSignal.timeout(12000) };
  if (formData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(formData).toString();
  }
  const response = await fetch(ocsUrl(pathname), options);
  const body = await response.json().catch(() => null);
  const statuscode = body?.ocs?.meta?.statuscode;
  if (!response.ok || !body?.ocs || (statuscode && statuscode >= 400)) {
    const error = new Error(`Nextcloud API request failed (${response.status}${statuscode ? `/${statuscode}` : ''})`);
    error.upstreamStatus = response.status;
    throw error;
  }
  return body.ocs;
}

function generateUsername(email) {
  const localPart = (email.split('@')[0] || 'user')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_.-]/g, '')
    .replace(/^[^a-z0-9]+/, '').slice(0, 22) || 'user';
  const prefix = (process.env.NEXTCLOUD_USERNAME_PREFIX || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 12);
  return `${prefix}${localPart}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 64);
}

async function sendCustomerApi(payload) {
  const url = requiredEnv('CUSTOMER_API_URL');
  const method = (process.env.CUSTOMER_API_METHOD || 'POST').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) throw new Error('CUSTOMER_API_METHOD moet POST, PUT of PATCH zijn.');
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const token = process.env.CUSTOMER_API_TOKEN;
  if (token) {
    const headerName = process.env.CUSTOMER_API_AUTH_HEADER || 'Authorization';
    const prefix = process.env.CUSTOMER_API_AUTH_PREFIX;
    headers[headerName] = prefix ? `${prefix} ${token}` : token;
  }
  const timeout = Math.min(Math.max(Number(process.env.CUSTOMER_API_TIMEOUT_MS || 10000), 1000), 30000);
  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
    redirect: 'error'
  });
  if (!response.ok) {
    const error = new Error(`Customer API returned HTTP ${response.status}`);
    error.upstreamStatus = response.status;
    throw error;
  }
  // Deliberately do not log or return the customer API response; it may contain personal data.
  return true;
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/signup', signupLimiter, async (req, res) => {
  if (process.env.INTERNAL_SIGNUP_SECRET) {
    const supplied = req.get('X-Signup-Secret') || '';
    if (!safeEqual(supplied, process.env.INTERNAL_SIGNUP_SECRET)) {
      return res.status(401).json({ error: 'Aanvraag niet geautoriseerd.' });
    }
  }

  const body = req.body || {};
  const c = body.customer || {};
  const a = body.account || body.nextcloud || {};
  const customer = {
    firstName: cleanText(c.firstName, 100),
    lastName: cleanText(c.lastName, 100),
    company: cleanText(c.company, 160),
    postalCode: cleanText(c.postalCode, 20),
    houseNumber: cleanText(c.houseNumber, 20),
    address: cleanText(c.address, 200),
    phone: cleanText(c.phone, 40)
  };
  const email = cleanText(a.email, 254).toLowerCase();
  const password = typeof a.password === 'string' ? a.password : '';
  const acceptedTerms = body.acceptedTerms === true;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!customer.firstName || !customer.lastName || !customer.company || !customer.postalCode || !customer.houseNumber || !customer.address || !emailValid || password.length < 12 || password.length > 256 || !acceptedTerms) {
    return res.status(400).json({ error: 'Controleer de verplichte velden, het e-mailadres, het wachtwoord en de voorwaarden.' });
  }

  let username;
  let nextcloudCreated = false;
  try {
    username = generateUsername(email);
    const displayName = `${customer.firstName} ${customer.lastName}`.trim();
    const form = { userid: username, password, displayName, email };
    const groups = (process.env.NEXTCLOUD_DEFAULT_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (process.env.NEXTCLOUD_DEFAULT_QUOTA) form.quota = process.env.NEXTCLOUD_DEFAULT_QUOTA.trim();
    await nextcloudRequest('users', 'POST', form);
    nextcloudCreated = true;

    for (const group of groups) {
      await nextcloudRequest(`users/${encodeURIComponent(username)}/groups`, 'POST', { group });
    }

    const source = {
      customer,
      account: { email },
      provisioning: { username },
      metadata: { createdAt: new Date().toISOString(), source: 'nextcloud-signup' }
    };
    const mapping = loadCustomerMapping();
    const customerPayload = buildMappedPayload(mapping, source);
    await sendCustomerApi(customerPayload);

    // Password is intentionally never persisted, logged, or returned to the browser.
    return res.status(201).json({
      ok: true,
      message: 'Uw aanvraag is verwerkt. U ontvangt verdere informatie per e-mail.',
      account: { username, email }
    });
  } catch (error) {
    // Best-effort compensation if the external customer API fails after Nextcloud creation.
    if (nextcloudCreated && username) {
      try { await nextcloudRequest(`users/${encodeURIComponent(username)}`, 'DELETE'); }
      catch (_rollbackError) { console.error('Signup compensation failed; manual review required.'); }
    }
    // Do not log request bodies, passwords, tokens, or upstream response bodies.
    console.error('Signup failed:', error.message, error.upstreamStatus ? `upstream=${error.upstreamStatus}` : '');
    return res.status(502).json({ error: 'Aanmelden is momenteel niet gelukt. Probeer het later opnieuw of neem contact op.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Aanvraag is te groot.' });
  console.error('Request failed:', err?.message || 'unknown error');
  res.status(400).json({ error: 'Ongeldige aanvraag.' });
});

app.listen(PORT, () => {
  console.log(`Signup app listening on port ${PORT}`);
  if (isProduction && !process.env.NEXTCLOUD_BASE_URL) console.warn('Configureer de verplichte variabelen in .env.');
});
