# MemeCast Broadcaster

Локальный передатчик для Windows. Он отправляет выбранное аудиоустройство на MemeCast по зашифрованному SRT и публикует метаданные текущего трека из SMTC Bridge.

## Требования

- Node.js 22.13 или новее;
- FFmpeg в `PATH`;
- запущенный SMTC Bridge на `http://127.0.0.1:5000`;
- виртуальное аудиоустройство, например VB-CABLE, чтобы изолировать Apple Music от остальных звуков Windows.

## Маршрутизация Apple Music

1. В Windows откройте «Параметры → Система → Звук → Микшер громкости».
2. Для Apple Music выберите выход `CABLE Input`.
3. В старой панели «Звук → Запись → CABLE Output → Прослушать» включите прослушивание на свои наушники, если хотите одновременно слышать музыку локально.
4. В MemeCast Broadcaster выберите устройство `CABLE Output`.

## Запуск

Откройте `start-broadcaster.cmd`. Интерфейс появится по адресу `http://127.0.0.1:43120`.

Значения `publishUser`, `publishPassword` и `srtPassphrase` должны совпадать с `BROADCAST_*` в `.env.production` на VPS. `overlayToken` берётся из ссылки OBS в кабинете MemeCast.

Файл `config.json` создаётся рядом с приложением и содержит секреты. Он исключён из Git.
