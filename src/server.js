const fs = require('fs/promises');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PORT = Number(process.env.APP_PORT || 8080);
const ARANGO_URL = (process.env.ARANGO_URL || 'http://127.0.0.1:8529').replace(/\/$/, '');
const ARANGO_DB = process.env.ARANGO_DB || 'tables_forms_app';
const ARANGO_USER = process.env.ARANGO_USER || 'root';
const ARANGO_PASSWORD = process.env.ARANGO_PASSWORD || 'prototype-password';
const BODY_LIMIT = 15 * 1024 * 1024;
const SESSION_COOKIE = 'app_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SECURE_COOKIES = process.env.APP_SECURE_COOKIES === '1';
const LOGIN_RE = /^[a-zA-Z0-9_.@-]{2,64}$/;
const PASSWORD_MIN_LENGTH = 8;
const sessions = new Map();
const authAttempts = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
const MAX_RESOURCES_PER_TYPE = 300;
const MAX_ROWS_PER_TABLE = 300;
const MAX_COLS_PER_TABLE = 120;
const MAX_FIELDS_PER_FORM = 100;
const MAX_OPTIONS_PER_FIELD = 100;
const MAX_RESPONSES = 5000;
const MAX_LOGS = 5000;
const MAX_NAME_LENGTH = 160;
const MAX_TEXT_LENGTH = 5000;
const MAX_CELL_LENGTH = 5000;
const MAX_OPTION_LENGTH = 500;
const MAX_ANSWER_FIELDS = 200;
const MAX_ANSWER_VALUES = 100;
const ALLOWED_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'email', 'date', 'radio', 'checkbox', 'select', 'scale']);
const ALLOWED_USER_ROLES = new Set(['administrator', 'analyst', 'editor', 'user']);

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'"
].join('; ');

const STATIC_FILES = new Map([
  ['/', path.join(PUBLIC_DIR, 'index.html')],
  ['/index.html', path.join(PUBLIC_DIR, 'index.html')],
  ['/styles.css', path.join(PUBLIC_DIR, 'styles.css')],
  ['/app.js', path.join(PUBLIC_DIR, 'app.js')],
  ['/data.js', path.join(PUBLIC_DIR, 'data.js')],
  ['/spreadsheet.js', path.join(PUBLIC_DIR, 'spreadsheet.js')],
  ['/vendor/fflate.js', path.join(PUBLIC_DIR, 'vendor', 'fflate.js')],
  ['/vendor/fflate.NOTICE.md', path.join(PUBLIC_DIR, 'vendor', 'fflate.NOTICE.md')]
]);

const COLLECTIONS = {
  users: 'users',
  spreadsheets: 'spreadsheets',
  tableRows: 'table_rows',
  forms: 'forms',
  formResponses: 'form_responses',
  activityLog: 'activity_log',
  userAssets: 'user_assets',
  formTargets: 'form_targets'
};

const COLLECTION_ORDER = ['users', 'spreadsheets', 'tableRows', 'forms', 'formResponses', 'activityLog', 'userAssets', 'formTargets'];
const CLIENT_STATE_KEYS = ['users', 'tables', 'forms', 'responses', 'tableLogs', 'formLogs'];
const EDGE_COLLECTION_KEYS = new Set(['userAssets', 'formTargets']);
let dbReadyPromise;

const OWNER_LOGIN_BY_NAME = {
  'Иванов И.И.': 'admin',
  'Петрова А.С.': 'analyst',
  'Сидоров П.К.': 'editor',
  'Кузнецова М.Н.': 'editor',
  'Орлов Д.С.': 'editor',
  'Смирнова Е.В.': 'admin'
};

const OWNER_LOGIN_BY_ID = {
  t1: 'admin',
  t2: 'analyst',
  t3: 'admin',
  t4: 'editor',
  t5: 'analyst',
  t6: 'editor',
  t7: 'editor',
  t8: 'admin',
  f1: 'analyst',
  f2: 'admin',
  f3: 'editor',
  f4: 'analyst',
  f5: 'admin',
  f6: 'editor',
  f7: 'editor',
  f8: 'admin'
};

const DEFAULT_INVITES_BY_ID = {
  t1: ['analyst'],
  t4: ['admin'],
  t8: ['editor'],
  f3: ['admin'],
  f8: ['analyst']
};

const MIME_TYPES = {
  '.css': 'text/css; charset=UTF-8',
  '.html': 'text/html; charset=UTF-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',
  '.md': 'text/markdown; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=UTF-8',
  '.xml': 'application/xml; charset=UTF-8'
};

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashPassword(password, salt = randomToken(16)) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { passwordSalt: salt, passwordHash: hash };
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(user, password) {
  if (!user || typeof password !== 'string') return false;
  if (user.passwordHash && user.passwordSalt) {
    const candidate = hashPassword(password, user.passwordSalt).passwordHash;
    return safeEqualHex(candidate, user.passwordHash);
  }
  return typeof user.password === 'string' && user.password === password;
}

function publicUser(user) {
  return {
    login: normalizeLogin(user?.login),
    role: user?.role || 'user',
    createdAt: user?.createdAt || '',
    updatedAt: user?.updatedAt || user?.createdAt || ''
  };
}

function sanitizeUserForStorage(user) {
  const login = normalizeLogin(user?.login);
  if (!LOGIN_RE.test(login)) return null;
  const createdAt = user?.createdAt || new Date().toISOString();
  const clean = {
    login,
    role: ALLOWED_USER_ROLES.has(String(user?.role || 'user')) ? String(user?.role || 'user') : 'user',
    createdAt,
    updatedAt: user?.updatedAt || createdAt
  };
  if (user?.passwordHash && user?.passwordSalt) {
    clean.passwordHash = String(user.passwordHash);
    clean.passwordSalt = String(user.passwordSalt);
  } else if (typeof user?.password === 'string' && user.password) {
    Object.assign(clean, hashPassword(user.password));
  }
  return clean.passwordHash && clean.passwordSalt ? clean : null;
}

function sanitizeUsersForStorage(users) {
  const seen = new Set();
  const clean = [];
  for (const user of users || []) {
    const next = sanitizeUserForStorage(user);
    const key = next?.login.toLowerCase();
    if (!next || seen.has(key)) continue;
    seen.add(key);
    clean.push(next);
  }
  return clean;
}

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': CSP,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function authHeader() {
  return `Basic ${Buffer.from(`${ARANGO_USER}:${ARANGO_PASSWORD}`).toString('base64')}`;
}

function dbPath(dbName, apiPath) {
  return `${ARANGO_URL}/_db/${encodeURIComponent(dbName)}${apiPath}`;
}

