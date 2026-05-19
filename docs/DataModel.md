# Модель данных


## Нереляционная модель

Используемая СУБД - ArangoDB. Модель сочетает документное хранение JSON и графовые связи. Документы удобны для таблиц, форм и ответов, потому что структура формы и набор колонок могут меняться от объекта к объекту. Ребра удобны для связей "пользователь владеет таблицей/формой" и "форма записывает ответы в таблицу".

![Нереляционная модель ArangoDB](https://github.com/user-attachments/assets/a45f6248-2cd1-417e-8e34-4c079a861618)



### Коллекции и назначение

| Коллекция | Тип ArangoDB | Назначение |
|---|---|---|
| `users` | document | Учетные записи пользователей и роли для доступа к приложению. |
| `spreadsheets` | document | Метаданные электронных таблиц: название, владелец, даты, комментарий, размеры сетки. |
| `table_rows` | document | Строки таблиц. Значения ячеек хранятся в объекте `values`, например `{ "A": "Проект", "B": "100" }`. |
| `forms` | document | Формы и их схема. Поля формы вложены массивом `fields`, потому что набор вопросов является частью формы. |
| `form_responses` | document | Отправленные ответы на формы. Ответы хранятся объектом `answers`, где ключ - идентификатор поля формы. |
| `activity_log` | document | История изменений таблиц и форм с датой, пользователем и типом действия. |
| `user_assets` | edge | Связь пользователя с таблицей или формой: владелец, редактор, читатель. |
| `form_targets` | edge | Связь формы с таблицей, куда автоматически добавляются ответы. |

### Поля и оценка размера

Оценка дана для UTF-8. Для строк с русским текстом принято среднее 2 байта на символ. В фактическом объеме учитываются имена JSON-полей, кавычки, служебные символы и системные поля ArangoDB (`_key`, `_id`, `_rev`). Значения округлены, потому что точный размер зависит от конкретных строк и индексов.

| Объект | Основные поля | Чистый объем данных | Фактический объем документа |
|---|---|---:|---:|
| `users` | `_key` 16 Б, `login` 32 Б, `passwordHash` 60 Б, `role` 8 Б, даты 48 Б, `comment` 112 Б | 276 Б | 520 Б |
| `spreadsheets` | `_key` 16 Б, `name` 80 Б, `ownerId` 16 Б, даты 48 Б, `comment` 256 Б, размеры 8 Б | 424 Б | 760 Б |
| `table_rows` | `_key` 16 Б, `spreadsheetId` 16 Б, `rowIndex` 4 Б, 10 значений по 24 Б, даты 48 Б | 324 Б | 620 Б |
| `forms` | `_key` 16 Б, `name` 80 Б, `description` 256 Б, `ownerId` 16 Б, `status` 10 Б, даты 48 Б, `comment` 256 Б, 5 полей формы примерно по 227 Б | 1817 Б | 2600 Б |
| `form_responses` | `_key` 16 Б, `formId` 16 Б, `submittedBy` 16 Б, `submittedAt` 24 Б, 5 ответов по 40 Б | 272 Б | 520 Б |
| `activity_log` | `_key` 16 Б, `entityType` 10 Б, `entityId` 16 Б, `action` 40 Б, `userId` 16 Б, дата 24 Б | 122 Б | 260 Б |
| `user_assets` | `_from` 16 Б, `_to` 16 Б, `role` 10 Б | 42 Б | 180 Б |
| `form_targets` | `_from` 16 Б, `_to` 16 Б | 32 Б | 180 Б |

### Оценка объема информации

Введем переменную `N` - количество электронных таблиц. Для единой формулы принимается демонстрационный профиль:

- на 1 таблицу приходится 1 форма;
- в каждой таблице 20 непустых строк и 10 логических колонок;
- у каждой формы 5 полей и 50 ответов;
- на каждую таблицу и форму вместе приходится 10 записей истории;
- 1 пользователь приходится на 5 таблиц, то есть `0.2N` пользователей;
- на каждую таблицу приходится 2 ребра `user_assets` и 1 ребро `form_targets`.

Чистый объем:

```text
V_clean_noSQL(N) =
0.2N * 276
+ N * 424
+ 20N * 324
+ N * 1817
+ 50N * 272
+ 10N * 122
+ 2N * 42
+ N * 32
= 23712.2N байт
```

Фактический объем:

```text
V_fact_noSQL(N) =
0.2N * 520
+ N * 760
+ 20N * 620
+ N * 2600
+ 50N * 520
+ 10N * 260
+ 2N * 180
+ N * 180
= 45004N байт
```

С учетом служебной информации базы, первичных индексов и небольшого постоянного системного запаса можно записать:

```text
V_noSQL(N) = 45004N + 1024 байт
```

Например, для `N = 10` таблиц потребуется примерно:

```text
V_noSQL(10) = 451064 байт ≈ 441 КиБ
```

### Избыточность данных

Избыточность определим как отношение фактического объема к чистому объему:

```text
R_noSQL(N) = (45004N + 1024) / (23712.2N)
```

При `N = 10`:

```text
R_noSQL(10) = 451064 / 237122 ≈ 1.90
```

Избыточность возникает из-за имен JSON-полей, системных полей ArangoDB, ребер графа, дат обновления и повторяющихся идентификаторов связей. При росте `N` влияние постоянного слагаемого `1024` уменьшается, и коэффициент стремится к `45004 / 23712.2 ≈ 1.90`.

### Направление роста модели

| Что увеличивается | Как растет объем |
|---|---|
| Количество пользователей `U` | Линейно: `O(U)`, пользовательские документы и ребра доступа. |
| Количество таблиц `T` | Линейно по метаданным: `O(T)`, но фактически доминируют строки таблиц. |
| Количество строк `R` и заполненных колонок `C` | `O(T * R * C)` по значениям в `table_rows.values`. |
| Количество форм `F` | `O(F * Q)`, где `Q` - число полей формы. |
| Количество ответов `A` | `O(A * Q)`, потому что каждый ответ хранит значения по полям формы. |
| Количество действий в истории `L` | `O(L)`, каждая операция добавляет документ в `activity_log`. |

### Примеры данных
#### Таблица

```json
{
  "_key": "tbl_budget_2024",
  "name": "Бюджет 2024",
  "ownerId": "u_ivanov",
  "rowCount": 40,
  "colCount": 40,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-03-01T11:30:00Z",
  "comment": "",
  "settings": {
    "frozenRows": 1,
    "defaultColumnWidth": 120
  }
}
```

```json
{
  "_key": "row_budget_2024_2",
  "spreadsheetId": "tbl_budget_2024",
  "rowIndex": 2,
  "values": {
    "A": "Маркетинг",
    "B": "100",
    "C": "95",
    "D": "-5"
  },
  "createdAt": "2024-01-15T10:01:00Z",
  "updatedAt": "2024-03-01T11:30:00Z"
}
```

#### Форма и ответ

```json
{
  "_key": "form_feedback",
  "name": "Обратная связь по проекту",
  "description": "Оценка проекта после демонстрации",
  "ownerId": "u_sidorov",
  "status": "published",
  "createdAt": "2024-02-15T09:00:00Z",
  "updatedAt": "2024-03-08T14:20:00Z",
  "comment": "Используется в ретро",
  "fields": [
    { "id": "project", "type": "text", "label": "Проект", "required": true },
    { "id": "score", "type": "scale", "label": "Оценка 1-10", "required": true, "min": 1, "max": 10 },
    { "id": "comment", "type": "textarea", "label": "Комментарий", "required": false }
  ]
}
```

```json
{
  "_key": "resp_001",
  "formId": "form_feedback",
  "submittedBy": "u_ivanov",
  "submittedAt": "2024-03-10T12:00:00Z",
  "answers": {
    "project": "Сервис таблиц",
    "score": 9,
    "comment": "Удобно строить статистику"
  },
  "targetRowId": "row_feedback_001"
}
```

### Примеры запросов

Ниже приведены AQL-запросы, которые реализуют основные сценарии использования. Под `n` понимается число документов в основной коллекции сценария, под `r` - число строк выбранной таблицы, под `a` - число ответов формы.

#### Авторизация

```aql
FOR u IN users
  FILTER LOWER(u.login) == LOWER(@login)
  LIMIT 1
  RETURN {
    _key: u._key,
    login: u.login,
    passwordHash: u.passwordHash,
    role: u.role
  }
```

Количество запросов: 1. Коллекции: `users`. Сложность при индексе по `login` - `O(log n)`, без индекса - `O(n)`.

#### Просмотр списка таблиц с многокритериальной фильтрацией

```aql
FOR t IN spreadsheets
  FILTER @name == null OR CONTAINS(LOWER(t.name), LOWER(@name))
  FILTER @ownerId == null OR t.ownerId == @ownerId
  FILTER @createdFrom == null OR t.createdAt >= @createdFrom
  FILTER @createdTo == null OR t.createdAt <= @createdTo
  FILTER @updatedFrom == null OR t.updatedAt >= @updatedFrom
  FILTER @updatedTo == null OR t.updatedAt <= @updatedTo
  SORT t.updatedAt DESC
  LIMIT @offset, @limit
  RETURN t
```

Количество запросов: 1 для списка, дополнительно 1 при необходимости отдельного подсчета общего количества. Коллекции: `spreadsheets`. Сложность - `O(log n + k)` при индексах по датам и владельцу, где `k` - число найденных объектов; подстрочный поиск по названию без ArangoSearch - `O(n)`.

#### Открытие таблицы

```aql
LET table = DOCUMENT(spreadsheets, @tableKey)
LET rows = (
  FOR r IN table_rows
    FILTER r.spreadsheetId == @tableKey
    SORT r.rowIndex ASC
    LIMIT @offset, @limit
    RETURN r
)
RETURN { table, rows }
```

Количество запросов: 1. Коллекции: `spreadsheets`, `table_rows`. Сложность - `O(log r + pageSize)` при индексе `table_rows.spreadsheetId`.

#### Изменение строки таблицы и запись истории

```aql
LET oldRow = FIRST(
  FOR r IN table_rows
    FILTER r.spreadsheetId == @tableKey AND r.rowIndex == @rowIndex
    LIMIT 1
    RETURN r
)
LET savedRow = UPSERT { spreadsheetId: @tableKey, rowIndex: @rowIndex }
  INSERT {
    spreadsheetId: @tableKey,
    rowIndex: @rowIndex,
    values: @values,
    createdAt: DATE_ISO8601(DATE_NOW()),
    updatedAt: DATE_ISO8601(DATE_NOW())
  }
  UPDATE {
    values: MERGE(oldRow.values, @values),
    updatedAt: DATE_ISO8601(DATE_NOW())
  }
  IN table_rows
  RETURN NEW
INSERT {
  entityType: "spreadsheet",
  entityId: @tableKey,
  action: "row_updated",
  userId: @userKey,
  createdAt: DATE_ISO8601(DATE_NOW()),
  diff: { rowIndex: @rowIndex, values: @values }
} INTO activity_log
RETURN savedRow[0]
```

Количество запросов: 1 транзакционный AQL-запрос. Коллекции: `table_rows`, `activity_log`. Сложность - `O(log r)` при уникальном индексе `(spreadsheetId, rowIndex)`.

#### Создание формы

```aql
LET form = (
  INSERT {
    name: @name,
    description: @description,
    ownerId: @userKey,
    status: "draft",
    fields: @fields,
    createdAt: DATE_ISO8601(DATE_NOW()),
    updatedAt: DATE_ISO8601(DATE_NOW()),
    comment: @comment
  } INTO forms
  RETURN NEW
)
INSERT {
  _from: CONCAT("users/", @userKey),
  _to: form[0]._id,
  role: "owner"
} INTO user_assets
RETURN form[0]
```

Количество запросов: 1. Коллекции: `forms`, `user_assets`. Сложность - `O(1 + q)`, где `q` - число полей формы.

#### Отправка ответа формы и автоматическая запись в таблицу

```aql
LET response = (
  INSERT {
    formId: @formKey,
    submittedBy: @userKey,
    submittedAt: DATE_ISO8601(DATE_NOW()),
    answers: @answers
  } INTO form_responses
  RETURN NEW
)
LET target = FIRST(
  FOR e IN form_targets
    FILTER e._from == CONCAT("forms/", @formKey)
    LIMIT 1
    RETURN PARSE_IDENTIFIER(e._to).key
)
LET nextIndex = target == null ? null : LENGTH(
  FOR r IN table_rows
    FILTER r.spreadsheetId == target
    RETURN 1
)
LET targetRow = target == null ? null : FIRST(
  INSERT {
    spreadsheetId: target,
    rowIndex: nextIndex + 1,
    values: @answers,
    sourceResponseId: response[0]._key,
    createdAt: DATE_ISO8601(DATE_NOW()),
    updatedAt: DATE_ISO8601(DATE_NOW())
  } INTO table_rows
  RETURN NEW
)
UPDATE response[0] WITH { targetRowId: targetRow._key } IN form_responses
RETURN { response: NEW, row: targetRow }
```

Количество запросов: 1. Коллекции: `form_responses`, `form_targets`, `table_rows`. Сложность - `O(log a + log r)` при индексе по `formId` и `spreadsheetId`; вычисление следующего номера строки лучше заменить счетчиком в `spreadsheets`, тогда операция будет `O(1)`.

#### Просмотр ответов формы

```aql
FOR r IN form_responses
  FILTER r.formId == @formKey
  SORT r.submittedAt DESC
  LIMIT @offset, @limit
  RETURN r
```

Количество запросов: 1. Коллекции: `form_responses`. Сложность - `O(log a + pageSize)` при индексе `formId, submittedAt`.

#### Настраиваемая статистика по таблице

```aql
FOR r IN table_rows
  FILTER r.spreadsheetId == @tableKey
  FILTER @filterCol == null OR CONTAINS(LOWER(TO_STRING(r.values[@filterCol])), LOWER(@filterValue))
  COLLECT category = r.values[@xCol] WITH COUNT INTO count
  SORT count DESC
  RETURN { category, count }
```

Количество запросов: 1. Коллекции: `table_rows`. Сложность - `O(r)` для выбранной таблицы, потому что агрегация должна просмотреть строки, прошедшие фильтры.

#### Поиск по истории действий

```aql
FOR h IN activity_log
  FILTER @entityType == null OR h.entityType == @entityType
  FILTER @entityId == null OR h.entityId == @entityId
  FILTER @userId == null OR h.userId == @userId
  FILTER @action == null OR CONTAINS(LOWER(h.action), LOWER(@action))
  FILTER @from == null OR h.createdAt >= @from
  FILTER @to == null OR h.createdAt <= @to
  SORT h.createdAt DESC
  LIMIT @offset, @limit
  RETURN h
```

Количество запросов: 1. Коллекции: `activity_log`. Сложность - `O(log l + k)` по индексам даты, типа сущности и пользователя; подстрочный поиск по `action` - `O(l)` без текстового индекса.

#### Импорт и экспорт всех данных

Экспорт можно выполнить одним AQL-запросом:

```aql
RETURN {
  users: (FOR u IN users RETURN u),
  spreadsheets: (FOR t IN spreadsheets RETURN t),
  tableRows: (FOR r IN table_rows RETURN r),
  forms: (FOR f IN forms RETURN f),
  responses: (FOR a IN form_responses RETURN a),
  activity: (FOR h IN activity_log RETURN h),
  userAssets: (FOR e IN user_assets RETURN e),
  formTargets: (FOR e IN form_targets RETURN e)
}
```

Количество запросов: 1. Коллекции: все 8 коллекций. Сложность - `O(U + T + R + F + A + L + E)`.

Импорт выполняется пакетными вставками по коллекциям в транзакции. Количество логических операций - по одной пакетной вставке на коллекцию, то есть до 8 операций; число вставляемых документов линейно зависит от размера импортируемого файла.

## Реляционная модель

SQL-аналог нормализует вложенные структуры в отдельные таблицы. Это уменьшает неоднозначность схемы, но увеличивает число таблиц, внешних ключей и соединений при чтении формы, ответов и строк электронных таблиц.

![Реляционная модель SQL](https://github.com/user-attachments/assets/73f8854f-92f0-4c77-afc5-795a32a0898b)


### Таблицы и назначение

| Таблица | Назначение |
|---|---|
| `users` | Пользователи и роли. |
| `spreadsheets` | Метаданные электронных таблиц. |
| `table_columns` | Описание колонок таблицы. |
| `table_rows` | Строки таблицы без значений ячеек. |
| `table_cells` | Значения отдельных ячеек. |
| `forms` | Метаданные форм. |
| `form_fields` | Поля формы. |
| `form_options` | Варианты ответов для `select`, `radio`, `checkbox`. |
| `form_responses` | Факт отправки формы. |
| `response_answers` | Ответы на отдельные поля формы. |
| `activity_log` | История действий. |
| `user_asset_roles` | Права пользователя на таблицы и формы. |
| `form_targets` | Таблица, в которую сохраняются ответы формы. |

### Поля и оценка размера

| Объект SQL | Основные поля | Чистый объем данных | Фактический объем строки |
|---|---|---:|---:|
| `users` | `id`, `login`, `password_hash`, `role`, даты, `comment` | 276 Б | 470 Б |
| `spreadsheets` | `id`, `owner_id`, `name`, даты, `comment`, размеры | 424 Б | 430 Б |
| `table_columns` | `id`, `spreadsheet_id`, `col_index`, `title`, `type` | 70 Б | 180 Б |
| `table_rows` | `id`, `spreadsheet_id`, `row_index`, даты | 44 Б | 160 Б |
| `table_cells` | `id`, `row_id`, `column_id`, значение, дата | 64 Б | 190 Б |
| `forms` | `id`, `owner_id`, `name`, `description`, `status`, даты, `comment` | 682 Б | 650 Б |
| `form_fields` | `id`, `form_id`, `field_index`, `type`, `label`, `required`, ограничения | 107 Б | 260 Б |
| `form_options` | `id`, `field_id`, `option_index`, `value` | 60 Б | 180 Б |
| `form_responses` | `id`, `form_id`, `submitted_by`, дата, `target_row_id` | 72 Б | 220 Б |
| `response_answers` | `id`, `response_id`, `field_id`, значение | 56 Б | 210 Б |
| `activity_log` | `id`, тип сущности, id сущности, действие, пользователь, дата | 122 Б | 220 Б |
| `user_asset_roles` | `user_id`, `asset_type`, `asset_id`, `role` | 46 Б | 170 Б |
| `form_targets` | `form_id`, `spreadsheet_id`, режим добавления | 36 Б | 160 Б |

В SQL часть строк может иметь меньший физический размер, чем JSON-документы, но для таблиц и ответов появляется много отдельных строк: каждая ячейка и каждый ответ на поле становятся отдельной записью.

### Оценка объема информации

Используем тот же демонстрационный профиль и ту же переменную `N`:

- 1 таблица и 1 форма на единицу `N`;
- 20 строк, 10 колонок и 200 непустых ячеек на таблицу;
- 5 полей формы, 10 вариантов ответов суммарно;
- 50 отправок формы и 250 отдельных ответов на поля;
- 10 записей истории;
- 0.2 пользователя, 2 записи прав и 1 связь формы с таблицей на единицу `N`.

Чистый объем SQL-модели:

```text
V_clean_SQL(N) =
0.2N * 276
+ N * 424
+ 10N * 70
+ 20N * 44
+ 200N * 64
+ N * 682
+ 5N * 107
+ 10N * 60
+ 50N * 72
+ 250N * 56
+ 10N * 122
+ 2N * 46
+ N * 36
= 35624.2N байт
```

Фактический объем SQL-модели:

```text
V_fact_SQL(N) =
0.2N * 470
+ N * 430
+ 10N * 180
+ 20N * 160
+ 200N * 190
+ N * 650
+ 5N * 260
+ 10N * 180
+ 50N * 220
+ 250N * 210
+ 10N * 220
+ 2N * 170
+ N * 160
= 113474N байт
```

С учетом системных страниц, индексов и служебных структур:

```text
V_SQL(N) = 113474N + 2048 байт
```

Например, для `N = 10`:

```text
V_SQL(10) = 1136788 байт ≈ 1.08 МиБ
```

### Избыточность данных

```text
R_SQL(N) = (113474N + 2048) / (35624.2N)
```

При `N = 10`:

```text
R_SQL(10) = 1136788 / 356242 ≈ 3.19
```

Избыточность выше из-за большого количества внешних ключей, индексов и строк для ячеек/ответов. При этом SQL-модель лучше контролирует типы и целостность данных.

### Направление роста модели

| Что увеличивается | Как растет объем |
|---|---|
| Пользователи | `O(U)` плюс записи в `user_asset_roles`. |
| Таблицы | `O(T)` по метаданным, `O(T * C)` по колонкам. |
| Ячейки | `O(T * R * C)` и это главный источник роста. |
| Формы | `O(F * Q + F * O)`, где `Q` - поля, `O` - варианты ответа. |
| Ответы | `O(A * Q)`, потому что каждый ответ на поле хранится отдельной строкой. |
| История | `O(L)`. |

### Примеры данных
#### Таблица
```sql
INSERT INTO spreadsheets (id, owner_id, name, row_count, col_count, created_at, updated_at, comment)
VALUES ('tbl_budget_2024', 'u_ivanov', 'Бюджет 2024', 40, 40,
        '2024-01-15T10:00:00Z', '2024-03-01T11:30:00Z', '');

INSERT INTO table_columns (id, spreadsheet_id, col_index, title, type)
VALUES
  ('col_budget_a', 'tbl_budget_2024', 1, 'Проект', 'text'),
  ('col_budget_b', 'tbl_budget_2024', 2, 'План', 'number'),
  ('col_budget_c', 'tbl_budget_2024', 3, 'Факт', 'number');

INSERT INTO table_rows (id, spreadsheet_id, row_index, created_at)
VALUES ('row_budget_2', 'tbl_budget_2024', 2, '2024-01-15T10:01:00Z');

INSERT INTO table_cells (row_id, column_id, value_text, value_number, updated_at)
VALUES
  ('row_budget_2', 'col_budget_a', 'Маркетинг', NULL, '2024-03-01T11:30:00Z'),
  ('row_budget_2', 'col_budget_b', NULL, 100, '2024-03-01T11:30:00Z'),
  ('row_budget_2', 'col_budget_c', NULL, 95, '2024-03-01T11:30:00Z');
```

#### Форма и ответ
```sql
INSERT INTO forms (id, owner_id, name, description, status, created_at, updated_at, comment)
VALUES ('form_feedback', 'u_sidorov', 'Обратная связь по проекту',
        'Оценка проекта после демонстрации', 'published',
        '2024-02-15T09:00:00Z', '2024-03-08T14:20:00Z', 'Используется в ретро');

INSERT INTO form_fields (id, form_id, field_index, type, label, required, min_value, max_value)
VALUES
  ('field_project', 'form_feedback', 1, 'text', 'Проект', TRUE, NULL, NULL),
  ('field_score', 'form_feedback', 2, 'scale', 'Оценка 1-10', TRUE, 1, 10),
  ('field_comment', 'form_feedback', 3, 'textarea', 'Комментарий', FALSE, NULL, NULL);

INSERT INTO form_responses (id, form_id, submitted_by, submitted_at, target_row_id)
VALUES ('resp_001', 'form_feedback', 'u_ivanov', '2024-03-10T12:00:00Z', 'row_feedback_001');

INSERT INTO response_answers (response_id, field_id, value_text, value_number)
VALUES
  ('resp_001', 'field_project', 'Сервис таблиц', NULL),
  ('resp_001', 'field_score', NULL, 9),
  ('resp_001', 'field_comment', 'Удобно строить статистику', NULL);
```

### Примеры запросов

#### Авторизация

```sql
SELECT id, login, password_hash, role
FROM users
WHERE LOWER(login) = LOWER(:login)
LIMIT 1;
```

Количество запросов: 1. Таблицы: `users`. Сложность - `O(log n)` при индексе по `login`.

#### Просмотр списка таблиц с фильтрами

```sql
SELECT s.*
FROM spreadsheets s
WHERE (:name IS NULL OR LOWER(s.name) LIKE '%' || LOWER(:name) || '%')
  AND (:owner_id IS NULL OR s.owner_id = :owner_id)
  AND (:created_from IS NULL OR s.created_at >= :created_from)
  AND (:created_to IS NULL OR s.created_at <= :created_to)
  AND (:updated_from IS NULL OR s.updated_at >= :updated_from)
  AND (:updated_to IS NULL OR s.updated_at <= :updated_to)
ORDER BY s.updated_at DESC
LIMIT :limit OFFSET :offset;
```

Количество запросов: 1, плюс 1 для `COUNT(*)` при отдельной пагинации. Таблицы: `spreadsheets`. Подстрочный поиск `LIKE '%text%'` без полнотекстового индекса - `O(n)`.

#### Открытие таблицы

```sql
SELECT *
FROM spreadsheets
WHERE id = :table_id;

SELECT r.row_index, c.col_index, c.title, cell.value_text, cell.value_number
FROM table_rows r
JOIN table_cells cell ON cell.row_id = r.id
JOIN table_columns c ON c.id = cell.column_id
WHERE r.spreadsheet_id = :table_id
ORDER BY r.row_index, c.col_index
LIMIT :limit OFFSET :offset;
```

Количество запросов: 2. Таблицы: `spreadsheets`, `table_rows`, `table_cells`, `table_columns`. Сложность - `O(log r + pageSize * C)` при индексах по внешним ключам.

#### Изменение ячейки и запись истории

```sql
INSERT INTO table_cells (row_id, column_id, value_text, value_number, updated_at)
VALUES (:row_id, :column_id, :value_text, :value_number, CURRENT_TIMESTAMP)
ON CONFLICT (row_id, column_id)
DO UPDATE SET
  value_text = EXCLUDED.value_text,
  value_number = EXCLUDED.value_number,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO activity_log (entity_type, entity_id, action, user_id, created_at)
VALUES ('spreadsheet', :table_id, 'cell_updated', :user_id, CURRENT_TIMESTAMP);
```

Количество запросов: 2 внутри транзакции. Таблицы: `table_cells`, `activity_log`. Сложность - `O(log cells)`.

#### Создание формы

```sql
INSERT INTO forms (id, owner_id, name, description, status, created_at, updated_at, comment)
VALUES (:id, :owner_id, :name, :description, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :comment);

INSERT INTO form_fields (id, form_id, field_index, type, label, required, min_value, max_value)
VALUES (:field_id, :form_id, :field_index, :type, :label, :required, :min_value, :max_value);
```

Количество запросов: `1 + q + o`, где `q` - число полей, `o` - число вариантов ответа, если вставлять построчно. При batch insert - 3 логические операции: форма, поля, варианты. Таблицы: `forms`, `form_fields`, `form_options`.

#### Отправка ответа формы

```sql
INSERT INTO form_responses (id, form_id, submitted_by, submitted_at, target_row_id)
VALUES (:response_id, :form_id, :user_id, CURRENT_TIMESTAMP, :target_row_id);

INSERT INTO response_answers (response_id, field_id, value_text, value_number, value_date)
VALUES (:response_id, :field_id, :value_text, :value_number, :value_date);

INSERT INTO table_rows (id, spreadsheet_id, row_index, created_at)
VALUES (:target_row_id, :spreadsheet_id, :row_index, CURRENT_TIMESTAMP);

INSERT INTO table_cells (row_id, column_id, value_text, value_number, updated_at)
VALUES (:target_row_id, :column_id, :value_text, :value_number, CURRENT_TIMESTAMP);
```

Количество запросов: `2 + q + q_table` внутри транзакции, где `q` - количество полей формы, `q_table` - количество значений, добавляемых в таблицу. При пакетной вставке - 4 логические операции. Таблицы: `form_responses`, `response_answers`, `table_rows`, `table_cells`.

#### Просмотр ответов формы

```sql
SELECT fr.id, fr.submitted_at, ff.label, ra.value_text, ra.value_number, ra.value_date
FROM form_responses fr
JOIN response_answers ra ON ra.response_id = fr.id
JOIN form_fields ff ON ff.id = ra.field_id
WHERE fr.form_id = :form_id
ORDER BY fr.submitted_at DESC, ff.field_index ASC
LIMIT :limit OFFSET :offset;
```

Количество запросов: 1. Таблицы: `form_responses`, `response_answers`, `form_fields`. Сложность - `O(log a + pageSize * q)`.

#### Настраиваемая статистика

```sql
SELECT COALESCE(c.value_text, CAST(c.value_number AS TEXT), 'пусто') AS category,
       COUNT(*) AS count
FROM table_rows r
JOIN table_cells c ON c.row_id = r.id
JOIN table_columns col ON col.id = c.column_id
WHERE r.spreadsheet_id = :table_id
  AND col.col_index = :x_col
GROUP BY category
ORDER BY count DESC;
```

Количество запросов: 1. Таблицы: `table_rows`, `table_cells`, `table_columns`. Сложность - `O(r * C)` для выбранной таблицы, так как нужны соединения по ячейкам.

#### История действий

```sql
SELECT *
FROM activity_log
WHERE (:entity_type IS NULL OR entity_type = :entity_type)
  AND (:entity_id IS NULL OR entity_id = :entity_id)
  AND (:user_id IS NULL OR user_id = :user_id)
  AND (:action IS NULL OR LOWER(action) LIKE '%' || LOWER(:action) || '%')
  AND (:from_date IS NULL OR created_at >= :from_date)
  AND (:to_date IS NULL OR created_at <= :to_date)
ORDER BY created_at DESC
LIMIT :limit OFFSET :offset;
```

Количество запросов: 1. Таблицы: `activity_log`. Сложность - `O(log l + k)` по индексам, подстрочный поиск без полнотекстового индекса - `O(l)`.


## Сравнение моделей

### Удельный объем информации

Для одинакового демонстрационного профиля:

```text
V_noSQL(N) = 45004N + 1024 байт
V_SQL(N)   = 113474N + 2048 байт
```

При `N = 10`:

```text
NoSQL: 451064 байт ≈ 441 КиБ
SQL:   1136788 байт ≈ 1.08 МиБ
```

В выбранной предметной области SQL-модель занимает больше места, потому что электронные таблицы и ответы форм распадаются на большое число строк `table_cells` и `response_answers`. В ArangoDB строка таблицы и ответ формы хранятся компактнее как JSON-документы с вложенным объектом значений.

Если таблицы станут очень широкими и большинство ячеек будет пустым, преимущество ArangoDB сохранится при хранении только непустых ключей в `values`. Если потребуется строгая типизация каждой колонки и сложные транзакционные ограничения, SQL-модель может стать удобнее, но объем и число соединений останутся выше.

### Запросы по отдельным сценариям

| Сценарий | ArangoDB: запросы и коллекции | SQL: запросы и таблицы |
|---|---|---|
| Авторизация | 1 запрос, `users` | 1 запрос, `users` |
| Список таблиц с фильтрами | 1 запрос, `spreadsheets`; 2 запроса с отдельным `COUNT` | 1 запрос, `spreadsheets`; 2 запроса с отдельным `COUNT` |
| Открытие таблицы | 1 запрос, `spreadsheets` + `table_rows` | 2 запроса, 4 таблицы: `spreadsheets`, `table_rows`, `table_cells`, `table_columns` |
| Изменение строки/ячейки | 1 AQL-запрос с `UPSERT` и логом, 2 коллекции | 2 SQL-запроса в транзакции, 2 таблицы |
| Создание формы | 1 AQL-запрос, `forms` + `user_assets` | `1 + q + o` запросов или 3 batch-операции |
| Отправка формы | 1 AQL-запрос, 3 коллекции | `2 + q + q_table` запросов или 4 batch-операции |
| Просмотр ответов | 1 запрос, `form_responses` | 1 запрос с JOIN по 3 таблицам |
| Статистика по таблице | 1 запрос, `table_rows`, сложность `O(r)` | 1 запрос с JOIN, сложность `O(r * C)` |
| История действий | 1 запрос, `activity_log` | 1 запрос, `activity_log` |
| Экспорт всех данных | 1 AQL-запрос с вложенными подзапросами, 8 коллекций | 13 `SELECT` или серверный дамп, 13 таблиц |
| Импорт всех данных | До 8 пакетных вставок | До 13 пакетных вставок с учетом порядка внешних ключей |

### Количество задействованных коллекций

В ArangoDB основные пользовательские сценарии обычно используют 1-3 коллекции. Исключение - полный экспорт, который читает все 8 коллекций. В SQL основные сценарии чаще требуют 3-4 таблицы из-за нормализации ячеек, полей формы и ответов.

### Качество модели для сценариев приложения

ArangoDB лучше соответствует сценариям "форма с произвольным набором полей", "таблица с меняющимися колонками", "ответ формы автоматически становится строкой таблицы". Эти данные естественно выглядят как документы. Графовые ребра добавляют удобное представление прав и связей между формами и таблицами.

SQL лучше подходит для случаев, когда заранее известна стабильная схема таблиц, нужна строгая типизация каждого поля и сложные ограничения целостности. Для аналога Google Таблиц и Google Форм схема как раз гибкая, поэтому нормализация приводит к большому числу технических таблиц и JOIN-запросов.

## Вывод

Для данного проекта лучше подходит NoSQL-модель в ArangoDB. Она компактнее для выбранного профиля данных, проще хранит гибкие структуры форм и таблиц, позволяет одним AQL-запросом получать документ вместе со связанными строками или ответами, а графовые коллекции естественно описывают права пользователей и привязку формы к таблице.

SQL-модель остается полезной как контрольная альтернатива: она строже по типам и внешним ключам, но в нашем приложении дает больший объем хранения и больше соединений для типовых сценариев.
