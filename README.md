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
sudo apt update && sudo apt install -y git nodejs npm postgresql && git clone <你的仓库地址> && cd download-station && sudo node server/panel.js
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
