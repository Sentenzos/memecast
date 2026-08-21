# MemeCast

Бесплатные мем-алерты для OBS: публичная страница зрителей, очередь алертов, озвучка текста, административная медиатека и IP-модерация.

## Локальный запуск

Требуется Node.js `>=22.13.0`.

```bash
npm install
copy .env.example .env
npm run dev
```

В `.env` задаются данные администратора:

```dotenv
ADMIN_LOGIN=admin
ADMIN_PASSWORD=change-this-password
```

Если переменные не заданы при локальной разработке, используются `admin` / `admin`. В production запасные данные отключены.

После запуска:

- `http://127.0.0.1:3000/` — публичная страница;
- `http://127.0.0.1:3000/login` — вход администратора;
- `http://127.0.0.1:3000/dashboard/demo` — локальный демо-кабинет.

База SQLite хранится в `data/memecast.sqlite`, загруженные файлы — в `data/media`. Ключ `GIPHY_API_KEY` необязателен.

## VPS

Для production предусмотрены Docker Compose, постоянный том и HTTP-прокси Caddy. Приложение доступно непосредственно по публичному IP сервера. Полная инструкция находится в `VPS_DEPLOY.md`.

```bash
docker compose --env-file .env.production up -d --build
```

## Проверка

```bash
npm run build
npm test
npm run lint
```
