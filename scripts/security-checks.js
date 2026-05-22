const assert = require('assert/strict');

const BASE_URL = (process.env.SECURITY_CHECK_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const RESET_SEED = process.env.SECURITY_CHECK_RESET_SEED !== '0';

class ApiClient {
  constructor(name) {
    this.name = name;
    this.cookie = '';
    this.csrfToken = '';
  }

  async request(path, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {})
    };
    if (this.cookie) headers.Cookie = this.cookie;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.sendCsrf !== false && this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method || 'GET')) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(BASE_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];

    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    if (options.expectStatus !== undefined) {
      assert.equal(response.status, options.expectStatus, `${this.name} ${options.method || 'GET'} ${path} expected ${options.expectStatus}, got ${response.status}: ${text}`);
    }

    return { status: response.status, json, text };
  }

  async login(login, password) {
    const { json } = await this.request('/api/auth/login', {
      method: 'POST',
      body: { login, password },
      expectStatus: 200,
      sendCsrf: false
    });
    this.csrfToken = json.csrfToken;
    assert.equal(json.user.login, login);
    assert.ok(this.cookie.includes('app_session='), 'session cookie was not set');
    assert.ok(this.csrfToken, 'csrf token was not returned');
  }

  async state() {
    return (await this.request('/api/state', { expectStatus: 200 })).json;
  }

  async putState(partial, expectStatus = 200, sendCsrf = true) {
    return (await this.request('/api/state', {
      method: 'PUT',
      body: partial,
      expectStatus,
      sendCsrf
    })).json;
  }
}

function byId(items, id) {
  return (items || []).find(item => item.id === id);
}