async function arangoFetch(apiPath, options = {}, dbName = ARANGO_DB) {
  const response = await fetch(dbPath(dbName, apiPath), {
    ...options,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const msg = body.errorMessage || body.message || response.statusText;
    const err = new Error(`ArangoDB ${response.status}: ${msg}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function arangoFetchSystem(apiPath, options = {}) {
  return arangoFetch(apiPath, options, '_system');
}

async function waitForArango() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await arangoFetchSystem('/_api/version');
      return;
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw lastError || new Error('ArangoDB is not available');
}

async function ensureDatabase() {
  try {
    await arangoFetchSystem('/_api/database', {
      method: 'POST',
      body: JSON.stringify({ name: ARANGO_DB })
    });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
}

async function ensureCollection(name, type = 2) {
  try {
    await arangoFetch('/_api/collection', {
      method: 'POST',
      body: JSON.stringify({ name, type })
    });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
}

async function ensurePersistentIndex(collectionName, fields, unique = false) {
  try {
    await arangoFetch(`/_api/index?collection=${encodeURIComponent(collectionName)}`, {
      method: 'POST',
      body: JSON.stringify({ type: 'persistent', fields, unique })
    });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
}

async function ensureIndexes() {
  await ensurePersistentIndex(COLLECTIONS.users, ['login'], true);
  await ensurePersistentIndex(COLLECTIONS.tableRows, ['spreadsheetId', 'rowIndex'], true);
  await ensurePersistentIndex(COLLECTIONS.tableRows, ['spreadsheetId']);
  await ensurePersistentIndex(COLLECTIONS.formResponses, ['formId', 'submittedAt']);
  await ensurePersistentIndex(COLLECTIONS.activityLog, ['entityType', 'entityId', 'createdAt']);
  await ensurePersistentIndex(COLLECTIONS.activityLog, ['userId', 'createdAt']);
  await ensurePersistentIndex(COLLECTIONS.userAssets, ['_from', '_to']);
  await ensurePersistentIndex(COLLECTIONS.formTargets, ['_from', '_to'], true);
}

function stripArangoFields(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, _rev, ...rest } = doc;
  if (!rest.id && rest._key) rest.id = rest._key;
  return rest;
}

function keyForDoc(doc, collectionKey) {
  const raw = doc.id || doc.login || doc._key || `${collectionKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return String(raw).replace(/[^a-zA-Z0-9_:.@()+,=;$!*'%-]/g, '_').slice(0, 254);
}

function prepareDoc(doc, collectionKey) {
  const clean = stripArangoFields({ ...(doc || {}) });
  clean._key = keyForDoc(clean, collectionKey);
  delete clean.id;
  return clean;
}

function normalizeLogin(value) {
  return String(value || '').trim();
}

function sameLogin(a, b) {
  return normalizeLogin(a).toLowerCase() === normalizeLogin(b).toLowerCase();
}

function docId(doc) {
  return String(doc?.id || doc?._key || '');
}

function uniqueLogins(users, ownerLogin) {
  const seen = new Set();
  const result = [];
  for (const user of users || []) {
    const login = normalizeLogin(user);
    const key = login.toLowerCase();
    if (!login || sameLogin(login, ownerLogin) || seen.has(key)) continue;
    seen.add(key);
    result.push(login);
  }
  return result;
}

function inferOwnerLogin(doc) {
  const explicit = normalizeLogin(doc?.ownerLogin);
  if (explicit) return explicit;
  const owner = normalizeLogin(doc?.owner);
  if (['admin', 'analyst', 'editor'].includes(owner.toLowerCase())) return owner;
  return OWNER_LOGIN_BY_ID[docId(doc)] || OWNER_LOGIN_BY_NAME[owner] || owner || 'admin';
}

function normalizeAccessDoc(doc) {
  const ownerLogin = inferOwnerLogin(doc);
  return {
    ...(doc || {}),
    ownerLogin,
    invitedUsers: uniqueLogins(doc?.invitedUsers || DEFAULT_INVITES_BY_ID[docId(doc)] || [], ownerLogin)
  };
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

function cleanId(value, fallbackPrefix) {
  const raw = cleanText(value, 96).trim();
  const safe = raw.replace(/[^a-zA-Z0-9_.:@-]/g, '_');
  return safe || `${fallbackPrefix}-${randomToken(8)}`;
}

function cleanDate(value, fallback) {
  return cleanText(value, 64) || fallback;
}

function cleanNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function userLoginSet(users) {
  return new Set((users || [])
    .map(user => normalizeLogin(user?.login).toLowerCase())
    .filter(Boolean));
}

function cleanInvitedUsers(invitedUsers, ownerLogin, validLogins) {
  const ownerKey = normalizeLogin(ownerLogin).toLowerCase();
  const seen = new Set();
  const result = [];
  for (const loginRaw of invitedUsers || []) {
    const login = normalizeLogin(loginRaw);
    const key = login.toLowerCase();
    if (!login || key === ownerKey || seen.has(key)) continue;
    if (validLogins && !validLogins.has(key)) continue;
    seen.add(key);
    result.push(login);
  }
  return result;
}

function cleanCells(cells) {
  return (Array.isArray(cells) ? cells : [])
    .slice(0, MAX_ROWS_PER_TABLE)
    .map(row => (Array.isArray(row) ? row : [])
      .slice(0, MAX_COLS_PER_TABLE)
      .map(cell => cleanText(cell, MAX_CELL_LENGTH)));
}

function cleanSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    frozenRows: cleanNumber(source.frozenRows, 0, 20, 1),
    defaultColumnWidth: cleanNumber(source.defaultColumnWidth, 40, 600, 120)
  };
}

function cleanTable(tableRaw, index, validLogins, now) {
  const table = normalizeAccessDoc(tableRaw);
  const ownerLogin = normalizeLogin(table.ownerLogin);
  if (!ownerLogin || !validLogins.has(ownerLogin.toLowerCase())) return null;
  const cells = cleanCells(table.cells);
  return normalizeAccessDoc({
    id: cleanId(docId(table) || `table-${index + 1}`, 'table'),
    name: cleanText(table.name, MAX_NAME_LENGTH),
    owner: ownerLogin,
    ownerLogin,
    invitedUsers: cleanInvitedUsers(table.invitedUsers, ownerLogin, validLogins),
    createdAt: cleanDate(table.createdAt, now),
    updatedAt: cleanDate(table.updatedAt, cleanDate(table.createdAt, now)),
    lastViewedAt: table.lastViewedAt ? cleanDate(table.lastViewedAt, null) : null,
    comment: cleanText(table.comment, MAX_TEXT_LENGTH),
    cells,
    rowCount: cleanNumber(table.rowCount, 1, MAX_ROWS_PER_TABLE, Math.max(40, cells.length)),
    colCount: cleanNumber(table.colCount, 1, MAX_COLS_PER_TABLE, Math.max(40, ...cells.map(row => row.length), 0)),
    settings: cleanSettings(table.settings)
  });
}

function cleanFormFields(fields) {
  return (Array.isArray(fields) ? fields : [])
    .slice(0, MAX_FIELDS_PER_FORM)
    .map((fieldRaw, index) => {
      const field = fieldRaw && typeof fieldRaw === 'object' ? fieldRaw : {};
      const type = ALLOWED_FIELD_TYPES.has(field.type) ? field.type : 'text';
      const options = (Array.isArray(field.options) ? field.options : [])
        .slice(0, MAX_OPTIONS_PER_FIELD)
        .map(option => cleanText(option, MAX_OPTION_LENGTH));
      return {
        id: cleanId(field.id || `field-${index + 1}`, 'field'),
        type,
        label: cleanText(field.label, MAX_NAME_LENGTH),
        required: Boolean(field.required),
        options,
        min: field.min === undefined || field.min === null ? '' : cleanText(field.min, 64),
        max: field.max === undefined || field.max === null ? '' : cleanText(field.max, 64)
      };
    });
}

function cleanForm(formRaw, index, validLogins, now) {
  const form = normalizeAccessDoc(formRaw);
  const ownerLogin = normalizeLogin(form.ownerLogin);
  if (!ownerLogin || !validLogins.has(ownerLogin.toLowerCase())) return null;
  return normalizeAccessDoc({
    id: cleanId(docId(form) || `form-${index + 1}`, 'form'),
    name: cleanText(form.name, MAX_NAME_LENGTH),
    owner: ownerLogin,
    ownerLogin,
    invitedUsers: cleanInvitedUsers(form.invitedUsers, ownerLogin, validLogins),
    createdAt: cleanDate(form.createdAt, now),
    updatedAt: cleanDate(form.updatedAt, cleanDate(form.createdAt, now)),
    lastViewedAt: form.lastViewedAt ? cleanDate(form.lastViewedAt, null) : null,
    comment: cleanText(form.comment, MAX_TEXT_LENGTH),
    description: cleanText(form.description, MAX_TEXT_LENGTH),
    status: cleanText(form.status || 'draft', 32),
    fields: cleanFormFields(form.fields)
  });
}

function cleanAnswerValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ANSWER_VALUES).map(item => cleanText(item, MAX_TEXT_LENGTH));
  }
  if (value && typeof value === 'object') return cleanText(JSON.stringify(value), MAX_TEXT_LENGTH);
  return cleanText(value, MAX_TEXT_LENGTH);
}

function cleanAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(answers).slice(0, MAX_ANSWER_FIELDS)) {
    clean[cleanId(key, 'answer')] = cleanAnswerValue(value);
  }
  return clean;
}

