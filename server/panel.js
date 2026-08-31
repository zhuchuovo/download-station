#!/usr/bin/env node
/**
 * 下载站 · 一键开服面板（零依赖，可在 npm install 之前运行）
 * 用法: node server/panel.js
 * 推荐: sudo node server/panel.js   （Linux 下可免密码自动创建数据库）
 * 可选环境变量: PANEL_PORT(默认8080) / PANEL_HOST(默认0.0.0.0) / PANEL_PASSWORD(面板密码)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENV_PATH = path.join(ROOT, '.env');
const PID_FILE = path.join(__dirname, 'app.pid');
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const PANEL_HTML = path.join(__dirname, 'panel.html');

const PANEL_PORT = Number(process.env.PANEL_PORT) || 8080;
const PANEL_HOST = process.env.PANEL_HOST || '0.0.0.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randHex = (n = 16) => crypto.randomBytes(n).toString('hex');
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

/* ---------------- 基础工具 ---------------- */

const run = (cmd, args, timeout = 60000, extraEnv = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...extraEnv } },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err?.message || '' });
      }
    );
  });

function readEnv() {
  const map = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) map[m[1]] = m[2];
    }
  } catch { /* .env 不存在 */ }
  return map;
}

function writeEnv(updates) {
  const merged = { ...readEnv(), ...updates };
  const text = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, text, 'utf8');
}

function getPg() {
  try { return require('pg'); } catch { return null; }
}

function panelPassword() {
  return process.env.PANEL_PASSWORD || readEnv().PANEL_PASSWORD || '';
}

function npmCommand() {
  if (process.platform === 'win32') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli] };
    return { cmd: 'cmd', args: ['/c', 'npm'] };
  }
  return { cmd: 'npm', args: [] };
}

async function npmVersion() {
  const { cmd, args } = npmCommand();
  const r = await run(cmd, [...args, '--version'], 15000);
  return r.ok ? r.stdout.trim() : null;
}

const _cache = {};
const cached = (key, fn) => (_cache[key] !== undefined ? _cache[key] : (_cache[key] = fn()));

async function findPsql() {
  const p = process.env.PANEL_PSQL_PATH;
  if (p && fs.existsSync(p)) return { path: p, version: '自定义路径' };
  let r = await run('psql', ['--version'], 8000);
  if (r.ok) return { path: 'psql', version: r.stdout.trim() };
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\PostgreSQL']) {
      let versions = [];
      try { versions = fs.readdirSync(base); } catch { continue; }
      for (const v of versions) {
        const exe = path.join(base, v, 'bin', 'psql.exe');
        if (fs.existsSync(exe)) {
          const vr = await run(exe, ['--version'], 8000);
          return { path: exe, version: vr.stdout.trim() || v };
        }
      }
    }
  }
  return null;
}

async function sudoOk() {
  if (process.platform !== 'linux') return false;
  const r = await run('sudo', ['-n', 'true'], 8000);
  return r.ok;
}

/* ---------------- 数据库操作 ---------------- */

async function sudoPsql(sql, db = 'postgres', scalar = false) {
  const args = ['-n', '-u', 'postgres', 'psql', '-d', db];
  args.push(scalar ? '-tAc' : '-c', sql);
  return run('sudo', args, 60000);
}

const escSql = (s) => String(s).replace(/'/g, "''");

const GRANTS_DB = [
  'GRANT ALL PRIVILEGES ON DATABASE download_station TO ds_app',
];
const GRANTS_SCHEMA = [
  'GRANT ALL ON SCHEMA public TO ds_app',
  'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ds_app',
  'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ds_app',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ds_app',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ds_app',
];

// 将 public 下已有表/序列的所有权移交给 ds_app（老库迁移；全新数据库无影响）
const OWNERSHIP_SQL = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO ds_app', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ds_app', r.sequencename);
  END LOOP;
