import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB) || 2048;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json());
app.use(express.static('public'));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  defParamCharset: 'utf8',
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

const cleanupFile = (name) =>
  name && fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});

/* ---------------- 认证 ---------------- */

async function loadUser(id) {
  const { rows } = await pool.query(
    'SELECT id, username, is_admin, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

function getToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = await loadUser(payload.id);
    } catch { /* 无效 token 视为游客 */ }
  }
  next();
}

async function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: '请先登录' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  const user = await loadUser(payload.id);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

app.post('/api/auth/register', async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || !/^\S{2,30}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 2-30 个字符且不含空格' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    const isFirst = rows[0].c === 0;
    const { rows: inserted } = await pool.query(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin, created_at',
      [username, hash, isFirst]
    );
    const user = inserted[0];
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user,
      message: isFirst ? '注册成功，你是第一位注册用户，已自动成为管理员' : '注册成功',
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '用户名已被占用' });
    next(err);
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username || '']);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, username: user.username, is_admin: user.is_admin, created_at: user.created_at },
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

/* ---------------- 资源 ---------------- */

const RESOURCE_SELECT = `
  SELECT r.id, r.title, r.description, r.filename, r.size, r.mime_type,
         r.download_count, r.status, r.uploader_id, r.uploaded_at,
         u.username AS uploader_name
  FROM resources r LEFT JOIN users u ON u.id = r.uploader_id`;

function canView(r, user) {
  return r.status === 'approved' || user?.is_admin || r.uploader_id === user?.id;
}

app.get('/api/resources', optionalAuth, async (req, res, next) => {
  try {
    let where = "r.status = 'approved'";
    const params = [];
    if (req.user?.is_admin) {
      where = 'TRUE';
    } else if (req.user) {
      where = "(r.status = 'approved' OR r.uploader_id = $1)";
      params.push(req.user.id);
    }
    const { rows } = await pool.query(
      `${RESOURCE_SELECT} WHERE ${where} ORDER BY r.uploaded_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/resources/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的资源 ID' });
    const { rows } = await pool.query(`${RESOURCE_SELECT} WHERE r.id = $1`, [id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: '资源不存在' });
    if (!canView(r, req.user)) return res.status(403).json({ error: '该资源尚未通过审核' });
    const { rows: comments } = await pool.query(
      'SELECT id, user_id, username, content, created_at FROM comments WHERE resource_id = $1 ORDER BY created_at ASC',
      [id]
    );
    res.json({ ...r, comments });
  } catch (err) {
    next(err);
  }
});

app.post('/api/resources', requireAuth, upload.single('file'), async (req, res, next) => {
  const file = req.file;
  let inserted = false;
  try {
    const { title, description } = req.body || {};
    if (!file) return res.status(400).json({ error: '请选择文件' });
    if (!title || !title.trim()) return res.status(400).json({ error: '请填写资源名称' });
    const status = req.user.is_admin ? 'approved' : 'pending';
    const { rows } = await pool.query(
      `INSERT INTO resources (title, description, filename, stored_name, size, mime_type, status, uploader_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [title.trim(), (description || '').trim(), file.originalname, file.filename, file.size, file.mimetype, status, req.user.id]
    );
    inserted = true;
    const { rows: full } = await pool.query(`${RESOURCE_SELECT} WHERE r.id = $1`, [rows[0].id]);
    res.status(201).json({
      resource: full[0],
      message: status === 'approved' ? '上传成功，已直接发布' : '上传成功，等待管理员审核',
    });
  } catch (err) {
    if (!inserted) cleanupFile(file?.filename);
    next(err);
  }
});

app.put('/api/resources/:id', requireAuth, upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) {
      cleanupFile(file?.filename);
      return res.status(404).json({ error: '资源不存在' });
    }
    const isOwner = r.uploader_id === req.user.id;
    if (!isOwner && !req.user.is_admin) {
      cleanupFile(file?.filename);
      return res.status(403).json({ error: '只能修改自己上传的资源' });
    }
    const { title, description } = req.body || {};
    if (title !== undefined && !String(title).trim()) {
      cleanupFile(file?.filename);
      return res.status(400).json({ error: '资源名称不能为空' });
    }
    const newTitle = title !== undefined ? String(title).trim() : r.title;
    const newDesc = description !== undefined ? String(description).trim() : r.description;
    const status = req.user.is_admin ? r.status : 'pending';
    const { rows: updated } = await pool.query(
      `UPDATE resources SET title = $1, description = $2,
        filename = $3, stored_name = $4, size = $5, mime_type = $6, status = $7
       WHERE id = $8 RETURNING id`,
      [
        newTitle,
        newDesc,
        file ? file.originalname : r.filename,
        file ? file.filename : r.stored_name,
        file ? file.size : r.size,
        file ? file.mimetype : r.mime_type,
        status,
        id,
      ]
    );
    if (file) cleanupFile(r.stored_name);
    const { rows: full } = await pool.query(`${RESOURCE_SELECT} WHERE r.id = $1`, [updated[0].id]);
    res.json({
      resource: full[0],
      message: req.user.is_admin ? '修改已保存' : '修改已保存，需重新审核后展示',
    });
  } catch (err) {
    cleanupFile(file?.filename);
    next(err);
  }
});