function cleanResponse(responseRaw, index, validLogins, validFormIds, now) {
  const formId = cleanId(responseRaw?.formId, 'form');
  const submittedBy = normalizeLogin(responseRaw?.submittedBy || responseRaw?.user);
  if (!validFormIds.has(formId) || !submittedBy || !validLogins.has(submittedBy.toLowerCase())) return null;
  const response = {
    _key: cleanId(docId(responseRaw) || `response-${index + 1}`, 'response'),
    formId,
    submittedBy,
    submittedAt: cleanDate(responseRaw?.submittedAt, now),
    answers: cleanAnswers(responseRaw?.answers)
  };
  if (responseRaw?.targetRowId) response.targetRowId = cleanId(responseRaw.targetRowId, 'row');
  return response;
}

function cleanActivityLog(logRaw, index, type, validIds, validLogins, now) {
  const refKey = type === 'spreadsheet' ? 'tableId' : 'formId';
  const entityId = cleanId(logRaw?.[refKey] || logRaw?.entityId, type);
  const userId = normalizeLogin(logRaw?.user || logRaw?.userId);
  if (entityId && !validIds.has(entityId)) return null;
  if (userId && !validLogins.has(userId.toLowerCase())) return null;
  const diff = type === 'spreadsheet'
    ? {
        tableName: cleanText(logRaw?.tableName || logRaw?.diff?.tableName, MAX_NAME_LENGTH),
        owner: cleanText(logRaw?.owner || logRaw?.diff?.owner, MAX_NAME_LENGTH),
        createdAt: cleanDate(logRaw?.createdAt || logRaw?.diff?.createdAt, ''),
        updatedAt: cleanDate(logRaw?.updatedAt || logRaw?.diff?.updatedAt, ''),
        viewedAt: cleanDate(logRaw?.viewedAt || logRaw?.diff?.viewedAt, ''),
        cell: cleanText(logRaw?.cell || logRaw?.diff?.cell, 32),
        value: cleanText(logRaw?.value || logRaw?.diff?.value, MAX_TEXT_LENGTH),
        details: cleanText(logRaw?.details || logRaw?.diff?.details, MAX_TEXT_LENGTH)
      }
    : {
        formName: cleanText(logRaw?.formName || logRaw?.diff?.formName, MAX_NAME_LENGTH),
        owner: cleanText(logRaw?.owner || logRaw?.diff?.owner, MAX_NAME_LENGTH),
        status: cleanText(logRaw?.status || logRaw?.diff?.status, 32),
        fieldsCount: cleanNumber(logRaw?.fieldsCount || logRaw?.diff?.fieldsCount, 0, MAX_FIELDS_PER_FORM, 0),
        createdAt: cleanDate(logRaw?.createdAt || logRaw?.diff?.createdAt, ''),
        updatedAt: cleanDate(logRaw?.updatedAt || logRaw?.diff?.updatedAt, ''),
        answers: cleanText(logRaw?.answers || logRaw?.diff?.answers, MAX_TEXT_LENGTH),
        details: cleanText(logRaw?.details || logRaw?.diff?.details, MAX_TEXT_LENGTH)
      };
  return {
    _key: cleanId(docId(logRaw) || `${type}-log-${index + 1}`, `${type}-log`),
    entityType: type,
    entityId,
    action: cleanText(logRaw?.action, MAX_NAME_LENGTH),
    userId,
    createdAt: cleanDate(logRaw?.date || logRaw?.createdAt || logRaw?.updatedAt, now),
    diff
  };
}

function isDocOwner(userLogin, doc) {
  return sameLogin(normalizeAccessDoc(doc).ownerLogin, userLogin);
}

function hasDocAccess(userLogin, doc) {
  const user = normalizeLogin(userLogin);
  if (!user || !doc) return false;
  const normalized = normalizeAccessDoc(doc);
  return sameLogin(normalized.ownerLogin, user) || (normalized.invitedUsers || []).some(login => sameLogin(login, user));
}

function columnName(index) {
  let n = Number(index) + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name || 'A';
}

function columnIndex(ref) {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || 'A';
  return letters.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function entityKey(handle) {
  return String(handle || '').split('/').pop() || '';
}

function entityCollection(handle) {
  return String(handle || '').split('/')[0] || '';
}

function entityHandle(collectionName, key) {
  return `${collectionName}/${key}`;
}

function normalizeAssetAccess(userAssets, collectionName, assetId, fallbackOwnerId) {
  let ownerLogin = normalizeLogin(fallbackOwnerId);
  const invitedUsers = [];
  for (const edge of userAssets || []) {
    if (entityCollection(edge?._to) !== collectionName || entityKey(edge?._to) !== assetId) continue;
    const login = normalizeLogin(entityKey(edge?._from));
    if (!login) continue;
    if (edge.role === 'owner') ownerLogin = login;
    else invitedUsers.push(login);
  }
  return {
    ownerLogin: ownerLogin || 'admin',
    invitedUsers: uniqueLogins(invitedUsers, ownerLogin || 'admin')
  };
}

function cellsFromTableRows(rows) {
  const cells = [];
  for (const row of rows || []) {
    const rowIndex = Math.max(0, Number(row.rowIndex || 1) - 1);
    const values = row.values && typeof row.values === 'object' ? row.values : {};
    if (!cells[rowIndex]) cells[rowIndex] = [];
    for (const [col, value] of Object.entries(values)) {
      cells[rowIndex][columnIndex(col)] = value == null ? '' : String(value);
    }
  }
  return cells.map(row => row || []);
}

function tableRowsFromCells(table, defaultCreatedAt, defaultUpdatedAt) {
  const rows = [];
  const cells = Array.isArray(table?.cells) ? table.cells : [];
  cells.forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const values = {};
    row.forEach((cell, colIndex) => {
      const value = cell == null ? '' : String(cell);
      if (value !== '') values[columnName(colIndex)] = value;
    });
    if (!Object.keys(values).length) return;
    rows.push({
      _key: `${docId(table)}_row_${index + 1}`,
      spreadsheetId: docId(table),
      rowIndex: index + 1,
      values,
      createdAt: table.createdAt || defaultCreatedAt,
      updatedAt: table.updatedAt || defaultUpdatedAt
    });
  });
  return rows;
}

