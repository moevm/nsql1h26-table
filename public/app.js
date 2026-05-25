(function () {
  const TITLES = {
    tables: 'Таблицы',
    forms: 'Формы',
    'table-view': 'Таблица',
    'form-view': 'Форма',
    'create-table': 'Создание таблицы',
    'create-form': 'Создание формы',
    import: 'Импорт данных',
    export: 'Экспорт данных',
    statistics: 'Статистика',
    'tables-log': 'Действия в таблицах',
    'table-log-view': 'Действие в таблице',
    'forms-log': 'Действия в формах',
    users: 'Пользователи',
    'user-view': 'Пользователь',
    about: 'О приложении'
  };

  const ROUTES = {
    '/': { screen: 'tables' },
    '/tables': { screen: 'tables' },
    '/forms': { screen: 'forms' },
    '/table-actions': { screen: 'tables-log' },
    '/tables-log': { screen: 'tables-log' },
    '/form-actions': { screen: 'forms-log' },
    '/forms-log': { screen: 'forms-log' },
    '/users': { screen: 'users' },
    '/import': { screen: 'import' },
    '/export': { screen: 'export' },
    '/statistics': { screen: 'statistics' },
    '/about': { screen: 'about' }
  };

  const SHEET_ROWS = 40;
  const SHEET_COLS = 40;
  const IMPORT_FILE_LIMIT = 10 * 1024 * 1024;
  const LIST_PAGE_SIZE = 10;

  let currentScreen = 'tables';
  let currentTableId = null;
  let currentFormId = null;
  let lastSearchScreen = 'tables';
  let sheetFiltersVisible = true;
  let sheetColumnFilters = {};
  let activeSheetFilterCleanup = null;
  let appVersionCache = '';
  const listPages = { tables: 1, forms: 1, 'tables-log': 1, 'forms-log': 1, users: 1 };

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function routeForScreen(screenId) {
    if (screenId === 'tables-log') return '/table-actions';
    if (screenId === 'forms-log') return '/form-actions';
    if (screenId === 'users') return '/users';
    if (screenId === 'import') return '/import';
    if (screenId === 'export') return '/export';
    if (screenId === 'statistics') return '/statistics';
    if (screenId === 'about') return '/about';
    if (screenId === 'forms') return '/forms';
    return '/tables';
  }

  function routeFromLocation() {
    const path = window.location.pathname || '/';
    if (/^\/tables\/([^/]+)$/.test(path)) {
      return { screen: 'table-view', tableId: decodeURIComponent(path.split('/').pop()) };
    }
    if (/^\/forms\/([^/]+)$/.test(path)) {
      return { screen: 'form-view', formId: decodeURIComponent(path.split('/').pop()) };
    }
    if (/^\/users\/([^/]+)$/.test(path)) {
      return { screen: 'user-view', userLogin: decodeURIComponent(path.split('/').pop()) };
    }
    if (/^\/table-actions\/([^/]+)$/.test(path)) {
      return { screen: 'table-log-view', tableLogId: decodeURIComponent(path.split('/').pop()) };
    }
    return ROUTES[path] || ROUTES['/'];
  }

  function pushRouteForScreen(screenId) {
    const path = routeForScreen(screenId);
    if (window.location.pathname !== path) history.pushState({ screen: screenId }, '', path);
  }

  function navigateToScreen(screenId) {
    pushRouteForScreen(screenId);
    showScreen(screenId);
    if (screenId === 'tables') renderTablesList();
    if (screenId === 'forms') renderFormsList();
    if (screenId === 'statistics') drawChart();
    if (screenId === 'create-form') renderFormBuilderFields();
  }

  function navigateToTable(id) {
    const path = '/tables/' + encodeURIComponent(id);
    if (window.location.pathname !== path) history.pushState({ screen: 'table-view', id }, '', path);
    openTableView(id);
  }

  function navigateToForm(id) {
    const path = '/forms/' + encodeURIComponent(id);
    if (window.location.pathname !== path) history.pushState({ screen: 'form-view', id }, '', path);
    openFormView(id);
  }

  function navigateToUser(login) {
    const path = '/users/' + encodeURIComponent(login);
    if (window.location.pathname !== path) history.pushState({ screen: 'user-view', login }, '', path);
    openUserView(login);
  }

  function navigateToTableLog(id) {
    const path = '/table-actions/' + encodeURIComponent(id);
    if (window.location.pathname !== path) history.pushState({ screen: 'table-log-view', id }, '', path);
    openTableLogView(id);
  }

  function showScreen(screenId) {
    currentScreen = screenId;
    $$('.screen-content').forEach(el => el.classList.add('hidden'));
    const panel = $('#screen-' + screenId);
    if (panel) panel.classList.remove('hidden');
    const title = TITLES[screenId] || screenId;
    const h = $('#header-title');
    if (h) h.textContent = title;
    const activeNavScreen = screenId === 'user-view' ? 'users' : (screenId === 'table-log-view' ? 'tables-log' : screenId);
    $$('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.screen === activeNavScreen);
    });
    var searchTables = $('#header-search-wrap');
    var searchForms = $('#header-search-forms');
    if (searchTables) searchTables.classList.toggle('hidden', screenId !== 'tables');
    if (searchForms) searchForms.classList.toggle('hidden', screenId !== 'forms');
    if (screenId === 'export') renderExportLists();
    if (screenId === 'statistics') initStatisticsScreen();
    if (screenId === 'tables-log') renderTablesLog();
    if (screenId === 'forms-log') renderFormsLog();
    if (screenId === 'users') renderUsersList();
    if (screenId === 'about') renderAbout();
  }

  async function renderAbout() {
    const versionEl = $('#about-version');
    if (!versionEl) return;
    if (appVersionCache) {
      versionEl.textContent = appVersionCache;
      return;
    }
    try {
      const response = await fetch('/api/version', { credentials: 'same-origin' });
      const data = await response.json();
      appVersionCache = data.version || 'недоступна';
    } catch {
      appVersionCache = 'недоступна';
    }
    versionEl.textContent = appVersionCache;
  }

  function showLogin() {
    $('#screen-login').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }

  function showApp() {
    $('#screen-login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    // Применяем сохранённую тему
    const savedTheme = localStorage.getItem('app_theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('theme-dark');
    } else {
      document.body.classList.remove('theme-dark');
    }
    const user = localStorage.getItem(STORAGE_KEYS.user) || 'Пользователь';
    const nameEl = $('#user-name');
    if (nameEl) nameEl.textContent = user;
    const route = routeFromLocation();
    if (route.tableId) {
      openTableView(route.tableId);
    } else if (route.formId) {
      openFormView(route.formId);
    } else if (route.userLogin) {
      openUserView(route.userLogin);
    } else if (route.tableLogId) {
      openTableLogView(route.tableLogId);
    } else {
      showScreen(route.screen || 'tables');
      if ((route.screen || 'tables') === 'tables') renderTablesList();
      if (route.screen === 'forms') renderFormsList();
    }
  }

  $('#sidebar-toggle')?.addEventListener('click', function () {
    $('#sidebar')?.classList.toggle('collapsed');
  });

  function showAuthError(msg) {
    const el = $('#auth-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }
  function hideAuthError() {
    const el = $('#auth-error');
    if (el) el.classList.add('hidden');
  }

  function enterAppAs(login) {
    localStorage.setItem(STORAGE_KEYS.user, login);
    const ready = typeof initializeAppData === 'function' ? initializeAppData() : Promise.resolve();
    window.appDataReady = ready;
    ready.then(showApp).catch(err => {
      showAuthError(err.message || 'Не удалось загрузить данные пользователя.');
    });
  }

  // ---------- Вкладки Вход / Регистрация ----------
  $$('.auth-tab').forEach(btn => {
    btn.addEventListener('click', function () {
      const tab = this.dataset.tab;
      $$('.auth-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      $('#form-login').classList.toggle('hidden', tab !== 'login');
      $('#form-register').classList.toggle('hidden', tab !== 'register');
      hideAuthError();
    });
  });

  $('#form-login')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideAuthError();
    const login = $('#input-login').value.trim();
    const pass = $('#input-password').value;
    const result = await validateLogin(login, pass);
    if (!result.ok) {
      showAuthError(result.error);
      return;
    }
    enterAppAs(result.user.login);
  });

  $('#form-register')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideAuthError();
    const login = $('#reg-login').value.trim();
    const pass = $('#reg-password').value;
    const confirm = $('#reg-password-confirm').value;
    if (login.length < 2) {
      showAuthError('Логин должен быть не короче 2 символов.');
      return;
    }
    if (pass.length < 8) {
      showAuthError('Пароль должен быть не короче 8 символов.');
      return;
    }
    if (pass !== confirm) {
      showAuthError('Пароли не совпадают.');
      return;
    }
    const result = await registerUser(login, pass);
    if (!result.ok) {
      showAuthError(result.error);
      return;
    }
    enterAppAs(login);
    $('#form-register').reset();
    $$('.auth-tab').forEach(b => b.classList.remove('active'));
    $('.auth-tab[data-tab="login"]').classList.add('active');
    $('#form-login').classList.remove('hidden');
    $('#form-register').classList.add('hidden');
  });

  $('#btn-logout')?.addEventListener('click', async function () {
    if (typeof logoutSession === 'function') {
      await logoutSession();
    } else {
      localStorage.removeItem(STORAGE_KEYS.user);
    }
    [STORAGE_KEYS.tables, STORAGE_KEYS.forms, STORAGE_KEYS.tableLogs, STORAGE_KEYS.formLogs, 'app_form_responses']
      .forEach(key => localStorage.removeItem(key));
    showLogin();
  });

  // ---------- Навигация ----------
  $$('.nav-link').forEach(link => {
    link.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      const screen = this.dataset.screen;
      if (screen) navigateToScreen(screen);
    });
  });

  $$('.link[data-screen]').forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      showScreen(this.dataset.screen);
      if (this.dataset.screen === 'tables') renderTablesList();
      if (this.dataset.screen === 'forms') renderFormsList();
    });
  });

  window.addEventListener('popstate', function () {
    if ($('#app')?.classList.contains('hidden')) return;
    const route = routeFromLocation();
    if (route.tableId) openTableView(route.tableId);
    else if (route.formId) openFormView(route.formId);
    else if (route.userLogin) openUserView(route.userLogin);
    else if (route.tableLogId) openTableLogView(route.tableLogId);
    else showScreen(route.screen || 'tables');
  });

  // ---------- Списки таблиц и форм ----------
  function setTableLastViewed(id) {
    const tables = loadTables();
    const t = tables.find(x => x.id === id);
    if (t && hasResourceAccess(t)) { t.lastViewedAt = new Date().toISOString(); saveTables(tables); }
  }
  function setFormLastViewed(id) {
    const forms = loadForms();
    const f = forms.find(x => x.id === id);
    if (f && hasResourceAccess(f)) { f.lastViewedAt = new Date().toISOString(); saveForms(forms); }
  }

  function normalizeText(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ru', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function openTableInNewTab(id) {
    const opened = window.open('/tables/' + encodeURIComponent(id), '_blank', 'noopener');
    if (opened) opened.opener = null;
  }

  function openFormInNewTab(id) {
    const opened = window.open('/forms/' + encodeURIComponent(id), '_blank', 'noopener');
    if (opened) opened.opener = null;
  }

  function currentUserLogin() {
    return localStorage.getItem(STORAGE_KEYS.user) || '';
  }

  function currentUserRole() {
    return findUser(currentUserLogin())?.role || 'user';
  }

  function isCurrentUserAdmin() {
    return currentUserRole() === 'administrator';
  }

  function sameLogin(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function isResourceOwner(resource) {
    return sameLogin(resource?.ownerLogin, currentUserLogin());
  }

  function hasResourceAccess(resource) {
    const user = currentUserLogin();
    if (!user || !resource) return false;
    if (isResourceOwner(resource)) return true;
    return (resource.invitedUsers || []).some(login => sameLogin(login, user));
  }

  function accessibleTables() {
    return loadTables().filter(hasResourceAccess);
  }

  function accessibleForms() {
    return loadForms().filter(hasResourceAccess);
  }

  function accessibleTableIds() {
    return new Set(accessibleTables().map(table => table.id));
  }

  function accessibleTableLogs() {
    const tableIds = accessibleTableIds();
    return loadTableLogs().filter(log => !log.tableId || tableIds.has(log.tableId) || sameLogin(log.user, currentUserLogin()));
  }

  function accessibleFormIds() {
    return new Set(accessibleForms().map(form => form.id));
  }

  function ownedTables() {
    return loadTables().filter(isResourceOwner);
  }

  function ownedForms() {
    return loadForms().filter(isResourceOwner);
  }

  function findAccessibleTable(id) {
    return accessibleTables().find(table => table.id === id);
  }

  function findAccessibleForm(id) {
    return accessibleForms().find(form => form.id === id);
  }

  function findAccessibleTableLog(id) {
    return accessibleTableLogs().find(log => String(log.id || '') === String(id || ''));
  }

  function accessDenied(resourceType) {
    alert((resourceType === 'form' ? 'Форма' : 'Таблица') + ' недоступна: владелец не приглашал вас.');
    navigateToScreen(resourceType === 'form' ? 'forms' : 'tables');
  }

  function makeImportedResourceId(type, index, usedIds) {
    const prefix = type === 'form' ? 'f' : 't';
    let counter = 0;
    let id = '';
    do {
      id = prefix + 'import-' + Date.now() + '-' + index + (counter ? '-' + counter : '');
      counter += 1;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  }

  function normalizeImportedResource(resource, type, index, id, existingResource) {
    const user = currentUserLogin() || 'Пользователь';
    const now = new Date().toISOString();
    return {
      ...resource,
      id,
      owner: user,
      ownerLogin: user,
      invitedUsers: existingResource?.invitedUsers || [],
      createdAt: existingResource?.createdAt || resource?.createdAt || now,
      updatedAt: resource?.updatedAt || now,
      history: existingResource?.history || resource?.history || []
    };
  }

  function mergeImportedResources(existingResources, importedResources, type) {
    const next = [...existingResources];
    const indexById = new Map();
    const ownedById = new Map();
    const usedIds = new Set();
    const idMap = new Map();

    next.forEach((resource, index) => {
      const id = String(resource?.id || '');
      if (!id) return;
      indexById.set(id, index);
      usedIds.add(id);
      if (isResourceOwner(resource)) ownedById.set(id, resource);
    });

    if (!Array.isArray(importedResources) || !importedResources.length) {
      return { items: next, idMap };
    }

    importedResources.forEach((resource, index) => {
      const rawId = String(resource?.id || '').trim();
      const existingOwned = rawId ? ownedById.get(rawId) : null;
      const targetId = existingOwned ? rawId : makeImportedResourceId(type, index, usedIds);
      const normalized = normalizeImportedResource(resource, type, index, targetId, existingOwned);
      idMap.set(rawId || targetId, targetId);

      if (indexById.has(targetId)) {
        next[indexById.get(targetId)] = normalized;
      } else {
        indexById.set(targetId, next.length);
        next.push(normalized);
      }
    });

    return { items: next, idMap };
  }

  function mergeImportedChildDocs(existingDocs, importedDocs, refKey, idMap) {
    const next = [...existingDocs];
    const indexById = new Map();
    const user = currentUserLogin() || 'Пользователь';

    next.forEach((doc, index) => {
      const id = String(doc?.id || doc?._key || '');
      if (id) indexById.set(id, index);
    });

    if (!Array.isArray(importedDocs) || !idMap.size) return next;

    importedDocs.forEach((doc, index) => {
      const originalRef = String(doc?.[refKey] || '').trim();
      const mappedRef = idMap.get(originalRef);
      if (!mappedRef) return;
      const rawId = String(doc?.id || doc?._key || '').trim();
      const id = rawId || refKey + '-import-' + Date.now() + '-' + index;
      const normalized = {
        ...doc,
        id,
        [refKey]: mappedRef,
        user
      };
      if (indexById.has(id)) {
        next[indexById.get(id)] = {
          ...next[indexById.get(id)],
          ...normalized
        };
      } else {
        indexById.set(id, next.length);
        next.push(normalized);
      }
    });

    return next;
  }

  function mergeImportedStateForCurrentUser(data) {
    const tablesMerge = mergeImportedResources(loadTables(), data.tables, 'table');
    const formsMerge = mergeImportedResources(loadForms(), data.forms, 'form');
    const nextTables = tablesMerge.items;
    const nextForms = formsMerge.items;
    const nextResponses = mergeImportedChildDocs(loadFormResponses(), data.responses, 'formId', formsMerge.idMap);
    const nextTableLogs = mergeImportedChildDocs(loadTableLogs(), data.tableLogs, 'tableId', tablesMerge.idMap);
    const nextFormLogs = mergeImportedChildDocs(loadFormLogs(), data.formLogs, 'formId', formsMerge.idMap);
    return {
      users: loadUsers(),
      tables: nextTables,
      forms: nextForms,
      responses: nextResponses,
      tableLogs: nextTableLogs,
      formLogs: nextFormLogs
    };
  }

  function parseDateBoundary(dateValue, isEnd) {
    if (!dateValue) return null;
    const v = String(dateValue).trim();
    const source = /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? v + (isEnd ? 'T23:59:59.999' : 'T00:00:00.000')
      : v;
    const d = new Date(source);
    return isNaN(d.getTime()) ? null : d;
  }

  function rawFilterValue(id) {
    return ($(id)?.value || '').trim();
  }

  function inDateRange(dateIso, from, to) {
    if (!from && !to) return true;
    if (!dateIso) return false;
    const t = new Date(dateIso).getTime();
    if (isNaN(t)) return false;
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  }

  function parseNumberBoundary(raw) {
    if (raw == null || raw === '') return null;
    const v = Number(String(raw).replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }

  function inNumberRange(value, min, max) {
    if (min == null && max == null) return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (min != null && n < min) return false;
    if (max != null && n > max) return false;
    return true;
  }

  function sortByLastViewedOrUpdated(a, b) {
    const ta = a.lastViewedAt ? new Date(a.lastViewedAt).getTime() : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
    const tb = b.lastViewedAt ? new Date(b.lastViewedAt).getTime() : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
    const va = isNaN(ta) ? 0 : ta;
    const vb = isNaN(tb) ? 0 : tb;
    return vb - va;
  }

  function getTablesMultiFilters() {
    return {
      name: ($('#filter-tables-name')?.value || '').trim(),
      owner: ($('#filter-tables-owner')?.value || '').trim(),
      comment: ($('#filter-tables-comment')?.value || '').trim(),
      createdFrom: parseDateBoundary($('#filter-tables-created-from')?.value, false),
      createdTo: parseDateBoundary($('#filter-tables-created-to')?.value, true),
      updatedFrom: parseDateBoundary($('#filter-tables-updated-from')?.value, false),
      updatedTo: parseDateBoundary($('#filter-tables-updated-to')?.value, true),
      viewedFrom: parseDateBoundary($('#filter-tables-viewed-from')?.value, false),
      viewedTo: parseDateBoundary($('#filter-tables-viewed-to')?.value, true)
    };
  }

  function getFormsMultiFilters() {
    return {
      name: ($('#filter-forms-name')?.value || '').trim(),
      owner: ($('#filter-forms-owner')?.value || '').trim(),
      comment: ($('#filter-forms-comment')?.value || '').trim(),
      createdFrom: parseDateBoundary($('#filter-forms-created-from')?.value, false),
      createdTo: parseDateBoundary($('#filter-forms-created-to')?.value, true),
      updatedFrom: parseDateBoundary($('#filter-forms-updated-from')?.value, false),
      updatedTo: parseDateBoundary($('#filter-forms-updated-to')?.value, true),
      viewedFrom: parseDateBoundary($('#filter-forms-viewed-from')?.value, false),
      viewedTo: parseDateBoundary($('#filter-forms-viewed-to')?.value, true)
    };
  }

  function getTablesLogMultiFilters() {
    return {
      tableName: ($('#filter-tables-log-tableName')?.value || '').trim(),
      action: ($('#filter-tables-log-action')?.value || '').trim(),
      user: ($('#filter-tables-log-user')?.value || '').trim(),
      owner: ($('#filter-tables-log-owner')?.value || '').trim(),
      cell: ($('#filter-tables-log-cell')?.value || '').trim(),
      value: ($('#filter-tables-log-value')?.value || '').trim(),
      createdFrom: parseDateBoundary($('#filter-tables-log-created-from')?.value, false),
      createdTo: parseDateBoundary($('#filter-tables-log-created-to')?.value, true),
      updatedFrom: parseDateBoundary($('#filter-tables-log-updated-from')?.value, false),
      updatedTo: parseDateBoundary($('#filter-tables-log-updated-to')?.value, true),
      viewedFrom: parseDateBoundary($('#filter-tables-log-viewed-from')?.value, false),
      viewedTo: parseDateBoundary($('#filter-tables-log-viewed-to')?.value, true),
      dateFrom: parseDateBoundary($('#filter-tables-log-date-from')?.value, false),
      dateTo: parseDateBoundary($('#filter-tables-log-date-to')?.value, true)
    };
  }

  function getFormsLogMultiFilters() {
    return {
      formName: ($('#filter-forms-log-formName')?.value || '').trim(),
      action: ($('#filter-forms-log-action')?.value || '').trim(),
      user: ($('#filter-forms-log-user')?.value || '').trim(),
      owner: ($('#filter-forms-log-owner')?.value || '').trim(),
      answers: ($('#filter-forms-log-answers')?.value || '').trim(),
      status: ($('#filter-forms-log-status')?.value || '').trim(),
      fieldsMin: parseNumberBoundary($('#filter-forms-log-fields-min')?.value),
      fieldsMax: parseNumberBoundary($('#filter-forms-log-fields-max')?.value),
      createdFrom: parseDateBoundary($('#filter-forms-log-created-from')?.value, false),
      createdTo: parseDateBoundary($('#filter-forms-log-created-to')?.value, true),
      updatedFrom: parseDateBoundary($('#filter-forms-log-updated-from')?.value, false),
      updatedTo: parseDateBoundary($('#filter-forms-log-updated-to')?.value, true),
      dateFrom: parseDateBoundary($('#filter-forms-log-date-from')?.value, false),
      dateTo: parseDateBoundary($('#filter-forms-log-date-to')?.value, true)
    };
  }

  function getUsersMultiFilters() {
    return {
      login: ($('#filter-users-login')?.value || '').trim(),
      role: ($('#filter-users-role')?.value || '').trim(),
      createdFrom: parseDateBoundary($('#filter-users-created-from')?.value, false),
      createdTo: parseDateBoundary($('#filter-users-created-to')?.value, true),
      updatedFrom: parseDateBoundary($('#filter-users-updated-from')?.value, false),
      updatedTo: parseDateBoundary($('#filter-users-updated-to')?.value, true)
    };
  }

  function commonServerDateParams(prefix, names) {
    const params = {};
    names.forEach(name => {
      const from = rawFilterValue('#filter-' + prefix + '-' + name + '-from');
      const to = rawFilterValue('#filter-' + prefix + '-' + name + '-to');
      if (from) params[name + 'From'] = from;
      if (to) params[name + 'To'] = to;
    });
    return params;
  }

  function listServerParams(kind) {
    if (kind === 'tables') {
      return {
        q: rawFilterValue('#search-tables-global'),
        name: rawFilterValue('#filter-tables-name'),
        owner: rawFilterValue('#filter-tables-owner'),
        comment: rawFilterValue('#filter-tables-comment'),
        ...commonServerDateParams('tables', ['created', 'updated', 'viewed'])
      };
    }
    if (kind === 'forms') {
      return {
        q: rawFilterValue('#search-forms-global'),
        name: rawFilterValue('#filter-forms-name'),
        owner: rawFilterValue('#filter-forms-owner'),
        comment: rawFilterValue('#filter-forms-comment'),
        ...commonServerDateParams('forms', ['created', 'updated', 'viewed'])
      };
    }
    if (kind === 'tables-log') {
      return {
        q: rawFilterValue('#search-tables-log'),
        tableName: rawFilterValue('#filter-tables-log-tableName'),
        action: rawFilterValue('#filter-tables-log-action'),
        user: rawFilterValue('#filter-tables-log-user'),
        owner: rawFilterValue('#filter-tables-log-owner'),
        cell: rawFilterValue('#filter-tables-log-cell'),
        value: rawFilterValue('#filter-tables-log-value'),
        ...commonServerDateParams('tables-log', ['created', 'updated', 'viewed', 'date'])
      };
    }
    if (kind === 'forms-log') {
      return {
        q: rawFilterValue('#search-forms-log'),
        formName: rawFilterValue('#filter-forms-log-formName'),
        action: rawFilterValue('#filter-forms-log-action'),
        user: rawFilterValue('#filter-forms-log-user'),
        owner: rawFilterValue('#filter-forms-log-owner'),
        answers: rawFilterValue('#filter-forms-log-answers'),
        status: rawFilterValue('#filter-forms-log-status'),
        fieldsMin: rawFilterValue('#filter-forms-log-fields-min'),
        fieldsMax: rawFilterValue('#filter-forms-log-fields-max'),
        ...commonServerDateParams('forms-log', ['created', 'updated', 'date'])
      };
    }
    if (kind === 'users') {
      return {
        q: rawFilterValue('#search-users'),
        login: rawFilterValue('#filter-users-login'),
        role: rawFilterValue('#filter-users-role'),
        ...commonServerDateParams('users', ['created', 'updated'])
      };
    }
    return {};
  }

  async function loadPagedList(kind, apiType, fallbackItems) {
    const page = listPages[kind] || 1;
    const params = {
      ...listServerParams(kind),
      page,
      limit: LIST_PAGE_SIZE
    };
    if (typeof fetchList === 'function') {
      try {
        return await fetchList(apiType, params);
      } catch (err) {
        console.warn('Server-side list failed, using local cache:', err.message);
      }
    }
    const items = fallbackItems();
    const offset = (page - 1) * LIST_PAGE_SIZE;
    return { items: items.slice(offset, offset + LIST_PAGE_SIZE), total: items.length, page, limit: LIST_PAGE_SIZE };
  }

  function renderPagination(kind, total, page, limit, renderFn) {
    const countEl = $('#' + kind + '-count');
    const paginationEl = $('#' + kind + '-pagination');
    if (countEl) countEl.textContent = 'Найдено ' + total + ' элементов';
    if (!paginationEl) return;
    const pages = Math.max(1, Math.ceil(total / limit));
    paginationEl.innerHTML = '<button type="button" class="btn btn-ghost btn-sm pagination-prev">Назад</button>' +
      '<span class="pagination-info">' + page + ' / ' + pages + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm pagination-next">Вперёд</button>';
    const prev = paginationEl.querySelector('.pagination-prev');
    const next = paginationEl.querySelector('.pagination-next');
    if (prev) {
      prev.disabled = page <= 1;
      prev.addEventListener('click', () => {
        listPages[kind] = Math.max(1, page - 1);
        renderFn();
      });
    }
    if (next) {
      next.disabled = page >= pages;
      next.addEventListener('click', () => {
        listPages[kind] = Math.min(pages, page + 1);
        renderFn();
      });
    }
  }

  async function renderTablesList() {
    lastSearchScreen = 'tables';
    const query = ($('#search-tables-global')?.value || '').trim().toLowerCase();
    const filters = getTablesMultiFilters();
    let list = accessibleTables();
    if (query) {
      list = list.filter(t => {
        const q = query;
        const viewed = t.lastViewedAt ? String(new Date(t.lastViewedAt).toLocaleString('ru')) : '';
        return [
          t.name,
          t.owner,
          t.comment,
          t.createdAt,
          t.updatedAt,
          viewed
        ].some(v => normalizeText(v).includes(q));
      });
    }

    list = list.filter(t => {
      if (filters.name && !normalizeText(t.name).includes(normalizeText(filters.name))) return false;
      if (filters.owner && !normalizeText(t.owner).includes(normalizeText(filters.owner))) return false;
      if (filters.comment && !normalizeText(t.comment).includes(normalizeText(filters.comment))) return false;
      if (filters.createdFrom || filters.createdTo) if (!inDateRange(t.createdAt, filters.createdFrom, filters.createdTo)) return false;
      if (filters.updatedFrom || filters.updatedTo) if (!inDateRange(t.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
      if (filters.viewedFrom || filters.viewedTo) if (!inDateRange(t.lastViewedAt, filters.viewedFrom, filters.viewedTo)) return false;
      return true;
    });

    list = [...list].sort(sortByLastViewedOrUpdated);
    const pageData = await loadPagedList('tables', 'tables', () => list);
    list = pageData.items || [];
    const tbody = $('#tbody-tables');
    if (!tbody) return;
    tbody.innerHTML = list.map(t => `
      <tr class="table-row-clickable" data-table-id="${escapeHtml(t.id)}">
        <td><a href="/tables/${encodeURIComponent(t.id)}" target="_blank" rel="noopener" class="table-open-link" data-id="${escapeHtml(t.id)}">${escapeHtml(t.name)}</a></td>
        <td>${escapeHtml(formatDateTime(t.createdAt))}</td>
        <td>${escapeHtml(formatDateTime(t.updatedAt))}</td>
        <td>${escapeHtml(formatDateTime(t.lastViewedAt))}</td>
        <td>${escapeHtml(t.owner)}${isResourceOwner(t) ? '' : ' <span class="access-badge">приглашение</span>'}</td>
        <td>${escapeHtml(t.comment || '')}</td>
        <td class="cell-actions">${isResourceOwner(t) ? '<button type="button" class="btn-link btn-link-danger delete-table" data-id="' + escapeHtml(t.id) + '" data-name="' + escapeHtml(t.name) + '">Удалить</button>' : '—'}</td>
      </tr>
    `).join('') || '<tr><td colspan="7">Нет таблиц</td></tr>';
    renderPagination('tables', pageData.total || 0, pageData.page || 1, pageData.limit || LIST_PAGE_SIZE, renderTablesList);
    tbody.querySelectorAll('.table-open-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });
    tbody.querySelectorAll('.table-row-clickable').forEach(tr => {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('.delete-table') || e.target.closest('a')) return;
        openTableInNewTab(this.dataset.tableId);
      });
    });
    tbody.querySelectorAll('.delete-table').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        confirmDeleteTable(this.dataset.id, this.dataset.name);
      });
    });
  }

  function confirmDeleteTable(id, name) {
    const table = loadTables().find(t => t.id === id);
    if (!table || !isResourceOwner(table)) {
      alert('Удалять таблицу может только её создатель.');
      return;
    }
    var msg = document.createElement('div');
    msg.className = 'delete-confirm-dialog';
    msg.innerHTML = '<div class="delete-confirm-content"><p class="delete-confirm-title">Удалить таблицу?</p><p class="delete-confirm-text">Таблица «' + escapeHtml(String(name || '')) + '» будет удалена без возможности восстановления. Все данные будут потеряны.</p><p class="delete-confirm-warn">Это действие нельзя отменить.</p><div class="delete-confirm-buttons"><button type="button" class="btn btn-ghost cancel-delete">Отмена</button><button type="button" class="btn btn-danger confirm-delete">Удалить</button></div></div>';
    msg.querySelector('.cancel-delete').onclick = function () { msg.remove(); document.body.style.overflow = ''; };
    msg.querySelector('.confirm-delete').onclick = function () {
      const user = currentUserLogin() || 'Пользователь';
      addTableHistory(id, { action: 'Таблица удалена', user, tableName: name || '' });
      const tables = loadTables().filter(t => t.id !== id);
      saveTables(tables);
      msg.remove();
      document.body.style.overflow = '';
      if (currentTableId === id) currentTableId = null;
      navigateToScreen('tables');
    };
    document.body.style.overflow = 'hidden';
    document.body.appendChild(msg);
  }

  function confirmDeleteForm(id, name) {
    const targetForm = loadForms().find(f => f.id === id);
    if (!targetForm || !isResourceOwner(targetForm)) {
      alert('Удалять форму может только её создатель.');
      return;
    }
    const msg = document.createElement('div');
    msg.className = 'delete-confirm-dialog';
    msg.innerHTML = '<div class="delete-confirm-content"><p class="delete-confirm-title">Удалить форму?</p><p class="delete-confirm-text">Форма «' + escapeHtml(String(name || '')) + '» будет удалена без возможности восстановления. Все данные и ответы будут потеряны.</p><p class="delete-confirm-warn">Это действие нельзя отменить.</p><div class="delete-confirm-buttons"><button type="button" class="btn btn-ghost cancel-delete">Отмена</button><button type="button" class="btn btn-danger confirm-delete">Удалить</button></div></div>';
    msg.querySelector('.cancel-delete').onclick = function () { msg.remove(); document.body.style.overflow = ''; };
    msg.querySelector('.confirm-delete').onclick = function () {
      const forms = loadForms();
      const form = forms.find(f => f.id === id);
      const user = currentUserLogin() || 'Пользователь';
      if (form) addFormHistory(id, { action: 'Форма удалена', user });
      const remaining = forms.filter(f => f.id !== id);
      saveForms(remaining);
      saveFormResponses(loadFormResponses().filter(r => r.formId !== id));
      msg.remove();
      document.body.style.overflow = '';
      if (currentFormId === id) currentFormId = null;
      navigateToScreen('forms');
    };
    document.body.style.overflow = 'hidden';
    document.body.appendChild(msg);
  }

  async function renderFormsList() {
    lastSearchScreen = 'forms';
    const query = ($('#search-forms-global')?.value || '').trim().toLowerCase();
    const filters = getFormsMultiFilters();
    let list = accessibleForms();
    if (query) {
      list = list.filter(f => {
        const q = query;
        const viewed = f.lastViewedAt ? String(new Date(f.lastViewedAt).toLocaleString('ru')) : '';
        return [
          f.name,
          f.owner,
          f.comment,
          f.description,
          f.createdAt,
          f.updatedAt,
          viewed
        ].some(v => normalizeText(v).includes(q));
      });
    }

    list = list.filter(f => {
      if (filters.name && !normalizeText(f.name).includes(normalizeText(filters.name))) return false;
      if (filters.owner && !normalizeText(f.owner).includes(normalizeText(filters.owner))) return false;
      if (filters.comment && !normalizeText(f.comment).includes(normalizeText(filters.comment))) return false;
      if (filters.createdFrom || filters.createdTo) if (!inDateRange(f.createdAt, filters.createdFrom, filters.createdTo)) return false;
      if (filters.updatedFrom || filters.updatedTo) if (!inDateRange(f.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
      if (filters.viewedFrom || filters.viewedTo) if (!inDateRange(f.lastViewedAt, filters.viewedFrom, filters.viewedTo)) return false;
      return true;
    });

    list = [...list].sort(sortByLastViewedOrUpdated);
    const pageData = await loadPagedList('forms', 'forms', () => list);
    list = pageData.items || [];
    const tbody = $('#tbody-forms');
    if (!tbody) return;
    tbody.innerHTML = list.map(f => `
      <tr class="form-row-clickable" data-form-id="${escapeHtml(f.id)}">
        <td><a href="/forms/${encodeURIComponent(f.id)}" target="_blank" rel="noopener" class="form-open-link" data-id="${escapeHtml(f.id)}">${escapeHtml(f.name)}</a></td>
        <td>${escapeHtml(formatDateTime(f.createdAt))}</td>
        <td>${escapeHtml(formatDateTime(f.updatedAt))}</td>
        <td>${escapeHtml(formatDateTime(f.lastViewedAt))}</td>
        <td>${escapeHtml(f.owner)}${isResourceOwner(f) ? '' : ' <span class="access-badge">приглашение</span>'}</td>
        <td>${escapeHtml(f.comment || '')}</td>
        <td class="cell-actions">${isResourceOwner(f) ? '<button type="button" class="btn-link btn-link-danger delete-form" data-id="' + escapeHtml(f.id) + '" data-name="' + escapeHtml(f.name) + '">Удалить</button>' : '—'}</td>
      </tr>
    `).join('') || '<tr><td colspan="7">Нет форм</td></tr>';
    renderPagination('forms', pageData.total || 0, pageData.page || 1, pageData.limit || LIST_PAGE_SIZE, renderFormsList);
    tbody.querySelectorAll('.form-open-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });
    tbody.querySelectorAll('.form-row-clickable').forEach(tr => {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('.delete-form') || e.target.closest('a')) return;
        openFormInNewTab(this.dataset.formId);
      });
    });
    tbody.querySelectorAll('.delete-form').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        confirmDeleteForm(this.dataset.id, this.dataset.name);
      });
    });
  }

  async function renderUsersList() {
    const query = ($('#search-users')?.value || '').trim().toLowerCase();
    const filters = getUsersMultiFilters();
    let list = loadUsers();
    if (query) {
      list = list.filter(user => [user.login, user.role, user.createdAt, user.updatedAt].some(value => normalizeText(value).includes(query)));
    }
    list = list.filter(user => {
      if (filters.login && !normalizeText(user.login).includes(normalizeText(filters.login))) return false;
      if (filters.role && !normalizeText(user.role).includes(normalizeText(filters.role))) return false;
      if (filters.createdFrom || filters.createdTo) if (!inDateRange(user.createdAt, filters.createdFrom, filters.createdTo)) return false;
      if (filters.updatedFrom || filters.updatedTo) if (!inDateRange(user.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
      return true;
    }).sort((a, b) => String(a.login || '').localeCompare(String(b.login || ''), 'ru'));

    const pageData = await loadPagedList('users', 'users', () => list);
    const users = pageData.items || [];
    const tbody = $('#tbody-users');
    if (!tbody) return;
    tbody.innerHTML = users.length
      ? users.map(user => '<tr class="user-row-clickable" data-login="' + escapeHtml(user.login) + '"><td><a href="/users/' + encodeURIComponent(user.login) + '" class="user-open-link" data-login="' + escapeHtml(user.login) + '">' + escapeHtml(user.login) + '</a></td><td>' + escapeHtml(user.role || '') + '</td><td>' + escapeHtml(formatDateTime(user.createdAt)) + '</td><td>' + escapeHtml(formatDateTime(user.updatedAt || user.createdAt)) + '</td></tr>').join('')
      : '<tr><td colspan="4">Пользователи не найдены</td></tr>';
    renderPagination('users', pageData.total || 0, pageData.page || 1, pageData.limit || LIST_PAGE_SIZE, renderUsersList);
    tbody.querySelectorAll('.user-open-link').forEach(link => {
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        navigateToUser(this.dataset.login);
      });
    });
    tbody.querySelectorAll('.user-row-clickable').forEach(tr => {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        navigateToUser(this.dataset.login);
      });
    });
  }

  function openUserView(login) {
    const user = findUser(login);
    if (!user) {
      alert('Пользователь не найден.');
      navigateToScreen('users');
      return;
    }

    showScreen('user-view');
    $('#view-user-title').textContent = user.login || 'Пользователь';
    $('#view-user-login').value = user.login || '';
    $('#view-user-role').value = user.role || 'user';
    $('#view-user-created').value = formatDateTime(user.createdAt);
    $('#view-user-updated').value = formatDateTime(user.updatedAt || user.createdAt);
    $('#user-meta').textContent = 'Создан: ' + formatDateTime(user.createdAt) + ', Изменён: ' + formatDateTime(user.updatedAt || user.createdAt);
    $('#user-edit-result')?.classList.add('hidden');

    const canEdit = isCurrentUserAdmin();
    $('#view-user-role').disabled = !canEdit;
    $('#save-user')?.classList.toggle('hidden', !canEdit);
    $('#user-edit-readonly')?.classList.toggle('hidden', canEdit);
  }

  $('#back-from-user')?.addEventListener('click', function () {
    navigateToScreen('users');
  });

  $('#save-user')?.addEventListener('click', async function () {
    const login = $('#view-user-login')?.value || '';
    const role = $('#view-user-role')?.value || 'user';
    const resultEl = $('#user-edit-result');
    try {
      this.disabled = true;
      if (resultEl) {
        resultEl.textContent = 'Сохранение...';
        resultEl.className = 'result-message';
        resultEl.classList.remove('hidden');
      }
      const user = await updateUser(login, { role });
      if (user) {
        $('#view-user-role').value = user.role || 'user';
        $('#view-user-created').value = formatDateTime(user.createdAt);
        $('#view-user-updated').value = formatDateTime(user.updatedAt || user.createdAt);
        $('#user-meta').textContent = 'Создан: ' + formatDateTime(user.createdAt) + ', Изменён: ' + formatDateTime(user.updatedAt || user.createdAt);
      }
      if (resultEl) {
        resultEl.textContent = 'Пользователь сохранён.';
        resultEl.className = 'result-message success';
        resultEl.classList.remove('hidden');
      }
    } catch (err) {
      if (resultEl) {
        resultEl.textContent = 'Ошибка: ' + (err.message || 'не удалось сохранить пользователя');
        resultEl.className = 'result-message error';
        resultEl.classList.remove('hidden');
      }
    } finally {
      this.disabled = false;
    }
  });

  function rerenderFromFirstPage(kind, renderFn) {
    listPages[kind] = 1;
    renderFn();
  }

  $('#search-tables-global')?.addEventListener('input', () => rerenderFromFirstPage('tables', renderTablesList));
  $('#btn-table-filters')?.addEventListener('click', function () {
    $('#panel-table-filters')?.classList.toggle('hidden');
  });
  $('#btn-table-filters-reset')?.addEventListener('click', function () {
    $$('#panel-table-filters input').forEach(inp => { inp.value = ''; });
    rerenderFromFirstPage('tables', renderTablesList);
  });
  $$('#panel-table-filters input').forEach(inp => {
    inp.addEventListener('input', () => rerenderFromFirstPage('tables', renderTablesList));
    inp.addEventListener('change', () => rerenderFromFirstPage('tables', renderTablesList));
  });
  $('#btn-create-table')?.addEventListener('click', function () { showScreen('create-table'); });

  $('#search-forms-global')?.addEventListener('input', () => rerenderFromFirstPage('forms', renderFormsList));
  $('#btn-form-filters')?.addEventListener('click', function () {
    $('#panel-form-filters')?.classList.toggle('hidden');
  });
  $('#btn-form-filters-reset')?.addEventListener('click', function () {
    $$('#panel-form-filters input').forEach(inp => { inp.value = ''; });
    rerenderFromFirstPage('forms', renderFormsList);
  });
  $$('#panel-form-filters input').forEach(inp => {
    inp.addEventListener('input', () => rerenderFromFirstPage('forms', renderFormsList));
    inp.addEventListener('change', () => rerenderFromFirstPage('forms', renderFormsList));
  });

  $('#search-tables-log')?.addEventListener('input', () => rerenderFromFirstPage('tables-log', renderTablesLog));
  $('#btn-tables-log-filters')?.addEventListener('click', function () {
    $('#panel-tables-log-filters')?.classList.toggle('hidden');
  });
  $('#btn-tables-log-filters-reset')?.addEventListener('click', function () {
    $$('#panel-tables-log-filters input, #panel-tables-log-filters select').forEach(inp => { inp.value = ''; });
    rerenderFromFirstPage('tables-log', renderTablesLog);
  });
  $$('#panel-tables-log-filters input, #panel-tables-log-filters select').forEach(inp => {
    inp.addEventListener('input', () => rerenderFromFirstPage('tables-log', renderTablesLog));
    inp.addEventListener('change', () => rerenderFromFirstPage('tables-log', renderTablesLog));
  });

  $('#search-forms-log')?.addEventListener('input', () => rerenderFromFirstPage('forms-log', renderFormsLog));
  $('#btn-forms-log-filters')?.addEventListener('click', function () {
    $('#panel-forms-log-filters')?.classList.toggle('hidden');
  });
  $('#btn-forms-log-filters-reset')?.addEventListener('click', function () {
    $$('#panel-forms-log-filters input, #panel-forms-log-filters select').forEach(inp => { inp.value = ''; });
    rerenderFromFirstPage('forms-log', renderFormsLog);
  });
  $$('#panel-forms-log-filters input, #panel-forms-log-filters select').forEach(inp => {
    inp.addEventListener('input', () => rerenderFromFirstPage('forms-log', renderFormsLog));
    inp.addEventListener('change', () => rerenderFromFirstPage('forms-log', renderFormsLog));
  });

  $('#search-users')?.addEventListener('input', () => rerenderFromFirstPage('users', renderUsersList));
  $('#btn-users-filters')?.addEventListener('click', function () {
    $('#panel-users-filters')?.classList.toggle('hidden');
  });
  $('#btn-users-filters-reset')?.addEventListener('click', function () {
    $$('#panel-users-filters input').forEach(inp => { inp.value = ''; });
    rerenderFromFirstPage('users', renderUsersList);
  });
  $$('#panel-users-filters input').forEach(inp => {
    inp.addEventListener('input', () => rerenderFromFirstPage('users', renderUsersList));
    inp.addEventListener('change', () => rerenderFromFirstPage('users', renderUsersList));
  });

  $('#btn-create-form')?.addEventListener('click', function () { showScreen('create-form'); renderFormBuilderFields(); });

  // Переключатель темы
  $('#btn-toggle-theme')?.addEventListener('click', function () {
    const dark = !document.body.classList.contains('theme-dark');
    document.body.classList.toggle('theme-dark', dark);
    localStorage.setItem('app_theme', dark ? 'dark' : 'light');
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  // ---------- Поиск таблиц: сортировка и фильтрация ----------
  // ---------- Просмотр/редактирование таблицы (сетка 40x40, строки 1..40, столбцы A..AN) ----------
  function colLetter(c) {
    if (c < 26) return String.fromCharCode(65 + c);
    return String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
  }

  function ensureCellsGrid(cells) {
    const rows = SHEET_ROWS;
    const cols = SHEET_COLS;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = (cells && cells[r]) ? [...cells[r]] : [];
      while (row.length < cols) row.push('');
      grid.push(row);
    }
    return grid;
  }

  function buildSheetFromCells(cells) {
    const grid = ensureCellsGrid(cells);
    let html = '<table class="sheet-grid"><tbody>';
    // Строка заголовков столбцов (A, B, C...) — первая строка tbody, горизонтально
    html += '<tr class="sheet-header-row">';
    html += '<td class="sheet-corner"></td>';
    for (let c = 0; c < SHEET_COLS; c++) {
      html += '<td class="sheet-col-header" data-col="' + c + '"><span class="col-letter">' + colLetter(c) + '</span> <span class="col-filter" data-col="' + c + '" title="Фильтр">▾</span></td>';
    }
    html += '</tr>';
    for (let r = 0; r < SHEET_ROWS; r++) {
      html += '<tr>';
      html += '<td class="sheet-row-header">' + (r + 1) + '</td>';
      for (let c = 0; c < SHEET_COLS; c++) {
        const val = (grid[r][c] != null ? grid[r][c] : '');
        html += '<td class="sheet-cell" data-r="' + r + '" data-c="' + c + '"><input type="text" value="' + escapeHtml(String(val)) + '" data-r="' + r + '" data-c="' + c + '"></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function invitedUsersHtml(resource, type) {
    const invited = resource.invitedUsers || [];
    const owner = isResourceOwner(resource);
    if (!invited.length) return '<span class="hint">Приглашённых пользователей нет.</span>';
    return invited.map(login => {
      const remove = owner
        ? '<button type="button" class="access-remove" data-type="' + type + '" data-login="' + escapeHtml(login) + '" title="Отозвать доступ">×</button>'
        : '';
      return '<span class="access-chip">' + escapeHtml(login) + remove + '</span>';
    }).join('');
  }

  function renderAccessBlock(type, resource) {
    const prefix = type === 'form' ? 'form' : 'table';
    const ownerEl = $('#' + prefix + '-access-owner');
    const listEl = $('#' + prefix + '-access-invited');
    const controlsEl = $('#' + prefix + '-access-controls');
    const readonlyEl = $('#' + prefix + '-access-readonly');
    if (ownerEl) ownerEl.textContent = 'Создатель: ' + (resource.ownerLogin || resource.owner || '—');
    if (listEl) listEl.innerHTML = invitedUsersHtml(resource, type);
    const owner = isResourceOwner(resource);
    controlsEl?.classList.toggle('hidden', !owner);
    readonlyEl?.classList.toggle('hidden', owner);
  }

  function renderTableAccessBlock(table) {
    renderAccessBlock('table', table);
  }

  function renderFormAccessBlock(form) {
    renderAccessBlock('form', form);
  }

  function inviteUser(type) {
    const prefix = type === 'form' ? 'form' : 'table';
    const id = type === 'form' ? currentFormId : currentTableId;
    const input = $('#' + prefix + '-invite-login');
    const login = (input?.value || '').trim();
    if (!login) return;

    const users = loadUsers();
    const user = users.find(u => sameLogin(u.login, login));
    if (!user) {
      alert('Пользователь с таким логином не найден.');
      return;
    }

    const list = type === 'form' ? loadForms() : loadTables();
    const resource = list.find(item => item.id === id);
    if (!resource || !isResourceOwner(resource)) {
      alert('Управлять доступом может только создатель.');
      return;
    }
    if (sameLogin(user.login, resource.ownerLogin)) {
      alert('Создатель уже имеет доступ.');
      return;
    }

    resource.invitedUsers = resource.invitedUsers || [];
    if (!resource.invitedUsers.some(existing => sameLogin(existing, user.login))) {
      resource.invitedUsers.push(user.login);
      if (type === 'form') {
        saveForms(list);
        addFormHistory(resource.id, { action: 'Пользователь приглашён: ' + user.login, user: currentUserLogin() || 'Пользователь' });
      } else {
        saveTables(list);
        addTableHistory(resource.id, { action: 'Пользователь приглашён: ' + user.login, user: currentUserLogin() || 'Пользователь' });
      }
    }
    if (input) input.value = '';
    const fresh = (type === 'form' ? loadForms() : loadTables()).find(item => item.id === id);
    renderAccessBlock(type, fresh || resource);
  }

  function revokeUser(type, login) {
    const id = type === 'form' ? currentFormId : currentTableId;
    const list = type === 'form' ? loadForms() : loadTables();
    const resource = list.find(item => item.id === id);
    if (!resource || !isResourceOwner(resource)) {
      alert('Управлять доступом может только создатель.');
      return;
    }
    resource.invitedUsers = (resource.invitedUsers || []).filter(existing => !sameLogin(existing, login));
    if (type === 'form') {
      saveForms(list);
      addFormHistory(resource.id, { action: 'Доступ отозван: ' + login, user: currentUserLogin() || 'Пользователь' });
    } else {
      saveTables(list);
      addTableHistory(resource.id, { action: 'Доступ отозван: ' + login, user: currentUserLogin() || 'Пользователь' });
    }
    const fresh = (type === 'form' ? loadForms() : loadTables()).find(item => item.id === id);
    renderAccessBlock(type, fresh || resource);
  }

  function closeActiveSheetFilter() {
    if (!activeSheetFilterCleanup) return;
    const cleanup = activeSheetFilterCleanup;
    activeSheetFilterCleanup = null;
    cleanup();
  }

  function placeSheetFilterDropdown(pop, anchor) {
    const target = anchor.closest('.sheet-col-header') || anchor;
    const rect = target.getBoundingClientRect();
    const wrapRect = anchor.closest('.sheet-wrap')?.getBoundingClientRect();
    const margin = 8;

    pop.style.position = 'fixed';
    pop.style.visibility = 'hidden';
    pop.style.left = '0px';
    pop.style.top = '0px';

    const minLeft = Math.max(margin, wrapRect ? wrapRect.left : margin);
    const maxLeft = Math.max(minLeft, window.innerWidth - pop.offsetWidth - margin);
    const left = Math.min(Math.max(rect.left, minLeft), maxLeft);
    let top = rect.bottom + 4;
    if (top + pop.offsetHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - pop.offsetHeight - 4);
    }

    pop.style.left = left + 'px';
    pop.style.top = Math.max(margin, top) + 'px';
    pop.style.visibility = '';
  }

  function applyColumnFilterSelection(col, allValues, pop) {
    const selected = new Set($$('input[type="checkbox"]', pop)
      .filter(cb => cb.checked)
      .map(cb => cb.value));
    if (selected.size === allValues.length) delete sheetColumnFilters[col];
    else sheetColumnFilters[col] = selected;
    applySheetFilterVisibility();
  }

  function openSheetColumnFilter(anchor, col, values) {
    closeActiveSheetFilter();
    const allValues = [...values];
    const current = sheetColumnFilters[col] || new Set(allValues);
    const pop = document.createElement('div');
    pop.className = 'filter-dropdown';
    pop.setAttribute('role', 'menu');

    ['pointerdown', 'mousedown', 'click'].forEach(type => {
      pop.addEventListener(type, event => {
        event.stopPropagation();
      });
    });

    if (allValues.length) {
      allValues.forEach(value => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = current.has(value);
        checkbox.addEventListener('change', () => {
          applyColumnFilterSelection(col, allValues, pop);
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + value));
        pop.appendChild(label);
      });
    } else {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'Нет значений';
      pop.appendChild(empty);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn-filter-reset';
    reset.textContent = 'Сбросить фильтр';
    reset.addEventListener('click', () => {
      delete sheetColumnFilters[col];
      applySheetFilterVisibility();
      closeActiveSheetFilter();
    });
    pop.appendChild(reset);

    document.body.appendChild(pop);
    placeSheetFilterDropdown(pop, anchor);

    const closeOnDocumentClick = event => {
      if (pop.contains(event.target) || anchor.contains(event.target)) return;
      closeActiveSheetFilter();
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') closeActiveSheetFilter();
    };

    let isOpen = true;
    let closeClickTimer = null;
    activeSheetFilterCleanup = () => {
      isOpen = false;
      if (closeClickTimer !== null) window.clearTimeout(closeClickTimer);
      pop.remove();
      document.removeEventListener('click', closeOnDocumentClick);
      document.removeEventListener('keydown', closeOnEscape);
    };

    closeClickTimer = window.setTimeout(() => {
      if (!isOpen) return;
      document.addEventListener('click', closeOnDocumentClick);
    }, 0);
    document.addEventListener('keydown', closeOnEscape);
  }

  function openTableView(id) {
    currentTableId = id;
    closeActiveSheetFilter();
    sheetColumnFilters = {};
    const t = loadTables().find(x => x.id === id);
    if (!t) return;
    if (!hasResourceAccess(t)) {
      currentTableId = null;
      accessDenied('table');
      return;
    }
    setTableLastViewed(id);
    const visibleTable = findAccessibleTable(id) || t;
    showScreen('table-view');
    $('#view-table-name').value = visibleTable.name || '';
    $('#view-table-comment').value = visibleTable.comment || '';
    $('#table-meta').textContent = `Создано: ${visibleTable.createdAt}, Изменено: ${visibleTable.updatedAt}`;
    $('#table-history-panel').classList.add('hidden');
    renderTableAccessBlock(visibleTable);
    const cellsEl = $('#view-table-cells');
    cellsEl.innerHTML = buildSheetFromCells(visibleTable.cells);
    cellsEl.classList.toggle('sheet-filters-off', !sheetFiltersVisible);
    $('#sheet-toggle-filters')?.classList.toggle('active', sheetFiltersVisible);
    applySheetFilterVisibility();
    cellsEl.querySelectorAll('.sheet-cell input').forEach(inp => {
      inp.addEventListener('change', function () {
        const r = parseInt(this.dataset.r, 10), c = parseInt(this.dataset.c, 10);
        const tables = loadTables();
        const tb = tables.find(x => x.id === currentTableId);
        if (!tb || !hasResourceAccess(tb)) return;
        tb.cells = ensureCellsGrid(tb.cells);
        if (!tb.cells[r]) tb.cells[r] = [];
        while (tb.cells[r].length <= c) tb.cells[r].push('');
        tb.cells[r][c] = this.value;
        saveTables(tables);
        addTableHistory(currentTableId, {
          action: 'Ячейка изменена',
          user: currentUserLogin() || 'Пользователь',
          cell: colLetter(c) + (r + 1),
          value: this.value
        });
      });
    });
    cellsEl.querySelectorAll('.col-filter').forEach(span => {
      span.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!sheetFiltersVisible) return;
        const col = parseInt(this.dataset.col, 10);
        const tables = loadTables();
        const tb = tables.find(x => x.id === currentTableId);
        if (!tb || !hasResourceAccess(tb)) return;
        const grid = ensureCellsGrid(tb.cells);
        const values = [];
        for (let r = 0; r < grid.length; r++)
          if (grid[r][col] !== undefined && grid[r][col] !== '') values.push(String(grid[r][col]).trim());
        const uniq = [...new Set(values)].sort();
        openSheetColumnFilter(this, col, uniq);
      });
    });
  }

  function applySheetFilterVisibility() {
    const t = loadTables().find(x => x.id === currentTableId);
    if (!t || !hasResourceAccess(t)) return;
    const grid = ensureCellsGrid(t.cells);
    const rows = $('#view-table-cells')?.querySelectorAll('tbody tr');
    if (!rows) return;
    rows.forEach((tr, i) => {
      if (i === 0) { tr.style.display = ''; return; } // первая строка — заголовки A,B,C
      const dataRowIndex = i - 1;
      const row = grid[dataRowIndex];
      if (!row) { tr.style.display = ''; return; }
      let show = true;
      for (const c in sheetColumnFilters) {
        const col = parseInt(c, 10);
        const allowed = sheetColumnFilters[c];
        if (!allowed) continue;
        const val = String((row[col] != null ? row[col] : '')).trim();
        if (!allowed.has(val)) { show = false; break; }
      }
      tr.style.display = show ? '' : 'none';
    });
    $('#view-table-cells')?.querySelectorAll('.col-filter').forEach(el => {
      el.classList.toggle('active', Object.prototype.hasOwnProperty.call(sheetColumnFilters, el.dataset.col));
    });
  }

  function bindSheetInputs(container) {
    if (!container) return;
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', function () {
        const r = parseInt(this.dataset.r, 10), c = parseInt(this.dataset.c, 10);
        const tables = loadTables();
        const tb = tables.find(x => x.id === currentTableId);
        if (!tb || !hasResourceAccess(tb)) return;
        tb.cells = ensureCellsGrid(tb.cells);
        if (!tb.cells[r]) tb.cells[r] = [];
        while (tb.cells[r].length <= c) tb.cells[r].push('');
        tb.cells[r][c] = this.value;
        saveTables(tables);
        addTableHistory(currentTableId, {
          action: 'Ячейка изменена',
          user: currentUserLogin() || 'Пользователь',
          cell: colLetter(c) + (r + 1),
          value: this.value
        });
      });
    });
  }

  $('#sheet-toggle-filters')?.addEventListener('click', function () {
    sheetFiltersVisible = !sheetFiltersVisible;
    this.classList.toggle('active', sheetFiltersVisible);
    if (!sheetFiltersVisible) {
      sheetColumnFilters = {};
    }
    $('#view-table-cells')?.classList.toggle('sheet-filters-off', !sheetFiltersVisible);
    applySheetFilterVisibility();
  });


  $('#sheet-show-history')?.addEventListener('click', function () {
    const panel = $('#table-history-panel');
    const list = $('#table-history-list');
    const history = getTableHistory(currentTableId);
    list.innerHTML = history.length ? history.map(h => {
      const d = h.date ? new Date(h.date).toLocaleString('ru') : '';
      return '<div class="history-item">' + escapeHtml(d) + ' — ' + escapeHtml(h.action) + ' (' + escapeHtml(h.user) + ')</div>';
    }).join('') : '<div class="history-item">Нет записей</div>';
    panel.classList.toggle('hidden', !panel.classList.contains('hidden'));
  });

  $('#table-invite-btn')?.addEventListener('click', function () {
    inviteUser('table');
  });

  $('#table-invite-login')?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inviteUser('table');
    }
  });

  $('#table-access-invited')?.addEventListener('click', function (e) {
    const btn = e.target.closest('.access-remove');
    if (btn) revokeUser('table', btn.dataset.login);
  });

  $('#back-from-table')?.addEventListener('click', function () {
    navigateToScreen('tables');
  });

  $('#save-table')?.addEventListener('click', function () {
    if (!currentTableId) return;
    const tables = loadTables();
    const tb = tables.find(t => t.id === currentTableId);
    if (!tb) return;
    if (!hasResourceAccess(tb)) {
      accessDenied('table');
      return;
    }
    tb.name = $('#view-table-name').value.trim() || tb.name;
    tb.comment = $('#view-table-comment').value.trim() || '';
    const cellsEl = $('#view-table-cells');
    const inputs = cellsEl.querySelectorAll('.sheet-cell input');
    tb.cells = ensureCellsGrid(tb.cells);
    inputs.forEach(inp => {
      const r = parseInt(inp.dataset.r, 10), c = parseInt(inp.dataset.c, 10);
      if (!tb.cells[r]) tb.cells[r] = [];
      while (tb.cells[r].length <= c) tb.cells[r].push('');
      tb.cells[r][c] = inp.value;
    });
    const now = new Date();
    tb.updatedAt = now.toISOString();
    const user = localStorage.getItem(STORAGE_KEYS.user) || 'Пользователь';
    saveTables(tables);
    addTableHistory(currentTableId, { action: 'Изменён', user });
    const saved = loadTables().find(t => t.id === currentTableId) || tb;
    $('#table-meta').textContent = 'Создано: ' + new Date(saved.createdAt).toLocaleString('ru') + ', Изменено: ' + new Date(saved.updatedAt).toLocaleString('ru');
  });

  // ---------- Просмотр/редактирование формы ----------
  function normalizeFormFields(form) {
    const raw = form.fields || [];
    return raw.map((f, i) => {
      if (typeof f === 'string') return { id: form.id + '-f' + i, type: 'text', label: f, required: false };
      return { id: f.id || form.id + '-f' + i, type: f.type || 'text', label: f.label || '', required: !!f.required, placeholder: f.placeholder, options: f.options || [], min: f.min, max: f.max };
    });
  }

  function formatAnswersForLog(form, answers) {
    const fields = normalizeFormFields(form);
    return fields.map(field => {
      const raw = answers?.[field.id];
      const value = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
      return (field.label || field.id) + ': ' + value;
    }).filter(line => line.trim() !== ':').join('; ');
  }

  function scaleBound(value, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(-100, Math.min(100, n));
  }

  function openFormView(id) {
    currentFormId = id;
    const f = loadForms().find(x => x.id === id);
    if (!f) return;
    if (!hasResourceAccess(f)) {
      currentFormId = null;
      accessDenied('form');
      return;
    }
    setFormLastViewed(id);
    const visibleForm = findAccessibleForm(id) || f;
    showScreen('form-view');
    $('#view-form-name').value = visibleForm.name || '';
    $('#view-form-comment').value = visibleForm.comment || '';
    $('#form-meta').textContent = `Создано: ${visibleForm.createdAt}, Изменено: ${visibleForm.updatedAt}`;
    visibleForm.fields = normalizeFormFields(visibleForm);
    const owner = isResourceOwner(visibleForm);
    $('#view-form-name').disabled = !owner;
    $('#view-form-comment').disabled = !owner;
    $('#save-form')?.classList.toggle('hidden', !owner);
    $('.form-tab[data-form-tab="edit"]')?.classList.toggle('hidden', !owner);
    $('.form-tab[data-form-tab="responses"]')?.classList.toggle('hidden', !owner);
    renderFormAccessBlock(visibleForm);
    renderFormEditBlock(visibleForm.fields);
    renderFormPreviewBlock(visibleForm);
    renderFormResponsesBlock(visibleForm);
    $('#form-edit-block').classList.toggle('hidden', !owner);
    $('#form-preview-block').classList.toggle('hidden', owner);
    $('#form-responses-block').classList.add('hidden');
    $$('.form-tab').forEach(b => b.classList.remove('active'));
    const activeTab = owner ? $('.form-tab[data-form-tab="edit"]') : $('.form-tab[data-form-tab="preview"]');
    if (activeTab) activeTab.classList.add('active');
  }

  const FORM_FIELD_TYPES_ARR = typeof FORM_FIELD_TYPES !== 'undefined' ? FORM_FIELD_TYPES : [
    { value: 'text', label: 'Краткий ответ' }, { value: 'textarea', label: 'Длинный текст' }, { value: 'number', label: 'Число' }, { value: 'email', label: 'Email' }, { value: 'date', label: 'Дата' },
    { value: 'radio', label: 'Один из списка' }, { value: 'checkbox', label: 'Несколько' }, { value: 'select', label: 'Список' }, { value: 'scale', label: 'Шкала' }
  ];

  function renderFormEditBlock(fields) {
    const container = $('#view-form-fields-edit');
    if (!container) return;
    container.innerHTML = fields.map((fld, i) => {
      const typesOpts = FORM_FIELD_TYPES_ARR.map(t => '<option value="' + escapeHtml(t.value) + '"' + (t.value === fld.type ? ' selected' : '') + '>' + escapeHtml(t.label) + '</option>').join('');
      const opts = (fld.options || []).join(', ');
      const optRow = ['radio', 'checkbox', 'select'].includes(fld.type) ? '<input type="text" class="input field-options-input" data-i="' + i + '" placeholder="Варианты через запятую" value="' + escapeHtml(opts) + '">' : '';
      const scaleRow = fld.type === 'scale' ? ' от <input type="number" class="input" style="width:50px" data-i="' + i + '" data-key="min" value="' + escapeHtml(scaleBound(fld.min, 1)) + '"> до <input type="number" class="input" style="width:50px" data-i="' + i + '" data-key="max" value="' + escapeHtml(scaleBound(fld.max, 10)) + '">' : '';
      return '<div class="form-field-item" data-i="' + i + '"><select class="input field-type-select" data-i="' + i + '">' + typesOpts + '</select><input type="text" class="input field-label-input" data-i="' + i + '" placeholder="Подпись" value="' + escapeHtml(fld.label) + '"><label class="label-inline"><input type="checkbox" data-i="' + i + '" ' + (fld.required ? 'checked' : '') + '> Обязательное</label>' + optRow + scaleRow + '<button type="button" class="btn btn-ghost btn-sm btn-remove-field" data-i="' + i + '">✕</button></div>';
    }).join('');
    container.querySelectorAll('.field-type-select').forEach(el => { el.addEventListener('change', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].type = this.value; saveForms(forms); renderFormEditBlock(form.fields); renderFormPreviewBlock(form); } }); });
    container.querySelectorAll('.field-label-input').forEach(el => { el.addEventListener('input', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].label = this.value; saveForms(forms); renderFormPreviewBlock(form); } }); });
    container.querySelectorAll('.field-options-input').forEach(el => { el.addEventListener('input', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].options = this.value.split(',').map(s => s.trim()).filter(Boolean); saveForms(forms); } }); });
    container.querySelectorAll('[data-key="min"]').forEach(el => { el.addEventListener('change', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].min = parseInt(this.value, 10); saveForms(forms); } }); });
    container.querySelectorAll('[data-key="max"]').forEach(el => { el.addEventListener('change', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].max = parseInt(this.value, 10); saveForms(forms); } }); });
    container.querySelectorAll('input[type="checkbox"]').forEach(el => { el.addEventListener('change', function () { const forms = loadForms(); const form = forms.find(x => x.id === currentFormId); const i = parseInt(this.dataset.i, 10); if (form && isResourceOwner(form) && form.fields[i]) { form.fields[i].required = this.checked; saveForms(forms); } }); });
    container.querySelectorAll('.btn-remove-field').forEach(btn => {
      btn.addEventListener('click', function () {
        const forms = loadForms();
        const form = forms.find(x => x.id === currentFormId);
        if (!form || !isResourceOwner(form) || !form.fields) return;
        const i = parseInt(this.dataset.i, 10);
        form.fields.splice(i, 1);
        saveForms(forms);
        renderFormEditBlock(form.fields);
        renderFormPreviewBlock(form);
      });
    });
  }

  $('#form-add-field-in-edit')?.addEventListener('click', function () {
    const forms = loadForms();
    const form = forms.find(x => x.id === currentFormId);
    if (!form || !isResourceOwner(form)) return;
    form.fields = normalizeFormFields(form);
    form.fields.push({ id: form.id + '-f' + Date.now(), type: 'text', label: 'Новый вопрос', required: false, options: [] });
    saveForms(forms);
    renderFormEditBlock(form.fields);
    renderFormPreviewBlock(form);
  });

  function renderFormPreviewBlock(form) {
    const descEl = $('#form-description-preview');
    const fillEl = $('#view-form-fill');
    if (!fillEl) return;
    const f = form || loadForms().find(x => x.id === currentFormId);
    if (!f) return;
    if (descEl) descEl.textContent = f.description || '';
    const fields = normalizeFormFields(f);
    fillEl.innerHTML = fields.map((fld) => {
      let input = '';
      if (fld.type === 'text') input = '<input type="text" class="input" data-field-id="' + escapeHtml(fld.id) + '">';
      else if (fld.type === 'textarea') input = '<textarea class="textarea" rows="2" data-field-id="' + escapeHtml(fld.id) + '"></textarea>';
      else if (fld.type === 'number') input = '<input type="number" class="input" data-field-id="' + escapeHtml(fld.id) + '">';
      else if (fld.type === 'email') input = '<input type="email" class="input" data-field-id="' + escapeHtml(fld.id) + '">';
      else if (fld.type === 'date') input = '<input type="date" class="input" data-field-id="' + escapeHtml(fld.id) + '">';
      else if (fld.type === 'radio' && (fld.options || []).length) input = '<div class="radio-options">' + (fld.options || []).map(o => '<label><input type="radio" name="' + escapeHtml(fld.id) + '" value="' + escapeHtml(o) + '"> ' + escapeHtml(o) + '</label>').join('') + '</div>';
      else if (fld.type === 'checkbox' && (fld.options || []).length) input = '<div class="checkbox-options">' + (fld.options || []).map(o => '<label><input type="checkbox" name="' + escapeHtml(fld.id) + '" value="' + escapeHtml(o) + '"> ' + escapeHtml(o) + '</label>').join('') + '</div>';
      else if (fld.type === 'select' && (fld.options || []).length) input = '<select class="input" data-field-id="' + escapeHtml(fld.id) + '"><option value="">—</option>' + (fld.options || []).map(o => '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + '</option>').join('') + '</select>';
      else if (fld.type === 'scale') {
        const min = scaleBound(fld.min, 1);
        const max = Math.max(min, scaleBound(fld.max, 10));
        input = '<select class="input" data-field-id="' + escapeHtml(fld.id) + '"><option value="">—</option>' + Array.from({ length: max - min + 1 }, (_, k) => min + k).map(n => '<option value="' + n + '">' + n + '</option>').join('') + '</select>';
      } else input = '<input type="text" class="input" data-field-id="' + escapeHtml(fld.id) + '">';
      return '<div class="form-fill-field"><label class="label">' + escapeHtml(fld.label) + (fld.required ? ' *' : '') + '</label>' + input + '</div>';
    }).join('');
  }

  function renderFormResponsesBlock(form) {
    const f = form || loadForms().find(x => x.id === currentFormId);
    if (!f) return;
    const responses = loadFormResponses().filter(r => r.formId === f.id && (isResourceOwner(f) || sameLogin(r.user, currentUserLogin())));
    const fields = normalizeFormFields(f);
    const thead = $('#form-responses-thead');
    const tbody = $('#form-responses-tbody');
    if (!thead || !tbody) return;
    thead.innerHTML = '<tr><th>Дата</th>' + fields.map(fld => '<th>' + escapeHtml(fld.label) + '</th>').join('') + '</tr>';
    tbody.innerHTML = responses.length ? responses.map(r => {
      const cells = fields.map(fld => escapeHtml(String(r.answers && r.answers[fld.id] != null ? r.answers[fld.id] : '—')));
      return '<tr><td>' + escapeHtml(r.submittedAt || '') + '</td>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + (fields.length + 1) + '">Нет ответов</td></tr>';
  }

  $$('.form-tab').forEach(btn => {
    btn.addEventListener('click', function () {
      const tab = this.dataset.formTab;
      const form = loadForms().find(x => x.id === currentFormId);
      if ((tab === 'edit' || tab === 'responses') && (!form || !isResourceOwner(form))) return;
      $$('.form-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      $('#form-edit-block').classList.toggle('hidden', tab !== 'edit');
      $('#form-preview-block').classList.toggle('hidden', tab !== 'preview');
      $('#form-responses-block').classList.toggle('hidden', tab !== 'responses');
      if (tab === 'responses') renderFormResponsesBlock();
    });
  });

  $('#form-submit-response')?.addEventListener('click', function () {
    const form = loadForms().find(x => x.id === currentFormId);
    if (!form) return;
    if (!hasResourceAccess(form)) {
      accessDenied('form');
      return;
    }
    const fields = normalizeFormFields(form);
    const answers = {};
    const fillRoot = $('#view-form-fill');
    fields.forEach(fld => {
      let val;
      if (fld.type === 'checkbox') {
        val = $$('input[type="checkbox"]', fillRoot).filter(cb => cb.name === fld.id && cb.checked).map(cb => cb.value);
      } else if (fld.type === 'radio') {
        const checked = $$('input[type="radio"]', fillRoot).find(cb => cb.name === fld.id && cb.checked);
        val = checked ? checked.value : '';
      } else {
        const el = $$('[data-field-id]', fillRoot).find(node => node.dataset.fieldId === fld.id);
        if (!el) return;
        val = el.value != null ? el.value.trim() : '';
      }
      answers[fld.id] = Array.isArray(val) ? val : val;
    });
    const requiredOk = fields.filter(f => f.required).every(f => {
      const v = answers[f.id];
      return (Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== ''));
    });
    if (!requiredOk) { alert('Заполните все обязательные поля.'); return; }
    const responses = loadFormResponses();
    responses.push({ id: 'r' + Date.now(), formId: form.id, submittedAt: new Date().toLocaleString('ru'), user: localStorage.getItem(STORAGE_KEYS.user), answers });
    saveFormResponses(responses);
    $('#view-form-fill').querySelectorAll('input, textarea, select').forEach(el => { el.value = ''; });
    $$('input[type="checkbox"], input[type="radio"]', $('#view-form-fill')).forEach(cb => { cb.checked = false; });
    addFormHistory(form.id, {
      action: 'Ответ создан',
      user: localStorage.getItem(STORAGE_KEYS.user) || 'Пользователь',
      answers: formatAnswersForLog(form, answers)
    });
    renderFormResponsesBlock();
  });

  $('#back-from-form')?.addEventListener('click', function () {
    navigateToScreen('forms');
  });

  $('#save-form')?.addEventListener('click', function () {
    if (!currentFormId) return;
    const forms = loadForms();
    const form = forms.find(f => f.id === currentFormId);
    if (!form) return;
    if (!hasResourceAccess(form)) {
      accessDenied('form');
      return;
    }
    if (!isResourceOwner(form)) {
      alert('Редактировать форму может только создатель.');
      return;
    }
    form.name = $('#view-form-name').value.trim() || form.name;
    form.comment = $('#view-form-comment').value.trim() || '';
    const now = new Date();
    form.updatedAt = now.toISOString();
    saveForms(forms);
    const user = localStorage.getItem(STORAGE_KEYS.user) || 'Пользователь';
    addFormHistory(currentFormId, { action: 'Форма изменена', user });
    openFormView(currentFormId);
  });

  $('#form-invite-btn')?.addEventListener('click', function () {
    inviteUser('form');
  });

  $('#form-invite-login')?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inviteUser('form');
    }
  });

  $('#form-access-invited')?.addEventListener('click', function (e) {
    const btn = e.target.closest('.access-remove');
    if (btn) revokeUser('form', btn.dataset.login);
  });

  // ---------- Создание таблицы (бесконечная, одна ячейка по умолчанию) ----------
  $('#form-create-table')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const name = $('#new-table-name').value.trim();
    const id = 't' + Date.now();
    const now = new Date();
    const date = now.toISOString();
    const user = currentUserLogin() || 'Пользователь';
    const tables = loadTables();
    tables.push({ id, name, owner: user, ownerLogin: user, invitedUsers: [], createdAt: date, updatedAt: date, comment: '', cells: [['']], history: [] });
    saveTables(tables);
    addTableHistory(id, { action: 'Создано', user });
    this.reset();
    openTableInNewTab(id);
    navigateToScreen('tables');
  });

  document.addEventListener('DOMContentLoaded', function () {
    if ($('#form-fields-list')) renderFormBuilderFields();
  });

  // ---------- Создание формы (конструктор полей) ----------
  let builderFields = [{ id: 'new-f0', type: 'text', label: 'Вопрос 1', required: false }];

  function renderFormBuilderFields() {
    const container = $('#form-fields-list');
    if (!container) return;
    container.innerHTML = builderFields.map((fld, i) => {
      const typesOpts = FORM_FIELD_TYPES_ARR.map(t => '<option value="' + escapeHtml(t.value) + '"' + (t.value === fld.type ? ' selected' : '') + '>' + escapeHtml(t.label) + '</option>').join('');
      const opts = (fld.options || []).join(', ');
      const optRow = ['radio', 'checkbox', 'select'].includes(fld.type) ? '<input type="text" class="input field-options-input" data-i="' + i + '" placeholder="Варианты через запятую" value="' + escapeHtml(opts) + '">' : '';
      const scaleRow = fld.type === 'scale' ? ' от <input type="number" class="input" style="width:50px" data-i="' + i + '" data-key="min" value="' + escapeHtml(scaleBound(fld.min, 1)) + '"> до <input type="number" class="input" style="width:50px" data-i="' + i + '" data-key="max" value="' + escapeHtml(scaleBound(fld.max, 10)) + '">' : '';
      return '<div class="form-field-item" data-i="' + i + '"><select class="input field-type-select" data-i="' + i + '">' + typesOpts + '</select><input type="text" class="input field-label-input" data-i="' + i + '" value="' + escapeHtml(fld.label) + '"><label class="label-inline"><input type="checkbox" data-i="' + i + '" ' + (fld.required ? 'checked' : '') + '> Обязательное</label>' + optRow + scaleRow + '<button type="button" class="btn btn-ghost btn-sm btn-remove-field" data-i="' + i + '">✕</button></div>';
    }).join('');
    container.querySelectorAll('.field-type-select').forEach(el => { el.addEventListener('change', function () { const i = parseInt(this.dataset.i, 10); builderFields[i].type = this.value; renderFormBuilderFields(); }); });
    container.querySelectorAll('.field-label-input').forEach(el => { el.addEventListener('input', function () { const i = parseInt(this.dataset.i, 10); builderFields[i].label = this.value; }); });
    container.querySelectorAll('.field-options-input').forEach(el => { el.addEventListener('input', function () { const i = parseInt(this.dataset.i, 10); builderFields[i].options = this.value.split(',').map(s => s.trim()).filter(Boolean); }); });
    container.querySelectorAll('[data-key="min"]').forEach(el => { el.addEventListener('change', function () { const i = parseInt(this.dataset.i, 10); builderFields[i].min = parseInt(this.value, 10); }); });
    container.querySelectorAll('[data-key="max"]').forEach(el => { el.addEventListener('change', function () { const i = parseInt(this.dataset.i, 10); builderFields[i].max = parseInt(this.value, 10); }); });
    container.querySelectorAll('.btn-remove-field').forEach(btn => {
      btn.addEventListener('click', function () {
        const i = parseInt(this.dataset.i, 10);
        builderFields.splice(i, 1);
        if (builderFields.length === 0) builderFields = [{ id: 'new-f0', type: 'text', label: 'Вопрос 1', required: false }];
        renderFormBuilderFields();
      });
    });
  }

  $('#add-form-field')?.addEventListener('click', function () {
    builderFields.push({ id: 'new-f' + builderFields.length, type: 'text', label: 'Вопрос ' + (builderFields.length + 1), required: false });
    renderFormBuilderFields();
  });

  $('#save-new-form')?.addEventListener('click', function () {
    const name = $('#new-form-name').value.trim();
    const description = $('#new-form-desc').value.trim();
    if (!name) { alert('Введите название формы.'); return; }
    const id = 'f' + Date.now();
    const now = new Date();
    const date = now.toISOString();
    const user = currentUserLogin() || 'Пользователь';
    const fields = builderFields.map((f, i) => ({ id: id + '-f' + i, type: f.type || 'text', label: f.label || '', required: !!f.required, options: f.options || [], min: f.min, max: f.max }));
    const forms = loadForms();
    forms.push({ id, name, owner: user, ownerLogin: user, invitedUsers: [], createdAt: date, updatedAt: date, comment: '', description, status: 'draft', fields });
    saveForms(forms);
    addFormHistory(id, { action: 'Форма создана', user });
    builderFields = [{ id: 'new-f0', type: 'text', label: 'Вопрос 1', required: false }];
    $('#new-form-name').value = '';
    $('#new-form-desc').value = '';
    renderFormBuilderFields();
    openFormInNewTab(id);
    navigateToScreen('forms');
  });

  // ---------- Импорт ----------
  function detectDataFileFormat(fileName) {
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    return ['json', 'csv', 'xml', 'xlsx', 'ods'].includes(ext) ? ext : '';
  }

  $('#btn-import')?.addEventListener('click', function () {
    const fileInput = $('#import-file');
    const formatSelect = $('#import-format');
    const resultEl = $('#import-result');
    if (!fileInput?.files?.length) {
      resultEl.textContent = 'Выберите файл.';
      resultEl.className = 'result-message error';
      resultEl.classList.remove('hidden');
      return;
    }
    const file = fileInput.files[0];
    if (file.size > IMPORT_FILE_LIMIT) {
      resultEl.textContent = 'Файл слишком большой. Максимум: 10 МБ.';
      resultEl.className = 'result-message error';
      resultEl.classList.remove('hidden');
      return;
    }
    const detectedFormat = detectDataFileFormat(file.name);
    const format = detectedFormat || formatSelect.value;
    if (detectedFormat && formatSelect) formatSelect.value = detectedFormat;
    const reader = new FileReader();
    reader.onload = async function () {
      try {
        resultEl.textContent = 'Импорт выполняется...';
        resultEl.className = 'result-message';
        resultEl.classList.remove('hidden');
        let data;
        const source = reader.result;
        if (format === 'json') {
          data = JSON.parse(source);
        } else if (format === 'csv') {
          data = parseCsvToData(source);
        } else if (format === 'xml') {
          data = parseXmlToData(source);
        } else if (format === 'xlsx' || format === 'ods') {
          data = window.AppSpreadsheet.parseSpreadsheetData(source, format);
        } else {
          throw new Error('Неподдерживаемый формат файла.');
        }
        const importCounts = {
          tables: Array.isArray(data.tables) ? data.tables.length : 0,
          forms: Array.isArray(data.forms) ? data.forms.length : 0,
          responses: Array.isArray(data.responses) ? data.responses.length : 0,
          tableLogs: Array.isArray(data.tableLogs) ? data.tableLogs.length : 0,
          formLogs: Array.isArray(data.formLogs) ? data.formLogs.length : 0
        };
        await replaceAllAppData(mergeImportedStateForCurrentUser(data));
        resultEl.textContent = 'Импорт выполнен успешно: таблиц — ' + importCounts.tables +
          ', форм — ' + importCounts.forms +
          ', ответов — ' + importCounts.responses +
          ', действий в таблицах — ' + importCounts.tableLogs +
          ', действий в формах — ' + importCounts.formLogs + '.';
        resultEl.className = 'result-message success';
        resultEl.classList.remove('hidden');
      } catch (err) {
        resultEl.textContent = 'Ошибка: ' + (err.message || 'неверный формат');
        resultEl.className = 'result-message error';
        resultEl.classList.remove('hidden');
      }
    };
    if (format === 'xlsx' || format === 'ods') {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  });

  function parseCsvToData(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const data = { tables: [], forms: [], users: [], responses: [], tableLogs: [], formLogs: [] };
    for (const line of lines) {
      if (line.startsWith('COLLECTION,')) {
        const first = line.indexOf(',');
        const second = line.indexOf(',', first + 1);
        const collection = line.slice(first + 1, second);
        const payload = line.slice(second + 1);
        if (Array.isArray(data[collection])) data[collection].push(JSON.parse(decodeURIComponent(payload)));
      } else if (line.startsWith('TABLE,')) {
        const [, id, name, owner, createdAt, updatedAt] = line.split(',');
        data.tables.push({ id, name, owner, createdAt, updatedAt, comment: '', cells: [], status: 'draft' });
      } else if (line.startsWith('FORM,')) {
        const [, id, name, owner, createdAt, updatedAt] = line.split(',');
        data.forms.push({ id, name, owner, createdAt, updatedAt, comment: '', fields: [], description: '', status: 'draft' });
      }
    }
    return data;
  }

  function parseXmlToData(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const payload = doc.querySelector('payload');
    if (payload && payload.textContent) {
      return JSON.parse(payload.textContent);
    }
    const tables = [];
    const forms = [];
    doc.querySelectorAll('table').forEach(el => {
      tables.push({
        id: el.getAttribute('id') || 't' + Date.now(),
        name: el.querySelector('name')?.textContent || '',
        owner: el.querySelector('owner')?.textContent || '',
        createdAt: el.querySelector('createdAt')?.textContent || '',
        updatedAt: el.querySelector('updatedAt')?.textContent || '',
        comment: '',
        cells: [],
        status: 'draft'
      });
    });
    doc.querySelectorAll('form').forEach(el => {
      forms.push({
        id: el.getAttribute('id') || 'f' + Date.now(),
        name: el.querySelector('name')?.textContent || '',
        owner: el.querySelector('owner')?.textContent || '',
        createdAt: el.querySelector('createdAt')?.textContent || '',
        updatedAt: el.querySelector('updatedAt')?.textContent || '',
        comment: '',
        fields: [],
        description: '',
        status: 'draft'
      });
    });
    return { tables, forms };
  }

  // ---------- Экспорт (выборочный) ----------
  function renderExportLists() {
    const tables = accessibleTables();
    const forms = accessibleForms();
    const tablesWrap = $('#export-tables-list');
    const formsWrap = $('#export-forms-list');
    if (tablesWrap) {
      tablesWrap.innerHTML = tables.length ? tables.map(t =>
        '<label class="export-checkbox-label"><input type="checkbox" class="export-table-cb" value="' + escapeHtml(t.id) + '"> ' + escapeHtml(t.name) + '</label>'
      ).join('') : '<p class="hint">Нет таблиц</p>';
    }
    if (formsWrap) {
      formsWrap.innerHTML = forms.length ? forms.map(f =>
        '<label class="export-checkbox-label"><input type="checkbox" class="export-form-cb" value="' + escapeHtml(f.id) + '"> ' + escapeHtml(f.name) + '</label>'
      ).join('') : '<p class="hint">Нет форм</p>';
    }
  }

  $('#btn-export')?.addEventListener('click', function () {
    const format = $('#export-format').value;
    const selectedTableIds = $$('.export-table-cb:checked').map(cb => cb.value);
    const selectedFormIds = $$('.export-form-cb:checked').map(cb => cb.value);
    const allTables = accessibleTables();
    const allForms = accessibleForms();
    const tables = selectedTableIds.length ? allTables.filter(t => selectedTableIds.includes(t.id)) : allTables;
    const forms = selectedFormIds.length ? allForms.filter(f => selectedFormIds.includes(f.id)) : allForms;
    const selectedFormIdSet = new Set(forms.map(f => f.id));
    const selectedTableIdSet = new Set(tables.map(t => t.id));
    const data = {
      users: loadUsers(),
      tables,
      forms,
      responses: loadFormResponses().filter(r => selectedFormIdSet.has(r.formId)),
      tableLogs: loadTableLogs().filter(l => !l.tableId || selectedTableIdSet.has(l.tableId)),
      formLogs: loadFormLogs().filter(l => !l.formId || selectedFormIdSet.has(l.formId)),
      exportedAt: new Date().toISOString()
    };
    let blob, name;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      name = 'export.json';
    } else if (format === 'csv') {
      const lines = ['TYPE,COLLECTION,PAYLOAD'];
      ['users', 'tables', 'forms', 'responses', 'tableLogs', 'formLogs'].forEach(collection => {
        data[collection].forEach(item => lines.push('COLLECTION,' + collection + ',' + encodeURIComponent(JSON.stringify(item))));
      });
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      name = 'export.csv';
    } else if (format === 'xml') {
      const xml = '<?xml version="1.0" encoding="UTF-8"?><export><payload>' + escapeHtml(JSON.stringify(data)) + '</payload></export>';
      blob = new Blob([xml], { type: 'application/xml' });
      name = 'export.xml';
    } else if (format === 'xlsx' || format === 'ods') {
      blob = window.AppSpreadsheet.createSpreadsheetBlob(data, format);
      name = 'export.' + format;
    } else {
      alert('Неподдерживаемый формат экспорта.');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- Журналы действий (многокритериальные фильтры) ----------
  async function renderTablesLog() {
    const tbody = $('#tbody-tables-log');
    if (!tbody) return;
    let rows = accessibleTableLogs().map(l => ({
      id: l.id || '',
      tableId: l.tableId || '',
      tableName: l.tableName || '',
      owner: l.owner || '',
      createdAt: l.createdAt || '',
      updatedAt: l.updatedAt || '',
      viewedAt: l.viewedAt || '',
      action: l.action || '',
      cell: l.cell || '',
      value: l.value || '',
      details: l.details || '',
      user: l.user || '',
      date: l.date || ''
    }));

    const query = ($('#search-tables-log')?.value || '').trim().toLowerCase();
    const filters = getTablesLogMultiFilters();

    if (query) {
      rows = rows.filter(r => {
        return [
          r.tableName,
          r.action,
          r.user,
          r.owner,
          r.cell,
          r.value,
          r.details,
          formatDateTime(r.createdAt),
          formatDateTime(r.updatedAt),
          formatDateTime(r.viewedAt),
          formatDateTime(r.date)
        ].some(v => normalizeText(v).includes(query));
      });
    }

    rows = rows.filter(r => {
      if (filters.tableName && !normalizeText(r.tableName).includes(normalizeText(filters.tableName))) return false;
      if (filters.action && !normalizeText(r.action).includes(normalizeText(filters.action))) return false;
      if (filters.user && !normalizeText(r.user).includes(normalizeText(filters.user))) return false;
      if (filters.owner && !normalizeText(r.owner).includes(normalizeText(filters.owner))) return false;
      if (filters.cell && !normalizeText(r.cell).includes(normalizeText(filters.cell))) return false;
      if (filters.value && !normalizeText(r.value).includes(normalizeText(filters.value))) return false;
      if (filters.createdFrom || filters.createdTo) if (!inDateRange(r.createdAt, filters.createdFrom, filters.createdTo)) return false;
      if (filters.updatedFrom || filters.updatedTo) if (!inDateRange(r.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
      if (filters.viewedFrom || filters.viewedTo) if (!inDateRange(r.viewedAt, filters.viewedFrom, filters.viewedTo)) return false;
      if (filters.dateFrom || filters.dateTo) if (!inDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
      return true;
    });

    rows.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

    const pageData = await loadPagedList('tables-log', 'tableLogs', () => rows);
    rows = pageData.items || [];
    tbody.innerHTML = rows.length
      ? rows.map(r => '<tr class="table-log-row-clickable" data-log-id="' + escapeHtml(r.id || '') + '">' +
        '<td><a href="/table-actions/' + encodeURIComponent(r.id || '') + '" class="table-log-open-link" data-log-id="' + escapeHtml(r.id || '') + '">' + escapeHtml(r.tableName || '—') + '</a></td>' +
        '<td>' + escapeHtml(r.action || '—') + '</td>' +
        '<td>' + escapeHtml(r.user || '—') + '</td>' +
        '<td>' + escapeHtml(r.owner || '—') + '</td>' +
        '<td>' + escapeHtml(r.cell || '—') + '</td>' +
        '<td>' + escapeHtml(r.value || r.details || '—') + '</td>' +
        '<td>' + escapeHtml(formatDateTime(r.createdAt)) + '</td>' +
        '<td>' + escapeHtml(formatDateTime(r.updatedAt)) + '</td>' +
        '<td>' + escapeHtml(formatDateTime(r.viewedAt)) + '</td>' +
        '<td>' + escapeHtml(formatDateTime(r.date)) + '</td>' +
      '</tr>').join('')
      : '<tr><td colspan="10">Действий нет</td></tr>';
    renderPagination('tables-log', pageData.total || 0, pageData.page || 1, pageData.limit || LIST_PAGE_SIZE, renderTablesLog);
    tbody.querySelectorAll('.table-log-open-link').forEach(link => {
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        navigateToTableLog(this.dataset.logId);
      });
    });
    tbody.querySelectorAll('.table-log-row-clickable').forEach(tr => {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        navigateToTableLog(this.dataset.logId);
      });
    });
  }

  function openTableLogView(id) {
    const log = findAccessibleTableLog(id);
    if (!log) {
      alert('Действие недоступно или не найдено.');
      navigateToScreen('tables-log');
      return;
    }

    showScreen('table-log-view');
    $('#view-table-log-title').textContent = log.action || 'Действие в таблице';
    $('#table-log-meta').textContent = 'Дата действия: ' + formatDateTime(log.date);
    $('#view-table-log-table').value = log.tableName || '—';
    $('#view-table-log-action').value = log.action || '—';
    $('#view-table-log-user').value = log.user || '—';
    $('#view-table-log-owner').value = log.owner || '—';
    $('#view-table-log-cell').value = log.cell || '—';
    $('#view-table-log-value').value = log.value || log.details || '—';
    $('#view-table-log-created').value = formatDateTime(log.createdAt);
    $('#view-table-log-updated').value = formatDateTime(log.updatedAt);
    $('#view-table-log-viewed').value = formatDateTime(log.viewedAt);
    $('#view-table-log-date').value = formatDateTime(log.date);
  }

  $('#back-from-table-log')?.addEventListener('click', function () {
    navigateToScreen('tables-log');
  });

  async function renderFormsLog() {
    const tbody = $('#tbody-forms-log');
    if (!tbody) return;
    const formIds = accessibleFormIds();
    let rows = loadFormLogs().filter(l => !l.formId || formIds.has(l.formId) || sameLogin(l.user, currentUserLogin())).map(l => ({
      formId: l.formId || '',
      formName: l.formName || '',
      owner: l.owner || '',
      status: l.status || '',
      fieldsCount: l.fieldsCount || 0,
      createdAt: l.createdAt || '',
      updatedAt: l.updatedAt || '',
      action: l.action || '',
      answers: l.answers || '',
      details: l.details || '',
      user: l.user || '',
      date: l.date || ''
    }));

    const query = ($('#search-forms-log')?.value || '').trim().toLowerCase();
    const filters = getFormsLogMultiFilters();

    if (query) {
      rows = rows.filter(r => {
        const viewedDate = r.date ? String(new Date(r.date).toLocaleString('ru')) : '';
        return [r.formName, r.action, r.user, r.owner, r.status, r.answers, r.details, viewedDate].some(v => normalizeText(v).includes(query));
      });
    }

    rows = rows.filter(r => {
      if (filters.formName && !normalizeText(r.formName).includes(normalizeText(filters.formName))) return false;
      if (filters.action && !normalizeText(r.action).includes(normalizeText(filters.action))) return false;
      if (filters.user && !normalizeText(r.user).includes(normalizeText(filters.user))) return false;
      if (filters.owner && !normalizeText(r.owner).includes(normalizeText(filters.owner))) return false;
      if (filters.answers && !normalizeText(r.answers).includes(normalizeText(filters.answers))) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (!inNumberRange(r.fieldsCount, filters.fieldsMin, filters.fieldsMax)) return false;
      if (filters.createdFrom || filters.createdTo) if (!inDateRange(r.createdAt, filters.createdFrom, filters.createdTo)) return false;
      if (filters.updatedFrom || filters.updatedTo) if (!inDateRange(r.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
      if (filters.dateFrom || filters.dateTo) if (!inDateRange(r.date, filters.dateFrom, filters.dateTo)) return false;
      return true;
    });

    rows.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

    const pageData = await loadPagedList('forms-log', 'formLogs', () => rows);
    rows = pageData.items || [];
    tbody.innerHTML = rows.length
      ? rows.map(r => '<tr><td>' + escapeHtml(r.formName) + '</td><td>' + escapeHtml(r.action) + '</td><td>' + escapeHtml(r.answers || r.details || '—') + '</td><td>' + escapeHtml(r.user) + '</td><td>' + escapeHtml(r.date ? new Date(r.date).toLocaleString('ru') : '') + '</td></tr>').join('')
      : '<tr><td colspan="5">Действий нет</td></tr>';
    renderPagination('forms-log', pageData.total || 0, pageData.page || 1, pageData.limit || LIST_PAGE_SIZE, renderFormsLog);
  }

  // ---------- Статистика (метаданные и строки выбранной таблицы) ----------
  const STAT_OPERATORS = [
    { value: 'contains', label: 'содержит' },
    { value: 'not_contains', label: 'не содержит' },
    { value: 'eq', label: 'равно' },
    { value: 'neq', label: 'не равно' },
    { value: 'gt', label: 'больше' },
    { value: 'lt', label: 'меньше' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'empty', label: 'пусто' },
    { value: 'not_empty', label: 'не пусто' }
  ];
  let statConditions = [];

  function currentStatSource() {
    return $('#stat-source')?.value || 'metadata';
  }

  function statFieldOptions() {
    if (currentStatSource() === 'table') {
      return Array.from({ length: SHEET_COLS }, (_, i) => ({ value: String(i), label: colLetter(i) }));
    }
    return [
      { value: 'name', label: 'Название' },
      { value: 'owner', label: 'Владелец' },
      { value: 'type', label: 'Тип' },
      { value: 'createdAt', label: 'Дата создания' },
      { value: 'updatedAt', label: 'Дата изменения' },
      { value: 'lastViewedAt', label: 'Дата просмотра' },
      { value: 'comment', label: 'Комментарий' },
      { value: 'description', label: 'Описание формы' },
      { value: 'status', label: 'Статус формы' },
      { value: 'fieldsCount', label: 'Кол-во полей' }
    ];
  }

  function populateStatTables() {
    const tableSelect = $('#stat-table');
    if (!tableSelect) return;
    const tables = accessibleTables();
    tableSelect.innerHTML = tables.map(t => '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>').join('');
    const colOptions = '<option value="">—</option>' + Array.from({ length: SHEET_COLS }, (_, i) => '<option value="' + i + '">' + colLetter(i) + '</option>').join('');
    const xOptions = Array.from({ length: SHEET_COLS }, (_, i) => '<option value="' + i + '">' + colLetter(i) + '</option>').join('');
    if ($('#stat-table-x')) $('#stat-table-x').innerHTML = xOptions;
    if ($('#stat-table-y')) $('#stat-table-y').innerHTML = colOptions;
  }

  function renderStatConditions() {
    const wrap = $('#stat-conditions-list');
    if (!wrap) return;
    const fields = statFieldOptions();
    const fieldOptions = fields.map(f => '<option value="' + escapeHtml(f.value) + '">' + escapeHtml(f.label) + '</option>').join('');
    const opOptions = STAT_OPERATORS.map(op => '<option value="' + escapeHtml(op.value) + '">' + escapeHtml(op.label) + '</option>').join('');
    wrap.innerHTML = statConditions.map((cond, i) => {
      return '<div class="stat-condition-row" data-i="' + i + '">' +
        '<select class="input stat-condition-field" data-i="' + i + '">' + fieldOptions + '</select>' +
        '<select class="input stat-condition-op" data-i="' + i + '">' + opOptions + '</select>' +
        '<input type="text" class="input stat-condition-value" data-i="' + i + '" placeholder="значение">' +
        '<button type="button" class="btn btn-ghost btn-sm stat-condition-remove" data-i="' + i + '">Удалить</button>' +
        '</div>';
    }).join('') || '<p class="hint stat-empty-conditions">Условия не заданы</p>';

    wrap.querySelectorAll('.stat-condition-row').forEach(row => {
      const i = Number(row.dataset.i);
      const cond = statConditions[i];
      const field = row.querySelector('.stat-condition-field');
      const op = row.querySelector('.stat-condition-op');
      const value = row.querySelector('.stat-condition-value');
      if (field) field.value = cond.field || fields[0]?.value || '';
      if (op) op.value = cond.op || 'contains';
      if (value) value.value = cond.value || '';
    });

    wrap.querySelectorAll('.stat-condition-field').forEach(el => el.addEventListener('change', function () {
      statConditions[Number(this.dataset.i)].field = this.value;
      drawChart();
    }));
    wrap.querySelectorAll('.stat-condition-op').forEach(el => el.addEventListener('change', function () {
      statConditions[Number(this.dataset.i)].op = this.value;
      drawChart();
    }));
    wrap.querySelectorAll('.stat-condition-value').forEach(el => el.addEventListener('input', function () {
      statConditions[Number(this.dataset.i)].value = this.value;
      drawChart();
    }));
    wrap.querySelectorAll('.stat-condition-remove').forEach(btn => btn.addEventListener('click', function () {
      statConditions.splice(Number(this.dataset.i), 1);
      renderStatConditions();
      drawChart();
    }));
  }

  function updateStatMode() {
    const isTable = currentStatSource() === 'table';
    $('#stat-metadata-controls')?.classList.toggle('hidden', isTable);
    $('#stat-table-controls')?.classList.toggle('hidden', !isTable);
    renderStatConditions();
  }

  function comparableValue(value) {
    if (Array.isArray(value)) value = value.join(', ');
    if (value == null) return { raw: '', text: '', number: null, date: null };
    const raw = String(value);
    const number = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    const date = new Date(raw);
    return {
      raw,
      text: raw.toLowerCase(),
      number: Number.isFinite(number) ? number : null,
      date: isNaN(date.getTime()) ? null : date.getTime()
    };
  }

  function compareByOperator(actual, operator, expected) {
    const a = comparableValue(actual);
    const e = comparableValue(expected);
    if (operator === 'empty') return a.text.trim() === '';
    if (operator === 'not_empty') return a.text.trim() !== '';
    if (operator === 'contains') return a.text.includes(e.text);
    if (operator === 'not_contains') return !a.text.includes(e.text);
    if (operator === 'eq') return a.text === e.text;
    if (operator === 'neq') return a.text !== e.text;

    let left = a.text;
    let right = e.text;
    if (a.number != null && e.number != null) {
      left = a.number;
      right = e.number;
    } else if (a.date != null && e.date != null) {
      left = a.date;
      right = e.date;
    }
    if (operator === 'gt') return left > right;
    if (operator === 'lt') return left < right;
    if (operator === 'gte') return left >= right;
    if (operator === 'lte') return left <= right;
    return true;
  }

  function metadataFieldValue(item, field) {
    if (field === 'type') return item._type === 'table' ? 'Таблица' : 'Форма';
    if (field === 'fieldsCount') return item._type === 'form' ? (item.fields ? item.fields.length : 0) : 0;
    return item[field] || '';
  }

  function rowPassesConditions(row) {
    return statConditions.every(cond => compareByOperator(row[Number(cond.field)] || '', cond.op, cond.value));
  }

  function metadataPassesConditions(item) {
    return statConditions.every(cond => compareByOperator(metadataFieldValue(item, cond.field), cond.op, cond.value));
  }

  function setStatKpis(total, tables, forms) {
    if ($('#stat-kpi-total')) $('#stat-kpi-total').textContent = String(total);
    if ($('#stat-kpi-tables')) $('#stat-kpi-tables').textContent = String(tables);
    if ($('#stat-kpi-forms')) $('#stat-kpi-forms').textContent = String(forms);
  }

  function drawEmptyChart(ctx, w, message) {
    ctx.fillStyle = document.body.classList.contains('theme-dark') ? '#e5e7eb' : '#1a1a1a';
    ctx.font = '16px DM Sans, sans-serif';
    ctx.fillText(message, 24, 52);
  }

  function drawBarChart(labels) {
    const canvas = $('#chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!labels.length) {
      drawEmptyChart(ctx, w, 'Нет данных для построения диаграммы');
      return;
    }
    const maxVal = Math.max(...labels.map(x => x.value), 1);
    const barH = 24;
    const gap = 8;
    const left = 170;
    const chartW = w - left - 60;
    ctx.font = '13px DM Sans, sans-serif';
    labels.slice(0, 11).forEach((item, i) => {
      const y = 42 + i * (barH + gap);
      ctx.fillStyle = document.body.classList.contains('theme-dark') ? '#e5e7eb' : '#1a1a1a';
      ctx.fillText(String(item.label).slice(0, 22), 8, y + barH / 2 + 4);
      const barLen = (item.value / maxVal) * chartW;
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(left, y, chartW, barH);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(left, y, barLen, barH);
      ctx.fillStyle = document.body.classList.contains('theme-dark') ? '#e5e7eb' : '#1a1a1a';
      ctx.fillText(String(item.value), left + barLen + 8, y + barH / 2 + 4);
    });
  }

  function drawMetadataChart() {
    const xAxis = $('#stat-x')?.value || 'owner';
    const typeFilter = $('#stat-type')?.value || 'all';
    let items = [];
    items = items.concat(accessibleTables().map(t => ({ ...t, _type: 'table' })));
    items = items.concat(accessibleForms().map(f => ({ ...f, _type: 'form' })));
    const filteredItems = items.filter(i => (typeFilter === 'all' || i._type === typeFilter) && metadataPassesConditions(i));
    setStatKpis(filteredItems.length, filteredItems.filter(x => x._type === 'table').length, filteredItems.filter(x => x._type === 'form').length);

    const counts = {};
    filteredItems.forEach(i => {
      let key = '—';
      if (xAxis === 'owner') key = i.owner || '—';
      else if (xAxis === 'type') key = i._type === 'table' ? 'Таблицы' : 'Формы';
      else if (xAxis === 'createdYear') key = (i.createdAt || '').slice(0, 4) || '—';
      else if (xAxis === 'updatedYear') key = (i.updatedAt || '').slice(0, 4) || '—';
      else if (xAxis === 'createdMonth') key = (i.createdAt || '').slice(0, 7) || '—';
      counts[key] = (counts[key] || 0) + 1;
    });
    const labels = Object.entries(counts).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
    drawBarChart(labels);
  }

  function drawTableChart() {
    const tableId = $('#stat-table')?.value;
    const xCol = $('#stat-table-x')?.value;
    const yCol = $('#stat-table-y')?.value;
    const table = findAccessibleTable(tableId);
    if (!table || xCol === '') {
      const canvas = $('#chart-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setStatKpis(0, 0, 0);
      drawEmptyChart(ctx, canvas.width, 'Выберите таблицу и ось X');
      return;
    }
    let rows = ensureCellsGrid(table.cells).filter(row => row.some(cell => String(cell || '').trim() !== ''));
    if (rows.length > 1) rows = rows.slice(1);
    rows = rows.filter(rowPassesConditions);
    setStatKpis(rows.length, 1, 0);

    const counts = {};
    rows.forEach(row => {
      const x = String(row[Number(xCol)] || '—').trim() || '—';
      const y = yCol !== '' ? (String(row[Number(yCol)] || '—').trim() || '—') : '';
      const key = y ? x + ' / ' + y : x;
      counts[key] = (counts[key] || 0) + 1;
    });
    const labels = Object.entries(counts).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
    drawBarChart(labels);
  }

  function drawChart() {
    if (currentStatSource() === 'table') drawTableChart();
    else drawMetadataChart();
  }

  function initStatisticsScreen() {
    populateStatTables();
    updateStatMode();
    if ($('#screen-statistics')?.dataset.initialized === '1') return;
    $('#screen-statistics').dataset.initialized = '1';
    $('#stat-source')?.addEventListener('change', function () {
      statConditions = [];
      updateStatMode();
      drawChart();
    });
    $('#stat-table')?.addEventListener('change', drawChart);
    $('#stat-table-x')?.addEventListener('change', drawChart);
    $('#stat-table-y')?.addEventListener('change', drawChart);
    $('#stat-type')?.addEventListener('change', drawChart);
    $('#stat-x')?.addEventListener('change', drawChart);
    $('#btn-add-stat-condition')?.addEventListener('click', function () {
      const firstField = statFieldOptions()[0]?.value || '';
      statConditions.push({ field: firstField, op: 'contains', value: '' });
      renderStatConditions();
    });
    drawChart();
  }

  $('#btn-build-stats')?.addEventListener('click', drawChart);
  $('#btn-reset-stats-filters')?.addEventListener('click', function () {
    statConditions = [];
    $('#stat-source') && ($('#stat-source').value = 'metadata');
    $('#stat-type') && ($('#stat-type').value = 'all');
    $('#stat-x') && ($('#stat-x').value = 'owner');
    updateStatMode();
    drawChart();
  });

  // ---------- Инициализация ----------
  async function startApp() {
    try {
      if (typeof loadCurrentSession === 'function') {
        await loadCurrentSession();
      }
      if (!localStorage.getItem(STORAGE_KEYS.user)) {
        showLogin();
        return;
      }
      await initializeAppData();
      showApp();
    } catch {
      if (typeof clearAuthSession === 'function') clearAuthSession();
      showLogin();
    }
  }

  startApp();
})();
