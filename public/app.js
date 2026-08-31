const $ = (s) => document.querySelector(s);

const state = {
  user: null,
  token: null,
  resources: [],
  filter: 'all',
  keyword: '',
  detail: null,
  authMode: 'login',
  uploadFile: null,
  editingId: null,
};

let toastTimer = null;

/* ---------- 工具 ---------- */

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
    mp3: '🎵', wav: '🎵', flac: '🎵', mp4: '🎬', mkv: '🎬', avi: '🎬',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    exe: '⚙️', msi: '⚙️', apk: '📱', txt: '📄', md: '📄', csv: '📄',
  };
  return map[ext] || '📎';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const STATUS = {
  pending: { label: '待审核', cls: 'st-pending' },
  approved: { label: '已发布', cls: 'st-approved' },
  rejected: { label: '已拒绝', cls: 'st-rejected' },
};

/* ---------- API ---------- */

async function api(path, options = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token && path !== '/api/auth/login') {
      forceLogout();
      toast('登录已过期，请重新登录', true);
    }
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function forceLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('ds_token');
  localStorage.removeItem('ds_user');
  renderNav();
  state.filter = 'all';
  loadResources();
  loadStats();
}

/* ---------- 认证 ---------- */

async function submitAuth() {
  const username = $('#f-username').value.trim();
  const password = $('#f-password').value;
  $('#auth-error').textContent = '';
  try {
    const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const data = await api(path, { method: 'POST', body: JSON.stringify({ username, password }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('ds_token', data.token);
    localStorage.setItem('ds_user', JSON.stringify(data.user));
    closeModal('#modal-auth');
    toast(data.message || '登录成功');
    state.filter = 'all';
    renderNav();
    loadResources();
    loadStats();
  } catch (e) {
    $('#auth-error').textContent = e.message;
  }
}

function logout() {
  forceLogout();
  toast('已退出登录');
}

/* ---------- 数据加载 ---------- */

async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#stat-count').textContent = s.resource_count;
    $('#stat-downloads').textContent = s.total_downloads;
    $('#stat-size').textContent = formatSize(Number(s.total_size));
  } catch { /* ignore */ }
  renderFilters();
}

async function loadResources() {
  try {
    state.resources = await api('/api/resources');
  } catch {
    state.resources = [];
  }
  renderGrid();
  renderFilters();
}

/* ---------- 渲染 ---------- */

function renderNav() {
  const el = $('#nav-user');
  if (!state.user) {
    el.innerHTML = `
      <button class="btn btn-ghost" id="nav-login">登录</button>
      <button class="btn btn-primary" id="nav-register">注册</button>`;
    $('#nav-login').onclick = () => switchAuth('login');
    $('#nav-register').onclick = () => switchAuth('register');
  } else {
    el.innerHTML = `
      <span class="nav-user">
        <span class="nav-username">${escapeHtml(state.user.username)}</span>
        ${state.user.is_admin ? '<span class="badge-admin">管理员</span>' : ''}
      </span>
      ${state.user.is_admin ? '<button class="btn btn-ghost" id="nav-users">用户管理</button>' : ''}
      <button class="btn btn-primary" id="nav-upload">＋ 上传资源</button>
      <button class="btn btn-ghost" id="nav-logout">退出</button>`;
    if (state.user.is_admin) $('#nav-users').onclick = openUsers;
    $('#nav-upload').onclick = openUpload;
    $('#nav-logout').onclick = logout;
  }
}

function renderFilters() {
  const el = $('#filters');
  if (!state.user) {
    el.innerHTML = '';
    return;
  }
  let chips;
  if (state.user.is_admin) {
    const pending = state.resources.filter((r) => r.status === 'pending').length;
    chips = [
      { key: 'all', label: '全部' },
      { key: 'pending', label: pending ? `待审核 (${pending})` : '待审核' },
      { key: 'approved', label: '已发布' },
      { key: 'rejected', label: '已拒绝' },
      { key: 'mine', label: '我上传的' },
    ];
  } else {
    chips = [
      { key: 'all', label: '全部' },
      { key: 'mine', label: '我上传的' },
    ];
  }
  el.innerHTML = chips.map((c) =>
    `<button class="chip ${state.filter === c.key ? 'active' : ''}" data-filter="${c.key}">${c.label}</button>`
  ).join('');
}

function visibleResources() {
  let list = state.resources;
  const kw = state.keyword.toLowerCase();
  if (kw) {
    list = list.filter((r) =>
      r.title.toLowerCase().includes(kw) ||
      r.filename.toLowerCase().includes(kw) ||
      (r.description || '').toLowerCase().includes(kw)
    );
  }
  if (state.filter === 'mine' && state.user) {
    list = list.filter((r) => r.uploader_id === state.user.id);
  } else if (state.filter !== 'all') {
    list = list.filter((r) => r.status === state.filter);
  }
  return list;
}

function renderGrid() {
  const grid = $('#grid');
  const list = visibleResources();
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-tip">${state.keyword ? '没有匹配的资源' : '暂无资源'}</div>`;
    return;
  }
  grid.innerHTML = list.map((r) => `
    <div class="card" data-id="${r.id}" data-title="${escapeHtml(r.title)}" data-desc="${escapeHtml(r.description || '')}">
      <div class="card-top">
        <span class="file-icon">${fileIcon(r.filename)}</span>
        ${r.status !== 'approved' ? `<span class="status-badge ${STATUS[r.status].cls}">${STATUS[r.status].label}</span>` : ''}
      </div>
      <div class="card-title">${escapeHtml(r.title)}</div>
      <div class="card-file">${escapeHtml(r.filename)}</div>
      <div class="card-meta">
        <span>${formatSize(Number(r.size))}</span>
        <span>${formatTime(r.uploaded_at)}</span>
      </div>
      <div class="card-bottom">
        <span class="dl-count">⬇ ${r.download_count} 次下载</span>
        <a class="btn btn-primary btn-sm" href="/api/download/${r.id}">下载</a>
      </div>
    </div>
  `).join('');
}