function activityToTableLog(log, tablesById) {
  const table = tablesById.get(String(log.entityId || ''));
  return {
    id: docId(log),
    tableId: String(log.entityId || ''),
    tableName: log.diff?.tableName || table?.name || '',
    owner: log.diff?.owner || table?.owner || table?.ownerLogin || '',
    action: log.action || '',
    user: log.userId || '',
    date: log.createdAt || '',
    createdAt: log.diff?.createdAt || table?.createdAt || '',
    updatedAt: log.diff?.updatedAt || table?.updatedAt || '',
    viewedAt: log.diff?.viewedAt || table?.lastViewedAt || '',
    cell: log.diff?.cell || '',
    value: log.diff?.value || '',
    details: log.diff?.details || ''
  };
}

function activityToFormLog(log, formsById) {
  const form = formsById.get(String(log.entityId || ''));
  return {
    id: docId(log),
    formId: String(log.entityId || ''),
    formName: log.diff?.formName || form?.name || '',
    owner: log.diff?.owner || form?.owner || form?.ownerLogin || '',
    status: log.diff?.status || form?.status || '',
    fieldsCount: Number(log.diff?.fieldsCount ?? form?.fields?.length ?? 0),
    action: log.action || '',
    user: log.userId || '',
    date: log.createdAt || '',
    createdAt: log.diff?.createdAt || form?.createdAt || '',
    updatedAt: log.diff?.updatedAt || form?.updatedAt || '',
    answers: log.diff?.answers || '',
    details: log.diff?.details || ''
  };
}

function dataModelToLegacyState(state) {
  const userAssets = state.userAssets || [];
  const rowsBySpreadsheet = new Map();
  for (const row of state.tableRows || []) {
    const spreadsheetId = String(row.spreadsheetId || '');
    if (!rowsBySpreadsheet.has(spreadsheetId)) rowsBySpreadsheet.set(spreadsheetId, []);
    rowsBySpreadsheet.get(spreadsheetId).push(row);
  }

  const tables = (state.spreadsheets || []).map(sheet => {
    const id = docId(sheet);
    const access = normalizeAssetAccess(userAssets, COLLECTIONS.spreadsheets, id, sheet.ownerId);
    return normalizeAccessDoc({
      id,
      name: sheet.name || '',
      owner: sheet.owner || access.ownerLogin,
      ownerLogin: access.ownerLogin,
      invitedUsers: access.invitedUsers,
      createdAt: sheet.createdAt || '',
      updatedAt: sheet.updatedAt || '',
      lastViewedAt: sheet.lastViewedAt || null,
      comment: sheet.comment || '',
      cells: cellsFromTableRows(rowsBySpreadsheet.get(id) || []),
      history: [],
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      settings: sheet.settings || {}
    });
  });

  const forms = (state.forms || []).map(form => {
    const id = docId(form);
    const access = normalizeAssetAccess(userAssets, COLLECTIONS.forms, id, form.ownerId);
    return normalizeAccessDoc({
      id,
      name: form.name || '',
      owner: form.owner || access.ownerLogin,
      ownerLogin: access.ownerLogin,
      invitedUsers: access.invitedUsers,
      createdAt: form.createdAt || '',
      updatedAt: form.updatedAt || '',
      lastViewedAt: form.lastViewedAt || null,
      comment: form.comment || '',
      description: form.description || '',
      status: form.status || 'draft',
      fields: Array.isArray(form.fields) ? form.fields : [],
      history: []
    });
  });

  const tablesById = new Map(tables.map(table => [docId(table), table]));
  const formsById = new Map(forms.map(form => [docId(form), form]));
  const responses = (state.formResponses || []).map(response => ({
    id: docId(response),
    formId: String(response.formId || ''),
    submittedAt: response.submittedAt || '',
    user: response.submittedBy || '',
    answers: response.answers || {},
    targetRowId: response.targetRowId
  }));

  const tableLogs = [];
  const formLogs = [];
  for (const log of state.activityLog || []) {
    if (log.entityType === 'spreadsheet') tableLogs.push(activityToTableLog(log, tablesById));
    if (log.entityType === 'form') formLogs.push(activityToFormLog(log, formsById));
  }

  return {
    users: state.users || [],
    tables,
    forms,
    responses,
    tableLogs,
    formLogs
  };
}