app.post('/api/resources/:id/review', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效的审核操作' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    const { rows } = await pool.query(
      'UPDATE resources SET status = $1 WHERE id = $2 RETURNING id',
      [status, Number(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: '资源不存在' });
    const { rows: full } = await pool.query(`${RESOURCE_SELECT} WHERE r.id = $1`, [rows[0].id]);
    res.json({ resource: full[0], message: status === 'approved' ? '已通过审核' : '已拒绝该资源' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/resources/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM resources WHERE id = $1 RETURNING stored_name',
      [Number(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: '资源不存在' });
    cleanupFile(rows[0].stored_name);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/download/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的资源 ID' });
    const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: '资源不存在' });
    if (!canView(r, req.user)) return res.status(403).json({ error: '该资源尚未通过审核，无法下载' });
    await pool.query('UPDATE resources SET download_count = download_count + 1 WHERE id = $1', [id]);
    const filePath = path.join(UPLOAD_DIR, r.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(410).json({ error: '文件已丢失（磁盘上不存在）' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`
    );
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 评论 ---------------- */

app.post('/api/resources/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });
    if (content.length > 2000) return res.status(400).json({ error: '评论内容过长（最多 2000 字）' });
    const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: '资源不存在' });
    if (!canView(r, req.user)) return res.status(403).json({ error: '该资源尚未通过审核' });
    const { rows: inserted } = await pool.query(
      `INSERT INTO comments (resource_id, user_id, username, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, username, content, created_at`,
      [id, req.user.id, req.user.username, content]
    );
    res.status(201).json(inserted[0]);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/comments/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM comments WHERE id = $1', [Number(req.params.id)]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: '评论不存在' });
    if (c.user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: '只能删除自己的评论' });
    }
    await pool.query('DELETE FROM comments WHERE id = $1', [c.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- 用户管理（管理员） ---------------- */

app.get('/api/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = 'TRUE';
    if (q) {
      where = 'u.username ILIKE $1';
      params.push(`%${q}%`);
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.is_admin, u.created_at,
              (SELECT COUNT(*)::int FROM resources r WHERE r.uploader_id = u.id) AS resource_count
       FROM users u WHERE ${where} ORDER BY u.id ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.put('/api/users/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { is_admin } = req.body || {};
    if (typeof is_admin !== 'boolean') return res.status(400).json({ error: '参数错误' });
    if (id === req.user.id) return res.status(400).json({ error: '不能修改自己的权限' });
    const { rows } = await pool.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, username, is_admin',
      [is_admin, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({
      user: rows[0],
      message: is_admin
        ? `已将 ${rows[0].username} 设为管理员`
        : `已撤销 ${rows[0].username} 的管理员权限`,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- 统计 ---------------- */

app.get('/api/stats', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'approved')::int AS resource_count,
        COALESCE(SUM(download_count) FILTER (WHERE status = 'approved'), 0)::int AS total_downloads,
        COALESCE(SUM(size) FILTER (WHERE status = 'approved'), 0)::bigint AS total_size,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
      FROM resources
    `);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 错误处理 ---------------- */

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `文件超过大小限制（${MAX_FILE_SIZE_MB} MB）` });
    }
    return res.status(400).json({ error: `上传失败：${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`下载站已启动: http://localhost:${PORT}`);
      console.log(`资源存放目录: ${UPLOAD_DIR}`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });
