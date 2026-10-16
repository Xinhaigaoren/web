const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let pinyin = null;
try { pinyin = require('pinyin-pro'); } catch (_) { pinyin = null; }

const app = express();
const PORT = process.env.PORT || 3000;

// 主管理员账号/密码：前后端直接设置（如需更换请修改此处）
const ADMIN_USER = 'xinhaigaoren2024';
const ADMIN_PASSWORD = 'xinhaigaorenguanliyuan2024';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL || '';
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://zwx-hub.github.io/hailin-high-school-alumni').replace(/\/$/, '');

const pool = DATABASE_URL
  ? (() => {
      const dbUrl = new URL(DATABASE_URL);
      return new Pool({
        host: dbUrl.hostname,
        port: Number(dbUrl.port || 5432),
        database: dbUrl.pathname.replace(/^\//, '') || 'postgres',
        user: decodeURIComponent(dbUrl.username),
        password: decodeURIComponent(dbUrl.password),
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
    })()
  : null;

// 强制放开跨域，避免 GitHub Pages -> Render 被浏览器拦截。
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

function ok(res, data = {}) {
  return res.json({ ok: true, ...data });
}

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, message, ...extra });
}

// ===== 工具函数 =====
function parsePositiveInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// 统一的数据库查询封装：无 DATABASE_URL 时给出友好错误，不让请求 500 裸奔。
async function dbQuery(text, params = []) {
  if (!pool) {
    const e = new Error('数据库未配置');
    e.code = 'NO_DB';
    throw e;
  }
  return pool.query(text, params);
}

// 内容安全：只转义 HTML 特殊字符，保留换行。
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
}

// ===== 认证中间件 =====
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return fail(res, 401, '未登录');
  try {
    const payload = jwt.verify(token, TOKEN_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return fail(res, 401, '登录已过期，请重新登录');
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'admin')) {
    return fail(res, 403, '无权限');
  }
  next();
}

function requireAlumni(req, res, next) {
  if (!req.user || req.user.role !== 'alumni') {
    return fail(res, 403, '仅校友可用');
  }
  next();
}

// ===== 启动自检：health =====
app.get('/api/health', async (req, res) => {
  let db = 'down';
  if (pool) {
    try {
      await dbQuery('select 1');
      db = 'up';
    } catch (e) {
      db = 'down';
    }
  }
  return ok(res, { db, version: '1.0.0' });
});

// ============================================================
// 用户 / 校友 / 管理员 认证体系
// ============================================================

// 注册：创建 app_users（默认校友，待审批）
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name, phone, email, grade, graduation_year, address } = req.body || {};
    if (!username || !password || !name || !phone || !email) {
      return fail(res, 400, '请填写完整信息（用户名、密码、姓名、手机、邮箱）');
    }
    if (String(password).length < 6) {
      return fail(res, 400, '密码至少 6 位');
    }
    const uname = String(username).trim();
    const existing = await dbQuery('select id from public.app_users where username = $1 or email = $2 or phone = $3', [uname, String(email).trim(), String(phone).trim()]);
    if (existing.rows.length > 0) return fail(res, 400, '用户名、手机或邮箱已被注册');
    const hash = await bcrypt.hash(String(password), 10);
    const r = await dbQuery(
      `insert into public.app_users (username, password_hash, name, phone, email, role, status)
       values ($1, $2, $3, $4, $5, 'alumni', 'pending')
       returning *`,
      [uname, hash, String(name).trim(), String(phone).trim(), String(email).trim()]
    );
    const user = r.rows[0];
    await dbQuery(
      `insert into public.alumni_profiles (user_id, name, phone, email, grade, graduation_year, address, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [user.id, String(name).trim(), String(phone).trim(), String(email).trim(), String(grade || '').trim(), parsePositiveInt(graduation_year), String(address || '').trim()]
    ).catch(() => {});
    const token = jwt.sign({ id: user.id, username: user.username, role: 'alumni', name: user.name }, TOKEN_SECRET, { expiresIn: '30d' });
    return ok(res, { token, user: { id: user.id, username: user.username, name: user.name, role: 'alumni', status: 'pending' } });
  } catch (e) {
    if (e.code === 'NO_DB') return fail(res, 503, '数据库未配置');
    return fail(res, 500, '注册失败', { error: e.message });
  }
});

// 登录：支持 用户名 / 手机号 / 邮箱 / 校友电子卡卡号
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return fail(res, 400, '请输入用户名和密码');
    const uname = String(username).trim();
    let r;
    try {
      r = await dbQuery(
        `select u.*, p.graduation_year, p.grade as p_grade, p.address, p.status as p_status,
                c.card_no
         from public.app_users u
         left join public.alumni_profiles p on p.user_id = u.id
         left join public.alumni_cards c on c.user_id = u.id
         where u.username = $1 or u.phone = $1 or u.email = $1 or c.card_no = $1
         limit 1`,
        [uname]
      );
    } catch (e) {
      return fail(res, 500, '登录失败', { error: e.message });
    }
    const user = r.rows[0];
    if (!user) return fail(res, 401, '用户名或密码错误');
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) return fail(res, 401, '用户名或密码错误');
    if (user.role !== 'super_admin' && user.role !== 'admin' && user.status === 'pending') {
      return fail(res, 403, '账号待管理员审批');
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      TOKEN_SECRET,
      { expiresIn: '30d' }
    );
    return ok(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
        graduation_year: user.graduation_year || null,
        address: user.address || '',
        card_no: user.card_no || ''
      }
    });
  } catch (e) {
    return fail(res, 500, '登录失败', { error: e.message });
  }
});

// 校友个人信息
app.get('/api/alumni/me', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select u.id, u.username, u.name, u.phone, u.email, u.role, u.status,
              p.name as profile_name, p.phone as profile_phone, p.email as profile_email,
              p.grade, p.graduation_year, p.address, p.class_name, p.avatar_url, p.status as profile_status,
              c.card_no
       from public.app_users u
       left join public.alumni_profiles p on p.user_id = u.id
       left join public.alumni_cards c on c.user_id = u.id
       where u.id = $1`,
      [req.user.id]
    );
    const row = r.rows[0];
    if (!row) return fail(res, 404, '用户不存在');
    return ok(res, {
      user: {
        id: row.id, username: row.username, name: row.name, phone: row.phone, email: row.email,
        role: row.role, status: row.status, card_no: row.card_no || ''
      },
      profile: {
        name: row.profile_name || row.name,
        phone: row.profile_phone || row.phone,
        email: row.profile_email || row.email,
        grade: row.grade || '',
        graduation_year: row.graduation_year || null,
        address: row.address || '',
        class_name: row.class_name || '',
        avatar_url: row.avatar_url || '',
        status: row.profile_status || ''
      }
    });
  } catch (e) {
    return fail(res, 500, '获取个人信息失败', { error: e.message });
  }
});