function legacyStateToDataModelState(legacy, existingUsers = [], existingFormTargets = []) {
  const now = new Date().toISOString();
  const users = sanitizeUsersForStorage(existingUsers.length ? existingUsers : legacy.users || []);
  const validLogins = userLoginSet(users);
  const spreadsheets = [];
  const tableRows = [];
  const forms = [];
  const formResponses = [];
  const activityLog = [];
  const userAssets = [];

  const addUserAsset = (login, collectionName, assetId, role) => {
    const userKey = normalizeLogin(login);
    if (!userKey || !assetId) return;
    userAssets.push({
      _key: `${userKey}_${collectionName}_${assetId}_${role}`.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 254),
      _from: entityHandle(COLLECTIONS.users, userKey),
      _to: entityHandle(collectionName, assetId),
      role
    });
  };

  for (const [index, tableRaw] of (legacy.tables || []).slice(0, MAX_RESOURCES_PER_TYPE).entries()) {
    const table = cleanTable(tableRaw, index, validLogins, now);
    if (!table) continue;
    const id = docId(table);
    if (!id) continue;
    const createdAt = table.createdAt || now;
    const updatedAt = table.updatedAt || createdAt;
    const cells = table.cells;
    const colCount = Math.max(40, ...cells.map(row => row.length), Number(table.colCount || 0));
    spreadsheets.push({
      _key: id,
      name: table.name || '',
      ownerId: table.ownerLogin,
      rowCount: Math.min(MAX_ROWS_PER_TABLE, Math.max(40, cells.length, Number(table.rowCount || 0))),
      colCount,
      createdAt,
      updatedAt,
      lastViewedAt: table.lastViewedAt || null,
      comment: table.comment || '',
      settings: table.settings || { frozenRows: 1, defaultColumnWidth: 120 }
    });
    tableRows.push(...tableRowsFromCells(table, createdAt, updatedAt));
    addUserAsset(table.ownerLogin, COLLECTIONS.spreadsheets, id, 'owner');
    for (const login of table.invitedUsers || []) addUserAsset(login, COLLECTIONS.spreadsheets, id, 'editor');
  }

  for (const [index, formRaw] of (legacy.forms || []).slice(0, MAX_RESOURCES_PER_TYPE).entries()) {
    const form = cleanForm(formRaw, index, validLogins, now);
    if (!form) continue;
    const id = docId(form);
    if (!id) continue;
    const createdAt = form.createdAt || now;
    const updatedAt = form.updatedAt || createdAt;
    forms.push({
      _key: id,
      name: form.name || '',
      description: form.description || '',
      ownerId: form.ownerLogin,
      status: form.status || 'draft',
      createdAt,
      updatedAt,
      lastViewedAt: form.lastViewedAt || null,
      comment: form.comment || '',
      fields: Array.isArray(form.fields) ? form.fields : []
    });
    addUserAsset(form.ownerLogin, COLLECTIONS.forms, id, 'owner');
    for (const login of form.invitedUsers || []) addUserAsset(login, COLLECTIONS.forms, id, 'editor');
  }

  const validFormIds = new Set(forms.map(form => form._key));
  const validSpreadsheetIds = new Set(spreadsheets.map(sheet => sheet._key));

  for (const [index, responseRaw] of (legacy.responses || []).slice(0, MAX_RESPONSES).entries()) {
    const response = cleanResponse(responseRaw, index, validLogins, validFormIds, now);
    if (response) formResponses.push(response);
  }

  for (const [index, log] of (legacy.tableLogs || []).slice(0, MAX_LOGS).entries()) {
    const cleanLog = cleanActivityLog(log, index, 'spreadsheet', validSpreadsheetIds, validLogins, now);
    if (cleanLog) activityLog.push(cleanLog);
  }

  for (const [index, log] of (legacy.formLogs || []).slice(0, MAX_LOGS).entries()) {
    const cleanLog = cleanActivityLog(log, index, 'form', validFormIds, validLogins, now);
    if (cleanLog) activityLog.push(cleanLog);
  }

  const formTargets = (existingFormTargets || []).filter(edge =>
    validFormIds.has(entityKey(edge._from)) && validSpreadsheetIds.has(entityKey(edge._to))
  );

  return { users, spreadsheets, tableRows, forms, formResponses, activityLog, userAssets, formTargets };
}

async function allDocs(collectionName) {
  const cursor = await arangoFetch('/_api/cursor', {
    method: 'POST',
    body: JSON.stringify({
      query: 'FOR doc IN @@collection RETURN doc',
      bindVars: { '@collection': collectionName },
      batchSize: 1000
    })
  });
  return (cursor.result || []).map(stripArangoFields);
}

async function collectionCount(collectionName) {
  const data = await arangoFetch(`/_api/collection/${encodeURIComponent(collectionName)}/count`);
  return Number(data.count || 0);
}

async function replaceCollection(collectionName, collectionKey, docs) {
  await arangoFetch(`/_api/collection/${encodeURIComponent(collectionName)}/truncate`, { method: 'PUT' });
  const safeDocs = collectionKey === 'users' ? sanitizeUsersForStorage(docs) : (docs || []);
  for (const doc of safeDocs) {
    await arangoFetch(`/_api/document/${encodeURIComponent(collectionName)}`, {
      method: 'POST',
      body: JSON.stringify(prepareDoc(doc, collectionKey))
    });
  }
}

async function loadSeed() {
  const seedPath = path.join(DATA_DIR, 'seed-data.json');
  const raw = await fs.readFile(seedPath, 'utf8');
  const seed = JSON.parse(raw);
  if (Array.isArray(seed.spreadsheets) || Array.isArray(seed.tableRows) || Array.isArray(seed.formResponses)) {
    return {
      users: seed.users || [],
      spreadsheets: seed.spreadsheets || [],
      tableRows: seed.tableRows || seed.table_rows || [],
      forms: seed.forms || [],
      formResponses: seed.formResponses || seed.form_responses || seed.responses || [],
      activityLog: seed.activityLog || seed.activity_log || seed.activity || [],
      userAssets: seed.userAssets || seed.user_assets || [],
      formTargets: seed.formTargets || seed.form_targets || []
    };
  }
  return legacyStateToDataModelState(seed, seed.users || [], []);
}

async function seedIfEmpty() {
  const tablesCount = await collectionCount(COLLECTIONS.spreadsheets);
  const formsCount = await collectionCount(COLLECTIONS.forms);
  if (tablesCount || formsCount) return;

  const seed = await loadSeed();
  for (const key of COLLECTION_ORDER) {
    await replaceCollection(COLLECTIONS[key], key, seed[key] || []);
  }
}

async function migrateLegacyUsers() {
  const users = await allDocs(COLLECTIONS.users);
  if (!users.some(user => user.password || !user.passwordHash || !user.passwordSalt)) return;
  await replaceCollection(COLLECTIONS.users, 'users', users);
}

async function ensureDbReady() {
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await waitForArango();
      await ensureDatabase();
      for (const key of COLLECTION_ORDER) {
        await ensureCollection(COLLECTIONS[key], EDGE_COLLECTION_KEYS.has(key) ? 3 : 2);
      }
      await ensureIndexes();
      await seedIfEmpty();
      await migrateLegacyUsers();
    })();
  }
  return dbReadyPromise;
}

async function getRawState() {
  await ensureDbReady();
  const entries = await Promise.all(
    COLLECTION_ORDER.map(async key => [key, await allDocs(COLLECTIONS[key])])
  );
  return Object.fromEntries(entries);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });
  return cookies;
}

function sessionCookieValue(token, maxAgeSeconds) {
  const secure = SECURE_COOKIES ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookieValue() {
  const secure = SECURE_COOKIES ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) sessions.delete(token);
  }
}

function createSession(user) {
  cleanupSessions();
  const token = randomToken();
  const csrfToken = randomToken();
  const publicProfile = publicUser(user);
  sessions.set(token, {
    csrfToken,
    user: publicProfile,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return { token, csrfToken, user: publicProfile };
}

function authAttemptKey(req, login) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  return `${ip}:${normalizeLogin(login).toLowerCase()}`;
}

function isAuthRateLimited(req, login) {
  const key = authAttemptKey(req, login);
  const entry = authAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    authAttempts.delete(key);
    return false;
  }
  return entry.count >= AUTH_MAX_ATTEMPTS;
}

