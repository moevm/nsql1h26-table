# Запуск проекта

## Требования

- Docker и Docker Compose
- Node.js 20+ для локальных проверок JS и smoke-тестов

## Запуск через Docker Compose

```bash
docker compose up -d --build
```

После запуска приложение доступно по адресу:

```text
http://127.0.0.1:8081
```

Проверить состояние контейнеров:

```bash
docker compose ps
```

Посмотреть логи приложения:

```bash
docker compose logs app
```

Посмотреть логи базы данных:

```bash
docker compose logs db
```

## Тестовые пользователи

| Роль | Логин | Пароль |
|------|-------|--------|
| Администратор | `admin` | `admin` |
| Аналитик | `analyst` | `analyst` |
| Редактор | `editor` | `editor` |

## Пересборка после изменений

Статические файлы приложения копируются в Docker-образ на этапе сборки. После изменений в `public/`, `src/` или `data/` нужно пересобрать контейнер приложения:

```bash
docker compose up -d --build app
```

## Проверки

Проверить синтаксис основных JS-файлов:

```bash
node --check src/server.js
node --check public/app.js
node --check public/data.js
node --check public/spreadsheet.js
```

Запустить smoke/security checks:

```bash
npm test
```

`npm test` ожидает, что приложение уже запущено и доступно по `http://127.0.0.1:8081`.

Если приложение запущено на другом адресе:

```bash
SECURITY_CHECK_BASE_URL=http://127.0.0.1:8081 npm test
```

## Локальный запуск без Docker

Локальный запуск возможен, если ArangoDB уже доступна отдельно:

```bash
npm start
```

Основные переменные окружения:

| Переменная | Назначение | Значение по умолчанию |
|------------|------------|-----------------------|
| `APP_PORT` | порт backend | `8080` |
| `ARANGO_URL` | URL ArangoDB | `http://127.0.0.1:8529` |
| `ARANGO_DB` | имя базы данных | `tables_forms_app` |
| `ARANGO_USER` | пользователь ArangoDB | `root` |
| `ARANGO_PASSWORD` | пароль ArangoDB | `prototype-password` |
| `APP_SECURE_COOKIES` | включить Secure cookie | `0` |
| `SECURITY_CHECK_BASE_URL` | адрес приложения для тестов | `http://127.0.0.1:8081` |
| `SECURITY_CHECK_RESET_SEED` | сбрасывать seed перед тестами | `1` |