/* ---------- 悬浮提示（标题 + 简介） ---------- */

const tooltipEl = $('#tooltip');

function showTooltip(card) {
  const title = card.dataset.title || '';
  const desc = card.dataset.desc || '暂无简介';
  tooltipEl.innerHTML = `<div class="t-title">${escapeHtml(title)}</div><div class="t-desc">${escapeHtml(desc)}</div>`;
  tooltipEl.classList.add('show');
  const rect = card.getBoundingClientRect();
  const tt = tooltipEl.getBoundingClientRect();
  let top = rect.top - tt.height - 8;
  if (top < 60) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tt.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tt.width - 8));
  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
}

function hideTooltip() {
  tooltipEl.classList.remove('show');
}

$('#grid').addEventListener('mouseover', (e) => {
  const card = e.target.closest('.card');
  if (card) showTooltip(card);
});
$('#grid').addEventListener('mouseout', (e) => {
  const card = e.target.closest('.card');
  if (card && !card.contains(e.relatedTarget)) hideTooltip();
});
$('#grid').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('.card');
  if (card) openDetail(Number(card.dataset.id));
});

/* ---------- 弹窗通用 ---------- */

function openModal(sel) {
  $(sel).classList.remove('hidden');
}

function closeModal(sel) {
  $(sel).classList.add('hidden');
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('.modal-backdrop').classList.add('hidden'));
});
document.querySelectorAll('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => {
    if (e.target === bd) bd.classList.add('hidden');
  });
});

/* ---------- 登录 / 注册弹窗 ---------- */

function switchAuth(mode) {
  state.authMode = mode;
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
  $('#btn-auth-submit').textContent = mode === 'login' ? '登录' : '注册';
  $('#f-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
  openModal('#modal-auth');
  $('#f-username').focus();
}

$('#tab-login').onclick = () => switchAuth('login');
$('#tab-register').onclick = () => switchAuth('register');
$('#btn-auth-submit').onclick = submitAuth;
$('#f-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAuth();
});

/* ---------- 上传资源 ---------- */

function openUpload() {
  $('#up-file').value = '';
  state.uploadFile = null;
  $('#up-drop-text').textContent = '点击选择文件或拖拽到此处';
  $('#up-title').value = '';
  $('#up-desc').value = '';
  $('#upload-error').textContent = '';
  $('#upload-hint').textContent = state.user?.is_admin
    ? '管理员上传的资源将直接发布'
    : '上传后需管理员审核通过才会公开显示';
  openModal('#modal-upload');
}

const upDrop = $('#up-drop');
upDrop.addEventListener('click', () => $('#up-file').click());
$('#up-file').addEventListener('change', () => {
  const f = $('#up-file').files[0];
  if (f) {
    state.uploadFile = f;
    $('#up-drop-text').textContent = `已选择：${f.name}（${formatSize(f.size)}）`;
  }
});
['dragover', 'dragenter'].forEach((ev) =>
  upDrop.addEventListener(ev, (e) => {
    e.preventDefault();
    upDrop.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  upDrop.addEventListener(ev, (e) => {
    e.preventDefault();
    upDrop.classList.remove('dragover');
  })
);
upDrop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) {
    state.uploadFile = f;
    $('#up-file').value = '';
    $('#up-drop-text').textContent = `已选择：${f.name}（${formatSize(f.size)}）`;
  }
});