function recordFailedAuth(req, login) {
  const key = authAttemptKey(req, login);
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearFailedAuth(req, login) {
  authAttempts.delete(authAttemptKey(req, login));
}

function getSession(req) {
  cleanupSessions();
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Authentication required' });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  const token = req.headers['x-csrf-token'];
  if (!session || !token || token !== session.csrfToken) {
    sendJson(res, 403, { error: 'Invalid CSRF token' });
    return false;
  }
  return true;
}

async function findStoredUser(login) {
  const users = await allDocs(COLLECTIONS.users);
  return users.find(user => sameLogin(user.login, login)) || null;
}

async function createStoredUser(login, password) {
  const users = await allDocs(COLLECTIONS.users);
  if (users.some(user => sameLogin(user.login, login))) {
    const err = new Error('Пользователь с таким логином уже существует');
    err.statusCode = 409;
    throw err;
  }
  const user = sanitizeUserForStorage({
    login,
    password,
    role: 'user',
    createdAt: new Date().toISOString()
  });
  if (!user) {
    const err = new Error('Некорректные регистрационные данные');
    err.statusCode = 400;
    throw err;
  }
  await arangoFetch(`/_api/document/${encodeURIComponent(COLLECTIONS.users)}`, {
    method: 'POST',
    body: JSON.stringify(prepareDoc(user, 'users'))
  });
  return user;
}

async function updateStoredUser(login, patch) {
  const targetLogin = normalizeLogin(login);
  const users = await allDocs(COLLECTIONS.users);
  const index = users.findIndex(user => sameLogin(user.login, targetLogin));
  if (index < 0) {
    const err = new Error('Пользователь не найден');
    err.statusCode = 404;
    throw err;
  }

  const current = users[index];
  const nextRole = normalizeLogin(patch?.role || current.role || 'user');
  if (!ALLOWED_USER_ROLES.has(nextRole)) {
    const err = new Error('Некорректная роль пользователя');
    err.statusCode = 400;
    throw err;
  }

  const adminCount = users.filter(user => user.role === 'administrator').length;
  if (current.role === 'administrator' && nextRole !== 'administrator' && adminCount <= 1) {
    const err = new Error('Нельзя убрать роль последнего администратора');
    err.statusCode = 400;
    throw err;
  }

  const updated = sanitizeUserForStorage({
    ...current,
    role: nextRole,
    login: current.login,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  });
  users[index] = updated;
  await replaceCollection(COLLECTIONS.users, 'users', users);

  for (const session of sessions.values()) {
    if (sameLogin(session.user?.login, updated.login)) session.user = publicUser(updated);
  }

  return publicUser(updated);
}

function filterStateForUser(state, userLogin) {
  const legacyState = dataModelToLegacyState(state);
  const user = normalizeLogin(userLogin);
  if (!user) {
    return {
      users: [],
      tables: [],
      forms: [],
      responses: [],
      tableLogs: [],
      formLogs: []
    };
  }

  const tables = (legacyState.tables || []).map(normalizeAccessDoc).filter(table => hasDocAccess(user, table));
  const forms = (legacyState.forms || []).map(normalizeAccessDoc).filter(form => hasDocAccess(user, form));
  const tableIds = new Set(tables.map(docId));
  const formIds = new Set(forms.map(docId));
  const formsById = new Map(forms.map(form => [docId(form), form]));

  return {
    users: (legacyState.users || []).map(publicUser),
    tables,
    forms,
    responses: (legacyState.responses || []).filter(response => {
      const formId = String(response.formId || '');
      const form = formsById.get(formId);
      return formIds.has(formId) && (isDocOwner(user, form) || sameLogin(response.user, user));
    }),
    tableLogs: (legacyState.tableLogs || []).filter(log => {
      const tableId = String(log.tableId || '');
      return (!tableId && sameLogin(log.user, user)) || tableIds.has(tableId) || sameLogin(log.user, user);
    }),
    formLogs: (legacyState.formLogs || []).filter(log => {
      const formId = String(log.formId || '');
      return (!formId && sameLogin(log.user, user)) || formIds.has(formId) || sameLogin(log.user, user);
    })
  };
}

async function getState(userLogin) {
  return filterStateForUser(await getRawState(), userLogin);
}

function textIncludes(value, query) {
  const needle = normalizeLogin(query).toLowerCase();
  if (!needle) return true;
  return String(value ?? '').toLowerCase().includes(needle);
}

function parseDateTimeParam(value, isEnd) {
  const raw = normalizeLogin(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(raw + (isEnd ? 'T23:59:59.999' : 'T00:00:00.000'));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function dateInRange(value, from, to) {
  if (from == null && to == null) return true;
  const time = new Date(value || '').getTime();
  if (Number.isNaN(time)) return false;
  if (from != null && time < from) return false;
  if (to != null && time > to) return false;
  return true;
}

function numberInRange(value, min, max) {
  if (min == null && max == null) return true;
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  if (min != null && num < min) return false;
  if (max != null && num > max) return false;
  return true;
}

function listParams(searchParams) {
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 10)));
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

function paginate(items, searchParams) {
  const { limit, page, offset } = listParams(searchParams);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    page,
    limit
  };
}

