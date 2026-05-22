// Data layer for the prototype. The UI keeps a local cache for synchronous
// rendering, while the source of truth is ArangoDB through the Node API.

const STORAGE_KEYS = {
  tables: 'app_tables',
  forms: 'app_forms',
  users: 'app_users',
  user: 'app_user',
  tableLogs: 'app_table_logs',
  formLogs: 'app_form_logs'
};

const STORAGE_FORM_RESPONSES = 'app_form_responses';
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8081' : '';
const CSRF_STORAGE_KEY = 'app_csrf_token';

const defaultUsers = [
  { login: 'admin', role: 'administrator', createdAt: '2024-01-01T09:00:00.000Z', updatedAt: '2024-01-01T09:00:00.000Z' },
  { login: 'analyst', role: 'analyst', createdAt: '2024-01-02T09:00:00.000Z', updatedAt: '2024-01-02T09:00:00.000Z' },
  { login: 'editor', role: 'editor', createdAt: '2024-01-03T09:00:00.000Z', updatedAt: '2024-01-03T09:00:00.000Z' }
];

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

const initialTables = [
  { id: 't1', name: 'Бюджет 2024', owner: 'Иванов И.И.', ownerLogin: 'admin', invitedUsers: ['analyst'], createdAt: '2024-01-15T09:00:00.000Z', updatedAt: '2024-03-01T15:30:00.000Z', lastViewedAt: '2024-03-12T10:10:00.000Z', comment: '', cells: [['Проект', 'План', 'Факт'], ['Маркетинг', '100', '95'], ['Разработка', '200', '210']], history: [] },
  { id: 't2', name: 'Контакты', owner: 'Петрова А.С.', ownerLogin: 'analyst', invitedUsers: [], createdAt: '2024-02-01T08:45:00.000Z', updatedAt: '2024-02-28T14:00:00.000Z', lastViewedAt: '2024-03-09T12:00:00.000Z', comment: 'Актуальный список', cells: [['Имя', 'Email', 'Телефон'], ['Алексей', 'a@mail.ru', '+7 999 123-45-67']], history: [] }
];

const FORM_FIELD_TYPES = [
  { value: 'text', label: 'Краткий ответ' },
  { value: 'textarea', label: 'Развёрнутый ответ' },
  { value: 'number', label: 'Число' },
  { value: 'email', label: 'Email' },
  { value: 'date', label: 'Дата' },
  { value: 'radio', label: 'Один из списка' },
  { value: 'checkbox', label: 'Несколько из списка' },
  { value: 'select', label: 'Выпадающий список' },
  { value: 'scale', label: 'Шкала (1-10)' }
];

const initialForms = [
  { id: 'f1', name: 'Анкета нового сотрудника', owner: 'Петрова А.С.', createdAt: '2024-01-05T09:00:00.000Z', updatedAt: '2024-02-20T10:30:00.000Z', lastViewedAt: '2024-03-10T09:15:00.000Z', comment: '', description: 'Заполняется при приёме', status: 'published', fields: [
    { id: 'f1-1', type: 'text', label: 'ФИО', required: true },
    { id: 'f1-2', type: 'date', label: 'Дата рождения', required: false },
    { id: 'f1-3', type: 'text', label: 'Отдел', required: true },
    { id: 'f1-4', type: 'email', label: 'Email', required: true }
  ], history: [], ownerLogin: 'analyst', invitedUsers: [] }
];

let apiAvailable = true;
let persistQueue = Promise.resolve();

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value || []));
}

function normalizeUserList(users) {
  return (users || []).map(user => String(user || '').trim()).filter(Boolean);
}

function inferOwnerLogin(resource) {
  const knownLogins = new Set(loadUsers().map(user => String(user.login || '').toLowerCase()));
  const explicit = String(resource?.ownerLogin || '').trim();
  if (explicit) return explicit;
  const owner = String(resource?.owner || '').trim();
  if (knownLogins.has(owner.toLowerCase())) return owner;
  return OWNER_LOGIN_BY_ID[resource?.id] || OWNER_LOGIN_BY_NAME[owner] || owner || 'admin';
}

function normalizeAccess(resource) {
  const ownerLogin = inferOwnerLogin(resource);
  const invitedUsers = normalizeUserList(resource?.invitedUsers || DEFAULT_INVITES_BY_ID[resource?.id] || [])
    .filter(login => login.toLowerCase() !== ownerLogin.toLowerCase());
  return { ownerLogin, invitedUsers: [...new Set(invitedUsers)] };
}

function normalizeTable(table) {
  return {
    history: [],
    lastViewedAt: null,
    comment: '',
    cells: [],
    ...table,
    ...normalizeAccess(table),
    history: table?.history || []
  };
}

