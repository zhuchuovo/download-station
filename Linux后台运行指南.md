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