async function submitUpload() {
  const file = state.uploadFile || $('#up-file').files[0];
  const title = $('#up-title').value.trim();
  if (!file) return ($('#upload-error').textContent = '请选择文件');
  if (!title) return ($('#upload-error').textContent = '请填写资源名称');
  const form = new FormData();
  form.append('file', file);
  form.append('title', title);
  form.append('description', $('#up-desc').value.trim());
  try {
    const data = await api('/api/resources', { method: 'POST', body: form });
    toast(data.message);
    closeModal('#modal-upload');
    loadResources();
    loadStats();
  } catch (e) {
    $('#upload-error').textContent = e.message;
  }
}

$('#btn-upload-submit').onclick = submitUpload;

/* ---------- 资源详情 ---------- */

async function openDetail(id) {
  try {
    state.detail = await api(`/api/resources/${id}`);
    renderDetail();
    openModal('#modal-detail');
  } catch (e) {
    toast(e.message, true);
  }
}

function renderDetail() {
  const r = state.detail;
  if (!r) return;
  const u = state.user;
  const isOwner = u && r.uploader_id === u.id;
  const isAdmin = !!u?.is_admin;

  const comments = (r.comments || []).map((c) => `
    <div class="comment">
      <div class="comment-head">
        <span class="comment-user">${escapeHtml(c.username)}</span>
        <span class="comment-time">${formatTime(c.created_at)}</span>
        ${u && (isAdmin || c.user_id === u.id) ? `<button class="link-btn" data-del-comment="${c.id}">删除</button>` : ''}
      </div>
      <div class="comment-content">${escapeHtml(c.content)}</div>
    </div>
  `).join('');

  $('#detail-body').innerHTML = `
    <div class="detail-title">
      <h3>${escapeHtml(r.title)}</h3>
      ${r.status !== 'approved' ? `<span class="status-badge ${STATUS[r.status].cls}">${STATUS[r.status].label}</span>` : ''}
    </div>
    ${r.status === 'pending' && !isAdmin ? '<p class="detail-hint">该资源正在等待管理员审核，审核通过后将对所有人可见</p>' : ''}
    <div class="detail-info">
      <span>文件：${escapeHtml(r.filename)}</span>
      <span>大小：${formatSize(Number(r.size))}</span>
      <span>上传者：${escapeHtml(r.uploader_name || '未知')}</span>
      <span>上传时间：${formatTime(r.uploaded_at)}</span>
    </div>
    <div class="detail-desc">
      <h4>简介</h4>
      <p>${escapeHtml(r.description) || '暂无简介'}</p>
    </div>
    <div class="detail-actions">
      <span class="dl-count big">⬇ ${r.download_count} 次下载</span>
      <a class="btn btn-primary" href="/api/download/${r.id}">下载资源</a>
      ${isOwner || isAdmin ? '<button class="btn btn-ghost" id="btn-edit-res">编辑</button>' : ''}
      ${isAdmin ? '<button class="btn btn-danger" id="btn-del-res">删除</button>' : ''}
      ${isAdmin && r.status !== 'approved' ? '<button class="btn btn-success" id="btn-approve">通过审核</button><button class="btn btn-warn" id="btn-reject">拒绝</button>' : ''}
    </div>
    <div class="comments">
      <h4>评论区</h4>
      <div class="comment-list">${comments || '<p class="comment-empty">还没有评论，来抢沙发吧</p>'}</div>
      ${u ? `
        <div class="comment-form">
          <textarea id="comment-input" rows="3" placeholder="写点什么介绍这个资源吧…"></textarea>
          <button class="btn btn-primary" id="btn-comment">发表评论</button>
        </div>` : '<p class="comment-empty">登录后即可评论</p>'}
    </div>
  `;

  const editBtn = $('#btn-edit-res');
  if (editBtn) editBtn.onclick = () => openEdit(r);
  const delBtn = $('#btn-del-res');
  if (delBtn) delBtn.onclick = () => deleteResource(r);
  const approveBtn = $('#btn-approve');
  if (approveBtn) approveBtn.onclick = () => reviewResource(r.id, 'approve');
  const rejectBtn = $('#btn-reject');
  if (rejectBtn) rejectBtn.onclick = () => reviewResource(r.id, 'reject');
  const commentBtn = $('#btn-comment');
  if (commentBtn) commentBtn.onclick = submitComment;
  $('#detail-body').querySelectorAll('[data-del-comment]').forEach((btn) => {
    btn.onclick = () => deleteComment(Number(btn.dataset.delComment));
  });
}