function normalizeForm(form) {
  return {
    history: [],
    lastViewedAt: null,
    comment: '',
    description: '',
    status: 'draft',
    fields: [],
    ...form,
    ...normalizeAccess(form),
    history: form?.history || []
  };
}

async function fetchJson(url, options) {
  const opts = options || {};
  const method = String(opts.method || 'GET').toUpperCase();
  const csrfToken = sessionStorage.getItem(CSRF_STORAGE_KEY);
  const headers = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(opts.headers || {})
  };
  const response = await fetch(API_BASE + url, {
    ...opts,
    credentials: 'same-origin',
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || response.statusText);
    err.status = response.status;
    throw err;
  }
  return data;
}

async function fetchList(type, params = {}) {
  const query = new URLSearchParams({ type });
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  return fetchJson('/api/list?' + query.toString());
}

async function updateUser(login, patch) {
  const data = await fetchJson('/api/users/' + encodeURIComponent(login), {
    method: 'PATCH',
    body: JSON.stringify(patch || {})
  });
  if (data.user) {
    const users = loadUsers();
    const index = users.findIndex(user => String(user.login || '').toLowerCase() === String(data.user.login || '').toLowerCase());
    if (index >= 0) users[index] = data.user;
    else users.push(data.user);
    saveUsers(users);
  }
  return data.user;
}

function setAuthSession(user, csrfToken) {
  if (user?.login) localStorage.setItem(STORAGE_KEYS.user, user.login);
  if (csrfToken) sessionStorage.setItem(CSRF_STORAGE_KEY, csrfToken);
}

function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEYS.user);
  sessionStorage.removeItem(CSRF_STORAGE_KEY);
}

async function loadCurrentSession() {
  const session = await fetchJson('/api/auth/me');
  setAuthSession(session.user, session.csrfToken);
  return session;
}

async function logoutSession() {
  try {
    await fetchJson('/api/auth/logout', { method: 'POST' });
  } finally {
    clearAuthSession();
  }
}

function persistState(partial) {
  if (!apiAvailable) return persistQueue;
  persistQueue = persistQueue
    .then(() => fetchJson('/api/state', {
      method: 'PUT',
      body: JSON.stringify(partial)
    }))
    .catch(err => {
      apiAvailable = false;
      console.warn('Не удалось сохранить данные в API, используется локальный кэш:', err.message);
    });
  return persistQueue;
}

async function initializeAppData() {
  try {
    const state = await fetchJson('/api/state');
    if (Array.isArray(state.users)) writeJson(STORAGE_KEYS.users, state.users);
    if (Array.isArray(state.tables)) writeJson(STORAGE_KEYS.tables, state.tables.map(normalizeTable));
    if (Array.isArray(state.forms)) writeJson(STORAGE_KEYS.forms, state.forms.map(normalizeForm));
    if (Array.isArray(state.responses)) writeJson(STORAGE_FORM_RESPONSES, state.responses);
    if (Array.isArray(state.tableLogs)) writeJson(STORAGE_KEYS.tableLogs, state.tableLogs);
    if (Array.isArray(state.formLogs)) writeJson(STORAGE_KEYS.formLogs, state.formLogs);
    apiAvailable = true;
  } catch (err) {
    if (err.status === 401) throw err;
    apiAvailable = false;
    console.warn('API недоступен, приложение запущено из локального кэша:', err.message);
    if (!localStorage.getItem(STORAGE_KEYS.users)) writeJson(STORAGE_KEYS.users, defaultUsers);
    if (!localStorage.getItem(STORAGE_KEYS.tables)) writeJson(STORAGE_KEYS.tables, initialTables);
    if (!localStorage.getItem(STORAGE_KEYS.forms)) writeJson(STORAGE_KEYS.forms, initialForms);
    if (!localStorage.getItem(STORAGE_FORM_RESPONSES)) writeJson(STORAGE_FORM_RESPONSES, []);
    if (!localStorage.getItem(STORAGE_KEYS.tableLogs)) writeJson(STORAGE_KEYS.tableLogs, []);
    if (!localStorage.getItem(STORAGE_KEYS.formLogs)) writeJson(STORAGE_KEYS.formLogs, []);
  }
}

function loadUsers() {
  const users = readJson(STORAGE_KEYS.users, defaultUsers);
  if (!localStorage.getItem(STORAGE_KEYS.users)) writeJson(STORAGE_KEYS.users, users);
  return users;
}

function saveUsers(users) {
  writeJson(STORAGE_KEYS.users, users);
}

function findUser(login) {
  return loadUsers().find(u => (u.login || '').toLowerCase() === String(login || '').trim().toLowerCase());
}

