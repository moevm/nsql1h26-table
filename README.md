# nosql_template


## Предварительная проверка заданий

<a href=" ./../../../actions/workflows/1_helloworld.yml" >![1. Согласована и сформулирована тема курсовой]( ./../../actions/workflows/1_helloworld.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/2_usecase.yml" >![2. Usecase]( ./../../actions/workflows/2_usecase.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/3_data_model.yml" >![3. Модель данных]( ./../../actions/workflows/3_data_model.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/4_prototype_store_and_view.yml" >![4. Прототип хранение и представление]( ./../../actions/workflows/4_prototype_store_and_view.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/5_prototype_analysis.yml" >![5. Прототип анализ]( ./../../actions/workflows/5_prototype_analysis.yml/badge.svg)</a> 

<a href=" ./../../../actions/workflows/6_report.yml" >![6. Пояснительная записка]( ./../../actions/workflows/6_report.yml/badge.svg)</a>

<a href=" ./../../../actions/workflows/7_app_is_ready.yml" >![7. App is ready]( ./../../actions/workflows/7_app_is_ready.yml/badge.svg)</a>

# Запуск и авторизация

## Запуск через Docker Compose

```bash
docker compose up -d --build
```

Приложение будет доступно по адресу:

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

Если после изменений в JS/CSS/HTML приложение не обновилось, нужно пересобрать контейнер приложения:

```bash
docker compose up -d --build app
```

## Проверки

Проверить синтаксис основных JS-файлов и отсутствие whitespace-ошибок в diff:

```bash
npm run check
```

Запустить security smoke checks:

```bash
npm test
```

`npm test` ожидает, что приложение уже запущено и доступно по `http://127.0.0.1:8081`.

Если приложение запущено на другом адресе:

```bash
SECURITY_CHECK_BASE_URL=http://127.0.0.1:8081 npm test
```

## Служебные API

Проверка доступности приложения и базы данных:

```text
GET /api/health
```

Пример ответа:

```json
{"ok":true,"db":"tables_forms_app","version":"1.0"}
```

Текущая версия приложения:

```text
GET /api/version
```

Пример ответа:

```json
{"version":"1.0"}
```
