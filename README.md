<<<<<<< HEAD
# 下载站 · Download Station

一个轻量的资源下载站：**投递资源 → 一键上线 → 点击下载并统计次数**。

内置「一键开服面板」：**一条命令启动，浏览器里点一下**，自动完成安装依赖、创建数据库、生成配置、启动服务——不需要手动编辑任何配置文件。

## ✨ 功能特性

- 📦 资源上传 / 下载，自动统计下载次数
- ✅ 管理员审核：资源审核通过后才公开展示
- 💬 评论互动（登录后可评论、删除）
- 👤 用户注册 / 登录（JWT），第一位注册用户自动成为管理员
- 🛠 用户管理：管理员可设置 / 撤销管理员
- 📊 统计看板：资源数、总下载量、待审核数
- 🚀 内置一键开服面板（**零依赖**，可在 `npm install` 之前直接运行）

## 🧰 技术栈

Node.js（ESM）+ Express + PostgreSQL（pg）+ JWT + bcrypt；前端为原生 HTML / JS，无构建步骤。

## 🚀 快速开始（Debian 12）

### 一行命令启动

```bash
sudo apt update && sudo apt install -y git nodejs npm postgresql && git clone https://github.com/zhuchuovo/download-station/edit/ && cd download-station && sudo node server/panel.js
```

看到 `开服面板已启动` 后，浏览器打开：

```
http://你的服务器IP:8080
```

点击 **🚀 一键开服**，自动完成：**安装依赖 → 创建数据库 → 生成 .env → 启动下载站**。完成后访问：

```
http://你的服务器IP:3000
```

全部搞定，无需手动编辑任何配置文件。

### 分步说明

1. **安装环境**（只需一次，Debian 12 自带 Node 18 / PostgreSQL 15，满足要求）：

   ```bash
   sudo apt update && sudo apt install -y nodejs npm postgresql
   ```

2. **一条命令启动面板**：

   ```bash
   sudo node server/panel.js
   ```

   用 `sudo` 运行可**免密码自动创建数据库**（不需要知道 postgres 密码）。

3. 浏览器打开 `http://你的服务器IP:8080`，点「🚀 一键开服」，等待完成。
4. 打开 `http://你的服务器IP:3000` 使用下载站（第一个注册的用户自动成为管理员）。

> 不想用 sudo？在面板「数据库连接配置」中填写 postgres 超级用户密码即可，其余不变。

### 面板能做什么

| 功能 | 说明 |
| --- | --- |
| 🚀 一键开服 | 自动完成：安装依赖 → 创建数据库（`download_station` / 用户 `ds_app`）→ 写入 `.env` → 启动服务 |
| 安装依赖 / 配置数据库 | 分步执行，失败时可单独重试 |
| 启动 / 停止 / 重启 | 管理下载站进程（PID 记录在 `server/app.pid`，日志在 `server/logs/app.log`） |
| 运行日志 | 网页内实时查看 |
| 数据库连接配置（高级） | 自定义 PostgreSQL 主机 / 端口 / 账号 |
| 面板密码 | 设置 `PANEL_PASSWORD` 后，进入面板需要密码 |

面板默认监听 `0.0.0.0:8080`，可自定义：

```bash
PANEL_PORT=9090 PANEL_PASSWORD=你的面板密码 sudo node server/panel.js
```

## 🛠 手动部署（不用面板时）

```bash
npm install

# 创建数据库与账号
sudo -u postgres psql -c "CREATE USER ds_app WITH PASSWORD '换成强密码';"
sudo -u postgres psql -c "CREATE DATABASE download_station OWNER ds_app;"

# 生成配置并修改
cp .env.example .env

# 启动（表结构会在启动时自动创建，无需手工导入 SQL）
npm start
```

后台常驻（简单方式）：

```bash
nohup npm start > app.log 2>&1 &
```

## 📁 目录结构