END $$`;

async function ensureDbViaPsql(cfg) {
  const portQ = await sudoPsql('SHOW port', 'postgres', true);
  const port = (portQ.stdout || '').trim() || cfg.pgPort || '5432';
  const dbExists = await sudoPsql("SELECT 1 FROM pg_database WHERE datname='download_station'", 'postgres', true);
  if (!String(dbExists.stdout || '').includes('1')) {
    const r = await sudoPsql('CREATE DATABASE download_station');
    if (!r.ok) throw new Error('创建数据库失败: ' + (r.stderr || r.stdout || r.error));
  }
  const role = await sudoPsql("SELECT 1 FROM pg_roles WHERE rolname='ds_app'", 'postgres', true);
  if (!String(role.stdout || '').includes('1')) {
    const r = await sudoPsql(`CREATE ROLE ds_app LOGIN PASSWORD '${escSql(cfg.appPassword)}'`);
    if (!r.ok) throw new Error('创建数据库用户失败: ' + (r.stderr || r.stdout || r.error));
  } else {
    await sudoPsql(`ALTER ROLE ds_app WITH LOGIN PASSWORD '${escSql(cfg.appPassword)}'`);
  }
  for (const g of GRANTS_DB) await sudoPsql(g);
  for (const g of GRANTS_SCHEMA) await sudoPsql(g, 'download_station');
  const own = await sudoPsql(OWNERSHIP_SQL, 'download_station');
  if (!own.ok) throw new Error('转移表所有权失败: ' + (own.stderr || own.stdout || own.error));
  return { host: '127.0.0.1', port };
}

async function ensureDbViaPgLib(cfg) {
  const pg = getPg();
  if (!pg) throw new Error('依赖尚未安装（找不到 pg 模块）。请先点击「安装依赖」，或用 sudo 运行面板');
  const base = { host: cfg.pgHost, port: Number(cfg.pgPort) || 5432, user: cfg.pgUser || 'postgres', password: cfg.pgPassword || '', connectionTimeoutMillis: 8000 };
  const c1 = new pg.Client({ ...base, database: 'postgres' });
  await c1.connect();
  try {
    const db = await c1.query("SELECT 1 FROM pg_database WHERE datname='download_station'");
    if (!db.rows.length) await c1.query('CREATE DATABASE download_station');
    const role = await c1.query("SELECT 1 FROM pg_roles WHERE rolname='ds_app'");
    if (!role.rows.length) await c1.query(`CREATE ROLE ds_app LOGIN PASSWORD '${escSql(cfg.appPassword)}'`);
    else await c1.query(`ALTER ROLE ds_app WITH LOGIN PASSWORD '${escSql(cfg.appPassword)}'`);
    for (const g of GRANTS_DB) await c1.query(g);
  } finally { await c1.end().catch(() => {}); }
  const c2 = new pg.Client({ ...base, database: 'download_station' });
  await c2.connect();
  try {
    for (const g of GRANTS_SCHEMA) await c2.query(g);
    await c2.query(OWNERSHIP_SQL);
  } finally { await c2.end().catch(() => {}); }
  return { host: base.host, port: String(base.port) };
}

async function verifyDb(env) {
  if (!env.PG_HOST || !env.PG_USER || !env.PG_DATABASE) return false;
  const pg = getPg();
  if (pg) {
    const c = new pg.Client({
      host: env.PG_HOST, port: Number(env.PG_PORT) || 5432,
      user: env.PG_USER, password: env.PG_PASSWORD || '',
      database: env.PG_DATABASE, connectionTimeoutMillis: 5000,
    });
    try { await c.connect(); await c.query('SELECT 1'); return true; }
    catch { return false; }
    finally { await c.end().catch(() => {}); }
  }
  const psql = await cached('psql', findPsql);
  if (psql) {
    const r = await run(
      psql.path,
      ['-h', env.PG_HOST, '-p', String(env.PG_PORT || 5432), '-U', env.PG_USER, '-d', env.PG_DATABASE, '-tAc', 'SELECT 1'],
      15000,
      { PGPASSWORD: env.PG_PASSWORD || '' }
    );
    return r.ok;
  }
  return null;
}

async function setupDatabase(input = {}) {
  const cfg = {
    pgHost: String(input.pgHost || '127.0.0.1'),
    pgPort: String(input.pgPort || '5432'),
    pgUser: String(input.pgUser || 'postgres'),
    pgPassword: String(input.pgPassword ?? ''),
    appPassword: randHex(16),
  };
  let info;
  if (await cached('sudo', sudoOk)) {
    info = await ensureDbViaPsql(cfg);
  } else {
    try {
      info = await ensureDbViaPgLib(cfg);
    } catch (e) {
      const msg = String(e.message || e);
      if (/password|authentication|登录|密码/i.test(msg)) {
        throw new Error(`连接 PostgreSQL 失败（${msg}）。请填写 postgres 超级用户密码，或用 sudo 运行面板`);
      }
      throw e;
    }
  }
  const cur = readEnv();
  const updates = {
    PG_HOST: info.host,
    PG_PORT: info.port,
    PG_USER: 'ds_app',
    PG_PASSWORD: cfg.appPassword,
    PG_DATABASE: 'download_station',
    JWT_SECRET: cur.JWT_SECRET || randHex(32),
  };
  if (!cur.PORT) updates.PORT = '3000';
  if (!cur.UPLOAD_DIR) updates.UPLOAD_DIR = 'uploads';
  if (!cur.MAX_FILE_SIZE_MB) updates.MAX_FILE_SIZE_MB = '2048';
  writeEnv(updates);
  const verified = await verifyDb(readEnv());
  return { ok: verified !== false, verified, host: info.host, port: info.port };
}

/* ---------------- 应用进程管理 ---------------- */

let appChild = null;

function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch { return null; }
}
function clearPid() { try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ } }
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function appState() {
  if (appChild && appChild.exitCode === null) return { running: true, pid: appChild.pid, managed: true };
  const pid = readPid();
  if (pid && isAlive(pid)) return { running: true, pid, managed: false };
  return { running: false, pid: null, managed: false };
}

function appendLog(line) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch { /* ignore */ }
}

async function startApp() {
  const st = appState();
  if (st.running) return { ok: false, error: `应用已在运行 (PID ${st.pid})` };
  appendLog(`\n[panel] ${new Date().toLocaleString()} 启动应用`);
  const fd = fs.openSync(LOG_FILE, 'a');
  try {
    appChild = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', fd, fd], windowsHide: true });
  } catch (e) {
    fs.closeSync(fd);
    return { ok: false, error: '启动失败: ' + e.message };
  }
  fs.closeSync(fd);
  fs.writeFileSync(PID_FILE, String(appChild.pid));
  appChild.on('exit', (code) => {
    appendLog(`[panel] 应用进程退出 code=${code}`);
    appChild = null;
    clearPid();
  });
  await sleep(1500);
  const now = appState();
  return now.running
    ? { ok: true, pid: now.pid }
    : { ok: false, error: '应用启动失败，请查看下方日志' };
}

function stopPid(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    try { process.kill(pid, 'SIGTERM'); } catch { return resolve(false); }
    let waited = 0;
    const timer = setInterval(() => {
      if (!isAlive(pid)) { clearInterval(timer); resolve(true); }
      else if (waited >= 5000) {
        clearInterval(timer);
        try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
        setTimeout(() => resolve(!isAlive(pid)), 300);
      } else waited += 200;
    }, 200);
  });
}

async function stopApp() {
  const st = appState();
  if (!st.running) return { ok: true, message: '应用未在运行' };
  appendLog(`[panel] ${new Date().toLocaleString()} 停止应用 (PID ${st.pid})`);
  if (appChild) {
    const child = appChild;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    const done = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
    if (!done) child.kill('SIGKILL');
    appChild = null;
    clearPid();
    return { ok: true };
  }
  const killed = await stopPid(st.pid);
  if (!killed) return { ok: false, error: '无法停止该进程（权限不足？），可尝试用 sudo 运行面板' };
  clearPid();
  return { ok: true };
}

function appResponds(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stats', timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/* ---------------- 面板业务 ---------------- */

async function npmInstall() {
  const { cmd, args } = npmCommand();
  const r = await run(cmd, [...args, 'install', '--omit=dev'], 600000);
  const tail = (r.stdout + '\n' + r.stderr).split(/\r?\n/).filter(Boolean).slice(-15).join('\n');
  return { ok: r.ok, output: tail || '完成' };
}

async function panelStatus() {
  const env = readEnv();
  const psql = await cached('psql', findPsql);
  const npm = await cached('npm', npmVersion);
  const st = appState();
  const appPort = Number(env.PORT) || 3000;
  const dbOk = await verifyDb(env);
  return {
    platform: `${process.platform} / ${process.arch}`,
    node: process.version,
    npm,
    psql: psql ? psql.version : null,
    isRoot: IS_ROOT,
    sudoAvailable: await cached('sudo', sudoOk),
    depsInstalled: fs.existsSync(path.join(ROOT, 'node_modules', 'express')),
    envExists: fs.existsSync(ENV_PATH),
    dbOk,
    app: { ...st, port: appPort, responds: st.running ? await appResponds(appPort) : false },
    authEnabled: !!panelPassword(),
  };
}

async function oneClick(input = {}) {
  const steps = [];
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
    const r = await npmInstall();
    steps.push({ name: '安装依赖', ok: r.ok, detail: r.output });
    if (!r.ok) return { ok: false, steps };
  } else {
    steps.push({ name: '安装依赖', ok: true, detail: '依赖已安装，跳过' });
  }

  const env = readEnv();
  const dbOk = env.PG_USER ? await verifyDb(env) : false;
  if (dbOk === true) {
    steps.push({ name: '配置数据库', ok: true, detail: '数据库连接正常，跳过' });
  } else {
    try {
      const r = await setupDatabase(input);
      steps.push({
        name: '配置数据库',
        ok: r.ok,
        detail: r.ok
          ? `已创建数据库 download_station（用户 ds_app @ ${r.host}:${r.port}）并写入 .env`
          : '已写入 .env，但连接验证失败，请检查 PostgreSQL 是否运行',
      });
      if (!r.ok) return { ok: false, steps };
    } catch (e) {
      steps.push({
        name: '配置数据库',
        ok: false,
        detail: `${e.message}（可尝试用 sudo 运行面板，或在「数据库连接配置」中填写 postgres 密码后重试）`,
      });
      return { ok: false, steps };
    }
  }

  const st = appState();
  if (!st.running) {
    const r = await startApp();
    steps.push({ name: '启动应用', ok: r.ok, detail: r.ok ? `已启动，PID ${r.pid}` : r.error });
    if (!r.ok) return { ok: false, steps };
  } else {
    steps.push({ name: '启动应用', ok: true, detail: `已在运行 (PID ${st.pid})` });
  }
  return { ok: true, steps };
}

function readLogs(n = 300) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/);
    return lines.slice(-n);
  } catch { return []; }
}

/* ---------------- HTTP 服务 ---------------- */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(PANEL_HTML);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      res.writeHead(500);
      return res.end('panel.html 缺失');
    }
  }
  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not Found' });

  const pwd = panelPassword();
  if (pwd && req.headers['x-panel-key'] !== pwd) return json(res, 401, { error: '面板密码错误' });

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await panelStatus());
    if (req.method === 'GET' && url.pathname === '/api/logs') return json(res, 200, { lines: readLogs() });

    const body = await readBody(req);
    if (req.method === 'POST' && url.pathname === '/api/install') return json(res, 200, await npmInstall());
    if (req.method === 'POST' && url.pathname === '/api/setup-db') {
      try {
        const r = await setupDatabase(body);
        return json(res, 200, r);
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/start') return json(res, 200, await startApp());
    if (req.method === 'POST' && url.pathname === '/api/stop') return json(res, 200, await stopApp());
    if (req.method === 'POST' && url.pathname === '/api/restart') {
      const s = await stopApp();
      if (!s.ok) return json(res, 200, s);
      return json(res, 200, await startApp());
    }
    if (req.method === 'POST' && url.pathname === '/api/oneclick') return json(res, 200, await oneClick(body));
    return json(res, 404, { error: '接口不存在' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    try { json(res, 500, { error: e.message }); } catch { /* ignore */ }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PANEL_PORT} 已被占用。可用 PANEL_PORT=其他端口 node server/panel.js 指定`);
    process.exit(1);
  }
  console.error('面板启动失败:', e.message);
  process.exit(1);
});

server.listen(PANEL_PORT, PANEL_HOST, () => {
  console.log('====================================');
  console.log('  下载站 · 开服面板已启动');
  console.log(`  面板地址: http://localhost:${PANEL_PORT}`);
  console.log(`  项目目录: ${ROOT}`);
  console.log('------------------------------------');
  if (IS_ROOT) console.log('  当前以 root 运行：可免密码自动创建数据库');
  else if (process.platform === 'linux') console.log('  提示: 用 sudo 运行可免密码自动创建数据库');
  if (!panelPassword()) console.log('  提示: 在 .env 中设置 PANEL_PASSWORD 可为面板加密码');
  console.log('====================================');
});