function responseAnswersText(response) {
  const answers = response?.answers && typeof response.answers === 'object' ? response.answers : {};
  return Object.entries(answers)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value ?? '')}`)
    .join('; ');
}

function enrichFormLogAnswers(log, responses) {
  if (log.answers) return log.answers;
  if (!log.formId) return '';
  const sameForm = (responses || []).filter(response => response.formId === log.formId && (!log.user || sameLogin(response.user, log.user)));
  if (!sameForm.length) return '';
  sameForm.sort((a, b) => Math.abs(new Date(a.submittedAt || '').getTime() - new Date(log.date || '').getTime()) -
    Math.abs(new Date(b.submittedAt || '').getTime() - new Date(log.date || '').getTime()));
  return responseAnswersText(sameForm[0]);
}

function filterList(type, state, searchParams) {
  const q = normalizeLogin(searchParams.get('q')).toLowerCase();
  const get = key => normalizeLogin(searchParams.get(key));
  const from = key => parseDateTimeParam(searchParams.get(`${key}From`), false);
  const to = key => parseDateTimeParam(searchParams.get(`${key}To`), true);

  if (type === 'tables') {
    return (state.tables || []).filter(item => {
      if (q && ![item.name, item.owner, item.ownerLogin, item.comment, item.createdAt, item.updatedAt, item.lastViewedAt].some(value => textIncludes(value, q))) return false;
      if (!textIncludes(item.name, get('name'))) return false;
      if (!textIncludes(item.owner || item.ownerLogin, get('owner'))) return false;
      if (!textIncludes(item.comment, get('comment'))) return false;
      if (!dateInRange(item.createdAt, from('created'), to('created'))) return false;
      if (!dateInRange(item.updatedAt, from('updated'), to('updated'))) return false;
      if (!dateInRange(item.lastViewedAt, from('viewed'), to('viewed'))) return false;
      return true;
    }).sort((a, b) => new Date(b.lastViewedAt || b.updatedAt || 0) - new Date(a.lastViewedAt || a.updatedAt || 0));
  }

  if (type === 'forms') {
    return (state.forms || []).filter(item => {
      if (q && ![item.name, item.owner, item.ownerLogin, item.comment, item.description, item.createdAt, item.updatedAt, item.lastViewedAt].some(value => textIncludes(value, q))) return false;
      if (!textIncludes(item.name, get('name'))) return false;
      if (!textIncludes(item.owner || item.ownerLogin, get('owner'))) return false;
      if (!textIncludes(item.comment, get('comment'))) return false;
      if (!dateInRange(item.createdAt, from('created'), to('created'))) return false;
      if (!dateInRange(item.updatedAt, from('updated'), to('updated'))) return false;
      if (!dateInRange(item.lastViewedAt, from('viewed'), to('viewed'))) return false;
      return true;
    }).sort((a, b) => new Date(b.lastViewedAt || b.updatedAt || 0) - new Date(a.lastViewedAt || a.updatedAt || 0));
  }

  if (type === 'users') {
    return (state.users || []).filter(item => {
      if (q && ![item.login, item.role, item.createdAt, item.updatedAt].some(value => textIncludes(value, q))) return false;
      if (!textIncludes(item.login, get('login'))) return false;
      if (!textIncludes(item.role, get('role'))) return false;
      if (!dateInRange(item.createdAt, from('created'), to('created'))) return false;
      if (!dateInRange(item.updatedAt, from('updated'), to('updated'))) return false;
      return true;
    }).sort((a, b) => String(a.login || '').localeCompare(String(b.login || ''), 'ru'));
  }

  if (type === 'tableLogs') {
    return (state.tableLogs || []).filter(item => {
      if (q && ![item.tableName, item.action, item.user, item.owner, item.cell, item.value, item.details, item.createdAt, item.updatedAt, item.viewedAt, item.date].some(value => textIncludes(value, q))) return false;
      if (!textIncludes(item.tableName, get('tableName'))) return false;
      if (!textIncludes(item.action, get('action'))) return false;
      if (!textIncludes(item.user, get('user'))) return false;
      if (!textIncludes(item.owner, get('owner'))) return false;
      if (!textIncludes(item.cell, get('cell'))) return false;
      if (!textIncludes(item.value, get('value'))) return false;
      if (!dateInRange(item.createdAt, from('created'), to('created'))) return false;
      if (!dateInRange(item.updatedAt, from('updated'), to('updated'))) return false;
      if (!dateInRange(item.viewedAt, from('viewed'), to('viewed'))) return false;
      if (!dateInRange(item.date, from('date'), to('date'))) return false;
      return true;
    }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  if (type === 'formLogs') {
    const responses = state.responses || [];
    return (state.formLogs || []).map(log => ({ ...log, answers: enrichFormLogAnswers(log, responses) })).filter(item => {
      if (q && ![item.formName, item.action, item.user, item.owner, item.status, item.answers, item.details, item.date].some(value => textIncludes(value, q))) return false;
      if (!textIncludes(item.formName, get('formName'))) return false;
      if (!textIncludes(item.action, get('action'))) return false;
      if (!textIncludes(item.user, get('user'))) return false;
      if (!textIncludes(item.owner, get('owner'))) return false;
      if (!textIncludes(item.answers, get('answers'))) return false;
      if (get('status') && item.status !== get('status')) return false;
      if (!numberInRange(item.fieldsCount, searchParams.get('fieldsMin') ? Number(searchParams.get('fieldsMin')) : null, searchParams.get('fieldsMax') ? Number(searchParams.get('fieldsMax')) : null)) return false;
      if (!dateInRange(item.createdAt, from('created'), to('created'))) return false;
      if (!dateInRange(item.updatedAt, from('updated'), to('updated'))) return false;
      if (!dateInRange(item.date, from('date'), to('date'))) return false;
      return true;
    }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  return null;
}

async function getListState(type, userLogin, searchParams) {
  const state = await getState(userLogin);
  const items = filterList(type, state, searchParams);
  if (!items) {
    const err = new Error('Unknown list type');
    err.statusCode = 400;
    throw err;
  }
  return paginate(items, searchParams);
}

function mergeResourcesForUser(existingDocs, incomingDocs, userLogin, options = {}) {
  const user = normalizeLogin(userLogin);
  if (!user) throw new Error('Authentication required');
  const allowInvitedEdits = Boolean(options.allowInvitedEdits);

  const incomingById = new Map();
  for (const incoming of incomingDocs || []) {
    const normalized = normalizeAccessDoc(incoming);
    const id = docId(normalized);
    if (id) incomingById.set(id, normalized);
  }

  const result = [];
  for (const existingRaw of existingDocs || []) {
    const existing = normalizeAccessDoc(existingRaw);
    const id = docId(existing);
    const incoming = incomingById.get(id);
    const canAccess = hasDocAccess(user, existing);
    const isOwner = isDocOwner(user, existing);

    if (!canAccess) {
      if (incoming) incomingById.delete(id);
      result.push(existing);
      continue;
    }

    if (!incoming) {
      if (!isOwner) result.push(existing);
      continue;
    }

    incomingById.delete(id);
    if (isOwner) {
      result.push(normalizeAccessDoc({
        ...incoming,
        ownerLogin: existing.ownerLogin,
        owner: existing.owner,
        createdAt: existing.createdAt
      }));
    } else if (allowInvitedEdits) {
      result.push(normalizeAccessDoc({
        ...existing,
        ...incoming,
        owner: existing.owner,
        ownerLogin: existing.ownerLogin,
        invitedUsers: existing.invitedUsers,
        createdAt: existing.createdAt
      }));
    } else {
      result.push(existing);
    }
  }

  for (const incoming of incomingById.values()) {
    const normalized = normalizeAccessDoc(incoming);
    if (!sameLogin(normalized.ownerLogin, user)) continue;
    const next = normalizeAccessDoc({
      ...normalized,
      owner: user,
      ownerLogin: user
    });
    result.push(next);
  }

  return result;
}

function mergeChildDocsForUser(existingDocs, incomingDocs, userLogin, resources, refKey) {
  const user = normalizeLogin(userLogin);
  if (!user) throw new Error('Authentication required');
  const accessibleIds = new Set((resources || []).filter(resource => hasDocAccess(user, resource)).map(docId));
  const resourceById = new Map((resources || []).map(resource => [docId(resource), resource]));
  const isAllowed = doc => {
    const ref = String(doc?.[refKey] || '');
    return (!ref && sameLogin(doc?.user, user)) || accessibleIds.has(ref) || sameLogin(doc?.user, user);
  };
  const result = [...(existingDocs || [])];
  const indexById = new Map();
  result.forEach((doc, index) => {
    const id = docId(doc);
    if (id) indexById.set(id, index);
  });

  for (const incoming of incomingDocs || []) {
    if (!isAllowed(incoming)) continue;
    const id = docId(incoming) || `${refKey}-${Date.now()}-${randomToken(6)}`;
    const ref = String(incoming?.[refKey] || '');
    const resource = resourceById.get(ref);
    const cleanIncoming = {
      ...(incoming || {}),
      id,
      user: sameLogin(incoming?.user, user) ? incoming.user : user
    };

    if (!indexById.has(id)) {
      indexById.set(id, result.length);
      result.push(cleanIncoming);
      continue;
    }

    const existing = result[indexById.get(id)];
    if (sameLogin(existing?.user, user) || (resource && isDocOwner(user, resource))) {
      result[indexById.get(id)] = {
        ...existing,
        ...cleanIncoming,
        user: existing?.user || cleanIncoming.user
      };
    }
  }

  return result;
}

async function updateState(partial, userLogin) {
  await ensureDbReady();
  const rawState = await getRawState();
  const nextState = dataModelToLegacyState(rawState);

  for (const key of CLIENT_STATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      if (!Array.isArray(partial[key])) throw new Error(`${key} must be an array`);
      if (key === 'users') {
        const err = new Error('Users cannot be modified through state import');
        err.statusCode = 403;
        throw err;
      } else if (key === 'tables') {
        nextState.tables = mergeResourcesForUser(nextState.tables, partial.tables, userLogin, { allowInvitedEdits: true });
      } else if (key === 'forms') {
        nextState.forms = mergeResourcesForUser(nextState.forms, partial.forms, userLogin);
      } else if (key === 'responses') {
        nextState.responses = mergeChildDocsForUser(nextState.responses, partial.responses, userLogin, nextState.forms, 'formId');
      } else if (key === 'tableLogs') {
        nextState.tableLogs = mergeChildDocsForUser(nextState.tableLogs, partial.tableLogs, userLogin, nextState.tables, 'tableId');
      } else if (key === 'formLogs') {
        nextState.formLogs = mergeChildDocsForUser(nextState.formLogs, partial.formLogs, userLogin, nextState.forms, 'formId');
      }
    }
  }

  const nextDataModel = legacyStateToDataModelState(nextState, rawState.users || [], rawState.formTargets || []);
  for (const key of COLLECTION_ORDER) {
    if (key === 'users') continue;
    await replaceCollection(COLLECTIONS[key], key, nextDataModel[key] || []);
  }
  return filterStateForUser(nextDataModel, userLogin);
}

function sendJson(res, statusCode, data, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, securityHeaders({
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  }));
  res.end(payload);
}

function clientError(err, fallback = 'Bad request') {
  if (err?.statusCode && err.statusCode >= 500) return 'Internal server error';
  return err?.message || fallback;
}

function staticFilePath(pathname) {
  const normalized = path.posix.normalize(pathname || '/');
  if (/^\/(?:tables|forms)(?:\/[a-zA-Z0-9_.:@-]+)?$/.test(normalized)) return STATIC_FILES.get('/index.html');
  if (/^\/users(?:\/[a-zA-Z0-9_.@-]+)?$/.test(normalized)) return STATIC_FILES.get('/index.html');
  if (/^\/table-actions(?:\/[a-zA-Z0-9_.:@-]+)?$/.test(normalized)) return STATIC_FILES.get('/index.html');
  if (['/table-actions', '/form-actions', '/tables-log', '/forms-log', '/users', '/import', '/export', '/statistics'].includes(normalized)) return STATIC_FILES.get('/index.html');
  return STATIC_FILES.get(normalized) || null;
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType && !contentType.includes('application/json')) {
    const err = new Error('Content-Type must be application/json');
    err.statusCode = 415;
    throw err;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_LIMIT) {
      const err = new Error('Request body is too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

async function serveStatic(req, res) {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  const filePath = staticFilePath(pathname);
  if (!filePath) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, securityHeaders({
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length
    }));
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    console.error('Static file error:', err);
    sendJson(res, err.code === 'ENOENT' ? 404 : 500, { error: err.code === 'ENOENT' ? 'Not found' : 'Internal server error' });
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      await ensureDbReady();
      sendJson(res, 200, { ok: true, db: ARANGO_DB });
    } catch (err) {
      console.error('Health check failed:', err);
      sendJson(res, 503, { ok: false, error: 'Database is not available' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const session = requireSession(req, res);
    if (!session) return;
    sendJson(res, 200, {
      user: session.user,
      csrfToken: session.csrfToken
    }, {
      'Set-Cookie': sessionCookieValue(session.token, Math.floor(SESSION_TTL_MS / 1000))
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      await ensureDbReady();
      const body = await readJsonBody(req);
      const login = normalizeLogin(body.login);
      const password = typeof body.password === 'string' ? body.password : '';
      if (isAuthRateLimited(req, login)) {
        sendJson(res, 429, { error: 'Слишком много попыток входа. Повторите позже.' });
        return;
      }
      const user = await findStoredUser(login);
      if (!user || !verifyPassword(user, password)) {
        recordFailedAuth(req, login);
        sendJson(res, 401, { error: 'Неверный логин или пароль' });
        return;
      }
      clearFailedAuth(req, login);
      const session = createSession(user);
      sendJson(res, 200, {
        user: session.user,
        csrfToken: session.csrfToken
      }, {
        'Set-Cookie': sessionCookieValue(session.token, Math.floor(SESSION_TTL_MS / 1000))
      });
    } catch (err) {
      console.error('Login failed:', err);
      sendJson(res, err.statusCode || 400, { error: clientError(err) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    try {
      await ensureDbReady();
      const body = await readJsonBody(req);
      const login = normalizeLogin(body.login);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!LOGIN_RE.test(login)) {
        sendJson(res, 400, { error: 'Логин должен быть 2-64 символа: латиница, цифры, точка, подчёркивание, дефис или @.' });
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        sendJson(res, 400, { error: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.` });
        return;
      }
      const user = await createStoredUser(login, password);
      const session = createSession(user);
      sendJson(res, 201, {
        user: session.user,
        csrfToken: session.csrfToken
      }, {
        'Set-Cookie': sessionCookieValue(session.token, Math.floor(SESSION_TTL_MS / 1000))
      });
    } catch (err) {
      console.error('Registration failed:', err);
      sendJson(res, err.statusCode || 400, { error: clientError(err) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const session = getSession(req);
    if (session && !requireCsrf(req, res, session)) return;
    if (session) sessions.delete(session.token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookieValue() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      sendJson(res, 200, await getState(session.user.login));
    } catch (err) {
      console.error('State read failed:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/list') {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const type = normalizeLogin(url.searchParams.get('type'));
      sendJson(res, 200, await getListState(type, session.user.login, url.searchParams));
    } catch (err) {
      const status = err.statusCode || 400;
      if (status >= 500) console.error('List read failed:', err);
      sendJson(res, status, { error: clientError(err) });
    }
    return;
  }

  const userApiMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userApiMatch) {
    const session = requireSession(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    if (session.user.role !== 'administrator') {
      sendJson(res, 403, { error: 'Administrator role required' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const user = await updateStoredUser(decodeURIComponent(userApiMatch[1]), body || {});
      sendJson(res, 200, { user });
    } catch (err) {
      const status = err.statusCode || 400;
      if (status >= 500) console.error('User update failed:', err);
      sendJson(res, status, { error: clientError(err) });
    }
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/state') {
    const session = requireSession(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await updateState(body || {}, session.user.login));
    } catch (err) {
      const status = err.statusCode || 400;
      if (status >= 500) console.error('State update failed:', err);
      sendJson(res, status, { error: clientError(err) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/seed/reset') {
    const session = requireSession(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    if (session.user.role !== 'administrator') {
      sendJson(res, 403, { error: 'Administrator role required' });
      return;
    }
    try {
      const seed = await loadSeed();
      await ensureDbReady();
      for (const key of COLLECTION_ORDER) {
        await replaceCollection(COLLECTIONS[key], key, seed[key] || []);
      }
      sendJson(res, 200, await getState(session.user.login));
    } catch (err) {
      console.error('Seed reset failed:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url || '/', 'http://localhost');
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    await serveStatic(req, res);
  } catch (err) {
    console.error('Unhandled request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

ensureDbReady()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`App is running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize application:', err);
    process.exit(1);
  });