```
download-station/
├── server.js          # 下载站主服务
├── db.js              # 数据库连接与自动建表
├── public/            # 前端页面
├── server/
│   ├── panel.js       # 一键开服面板（零依赖）
│   ├── panel.html     # 面板网页
│   └── logs/          # 面板管理的应用日志
├── uploads/           # 上传文件存储（自动创建）
├── .env               # 本地配置（不入库，见 .env.example）
└── .env.example       # 配置模板
```

## 🔧 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 下载站服务端口 |
| `UPLOAD_DIR` | `uploads` | 上传文件存放目录 |
| `MAX_FILE_SIZE_MB` | `2048` | 单文件大小上限（MB） |
| `JWT_SECRET` | — | 登录令牌密钥，上线前务必修改 |
| `PG_HOST` / `PG_PORT` | `127.0.0.1` / `5432` | PostgreSQL 连接 |
| `PG_USER` / `PG_PASSWORD` | `ds_app` / — | PostgreSQL 账号 |
| `PG_DATABASE` | `download_station` | 数据库名 |
| `PANEL_PORT` / `PANEL_HOST` | `8080` / `0.0.0.0` | 面板监听地址 |
| `PANEL_PASSWORD` | 空 | 面板访问密码（建议设置） |

## ❓ 常见问题

- **打不开面板 / 网站**：防火墙放行端口 `sudo ufw allow 8080`、`sudo ufw allow 3000`（云服务器还需在安全组放行）。
- **一键开服提示连接 PostgreSQL 失败**：非 sudo 运行时，需在面板「数据库连接配置」中填写 postgres 密码。
- **端口被占用**：面板用 `PANEL_PORT=9090` 指定，下载站改 `.env` 中的 `PORT`。
- **数据备份**：`pg_dump -U ds_app download_station > backup.sql`，并备份 `uploads/` 目录。
=======
# 下载站（download-station）Linux 后台运行指南

本项目是一个基于 **Node.js + Express + PostgreSQL** 的资源下载站。
本文介绍如何在 Linux 服务器上安装依赖、配置数据库，并让它在**后台常驻运行**（关闭终端也不退出、开机自启）。

---

## 1. 环境要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18（推荐 20/22 LTS） | 项目使用 ESM 模块（`"type": "module"`） |
| PostgreSQL | ≥ 12 | 存放用户、资源、评论数据 |
| npm | 随 Node.js 自带 | 安装依赖用 |

```bash
node -v && npm -v
```

---

## 2. 部署步骤

### 2.1 把代码放到服务器

```bash
# 例如放到 /opt/download-station
mkdir -p /opt/download-station
# 将项目文件（server.js、db.js、package.json、public/、server/ 等）拷贝或 git clone 到该目录
cd /opt/download-station
```

### 2.2 安装依赖

```bash
npm install --omit=dev
```

> 生产环境不需要 `dev` 依赖（本项目也没有，`npm install` 即可）。

### 2.3 准备 PostgreSQL 数据库

程序启动时会**自动建表**（见 `db.js` 的 `initDb()`），但**数据库本身和账号需要先建好**。

```bash
sudo -u postgres psql <<'SQL'
CREATE USER ds_app WITH PASSWORD '请改成强密码';
CREATE DATABASE download_station OWNER ds_app;
SQL
```

### 2.4 配置 .env

复制/编辑项目根目录的 `.env`，按你的数据库信息修改：

```env
PORT=3000
PG_HOST=127.0.0.1
PG_PORT=5432
PG_USER=ds_app
PG_PASSWORD=请改成强密码
PG_DATABASE=download_station
UPLOAD_DIR=uploads
MAX_FILE_SIZE_MB=2048
JWT_SECRET=请改成一段随机长字符串
```

- `UPLOAD_DIR` 是相对路径，最终指向项目目录下的 `uploads/`，不存在会自动创建。
- `JWT_SECRET` 用于签发登录 token，生产环境务必改掉。