async function submitComment() {
  const input = $('#comment-input');
  const content = input.value.trim();
  if (!content) return toast('评论内容不能为空', true);
  try {
    await api(`/api/resources/${state.detail.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    toast('评论发表成功');
    await openDetail(state.detail.id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteComment(cid) {
  if (!confirm('确定删除这条评论吗？')) return;
  try {
    await api(`/api/comments/${cid}`, { method: 'DELETE' });
    toast('评论已删除');
    await openDetail(state.detail.id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function reviewResource(id, action) {
  try {
    const data = await api(`/api/resources/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    toast(data.message);
    await openDetail(id);
    loadResources();
    loadStats();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteResource(r) {
  if (!confirm(`确定删除资源「${r.title}」吗？此操作不可恢复`)) return;
  try {
    await api(`/api/resources/${r.id}`, { method: 'DELETE' });
    toast('资源已删除');
    closeModal('#modal-detail');
    loadResources();
    loadStats();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- 编辑资源 ---------- */

function openEdit(r) {
  $('#edit-title').value = r.title;
  $('#edit-desc').value = r.description || '';
  $('#edit-file').value = '';
  $('#edit-error').textContent = '';
  state.editingId = r.id;
  closeModal('#modal-detail');
  openModal('#modal-edit');
}

async function submitEdit() {
  const title = $('#edit-title').value.trim();
  if (!title) return ($('#edit-error').textContent = '资源名称不能为空');
  const form = new FormData();
  form.append('title', title);
  form.append('description', $('#edit-desc').value.trim());
  const file = $('#edit-file').files[0];
  if (file) form.append('file', file);
  try {
    const data = await api(`/api/resources/${state.editingId}`, { method: 'PUT', body: form });
    toast(data.message);
    closeModal('#modal-edit');
    loadResources();
    loadStats();
  } catch (e) {
    $('#edit-error').textContent = e.message;
  }
}

$('#btn-edit-submit').onclick = submitEdit;

/* ---------- 用户管理（管理员） ---------- */

function openUsers() {
  $('#users-search').value = '';
  openModal('#modal-users');
  loadUsers();
}

async function loadUsers() {
  const q = $('#users-search').value.trim();
  try {
    const users = await api('/api/users' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    $('#users-body').innerHTML = users.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.username)}${u.id === state.user.id ? ' <span class="self-tag">（我）</span>' : ''}</td>
        <td>${u.is_admin ? '<span class="badge-admin">管理员</span>' : '<span class="badge-user">普通用户</span>'}</td>
        <td>${formatTime(u.created_at)}</td>
        <td>${u.resource_count}</td>
        <td>${u.id === state.user.id
          ? '—'
          : `<button class="btn btn-sm ${u.is_admin ? 'btn-warn' : 'btn-success'}" data-role="${u.id}" data-admin="${!u.is_admin}">${u.is_admin ? '撤销管理员' : '设为管理员'}</button>`}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty">没有找到用户</td></tr>';
    $('#users-body').querySelectorAll('[data-role]').forEach((btn) => {
      btn.onclick = () => toggleRole(Number(btn.dataset.role), btn.dataset.admin === 'true');
    });
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleRole(id, makeAdmin) {
  const msg = makeAdmin ? '确定授予该用户管理员权限？' : '确定撤销该用户的管理员权限？';
  if (!confirm(msg)) return;
  try {
    const data = await api(`/api/users/${id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ is_admin: makeAdmin }),
    });
    toast(data.message);
    loadUsers();
  } catch (e) {
    toast(e.message, true);
  }
}

$('#users-search').addEventListener('input', loadUsers);

/* ---------- 搜索 / 筛选 ---------- */

$('#search').addEventListener('input', (e) => {
  state.keyword = e.target.value.trim();
  renderGrid();
});

$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  renderFilters();
  renderGrid();
});

/* ---------- 初始化 ---------- */

(function init() {
  const token = localStorage.getItem('ds_token');
  const user = JSON.parse(localStorage.getItem('ds_user') || 'null');
  if (token && user) {
    state.token = token;
    state.user = user;
  }
  renderNav();
  loadResources();
  loadStats();
  if (state.token) {
    api('/api/auth/me')
      .then((u) => {
        state.user = u;
        localStorage.setItem('ds_user', JSON.stringify(u));
        renderNav();
        loadResources();
      })
      .catch(() => {});
  }
})();