async function main() {
  const anonymous = new ApiClient('anonymous');
  await anonymous.request('/api/state', { expectStatus: 401 });

  const admin = new ApiClient('admin');
  const analyst = new ApiClient('analyst');
  const editor = new ApiClient('editor');
  await admin.login('admin', 'admin');
  await analyst.login('analyst', 'analyst');
  await editor.login('editor', 'editor');

  if (RESET_SEED) {
    await admin.request('/api/seed/reset', { method: 'POST', body: {}, expectStatus: 200 });
  }

  await admin.putState({ tables: [] }, 403, false);
  await analyst.putState({ users: [{ login: 'analyst', role: 'administrator', isAdmin: true }] }, 403);

  const adminInitial = await admin.state();
  const analystInitial = await analyst.state();
  const editorInitial = await editor.state();

  assert.ok(byId(adminInitial.tables, 't3'), 'admin must see own table t3');
  assert.equal(byId(analystInitial.tables, 't3'), undefined, 'analyst must not see admin-only table t3');
  assert.ok(byId(analystInitial.tables, 't1'), 'analyst must see invited table t1');
  assert.ok(byId(adminInitial.forms, 'f3'), 'admin must see invited form f3');
  assert.ok(byId(editorInitial.forms, 'f3'), 'editor must see own form f3');

  const t1Name = `Security edit ${Date.now()}`;
  const analystTables = analystInitial.tables.map(table => ({ ...table }));
  const analystT1 = byId(analystTables, 't1');
  analystT1.name = t1Name;
  analystT1.cells = [['<script>alert(1)</script>', '=HYPERLINK("http://example.test")']];
  analystT1.ownerLogin = 'analyst';
  analystT1.invitedUsers = [];
  analystTables.push({
    id: 't3',
    name: 'stolen table',
    ownerLogin: 'analyst',
    invitedUsers: ['analyst'],
    cells: [['pwn']]
  });
  await analyst.putState({ tables: analystTables });

  const adminAfterAnalystEdit = await admin.state();
  const adminT1 = byId(adminAfterAnalystEdit.tables, 't1');
  const adminT3 = byId(adminAfterAnalystEdit.tables, 't3');
  assert.equal(adminT1.name, t1Name, 'invited table editor must be able to edit table content');
  assert.equal(adminT1.ownerLogin, 'admin', 'invited table editor must not change ownerLogin');
  assert.ok((adminT1.invitedUsers || []).some(login => login === 'analyst'), 'invited table editor must not revoke own invite');
  assert.notEqual(adminT3.name, 'stolen table', 'uninvited user must not modify foreign table by id');

  const adminTables = adminAfterAnalystEdit.tables.map(table => ({ ...table }));
  byId(adminTables, 't3').ownerLogin = 'analyst';
  await admin.putState({ tables: adminTables });
  const adminAfterOwnerAttempt = await admin.state();
  const analystAfterOwnerAttempt = await analyst.state();
  assert.equal(byId(adminAfterOwnerAttempt.tables, 't3').ownerLogin, 'admin', 'ownerLogin must be immutable through state payload');
  assert.equal(byId(analystAfterOwnerAttempt.tables, 't3'), undefined, 'owner transfer attempt must not leak table to another user');

  const f3Before = byId(editorInitial.forms, 'f3').name;
  const adminForms = adminInitial.forms.map(form => ({ ...form }));
  byId(adminForms, 'f3').name = 'mutated by invited user';
  await admin.putState({ forms: adminForms });
  const editorAfterFormAttempt = await editor.state();
  assert.equal(byId(editorAfterFormAttempt.forms, 'f3').name, f3Before, 'invited user must not edit foreign form structure');

  const adminResponses = (await admin.state()).responses || [];
  const editorResponses = (await editor.state()).responses || [];
  assert.equal(adminResponses.some(response => response.formId === 'f3' && response.user !== 'admin'), false, 'invited form user must not see other users responses');
  assert.ok(editorResponses.some(response => response.formId === 'f3'), 'form owner must see own form responses');

  const tablePage = (await admin.request('/api/list?type=tables&page=1&limit=2&comment=%D0%9F%D0%BB%D0%B0%D0%BD', { expectStatus: 200 })).json;
  assert.ok(tablePage.total >= 1, 'table list endpoint must filter by comment');
  assert.ok(tablePage.items.length <= 2, 'table list endpoint must apply server-side pagination');

  const usersPage = (await admin.request('/api/list?type=users&page=1&limit=10&q=admin', { expectStatus: 200 })).json;
  assert.ok(usersPage.items.some(user => user.login === 'admin'), 'users page endpoint must support user search');

  await analyst.request('/api/users/editor', { method: 'PATCH', body: { role: 'administrator' }, expectStatus: 403 });
  const editedUser = (await admin.request('/api/users/editor', { method: 'PATCH', body: { role: 'user' }, expectStatus: 200 })).json.user;
  assert.equal(editedUser.role, 'user', 'administrator must be able to edit user role');
  assert.ok(editedUser.updatedAt, 'user update must set updatedAt');
  const updatedFrom = encodeURIComponent(new Date(new Date(editedUser.updatedAt).getTime() - 1000).toISOString());
  const usersByUpdated = (await admin.request('/api/list?type=users&page=1&limit=10&updatedFrom=' + updatedFrom, { expectStatus: 200 })).json;
  assert.ok(usersByUpdated.items.some(user => user.login === 'editor'), 'users page endpoint must filter by updated datetime');

  const formLogsPage = (await editor.request('/api/list?type=formLogs&page=1&limit=10&answers=%D0%BF%D0%BE%D0%B7%D0%B8%D1%86', { expectStatus: 200 })).json;
  assert.ok(Array.isArray(formLogsPage.items), 'form log list endpoint must accept answer filters');

  const appJs = (await anonymous.request('/app.js', { expectStatus: 200 })).text;
  assert.ok(appJs.includes('escapeHtml(String(val))'), 'table cells must be escaped before insertion into HTML');
  assert.ok(appJs.includes('escapeHtml(fld.label)'), 'form labels must be escaped before insertion into HTML');

  const spreadsheetJs = (await anonymous.request('/spreadsheet.js', { expectStatus: 200 })).text;
  assert.ok(spreadsheetJs.includes('safeSpreadsheetText'), 'spreadsheet export must guard formula injection');
  assert.ok(spreadsheetJs.includes('encodePayload'), 'spreadsheet system payload must be encoded');

  console.log('Security smoke checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