// 更新校友个人信息（含头像）
app.put('/api/alumni/me', requireAuth, requireAlumni, async (req, res) => {
  try {
    const { name, phone, email, grade, graduation_year, address, class_name, avatar_url } = req.body || {};
    const r = await dbQuery(
      `select * from public.alumni_profiles where user_id = $1`,
      [req.user.id]
    );
    if (!r.rows[0]) {
      await dbQuery(
        `insert into public.alumni_profiles (user_id, name, phone, email, grade, graduation_year, address, class_name, avatar_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.user.id, name || '', phone || '', email || '', grade || '', parsePositiveInt(graduation_year), address || '', class_name || '', avatar_url || '']
      );
    } else {
      await dbQuery(
        `update public.alumni_profiles
         set name = coalesce($2, name), phone = coalesce($3, phone), email = coalesce($4, email),
             grade = coalesce($5, grade), graduation_year = coalesce($6, graduation_year),
             address = coalesce($7, address), class_name = coalesce($8, class_name),
             avatar_url = coalesce($9, avatar_url)
         where user_id = $1`,
        [req.user.id, name, phone, email, grade, parsePositiveInt(graduation_year), address, class_name, avatar_url]
      );
    }
    return ok(res, { message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新失败', { error: e.message });
  }
});

// 管理员登录（独立入口）
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return fail(res, 400, '请输入用户名和密码');
    if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
      const token = jwt.sign({ id: 0, username: ADMIN_USER, role: 'super_admin', name: '主管理员' }, TOKEN_SECRET, { expiresIn: '7d' });
      return ok(res, { token, user: { id: 0, username: ADMIN_USER, name: '主管理员', role: 'super_admin' } });
    }
    const r = await dbQuery(
      `select * from public.app_users where (username = $1 or email = $1 or phone = $1) and role in ('super_admin','admin') limit 1`,
      [String(username).trim()]
    );
    const user = r.rows[0];
    if (!user) return fail(res, 401, '用户名或密码错误');
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) return fail(res, 401, '用户名或密码错误');
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, TOKEN_SECRET, { expiresIn: '7d' });
    return ok(res, { token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (e) {
    return fail(res, 500, '登录失败', { error: e.message });
  }
});

// 管理员信息
app.get('/api/admin/me', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    return ok(res, {
      user: { id: req.user.id, username: req.user.username, name: req.user.name, role: req.user.role }
    });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// ============================================================
// 审批 / 校友档案
// ============================================================

// 待审批列表
app.get('/api/admin/pending', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select u.id, u.username, u.name, u.phone, u.email, u.created_at,
              p.grade, p.graduation_year, p.address, p.status as profile_status
       from public.app_users u
       left join public.alumni_profiles p on p.user_id = u.id
       where u.role = 'alumni' and (u.status = 'pending' or p.status = 'pending')
       order by u.created_at desc`
    );
    return ok(res, { users: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 全部校友
app.get('/api/admin/alumni', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const cond = q ? ' and (u.name ilike $1 or u.username ilike $1 or u.email ilike $1 or u.phone ilike $1)' : '';
    const params = q ? [`%${q}%`] : [];
    const r = await dbQuery(
      `select u.id, u.username, u.name, u.phone, u.email, u.role, u.status, u.created_at,
              p.grade, p.graduation_year, p.address, p.class_name, p.status as profile_status,
              c.card_no
       from public.app_users u
       left join public.alumni_profiles p on p.user_id = u.id
       left join public.alumni_cards c on c.user_id = u.id
       where u.role = 'alumni' ${cond}
       order by u.created_at desc`,
      params
    );
    return ok(res, { users: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 通过审批 / 确认填写（校友档案激活）
app.post('/api/admin/approve/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(
      `update public.app_users set status = 'approved', approved_at = now() where id = $1 and role = 'alumni' returning *`,
      [id]
    );
    if (!r.rows[0]) return fail(res, 404, '用户不存在');
    await dbQuery(
      `update public.alumni_profiles set status = 'approved' where user_id = $1`,
      [id]
    ).catch(() => {});
    return ok(res, { message: '已通过' });
  } catch (e) {
    return fail(res, 500, '操作失败', { error: e.message });
  }
});

// 修改信息
app.put('/api/admin/alumni/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const { name, phone, email, grade, graduation_year, address, class_name } = req.body || {};
    await dbQuery(
      `update public.app_users set name = coalesce($2, name), phone = coalesce($3, phone), email = coalesce($4, email) where id = $1`,
      [id, name, phone, email]
    );
    const r = await dbQuery(
      `select * from public.alumni_profiles where user_id = $1`,
      [id]
    );
    if (!r.rows[0]) {
      await dbQuery(
        `insert into public.alumni_profiles (user_id, name, phone, email, grade, graduation_year, address, class_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, name || '', phone || '', email || '', grade || '', parsePositiveInt(graduation_year), address || '', class_name || '']
      );
    } else {
      await dbQuery(
        `update public.alumni_profiles
         set name = coalesce($2, name), phone = coalesce($3, phone), email = coalesce($4, email),
             grade = coalesce($5, grade), graduation_year = coalesce($6, graduation_year),
             address = coalesce($7, address), class_name = coalesce($8, class_name)
         where user_id = $1`,
        [id, name, phone, email, grade, parsePositiveInt(graduation_year), address, class_name]
      );
    }
    return ok(res, { message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新失败', { error: e.message });
  }
});

// 删除校友
app.delete('/api/admin/alumni/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    await dbQuery('delete from public.alumni_profiles where user_id = $1', [id]).catch(() => {});
    await dbQuery('delete from public.alumni_cards where user_id = $1', [id]).catch(() => {});
    await dbQuery('delete from public.app_users where id = $1', [id]);
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除失败', { error: e.message });
  }
});

// ============================================================
// 校友电子卡
// ============================================================

// 我的电子卡
app.get('/api/card/my', requireAuth, requireAlumni, async (req, res) => {
  try {
    const r = await dbQuery(
      `select c.*, p.name, p.graduation_year, p.grade, p.address, p.class_name, p.avatar_url
       from public.alumni_cards c
       left join public.alumni_profiles p on p.user_id = c.user_id
       where c.user_id = $1`,
      [req.user.id]
    );
    if (r.rows.length === 0) {
      return ok(res, { card: null });
    }
    return ok(res, { card: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 领取电子卡（自动生成卡号：入学年份 + 毕业年份 + 随机5位）
app.post('/api/card/claim', requireAuth, requireAlumni, async (req, res) => {
  try {
    const me = await dbQuery(
      `select p.name, p.graduation_year, p.grade, p.address, p.class_name, p.status as p_status,
              u.status as u_status
       from public.alumni_profiles p
       join public.app_users u on u.id = p.user_id
       where p.user_id = $1`,
      [req.user.id]
    );
    const profile = me.rows[0];
    if (!profile) return fail(res, 400, '请先完善校友信息');
    if ((profile.u_status || '') !== 'approved' && (profile.p_status || '') !== 'approved') {
      return fail(res, 403, '校友档案尚未通过确认');
    }
    const has = await dbQuery('select * from public.alumni_cards where user_id = $1', [req.user.id]);
    if (has.rows.length > 0) {
      return ok(res, { card: has.rows[0], message: '已领取过校友卡' });
    }
    const gradYear = parsePositiveInt(profile.graduation_year);
    let cardNo = '';
    let tries = 0;
    while (tries < 50) {
      const cand = String(2021) + String(gradYear) + String(crypto.randomInt(100000, 1000000));
      const dup = await dbQuery('select id from public.alumni_cards where card_no = $1', [cand]);
      if (dup.rows.length === 0) { cardNo = cand; break; }
      tries++;
    }
    if (!cardNo) return fail(res, 500, '卡号生成失败，请重试');
    const ins = await dbQuery(
      `insert into public.alumni_cards (user_id, card_no, status)
       values ($1, $2, 'active') returning *`,
      [req.user.id, cardNo]
    );
    return ok(res, { card: ins.rows[0] });
  } catch (e) {
    return fail(res, 500, '领取失败', { error: e.message });
  }
});

// 更新电子卡（所在地支持手动修改等）
app.put('/api/card/my', requireAuth, requireAlumni, async (req, res) => {
  try {
    const { address, class_name, avatar_url } = req.body || {};
    await dbQuery(
      `update public.alumni_profiles set address = coalesce($2, address), class_name = coalesce($3, class_name), avatar_url = coalesce($4, avatar_url) where user_id = $1`,
      [req.user.id, address, class_name, avatar_url]
    );
    return ok(res, { message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新失败', { error: e.message });
  }
});

// ============================================================
// 电子邮箱系统
// ============================================================

async function ensureMailTables() {
  await dbQuery(`
    create table if not exists public.alumni_mail_accounts (
      user_id bigint primary key references public.app_users(id) on delete cascade,
      mail_address text unique not null,
      display_name text not null,
      created_at timestamptz default now()
    )
  `);
  await dbQuery(`
    create table if not exists public.alumni_mails (
      id bigserial primary key,
      sender_user_id bigint references public.app_users(id) on delete set null,
      sender_address text not null,
      sender_name text not null,
      subject text not null default '',
      body text not null default '',
      priority smallint default 0,
      read_receipt boolean default false,
      sent_at timestamptz default now()
    )
  `);
  await dbQuery(`
    create table if not exists public.alumni_mail_recipients (
      id bigserial primary key,
      mail_id bigint not null references public.alumni_mails(id) on delete cascade,
      user_id bigint references public.app_users(id) on delete set null,
      address text not null,
      name text not null default '',
      kind text not null default 'to',
      is_read boolean default false,
      read_at timestamptz,
      unique (mail_id, address, kind)
    )
  `);
  await dbQuery(`
    create table if not exists public.alumni_contacts (
      id bigserial primary key,
      owner_user_id bigint not null references public.app_users(id) on delete cascade,
      name text not null,
      email text not null default '',
      phone text not null default '',
      group_name text not null default '未分组联系人',
      note text not null default '',
      created_at timestamptz default now()
    )
  `);
  await dbQuery('create index if not exists idx_mail_recv_mail on public.alumni_mail_recipients(mail_id)');
  await dbQuery('create index if not exists idx_mail_recv_user on public.alumni_mail_recipients(user_id)');
  await dbQuery('create index if not exists idx_mail_sender on public.alumni_mails(sender_user_id)');
  await dbQuery('create index if not exists idx_contacts_owner on public.alumni_contacts(owner_user_id)');
}

// 姓名 -> 拼音首字母（如 张文轩 -> zwx）
function nameInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (pinyin && typeof pinyin.pinyin === 'function') {
    try {
      const arr = pinyin.pinyin(s, { toneType: 'none', type: 'array' });
      if (arr && arr.length) {
        return arr.map((x) => String(x).charAt(0).toLowerCase()).join('');
      }
    } catch (e) {}
  }
  // 回退：常见姓氏首字母表
  const table = {
    '张': 'z', '王': 'w', '李': 'l', '赵': 'z', '刘': 'l', '陈': 'c', '杨': 'y', '黄': 'h',
    '周': 'z', '吴': 'w', '徐': 'x', '孙': 's', '胡': 'h', '朱': 'z', '高': 'g', '林': 'l',
    '何': 'h', '郭': 'g', '马': 'm', '罗': 'l', '梁': 'l', '宋': 's', '郑': 'z', '谢': 'x',
    '韩': 'h', '唐': 't', '冯': 'f', '于': 'y', '董': 'd', '萧': 'x', '程': 'c', '曹': 'c',
    '袁': 'y', '邓': 'd', '许': 'x', '傅': 'f', '沈': 's', '曾': 'z', '彭': 'p', '吕': 'l',
    '苏': 's', '卢': 'l', '蒋': 'j', '蔡': 'c', '贾': 'j', '丁': 'd', '魏': 'w', '薛': 'x',
    '叶': 'y', '阎': 'y', '余': 'y', '潘': 'p', '杜': 'd', '戴': 'd', '夏': 'x', '钟': 'z',
    '汪': 'w', '田': 't', '任': 'r', '姜': 'j', '范': 'f', '方': 'f', '石': 's', '姚': 'y',
    '谭': 't', '廖': 'l', '邹': 'z', '熊': 'x', '金': 'j', '陆': 'l', '郝': 'h', '孔': 'k',
    '白': 'b', '崔': 'c', '康': 'k', '毛': 'm', '邱': 'q', '秦': 'q', '江': 'j', '史': 's',
    '顾': 'g', '侯': 'h', '邵': 's', '孟': 'm', '龙': 'l', '万': 'w', '段': 'd', '雷': 'l',
    '钱': 'q', '汤': 't', '尹': 'y', '易': 'y', '常': 'c', '武': 'w', '乔': 'q', '贺': 'h',
    '赖': 'l', '龚': 'g', '文': 'w', '欧': 'o', '蓝': 'l', '关': 'g', '庞': 'p', '温': 'w'
  };
  const fallbackMap = { '文': 'w', '轩': 'x', '伟': 'w', '强': 'q', '军': 'j', '磊': 'l', '洋': 'y', '涛': 't', '明': 'm', '杰': 'j', '鹏': 'p', '华': 'h', '斌': 'b', '浩': 'h', '宇': 'y', '凯': 'k', '欣': 'x', '怡': 'y', '婷': 't', '静': 'j', '丽': 'l', '娜': 'n', '芳': 'f', '燕': 'y', '艳': 'y', '敏': 'm', '慧': 'h', '娟': 'j', '霞': 'x', '平': 'p', '刚': 'g', '勇': 'y', '超': 'c', '波': 'b', '峰': 'f', '帅': 's', '宁': 'n', '悦': 'y', '琪': 'q', '雪': 'x', '晶': 'j', '玲': 'l', '红': 'h', '梅': 'm', '兰': 'l', '凤': 'f', '阳': 'y', '光': 'g', '龙': 'l' };
  const out = [];
  for (const ch of s) {
    const lower = table[ch] || fallbackMap[ch] || '';
    out.push(lower);
  }
  return out.join('') || 'xy';
}

// 获取（或创建）校友邮箱账号
async function getOrCreateMailAccount(userId) {
  const me = await dbQuery(
    `select u.name as uname, p.name as pname, p.graduation_year
     from public.app_users u
     left join public.alumni_profiles p on p.user_id = u.id
     where u.id = $1`,
    [userId]
  );
  const row = me.rows[0];
  const display = (row && (row.pname || row.uname)) || '校友';
  const gradYear = row && row.graduation_year ? String(row.graduation_year) : '';
  const initials = nameInitials(display);
  const base = initials + (gradYear.length >= 2 ? gradYear.slice(-2) : '');
  const domain = '@xinhaigaoren.org.cn';
  let mailAddress = base + domain;
  const existing = await dbQuery('select id from public.alumni_mail_accounts where mail_address = $1', [mailAddress]);
  if (existing.rows.length > 0) {
    let i = 2;
    while (i < 100) {
      const cand = base + i + domain;
      const dup = await dbQuery('select id from public.alumni_mail_accounts where mail_address = $1', [cand]);
      if (dup.rows.length === 0) { mailAddress = cand; break; }
      i++;
    }
  }
  const r = await dbQuery(
    `insert into public.alumni_mail_accounts (user_id, mail_address, display_name)
     values ($1, $2, $3)
     on conflict (user_id) do update set display_name = excluded.display_name
     returning *`,
    [userId, mailAddress, display]
  );
  return r.rows[0];
}

// 解析收件人：校友邮箱 -> { address, user_id, name }；外部邮箱 -> { address, user_id: null, name: '' }
async function resolveMailRecipient(raw) {
  const addr = String(raw || '').trim().toLowerCase();
  if (!addr) return null;
  const r = await dbQuery(
    `select a.mail_address, a.display_name, a.user_id
     from public.alumni_mail_accounts a
     where lower(a.mail_address) = $1 limit 1`,
    [addr]
  );
  if (r.rows[0]) {
    return { address: r.rows[0].mail_address, user_id: r.rows[0].user_id, name: r.rows[0].display_name };
  }
  return { address: addr, user_id: null, name: '' };
}

// 我的邮箱账号（不存在则自动创建）
app.get('/api/mail/account', requireAuth, requireAlumni, async (req, res) => {
  try {
    const acc = await getOrCreateMailAccount(req.user.id);
    return ok(res, { account: acc });
  } catch (e) {
    return fail(res, 500, '获取邮箱账号失败', { error: e.message });
  }
});

// 收件箱
app.get('/api/mail/inbox', requireAuth, requireAlumni, async (req, res) => {
  try {
    const acc = await getOrCreateMailAccount(req.user.id);
    const r = await dbQuery(
      `select m.id, m.subject, m.body, m.sender_name, m.sender_address, m.sent_at,
              r.is_read, r.kind, r.user_id as recv_user_id
       from public.alumni_mail_recipients r
       join public.alumni_mails m on m.id = r.mail_id
       where r.user_id = $1 or lower(r.address) = lower($2)
       order by m.sent_at desc
       limit 200`,
      [req.user.id, acc.mail_address]
    );
    const unread = await dbQuery(
      `select count(*)::int as c from public.alumni_mail_recipients r
       join public.alumni_mails m on m.id = r.mail_id
       where (r.user_id = $1 or lower(r.address) = lower($2)) and r.is_read = false`,
      [req.user.id, acc.mail_address]
    );
    const mails = r.rows.map((x) => ({
      id: x.id,
      subject: x.subject,
      body: x.body,
      from: x.sender_name || x.sender_address,
      sender_address: x.sender_address,
      sent_at: x.sent_at,
      is_read: x.is_read
    }));
    return ok(res, { mails, unread_count: unread.rows[0] ? unread.rows[0].c : 0 });
  } catch (e) {
    return fail(res, 500, '加载收件箱失败', { error: e.message });
  }
});

// 已发送（含逐收件人已读聚合）
app.get('/api/mail/sent', requireAuth, requireAlumni, async (req, res) => {
  try {
    const r = await dbQuery(
      `select m.id, m.subject, m.body, m.sent_at, m.read_receipt,
              count(distinct r.id) filter (where r.kind = 'to') as to_count,
              count(distinct r.id) filter (where r.kind = 'to' and r.is_read) as read_count,
              string_agg(distinct case when r.kind = 'to' then (r.name || ' <' || r.address || '>') end, ', ') as to_display
       from public.alumni_mails m
       left join public.alumni_mail_recipients r on r.mail_id = m.id
       where m.sender_user_id = $1
       group by m.id
       order by m.sent_at desc
       limit 200`,
      [req.user.id]
    );
    const mails = r.rows.map((x) => ({
      id: x.id,
      subject: x.subject,
      sent_at: x.sent_at,
      read_receipt: x.read_receipt,
      to_count: parseInt(x.to_count || 0, 10),
      read_count: parseInt(x.read_count || 0, 10),
      to_display: x.to_display || ''
    }));
    return ok(res, { mails });
  } catch (e) {
    return fail(res, 500, '加载已发送失败', { error: e.message });
  }
});

// 未读数量
app.get('/api/mail/unread-count', requireAuth, requireAlumni, async (req, res) => {
  try {
    const acc = await getOrCreateMailAccount(req.user.id);
    const r = await dbQuery(
      `select count(*)::int as c from public.alumni_mail_recipients r
       join public.alumni_mails m on m.id = r.mail_id
       where (r.user_id = $1 or lower(r.address) = lower($2)) and r.is_read = false`,
      [req.user.id, acc.mail_address]
    );
    return ok(res, { unread_count: r.rows[0] ? r.rows[0].c : 0 });
  } catch (e) {
    return fail(res, 500, '获取未读数量失败', { error: e.message });
  }
});

// 发送邮件
app.post('/api/mail/send', requireAuth, requireAlumni, async (req, res) => {
  try {
    const { to, cc, subject, body, priority, read_receipt } = req.body || {};
    const toList = Array.isArray(to) ? to.filter(Boolean) : [];
    if (!toList.length) return fail(res, 400, '请填写收件人');
    const senderAcc = await getOrCreateMailAccount(req.user.id);
    const resolved = [];
    for (const raw of toList) {
      const r = await resolveMailRecipient(raw);
      if (r) resolved.push({ ...r, kind: 'to' });
    }
    if (!resolved.length) return fail(res, 400, '收件人地址无效');
    const ccList = Array.isArray(cc) ? cc.filter(Boolean) : [];
    for (const raw of ccList) {
      const r = await resolveMailRecipient(raw);
      if (r) resolved.push({ ...r, kind: 'cc' });
    }
    const ins = await dbQuery(
      `insert into public.alumni_mails (sender_user_id, sender_address, sender_name, subject, body, priority, read_receipt)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [req.user.id, senderAcc.mail_address, senderAcc.display_name, String(subject || ''), String(body || ''), parsePositiveInt(priority), !!read_receipt]
    );
    const mail = ins.rows[0];
    for (const item of resolved) {
      await dbQuery(
        `insert into public.alumni_mail_recipients (mail_id, user_id, address, name, kind)
         values ($1, $2, $3, $4, $5)`,
        [mail.id, item.user_id, item.address, item.name, item.kind]
      );
    }
    return ok(res, { mail_id: mail.id, message: '邮件已发送' });
  } catch (e) {
    return fail(res, 500, '发送失败', { error: e.message });
  }
});

// 邮件详情（收件人打开自动标已读）
app.get('/api/mail/:id', requireAuth, requireAlumni, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    if (!id) return fail(res, 400, '参数错误');
    const acc = await getOrCreateMailAccount(req.user.id);
    const m = await dbQuery('select * from public.alumni_mails where id = $1', [id]);
    if (!m.rows[0]) return fail(res, 404, '邮件不存在');
    const mail = m.rows[0];
    const isSender = Number(mail.sender_user_id) === Number(req.user.id);
    if (!isSender) {
      await dbQuery(
        `update public.alumni_mail_recipients set is_read = true, read_at = now()
         where mail_id = $1 and (user_id = $2 or lower(address) = lower($3))`,
        [id, req.user.id, acc.mail_address]
      ).catch(() => {});
    }
    const recv = await dbQuery(
      `select r.address, r.name, r.kind, r.is_read, r.read_at
       from public.alumni_mail_recipients r where r.mail_id = $1 order by r.id`,
      [id]
    );
    const to = recv.rows.filter((x) => x.kind === 'to');
    const cc = recv.rows.filter((x) => x.kind === 'cc');
    const readCount = to.filter((x) => x.is_read).length;
    return ok(res, {
      mail: {
        id: mail.id, subject: mail.subject, body: mail.body,
        sender_name: mail.sender_name, sender_address: mail.sender_address,
        sent_at: mail.sent_at, read_receipt: mail.read_receipt
      },
      is_sender: isSender,
      to_count: to.length,
      read_count: readCount,
      to: to.map((x) => ({ name: x.name || '', address: x.address })),
      cc: cc.map((x) => ({ name: x.name || '', address: x.address })),
      recipients: to.map((x) => ({ name: x.name || '', address: x.address, is_read: x.is_read, read_at: x.read_at }))
    });
  } catch (e) {
    return fail(res, 500, '加载邮件失败', { error: e.message });
  }
});

// 删除邮件（发件人删整封 / 收件人删本人记录）
app.delete('/api/mail/:id/delete', requireAuth, requireAlumni, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    if (!id) return fail(res, 400, '参数错误');
    const acc = await getOrCreateMailAccount(req.user.id);
    const m = await dbQuery('select * from public.alumni_mails where id = $1', [id]);
    if (!m.rows[0]) return fail(res, 404, '邮件不存在');
    const mail = m.rows[0];
    const isSender = Number(mail.sender_user_id) === Number(req.user.id);
    if (isSender) {
      await dbQuery('delete from public.alumni_mails where id = $1', [id]);
    } else {
      await dbQuery(
        `delete from public.alumni_mail_recipients where mail_id = $1 and (user_id = $2 or lower(address) = lower($3))`,
        [id, req.user.id, acc.mail_address]
      );
      const left = await dbQuery('select count(*)::int as c from public.alumni_mail_recipients where mail_id = $1', [id]);
      if (left.rows[0] && left.rows[0].c === 0) {
        await dbQuery('delete from public.alumni_mails where id = $1', [id]);
      }
    }
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除失败', { error: e.message });
  }
});

// 个人通讯录（分组 + 全部校友联系人）
app.get('/api/mail/contacts', requireAuth, requireAlumni, async (req, res) => {
  try {
    const personal = await dbQuery(
      `select id, name, email, phone, group_name from public.alumni_contacts where owner_user_id = $1 order by id`,
      [req.user.id]
    );
    const alumni = await dbQuery(
      `select a.display_name as name, a.mail_address as email, a.user_id,
              p.address as city, p.graduation_year
       from public.alumni_mail_accounts a
       left join public.alumni_profiles p on p.user_id = a.user_id
       where a.user_id <> $1
       order by a.display_name`,
      [req.user.id]
    );
    const groups = {};
    for (const c of personal.rows) {
      const g = c.group_name || '未分组联系人';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ id: c.id, name: c.name, email: c.email, phone: c.phone });
    }
    return ok(res, { personal: personal.rows, groups, alumni: alumni.rows });
  } catch (e) {
    return fail(res, 500, '加载通讯录失败', { error: e.message });
  }
});