> 生成随机密钥：`openssl rand -hex 32`

### 2.5 先前台试跑一次

```bash
npm start
# 看到如下输出即成功：
#   下载站已启动: http://localhost:3000
#   资源存放目录: /opt/download-station/uploads
```

另开一个终端验证：

```bash
curl http://localhost:3000/api/stats
# 返回类似 {"resource_count":0,"total_downloads":0,...} 即正常
```

确认无误后按 `Ctrl+C` 停掉，再进行下面的后台部署。

---

## 3. 后台运行（三种方式，任选其一）

### 方式一：nohup（最简单，快速上手）

```bash
cd /opt/download-station
nohup node server.js > app.log 2>&1 &
echo $! > app.pid    # 记录进程号
```

- 日志写入 `app.log`，关闭终端也不影响运行。
- 查看状态：`cat app.pid` 得到 PID，`ps -p $(cat app.pid)` 确认存活。
- 查看日志：`tail -f app.log`
- 停止：`kill $(cat app.pid)`
- 缺点：**服务器重启后不会自动启动**，需要手动再执行一次。

### 方式二：systemd 服务（推荐，开机自启、崩溃自动拉起）

创建服务文件：

```bash
sudo tee /etc/systemd/system/download-station.service > /dev/null <<'EOF'
[Unit]
Description=Download Station (资源下载站)
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/download-station
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
# 建议用专用账号运行，更安全：
# User=www-data
Environment=NODE_ENV=production
# 日志交给 journald，无需重定向文件

[Install]
WantedBy=multi-user.target
EOF
```

> `ExecStart` 中的 node 路径以 `which node` 输出为准。

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now download-station
```

常用命令：

```bash
sudo systemctl status download-station   # 查看状态
sudo systemctl restart download-station  # 重启
sudo systemctl stop download-station     # 停止
journalctl -u download-station -f        # 实时查看日志
```

### 方式三：pm2（Node 进程管理器，多进程/监控友好）

```bash
npm install -g pm2
cd /opt/download-station
pm2 start server.js --name download-station
pm2 save                      # 保存进程列表
pm2 startup                   # 按提示执行输出的命令，实现开机自启
```

常用命令：

```bash
pm2 status                    # 查看状态
pm2 logs download-station     # 查看日志
pm2 restart download-station  # 重启
pm2 stop download-station     # 停止
```

---

## 4. 访问与验证

- 本机访问：`curl http://localhost:3000/api/stats`
- 局域网/公网访问：直接访问 `http://服务器IP:3000`（服务默认监听所有网卡）。
  - 如访问不通，检查防火墙：`sudo ufw allow 3000`（或云厂商安全组放行 3000 端口）。
- 反向代理（可选，配域名 + HTTPS 时使用，如 Nginx）：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 5. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `数据库初始化失败: ECONNREFUSED` | PostgreSQL 未启动或 `.env` 连接信息不对。`systemctl start postgresql`，核对 `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` |
| `database "download_station" does not exist` | 未建库，按 2.3 节创建 |
| `password authentication failed` | `PG_PASSWORD` 与 `CREATE USER` 时设置的不一致 |
| `EADDRINUSE: address already in use :::3000` | 3000 端口被占用，换 `PORT` 或 `kill` 旧进程（`lsof -i :3000`） |
| 上传大文件失败 | 检查 `MAX_FILE_SIZE_MB` 及 Nginx `client_max_body_size` 设置 |
| 页面能开但登录报错 | 检查 `JWT_SECRET` 是否改动过（改动会使已登录用户的 token 失效，属正常） |

---

## 6. 数据与文件备份（建议）

- 数据库：`pg_dump -U ds_app download_station > backup.sql`
- 上传文件：备份项目目录下的 `uploads/` 文件夹
>>>>>>> c49c144ba023271f2873b488888d08f655c57d5c