async function registerUser(login, password) {
  try {
    const session = await fetchJson('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
    setAuthSession(session.user, session.csrfToken);
    return { ok: true, user: session.user };
  } catch (err) {
    return { ok: false, error: err.message || 'Не удалось зарегистрироваться' };
  }
}

async function validateLogin(login, password) {
  try {
    const session = await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
    setAuthSession(session.user, session.csrfToken);
    return { ok: true, user: session.user };
  } catch (err) {
    return { ok: false, error: err.message || 'Неверный логин или пароль' };
  }
}

function loadTables() {
  return readJson(STORAGE_KEYS.tables, initialTables).map(normalizeTable);
}

function saveTables(tables) {
  const list = (tables || []).map(normalizeTable);
  writeJson(STORAGE_KEYS.tables, list);
  return persistState({ tables: list });
}

function loadForms() {
  return readJson(STORAGE_KEYS.forms, initialForms).map(normalizeForm);
}

function saveForms(forms) {
  const list = (forms || []).map(normalizeForm);
  writeJson(STORAGE_KEYS.forms, list);
  return persistState({ forms: list });
}

function loadFormResponses() {
  return readJson(STORAGE_FORM_RESPONSES, []);
}

function saveFormResponses(arr) {
  const responses = arr || [];
  writeJson(STORAGE_FORM_RESPONSES, responses);
  return persistState({ responses });
}

function loadTableLogs() {
  return readJson(STORAGE_KEYS.tableLogs, []);
}

function saveTableLogs(logs) {
  writeJson(STORAGE_KEYS.tableLogs, logs || []);
  return persistState({ tableLogs: logs || [] });
}

function loadFormLogs() {
  return readJson(STORAGE_KEYS.formLogs, []);
}

function saveFormLogs(logs) {
  writeJson(STORAGE_KEYS.formLogs, logs || []);
  return persistState({ formLogs: logs || [] });
}

function addTableHistory(tableId, entry) {
  const tables = loadTables();
  const t = tables.find(x => x.id === tableId);
  const now = new Date();
  const log = {
    id: 'tl' + Date.now(),
    tableId,
    tableName: t?.name || entry.tableName || '',
    owner: t?.owner || '',
    createdAt: t?.createdAt || '',
    updatedAt: now.toISOString(),
    viewedAt: t?.lastViewedAt || '',
    date: now.toISOString(),
    ...entry
  };
  if (t) {
    t.history = t.history || [];
    t.history.unshift({ id: log.id, date: log.date, action: log.action, user: log.user });
    t.updatedAt = log.updatedAt;
    saveTables(tables);
  }
  const logs = loadTableLogs();
  logs.unshift(log);
  saveTableLogs(logs);
}

function getTableHistory(tableId) {
  const logs = loadTableLogs().filter(x => x.tableId === tableId);
  if (logs.length) return logs.map(x => ({ id: x.id, date: x.date, action: x.action, user: x.user }));
  const t = loadTables().find(x => x.id === tableId);
  return (t && t.history) ? t.history : [];
}

function addFormHistory(formId, entry) {
  const forms = loadForms();
  const f = forms.find(x => x.id === formId);
  const now = new Date();
  const log = {
    id: 'fl' + Date.now(),
    formId,
    formName: f?.name || entry.formName || '',
    owner: f?.owner || '',
    status: f?.status || '',
    fieldsCount: f?.fields ? f.fields.length : 0,
    createdAt: f?.createdAt || '',
    updatedAt: now.toISOString(),
    date: now.toISOString(),
    ...entry
  };
  if (f) {
    f.history = f.history || [];
    f.history.unshift({ id: log.id, date: log.date, action: log.action, user: log.user });
    f.updatedAt = log.updatedAt;
    saveForms(forms);
  }
  const logs = loadFormLogs();
  logs.unshift(log);
  saveFormLogs(logs);
}

function getFormHistory(formId) {
  const logs = loadFormLogs().filter(x => x.formId === formId);
  if (logs.length) return logs.map(x => ({ id: x.id, date: x.date, action: x.action, user: x.user }));
  const f = loadForms().find(x => x.id === formId);
  return (f && f.history) ? f.history : [];
}

function getAppState() {
  return {
    users: loadUsers(),
    tables: loadTables(),
    forms: loadForms(),
    responses: loadFormResponses(),
    tableLogs: loadTableLogs(),
    formLogs: loadFormLogs()
  };
}

function replaceAllAppData(data) {
  const saves = [];
  if (Array.isArray(data.tables)) saves.push(saveTables(data.tables));
  if (Array.isArray(data.forms)) saves.push(saveForms(data.forms));
  if (Array.isArray(data.responses)) saves.push(saveFormResponses(data.responses));
  if (Array.isArray(data.tableLogs)) saves.push(saveTableLogs(data.tableLogs));
  if (Array.isArray(data.formLogs)) saves.push(saveFormLogs(data.formLogs));
  return Promise.all(saves);
}

window.appDataReady = Promise.resolve();