// 新增联系人
app.post('/api/mail/contacts', requireAuth, requireAlumni, async (req, res) => {
  try {
    const { name, email, phone, group_name, note } = req.body || {};
    if (!name) return fail(res, 400, '请填写联系人姓名');
    const r = await dbQuery(
      `insert into public.alumni_contacts (owner_user_id, name, email, phone, group_name, note)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [req.user.id, String(name).trim(), String(email || '').trim(), String(phone || '').trim(), String(group_name || '未分组联系人'), String(note || '')]
    );
    return ok(res, { contact: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '保存失败', { error: e.message });
  }
});

// 删除联系人
app.delete('/api/mail/contacts/:id', requireAuth, requireAlumni, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    await dbQuery('delete from public.alumni_contacts where id = $1 and owner_user_id = $2', [id, req.user.id]);
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除失败', { error: e.message });
  }
});

// ============================================================
// 站内内容 / 新闻 / 活动 / 校友名录（保留原有功能）
// ============================================================

// 通用内容页（站点 sections）
app.get('/api/site/:key', async (req, res) => {
  try {
    const r = await dbQuery('select * from public.site_sections where key = $1 limit 1', [req.params.key]);
    return ok(res, { section: r.rows[0] || null });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 访问统计
app.post('/api/visit', async (req, res) => {
  try {
    const { page } = req.body || {};
    if (!page) return ok(res, {});
    await dbQuery(
      `insert into public.page_visits (page, visited_at) values ($1, now())`,
      [String(page).slice(0, 200)]
    ).catch(() => {});
    return ok(res, { message: 'ok' });
  } catch (e) {
    return ok(res, {});
  }
});

// 获取访问统计
app.get('/api/visits', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select page, count(*)::int as cnt, max(visited_at) as last_visit
       from public.page_visits group by page order by cnt desc limit 100`
    );
    return ok(res, { visits: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 内容表初始化
async function ensureContentTables() {
  await dbQuery(`
    create table if not exists public.site_sections (
      id serial primary key,
      key text unique not null,
      title text not null default '',
      content text not null default '',
      updated_at timestamptz default now()
    )
  `);
}

async function ensureUserTableExtras() {
  await dbQuery(
    'alter table public.app_users add column if not exists display_name text'
  ).catch(() => {});
  await dbQuery(
    'alter table public.app_users add column if not exists status text not null default \'pending\''
  ).catch(() => {});
  await dbQuery(
    'alter table public.app_users add column if not exists approved_at timestamptz'
  ).catch(() => {});
}

async function ensureAlumniProfileExtras() {
  await dbQuery('alter table public.alumni_profiles add column if not exists class_name text').catch(() => {});
  await dbQuery('alter table public.alumni_profiles add column if not exists avatar_url text').catch(() => {});
  await dbQuery('alter table public.alumni_profiles add column if not exists status text not null default \'pending\'').catch(() => {});
}

async function ensurePasswordResetTable() {
  await dbQuery(`
    create table if not exists public.password_reset_requests (
      id serial primary key,
      user_id bigint not null references public.app_users(id) on delete cascade,
      requested_at timestamptz default now(),
      status text not null default 'pending',
      handled_at timestamptz
    )
  `);
}

async function ensureResetTables() {
  await dbQuery(`
    create table if not exists public.reset_tickets (
      id serial primary key,
      user_id bigint references public.app_users(id) on delete cascade,
      username text not null,
      contact text not null default '',
      reason text not null default '',
      status text not null default 'pending',
      reset_code text not null default '',
      reviewer_id bigint,
      reject_reason text not null default '',
      created_at timestamptz default now(),
      reviewed_at timestamptz
    )
  `);
}

async function ensureAdminSecurityTables() {
  await dbQuery(`
    create table if not exists public.admin_actions (
      id serial primary key,
      admin_id bigint not null default 0,
      action text not null,
      detail text not null default '',
      created_at timestamptz default now()
    )
  `);
}

async function ensureMainAdminPwd() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const r = await dbQuery(
    `select id from public.app_users where username = $1`,
    [ADMIN_USER]
  );
  if (r.rows.length === 0) {
    await dbQuery(
      `insert into public.app_users (username, password_hash, name, phone, email, role, status)
       values ($1, $2, '主管理员', '', '', 'super_admin', 'approved')
       on conflict (username) do nothing`,
      [ADMIN_USER, hash]
    ).catch(() => {});
  }
}

async function ensurePhase2Tables() {
  await dbQuery(`
    create table if not exists public.news (
      id serial primary key,
      title text not null,
      summary text not null default '',
      content text not null default '',
      cover text not null default '',
      category text not null default '',
      published_at timestamptz default now(),
      views int not null default 0
    )
  `);
  await dbQuery(`
    create table if not exists public.events (
      id serial primary key,
      title text not null,
      summary text not null default '',
      content text not null default '',
      location text not null default '',
      start_time timestamptz,
      end_time timestamptz,
      status text not null default 'upcoming',
      views int not null default 0
    )
  `);
  await dbQuery(`
    create table if not exists public.jobs (
      id serial primary key,
      title text not null,
      company text not null default '',
      location text not null default '',
      salary text not null default '',
      description text not null default '',
      contact text not null default '',
      published_at timestamptz default now()
    )
  `);
  await dbQuery(`
    create table if not exists public.alumni_directory (
      id serial primary key,
      name text not null,
      graduation_year int,
      grade text not null default '',
      university text not null default '',
      company text not null default '',
      location text not null default '',
      industry text not null default ''
    )
  `);
}

async function ensureSitePagesSeed() {
  const pages = [
    { key: 'about', title: '校友会介绍', content: '' },
    { key: 'contact', title: '联系我们', content: '' },
    { key: 'privacy', title: '隐私政策', content: '' },
    { key: 'terms', title: '使用条款', content: '' }
  ];
  for (const p of pages) {
    await dbQuery(
      `insert into public.site_sections (key, title, content)
       values ($1, $2, $3) on conflict (key) do nothing`,
      [p.key, p.title, p.content]
    ).catch(() => {});
  }
}

async function ensureSiteSectionsSeed() {
  const sections = [
    { key: 'home-intro', title: '首页介绍', content: '' },
    { key: 'news-intro', title: '新闻动态', content: '' }
  ];
  for (const s of sections) {
    await dbQuery(
      `insert into public.site_sections (key, title, content)
       values ($1, $2, $3) on conflict (key) do nothing`,
      [s.key, s.title, s.content]
    ).catch(() => {});
  }
}

async function ensurePhase3Tables() {
  await dbQuery(`
    create table if not exists public.alumni_cards (
      id serial primary key,
      user_id bigint unique not null references public.app_users(id) on delete cascade,
      card_no text unique not null,
      status text not null default 'active',
      created_at timestamptz default now()
    )
  `);
  await dbQuery(`
    create table if not exists public.favorites (
      id serial primary key,
      user_id bigint not null references public.app_users(id) on delete cascade,
      service_key text not null,
      created_at timestamptz default now(),
      unique (user_id, service_key)
    )
  `);
  await dbQuery(`
    create table if not exists public.page_visits (
      id serial primary key,
      page text not null,
      visited_at timestamptz default now()
    )
  `);
}

async function ensureZhangSuperAdmin() {
  const hash = await bcrypt.hash('zwxxhgr2024', 10);
  await dbQuery(
    `insert into public.app_users (username, password_hash, name, phone, email, role, status)
     values ('zwxzhangwenxuan', $1, '张文轩', '18545372006', 'zwxzwx861@qq.com', 'alumni', 'approved')
     on conflict (username) do nothing`,
    [hash]
  ).catch(() => {});
  await dbQuery(
    `insert into public.alumni_profiles (user_id, name, phone, email, grade, graduation_year, address, status)
     select id, '张文轩', '18545372006', 'zwxzwx861@qq.com', '2021', 2024, '哈尔滨', 'approved'
     from public.app_users where username = 'zwxzhangwenxuan'
     on conflict (user_id) do nothing`
  ).catch(() => {});
}

async function ensureBrandRename() {
  await dbQuery(`update public.site_sections set title = '校友会介绍' where key = 'about'`).catch(() => {});
}

async function ensureAlumniRoleSync() {
  await dbQuery(`update public.app_users set role = 'alumni' where role = 'user'`).catch(() => {});
}

async function ensureHomeRename() {
  await dbQuery(`update public.site_sections set title = '首页介绍' where key = 'home-intro'`).catch(() => {});
}

// ============================================================
// 审批 / 重置相关（保留）
// ============================================================

app.post('/api/password/reset/request', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return fail(res, 400, '请输入用户名');
    const r = await dbQuery(
      `select id from public.app_users where username = $1 or phone = $1 or email = $1 limit 1`,
      [String(username).trim()]
    );
    if (!r.rows[0]) return fail(res, 404, '用户不存在');
    await dbQuery(
      `insert into public.password_reset_requests (user_id) values ($1)`,
      [r.rows[0].id]
    ).catch(() => {});
    return ok(res, { message: '申请已提交，请联系管理员处理' });
  } catch (e) {
    return fail(res, 500, '申请失败', { error: e.message });
  }
});

app.get('/api/admin/reset/pending', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select t.*, u.name, u.phone, u.email
       from public.reset_tickets t
       left join public.app_users u on u.id = t.user_id
       where t.status = 'pending'
       order by t.created_at desc`
    );
    return ok(res, { tickets: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

app.post('/api/admin/reset/tickets/:id/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const reason = String(req.body?.reason || '资料核实通过').trim();
    const resetCode = randomCode(8);
    const r = await dbQuery(
      `update public.reset_tickets set status='approved', reviewer_id=$1, reset_code=$2, reviewed_at=now()
       where id=$3 returning *`,
      [req.user.admin_id ?? req.user.id, resetCode, id]
    );
    if (!r.rows[0]) return fail(res, 404, '工单不存在');
    await dbQuery(
      `insert into public.notifications (user_id, title, content, link)
       values ($1,'密码重置已通过','您的密码重置申请已通过，重置码：${resetCode}（10 分钟内有效）','account.html')`,
      [r.rows[0].user_id]
    ).catch(() => {});
    return ok(res, { message: '已通过', reset_code: resetCode });
  } catch (e) {
    return fail(res, 500, '审核失败', { error: e.message });
  }
});

app.post('/api/admin/reset/tickets/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const reason = String(req.body?.reason || '资料不符').trim();
    const r = await dbQuery(
      `update public.reset_tickets set status='rejected', reviewer_id=$1, reject_reason=$2, reviewed_at=now()
       where id=$3 returning *`,
      [req.user.admin_id ?? req.user.id, reason, id]
    );
    if (!r.rows[0]) return fail(res, 404, '工单不存在');
    await dbQuery(
      `insert into public.notifications (user_id, title, content)
       values ($1,'密码重置申请被拒绝','您的密码重置申请已被拒绝：$2。如有疑问请联系管理员。','account.html')`,
      [r.rows[0].user_id, reason]
    ).catch(() => {});
    return ok(res, { message: '已拒绝该申请' });
  } catch (e) {
    return fail(res, 500, '审核失败', { error: e.message });
  }
});

// 通知
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select * from public.notifications where user_id = $1 order by created_at desc limit 50`,
      [req.user.id]
    );
    return ok(res, { notifications: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 收藏列表
app.get('/api/favorites', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select service_key from public.favorites where user_id = $1`,
      [req.user.id]
    );
    return ok(res, { favorites: r.rows.map((x) => x.service_key) });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 新增收藏
app.post('/api/favorites', requireAuth, async (req, res) => {
  try {
    const { service_key } = req.body || {};
    if (!service_key) return fail(res, 400, '参数错误');
    await dbQuery(
      `insert into public.favorites (user_id, service_key) values ($1, $2)
       on conflict (user_id, service_key) do nothing`,
      [req.user.id, String(service_key).slice(0, 50)]
    );
    return ok(res, { message: '已收藏' });
  } catch (e) {
    return fail(res, 500, '操作失败', { error: e.message });
  }
});

// 取消收藏
app.delete('/api/favorites/:key', requireAuth, async (req, res) => {
  try {
    await dbQuery('delete from public.favorites where user_id = $1 and service_key = $2', [req.user.id, req.params.key]);
    return ok(res, { message: '已取消收藏' });
  } catch (e) {
    return fail(res, 500, '操作失败', { error: e.message });
  }
});

// 新闻
app.get('/api/news', async (req, res) => {
  try {
    const r = await dbQuery('select id, title, summary, cover, category, published_at, views from public.news order by published_at desc limit 50');
    return ok(res, { news: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

app.get('/api/news/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery('select * from public.news where id = $1', [id]);
    if (!r.rows[0]) return fail(res, 404, '新闻不存在');
    await dbQuery('update public.news set views = views + 1 where id = $1', [id]).catch(() => {});
    return ok(res, { news: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 活动
app.get('/api/events', async (req, res) => {
  try {
    const r = await dbQuery('select id, title, summary, location, start_time, end_time, status, views from public.events order by start_time desc limit 50');
    return ok(res, { events: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery('select * from public.events where id = $1', [id]);
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    await dbQuery('update public.events set views = views + 1 where id = $1', [id]).catch(() => {});
    return ok(res, { events: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 校友名录
app.get('/api/directory', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const cond = q ? ' where name ilike $1 or university ilike $1 or company ilike $1 or location ilike $1 or industry ilike $1' : '';
    const params = q ? [`%${q}%`] : [];
    const r = await dbQuery(`select * from public.alumni_directory ${cond} order by graduation_year desc nulls last limit 200`, params);
    return ok(res, { directory: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

// 内容页管理（后台）
app.get('/api/admin/sections', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await dbQuery('select * from public.site_sections order by id');
    return ok(res, { sections: r.rows });
  } catch (e) {
    return fail(res, 500, '获取失败', { error: e.message });
  }
});

app.put('/api/admin/sections/:key', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { title, content } = req.body || {};
    await dbQuery(
      `update public.site_sections set title = coalesce($2, title), content = coalesce($3, content), updated_at = now()
       where key = $1`,
      [req.params.key, title, content]
    );
    return ok(res, { message: '已保存' });
  } catch (e) {
    return fail(res, 500, '保存失败', { error: e.message });
  }
});

// 兜底 404
app.use((req, res) => {
  fail(res, 404, '接口不存在');
});

bootstrapSchema()
  .then(() => ensureZhangSuperAdmin())
  .then(() => ensureContentTables())
  .then(() => ensureUserTableExtras())
  .then(() => ensurePasswordResetTable())
  .then(() => ensureAlumniProfileExtras())
  .then(() => ensureResetTables())
  .then(() => ensureAdminSecurityTables())
  .then(() => ensureMainAdminPwd())
  .then(() => ensurePhase2Tables())
  .then(() => ensureSitePagesSeed())
  .then(() => ensureSiteSectionsSeed())
  .then(() => ensurePhase3Tables())
  .then(() => ensureMailTables())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`hailin alumni backend running on http://localhost:${PORT}`);
      // 内容改名/邮箱等迁移放后台执行，不阻塞启动，加快冷启动响应
      Promise.allSettled([
        ensureZhangSuperAdmin(),
        ensureBrandRename(),
        ensureAlumniRoleSync(),
        ensureHomeRename()
      ]).catch(() => {});
    });
  })
  .catch((e) => {
    console.error('startup failed:', e);
    app.listen(PORT, () => {
      console.log(`hailin alumni backend running without database init on http://localhost:${PORT}`);
    });
  });

async function bootstrapSchema() {
  await dbQuery(`create table if not exists public.app_users (
    id serial primary key,
    username text unique not null,
    password_hash text not null,
    name text not null default '',
    phone text not null default '',
    email text not null default '',
    role text not null default 'alumni',
    status text not null default 'pending',
    created_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.alumni_profiles (
    id serial primary key,
    user_id bigint unique not null references public.app_users(id) on delete cascade,
    name text not null default '',
    phone text not null default '',
    email text not null default '',
    grade text not null default '',
    graduation_year int,
    address text not null default '',
    class_name text not null default '',
    avatar_url text not null default '',
    status text not null default 'pending',
    created_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.notifications (
    id serial primary key,
    user_id bigint not null references public.app_users(id) on delete cascade,
    title text not null default '',
    content text not null default '',
    link text not null default '',
    is_read boolean not null default false,
    created_at timestamptz default now()
  )`);
}
