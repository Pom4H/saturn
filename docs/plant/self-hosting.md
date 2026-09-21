# Свой сервер Saturn

Сначала запустите установку на своём компьютере. Для доступа команды используйте отдельный сервер с HTTPS и постоянным процессом Saturn.

## 1. Локальный запуск

Установите Git и [Node.js 24 LTS](https://nodejs.org/en/download): версия от 24.20.0, ниже 25. Точная версия проекта указана в `.nvmrc`. npm входит в Node.js; отдельный сервер базы данных не нужен — используется встроенный SQLite.

Проверьте в терминале или PowerShell:

```sh
node --version
npm --version
git --version
```

Выполните в папке, где хотите разместить Saturn:

```sh
git clone https://github.com/Pom4H/saturn.git
cd saturn
npm ci
git init --bare data-plant/project.git
npm run plant
```

`git init --bare` создаёт отдельное хранилище проекта установки внутри `data-plant/`; оно не смешивается с исходниками Saturn. Этот шаг нужен для совместимости с опубликованными версиями, которые ищут Git-репозиторий в родительских папках.

`npm run plant` собирает приложение и запускает сервер. Оставьте терминал открытым. Остановка — Ctrl+C, повторный запуск из той же папки — `npm run plant`.

Откройте **http://127.0.0.1:4176/plant/login**. Логин — **engineer**. После входа Saturn откроет единую рабочую среду на корневом адресе сервера: инженер увидит исходники и публикацию, оператор — HMI и управление, viewer — режим наблюдения. При первом запуске с новой базой случайный пароль выводится в терминал один раз, в строке `Initial engineer password`. Сохраните его. Повторный запуск использует прежнюю учётную запись.

По умолчанию состояние хранится в `data-plant/plant.sqlite3`, а ревизии проекта — в `data-plant/project.git`. Папка создаётся автоматически и сохраняется после перезапуска. Начальная установка содержит демонстрационный проект; замените его своим через редактор.

Если порт 4176 занят, используйте, например, 4180:

```sh
# macOS / Linux
PORT=4180 npm run plant
```

```powershell
# Windows PowerShell
$env:PORT = '4180'
npm run plant
```

Тогда адрес входа — `http://127.0.0.1:4180/plant/login`, а рабочая среда после входа откроется на `http://127.0.0.1:4180/`.

## 2. Постоянный сервер для команды

Пример ниже рассчитан на Linux с systemd. Нужны Node.js 24.20.0 или новее в ветке 24, npm, права sudo и домен. Здесь `saturn.example.com` — пример: замените его своим доменом во всех файлах.

Установите Node.js, npm и Git так, чтобы они были доступны системному пользователю, а не только из личного профиля nvm. Для HTTPS установите [Caddy официальным способом](https://caddyserver.com/docs/install), который добавляет службу `caddy`.

### Приложение и данные

Создайте отдельного пользователя и загрузите исходники:

```sh
sudo useradd --system --user-group --create-home --home-dir /var/lib/saturn --shell /usr/sbin/nologin saturn
sudo git clone https://github.com/Pom4H/saturn.git /opt/saturn
sudo chown -R saturn:saturn /opt/saturn
sudo -u saturn sh -c 'cd /opt/saturn && npm ci && npm run plant:build'
```

Создайте `/etc/saturn.env`:

```ini
HOST=127.0.0.1
PORT=4176
SCADA_PUBLIC_URL=https://saturn.example.com
SCADA_DATABASE=/var/lib/saturn/plant.sqlite3
```

Это переменные окружения для службы. Сам Saturn не загружает `.env` автоматически. `SCADA_PUBLIC_URL` должен совпадать с HTTPS-адресом в браузере, без пути `/plant/`. Внешние подключения проходят через HTTPS-прокси, а процесс Saturn слушает loopback.

### Автозапуск

Создайте `/etc/systemd/system/saturn.service`:

```ini
[Unit]
Description=Saturn installation server
After=network.target

[Service]
Type=simple
User=saturn
Group=saturn
WorkingDirectory=/opt/saturn
EnvironmentFile=/etc/saturn.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env node --experimental-sqlite /opt/saturn/.plant/server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Если Node установлен вне указанного PATH, укажите абсолютный путь к Node в `ExecStart`. Запустите службу и проверьте её состояние:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now saturn
sudo systemctl status saturn --no-pager
sudo journalctl -u saturn -n 50 --no-pager
curl --fail http://127.0.0.1:4176/plant/api/health
```

В журнале первого запуска найдите пароль `engineer` и сохраните его. Не публикуйте этот журнал. Проверка `/plant/api/health` должна вернуть JSON со `status: "ok"`. После этого Saturn работает независимо от открытого терминала и запускается при перезагрузке.

### HTTPS и домен

Направьте DNS домена на сервер. Для публичного сертификата Caddy нужны доступные ему порты 80 и 443. Добавьте блок в `/etc/caddy/Caddyfile`:

```caddyfile
saturn.example.com {
    reverse_proxy 127.0.0.1:4176
}
```

Проверьте конфигурацию и примените её:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Этот пример предполагает уже запущенную службу Caddy. Она получает и обновляет сертификат для настроенного публичного домена. Для закрытой сети используйте HTTPS-прокси с сертификатом, которому доверяют устройства команды. Подробнее: [reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy) и [служба Caddy](https://caddyserver.com/docs/running#using-the-service).

## 3. Подключение и PWA

Откройте `https://saturn.example.com/plant/login` и войдите с учётной записью сервера. После входа браузер перейдёт на `https://saturn.example.com/` — это основная PWA Saturn для всех ролей. Engineer получает IDE, Git-ревизии и публикацию; operator — схему, алармы и разрешённые команды; viewer — read-only мониторинг. Первоначальная учётная запись имеет роль инженера; интерфейс управления пользователями пока не реализован.

Устанавливайте PWA именно с корневой рабочей среды `https://saturn.example.com/`. На iPhone используйте Safari → «Поделиться» → «На экран Домой». Приложение при запуске определяет текущую роль и подключает ту же установку; для живых данных нужна сеть.

`127.0.0.1` и `localhost` обозначают устройство, на котором открыт браузер. На телефоне указывайте HTTPS-домен сервера, а не адрес локального запуска на компьютере.

## 4. Обновление и сохранность проекта

Перед обновлением остановите Saturn и сохраните **всю** папку данных: `/var/lib/saturn` для службы из примера или `data-plant/` для локального запуска. Нужны runtime SQLite и сохранённые build artifacts; source Git хранится отдельно в engineering workspace. Копирование после остановки исключает неполный снимок работающей SQLite-базы.

Затем обновите исходники до выбранного релиза, выполните `npm ci` и `npm run plant:build` от пользователя `saturn`, запустите службу и снова проверьте `/plant/api/health`. Учитывайте совместимость версии модели с сохранённым состоянием. Исходники резервируются как обычная папка/Git repository; они не заменяют резервную копию runtime database.

## Если не запускается

- **Не найдены `node`, `npm` или `git`:** установите зависимости и откройте новый терминал. Для службы проверьте её PATH.
- **Нет `node:sqlite` или несовместимый Node:** используйте версию из `.nvmrc` и заново выполните `npm ci`.
- **`EADDRINUSE`:** порт занят; остановите свой предыдущий экземпляр либо задайте другой `PORT` и измените порт в прокси.
- **`Cross-origin write blocked`:** сравните адрес браузера с `SCADA_PUBLIC_URL`, затем перезапустите службу после исправления окружения.
- **Не открывается с телефона:** проверьте HTTPS-домен и доступность прокси; loopback-адрес работает только на самом сервере.
- **Нет кнопки установки PWA:** проверьте HTTPS, поддержку установки браузером и то, что приложение ещё не установлено.

Локальный сценарий проверяется запуском сервера и первым входом. Linux/systemd/Caddy — инструкция для отдельного хоста; её применение зависит от DNS, сети и установленного ПО этого хоста.
