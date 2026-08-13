const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
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

async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL 未配置');
  return pool.query(text, params);
}

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

function makeInviteCode() {
  return crypto.randomBytes(24).toString('hex');
}

function makeInviteLink(code) {
  return `${PUBLIC_SITE_URL}/admin/?invite=${encodeURIComponent(code)}`;
}

function makeRandomPassword(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function requireStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw new Error('密码至少 8 位');
  return value;
}

function normalizePermissions(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function bootstrapSchema() {
  if (!pool) return;
  const schemaFile = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaFile)) return;
  await dbQuery(fs.readFileSync(schemaFile, 'utf8'));
}

async function ensureRootAdmin() {
  if (!pool) return;
  await dbQuery(
    `insert into public.app_users (phone, display_name, role, status, is_phone_verified)
     values ($1, $2, 'super_admin', 'active', true)
     on conflict (phone) do update set role='super_admin', status='active', updated_at=now()
     returning id`,
    ['ROOT_ADMIN', '主管理员']
  );
  const user = await dbQuery(`select id from public.app_users where phone=$1 limit 1`, ['ROOT_ADMIN']);
  if (user.rows[0]) {
    await dbQuery(
      `insert into public.admin_accounts (user_id, admin_level, status, approved_at, note)
       values ($1, 'super_admin', 'approved', now(), '系统主管理员')
       on conflict (user_id) do update set admin_level='super_admin', status='approved', updated_at=now()`,
      [user.rows[0].id]
    );
  }
}

function signToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      admin_id: user.admin_id,
      display_name: user.display_name,
      role: user.role,
      admin_level: user.admin_level || null,
    },
    TOKEN_SECRET,
    { expiresIn: '7d' }
  );
}

function getBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = getBearer(req);
  if (!token) return fail(res, 401, '未登录');
  try {
    req.user = jwt.verify(token, TOKEN_SECRET);
    return next();
  } catch (e) {
    return fail(res, 401, '登录已过期，请重新登录');
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) return fail(res, 403, '需要管理员权限');
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') return fail(res, 403, '需要主管理员权限');
  return next();
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj[key] !== undefined) out[key] = obj[key];
  return out;
}

async function audit(req, action, targetType, targetId, detail = {}) {
  try {
    await dbQuery(
      `insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id, ip_address, user_agent, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user?.user_id || null,
        req.user?.role || null,
        action,
        targetType || null,
        targetId || null,
        req.ip,
        req.headers['user-agent'] || '',
        JSON.stringify(detail),
      ]
    );
  } catch (e) {
    console.warn('audit log failed:', e.message);
  }
}

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    if (pool) await dbQuery('select 1');
    return ok(res, { service: 'hailin-alumni-backend', message: '海林市高级中学校友（新海高人）后端接口运行中', database: pool ? 'connected' : 'not_configured' });
  } catch (e) {
    return fail(res, 500, '后端运行中，但数据库连接失败', { error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({ message: '接口不存在，请访问 /api/health' });
});

// 管理员登录：兼容旧后台：admin + ADMIN_PASSWORD
app.post(['/api/admin/login', '/api/login'], async (req, res) => {
  try {
    const { username, phone, password } = req.body || {};
    const loginName = (username || phone || '').trim();
    if (!loginName || !password) return fail(res, 400, '请输入账号和密码');

    await ensureRootAdmin();

    // 环境变量主管理员登录
    if (loginName === ADMIN_USER && password === ADMIN_PASSWORD) {
      const r = await dbQuery(
        `select u.id as user_id, u.display_name, u.role, a.id as admin_id, a.admin_level
         from public.app_users u
         join public.admin_accounts a on a.user_id=u.id
         where u.phone='ROOT_ADMIN'
         limit 1`
      );
      const user = r.rows[0] || { user_id: null, admin_id: null, display_name: '主管理员', role: 'super_admin', admin_level: 'super_admin' };
      const token = signToken(user);
      await audit({ ...req, user }, 'admin_login', 'admin_account', user.admin_id, { loginName });
      return ok(res, { token, user: { name: user.display_name, role: user.role, admin_level: user.admin_level } });
    }

    // 数据库管理员登录：后面可给每个管理员设置 password_hash
    const r = await dbQuery(
      `select u.id as user_id, u.display_name, u.phone, u.role, u.status, u.password_hash,
              a.id as admin_id, a.admin_level, a.status as admin_status
       from public.app_users u
       join public.admin_accounts a on a.user_id=u.id
       where u.phone=$1 or u.email=$1
       order by (u.email is not null) desc, (u.password_hash is not null) desc, u.id asc`,
      [loginName]
    );
    let user = null;
    for (const row of r.rows) {
      if (!row.password_hash) continue;
      if (row.status !== 'active' || row.admin_status !== 'approved') continue;
      if (await bcrypt.compare(password, row.password_hash)) { user = row; break; }
    }
    if (!user) return fail(res, 401, '账号或密码错误');
    const token = signToken(user);
    await audit({ ...req, user }, 'admin_login', 'admin_account', user.admin_id, { loginName });
    return ok(res, { token, user: { name: user.display_name, role: user.role, admin_level: user.admin_level } });
  } catch (e) {
    console.error(e);
    return fail(res, 500, '登录失败', { error: e.message });
  }
});

app.get('/api/admin/me', requireAuth, requireAdmin, async (req, res) => {
  return ok(res, { user: req.user });
});


// 免费邮箱账号：不发短信、不接付费邮件。注册后仍需管理员审核认证才能进入通讯录。
app.post(['/api/auth/register', '/api/alumni/register'], async (req, res) => {
  try {
    const b = req.body || {};
    const email = normalizeEmail(b.email);
    const password = b.password ? requireStrongPassword(b.password) : null;
    const name = String(b.name || b.display_name || '').trim();
    const phone = String(b.phone || '').trim() || null;
    if (!email || !email.includes('@')) return fail(res, 400, '请输入有效邮箱');
    if (!name) return fail(res, 400, '请输入姓名');
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const r = await dbQuery(
      `insert into public.app_users (email, phone, display_name, role, status, password_hash, is_email_verified)
       values ($1,$2,$3,'pending_alumni','pending',$4,false)
       on conflict (email) do update set display_name=excluded.display_name, phone=coalesce(excluded.phone, public.app_users.phone), password_hash=excluded.password_hash, updated_at=now()
       returning id, email, phone, display_name, role, status`,
      [email, phone, name, passwordHash]
    );
    return ok(res, { user: r.rows[0], message: '账号已创建，请继续提交校友认证资料，审核通过后可查看校友通讯录。' });
  } catch (e) {
    return fail(res, 500, '注册失败', { error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  return fail(res, 400, '密码登录已停用，请使用「邮箱/手机号 + 验证码」登录');
});

// 管理员本人资料和密码
app.patch('/api/admin/account/profile', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const displayName = String(b.display_name || b.name || '').trim();
    const email = normalizeEmail(b.email || '');
    const phone = String(b.phone || '').trim();
    if (!displayName) return fail(res, 400, '姓名不能为空');
    await dbQuery(
      `update public.app_users set display_name=$1, email=nullif($2,''), phone=nullif($3,''), updated_at=now() where id=$4`,
      [displayName, email, phone, req.user.user_id]
    );
    await dbQuery(
      `update public.admin_accounts set title=$1, department=$2, province=$3, city=$4, note=$5, updated_at=now() where id=$6`,
      [b.title || null, b.department || null, b.province || null, b.city || null, b.note || null, req.user.admin_id]
    );
    await audit(req, 'admin_profile_update', 'admin_account', req.user.admin_id, {});
    return ok(res, { message: '个人信息已保存' });
  } catch (e) {
    return fail(res, 500, '保存个人信息失败', { error: e.message });
  }
});

app.post('/api/admin/account/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const password = requireStrongPassword(req.body?.password);
    const oldPassword = String(req.body?.old_password || '');
    const r = await dbQuery(`select password_hash from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    const oldHash = r.rows[0]?.password_hash;
    if (oldHash && oldPassword) {
      const matched = await bcrypt.compare(oldPassword, oldHash);
      if (!matched) return fail(res, 401, '原密码不正确');
    }
    const hash = await bcrypt.hash(password, 10);
    await dbQuery(`update public.app_users set password_hash=$1, updated_at=now() where id=$2`, [hash, req.user.user_id]);
    await dbQuery(`update public.admin_accounts set last_password_changed_at=now(), updated_at=now() where id=$1`, [req.user.admin_id]).catch(() => {});
    await audit(req, 'admin_password_change', 'admin_account', req.user.admin_id, {});
    return ok(res, { message: '密码已修改，下次登录请使用新密码' });
  } catch (e) {
    return fail(res, 500, '修改密码失败', { error: e.message });
  }
});

app.get('/api/admin/accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select a.id as admin_id, a.admin_level, a.status as admin_status, a.title, a.department, a.province, a.city, a.permissions, a.note,
              u.id as user_id, u.display_name, u.email, u.phone, u.role, u.status as user_status, u.created_at, u.updated_at
       from public.admin_accounts a
       join public.app_users u on u.id=a.user_id
       order by case when a.admin_level='super_admin' then 0 else 1 end, u.created_at asc`
    );
    return ok(res, { admins: r.rows });
  } catch (e) {
    return fail(res, 500, '获取管理员列表失败', { error: e.message });
  }
});

app.patch('/api/admin/accounts/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const allowedLevels = ['admin', 'editor', 'reviewer', 'viewer', 'super_admin'];
    const allowedStatus = ['approved', 'disabled', 'pending'];
    if (b.admin_level && !allowedLevels.includes(b.admin_level)) return fail(res, 400, '管理员级别不正确');
    if (b.status && !allowedStatus.includes(b.status)) return fail(res, 400, '管理员状态不正确');
    const r = await dbQuery(
      `update public.admin_accounts
       set admin_level=coalesce($1, admin_level), status=coalesce($2, status), permissions=coalesce($3, permissions), note=coalesce($4, note), updated_at=now()
       where id=$5 returning *`,
      [b.admin_level || null, b.status || null, b.permissions ? JSON.stringify(b.permissions) : null, b.note || null, id]
    );
    if (!r.rows[0]) return fail(res, 404, '管理员不存在');
    await audit(req, 'admin_account_update', 'admin_account', id, b);
    return ok(res, { admin: r.rows[0], message: '管理员权限已更新' });
  } catch (e) {
    return fail(res, 500, '更新管理员失败', { error: e.message });
  }
});

// 校友认证提交：兼容旧 /api/applications
app.post(['/api/alumni/verify', '/api/applications'], async (req, res) => {
  try {
    const b = req.body || {};
    const applicantType = b.applicant_type || b.applicantType || b.type || 'graduated_alumni';
    const name = b.name || b.real_name || b.realName;
    const phone = b.phone || b.mobile;
    if (!name || !phone) return fail(res, 400, '姓名和手机号不能为空');

    const row = {
      applicant_type: applicantType,
      name,
      phone,
      gender: b.gender || null,
      id_tail: b.id_tail || b.idTail || null,
      province: b.province || null,
      city: b.city || null,
      county: b.county || null,
      current_province: b.current_province || b.currentProvince || null,
      current_city: b.current_city || b.currentCity || null,
      current_county: b.current_county || b.currentCounty || null,
      graduation_year: b.graduation_year || b.graduationYear || null,
      enrollment_year: b.enrollment_year || b.enrollmentYear || null,
      class_name: b.class_name || b.className || b.class || null,
      homeroom_teacher: b.homeroom_teacher || b.teacher || b.classTeacher || null,
      school_year: b.school_year || b.schoolYear || null,
      current_school: b.current_school || b.currentSchool || b.school || null,
      university_graduated: b.university_graduated || b.universityGraduated || b.university || null,
      chsi_proof_url: b.chsi_proof_url || b.chsiProofUrl || null,
      student_card_url: b.student_card_url || b.studentCardUrl || null,
      admission_notice_url: b.admission_notice_url || b.admissionNoticeUrl || null,
      extra_materials: JSON.stringify(b.extra_materials || b.extraMaterials || []),
      consent_personal_info: Boolean(b.consent_personal_info ?? b.consentPersonalInfo ?? true),
      consent_material_review: Boolean(b.consent_material_review ?? b.consentMaterialReview ?? true),
    };

    const r = await dbQuery(
      `insert into public.alumni_verifications
       (applicant_type,name,phone,gender,id_tail,province,city,county,current_province,current_city,current_county,
        graduation_year,class_name,homeroom_teacher,school_year,current_school,university_graduated,
        chsi_proof_url,student_card_url,admission_notice_url,extra_materials,consent_personal_info,consent_material_review,enrollment_year)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       returning *`,
      [
        row.applicant_type,row.name,row.phone,row.gender,row.id_tail,row.province,row.city,row.county,row.current_province,row.current_city,row.current_county,
        row.graduation_year,row.class_name,row.homeroom_teacher,row.school_year,row.current_school,row.university_graduated,
        row.chsi_proof_url,row.student_card_url,row.admission_notice_url,row.extra_materials,row.consent_personal_info,row.consent_material_review,row.enrollment_year
      ]
    );
    return ok(res, { application: r.rows[0], verification: r.rows[0], message: '校友认证资料已提交，等待审核' });
  } catch (e) {
    console.error(e);
    return fail(res, 500, '提交失败', { error: e.message });
  }
});

app.get(['/api/applications', '/api/admin/applications', '/api/admin/alumni/verifications'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = `where status=$1`; }
    const r = await dbQuery(
      `select * from public.alumni_verifications ${where} order by created_at desc limit 500`,
      params
    );
    return ok(res, { applications: r.rows, verifications: r.rows, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取认证列表失败', { error: e.message });
  }
});

app.patch(['/api/applications/:id/status', '/api/admin/applications/:id/status', '/api/admin/alumni/verifications/:id/review'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const status = req.body.status || req.body.action;
    const rejectReason = req.body.reject_reason || req.body.rejectReason || null;
    if (!['approved', 'rejected', 'need_more_info', 'pending'].includes(status)) return fail(res, 400, '审核状态不正确');

    const updated = await dbQuery(
      `update public.alumni_verifications
       set status=$1, reject_reason=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now()
       where id=$4
       returning *`,
      [status, rejectReason, req.user.admin_id, id]
    );
    if (!updated.rows[0]) return fail(res, 404, '认证记录不存在');

    // 通过后自动生成/更新校友用户和校友档案
    if (status === 'approved') {
      const v = updated.rows[0];
      const u = await dbQuery(
        `insert into public.app_users (phone, display_name, role, status, is_phone_verified)
         values ($1,$2,'alumni','active',false)
         on conflict (phone) do update set display_name=excluded.display_name, role='alumni', status='active', updated_at=now()
         returning id`,
        [v.phone, v.name]
      );
      const userId = u.rows[0].id;
      // 同步把同手机号的邮箱注册行也提升为已认证校友：保证「邮箱+密码」可登录、可自助重置密码
      await dbQuery(
        `update public.app_users set role='alumni', status='active', updated_at=now() where phone=$1`,
        [v.phone]
      ).catch(() => {});
      await dbQuery(
        `insert into public.alumni_profiles
         (user_id, verification_id, name, phone, province, city, county, current_province, current_city, current_county,
          graduation_year, class_name, homeroom_teacher, enrollment_year)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (user_id) do update set
          verification_id=excluded.verification_id, name=excluded.name, province=excluded.province, city=excluded.city, county=excluded.county,
          current_province=excluded.current_province, current_city=excluded.current_city, current_county=excluded.current_county,
          graduation_year=excluded.graduation_year, class_name=excluded.class_name, homeroom_teacher=excluded.homeroom_teacher, enrollment_year=excluded.enrollment_year,
          status='active', updated_at=now()`,
        [userId, v.id, v.name, v.phone, v.province, v.city, v.county, v.current_province, v.current_city, v.current_county, v.graduation_year, v.class_name, v.homeroom_teacher, v.enrollment_year]
      );
    }

    await audit(req, `alumni_verification_${status}`, 'alumni_verification', id, { rejectReason });
    return ok(res, { application: updated.rows[0], verification: updated.rows[0] });
  } catch (e) {
    console.error(e);
    return fail(res, 500, '审核失败', { error: e.message });
  }
});

// 实时读取数据库中的最新角色：认证通过后无需重新登录即可解锁会员模块
async function currentRole(req) {
  if (!req.user || !req.user.user_id) return req.user ? (req.user.role || null) : null;
  try {
    const r = await dbQuery(`select role from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    return r.rows[0] ? r.rows[0].role : (req.user.role || null);
  } catch (e) {
    return req.user.role || null;
  }
}

// 校友通讯录：已认证校友和管理员可看
app.get('/api/alumni/directory', requireAuth, async (req, res) => {
  try {
    const role = await currentRole(req);
    if (!['alumni', 'admin', 'super_admin'].includes(role)) return fail(res, 403, '完成校友认证后才可查看通讯录');
    const { province, city, county, year, q } = req.query;
    const params = [];
    const wheres = [`p.status='active'`];
    if (province) { params.push(province); wheres.push(`p.province=$${params.length}`); }
    if (city) { params.push(city); wheres.push(`p.city=$${params.length}`); }
    if (county) { params.push(county); wheres.push(`p.county=$${params.length}`); }
    if (year) { params.push(Number(year)); wheres.push(`p.graduation_year=$${params.length}`); }
    if (q) { params.push(`%${q}%`); wheres.push(`(p.name ilike $${params.length} or p.class_name ilike $${params.length} or p.company ilike $${params.length})`); }
    const r = await dbQuery(
      `select p.id,p.user_id,p.name,p.province,p.city,p.county,p.current_province,p.current_city,p.current_county,p.graduation_year,p.enrollment_year,p.class_name,p.homeroom_teacher,p.industry,p.company,p.position_title,p.bio,
              case when p.public_contact then p.phone else null end as phone,
              case when p.public_contact then u.email else null end as email
       from public.alumni_profiles p
       left join public.app_users u on u.id = p.user_id
       where ${wheres.join(' and ')}
       order by graduation_year desc nulls last, name asc
       limit 500`,
      params
    );
    return ok(res, { alumni: r.rows });
  } catch (e) {
    return fail(res, 500, '获取校友通讯录失败', { error: e.message });
  }
});

// 官网内容公开读取
app.get('/api/site/pages', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const r = await dbQuery(`select * from public.site_pages where is_public=true order by sort_order asc, created_at asc`);
    return ok(res, { pages: r.rows });
  } catch (e) {
    return fail(res, 500, '获取页面失败', { error: e.message });
  }
});

app.get('/api/site/sections', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const page = req.query.page;
    const params = [];
    let where = '';
    if (page) { params.push(page); where = 'where page_slug=$1'; }
    const r = await dbQuery(`select * from public.site_sections ${where} order by display_order asc, created_at asc`, params);
    return ok(res, { sections: r.rows });
  } catch (e) {
    return fail(res, 500, '获取内容区块失败', { error: e.message });
  }
});


// 官网页面完整读取，例如 /api/site/home
app.get('/api/site/:slug', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const { slug } = req.params;
    const pageResult = await dbQuery(
      `select slug, title, description, current_content, sort_order
       from public.site_pages
       where slug=$1 and is_public=true
       limit 1`,
      [slug]
    );
    if (!pageResult.rows[0]) return fail(res, 404, '页面不存在');

    const sectionsResult = await dbQuery(
      `select section_key, section_name, content, display_order
       from public.site_sections
       where page_slug=$1
       order by display_order asc, created_at asc`,
      [slug]
    );

    return ok(res, {
      page: pageResult.rows[0],
      sections: sectionsResult.rows
    });
  } catch (e) {
    return fail(res, 500, '获取页面内容失败', { error: e.message });
  }
});

// 管理员编辑内容：主管理员直接发布，普通管理员提交审批
app.post('/api/admin/content/sections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { page_slug, section_key, section_name, content, display_order } = req.body || {};
    if (!page_slug || !section_key || !section_name) return fail(res, 400, '页面、区块标识、区块名称不能为空');

    if (req.user.role === 'super_admin') {
      const r = await dbQuery(
        `insert into public.site_sections (page_slug, section_key, section_name, content, display_order)
         values ($1,$2,$3,$4,$5)
         on conflict (section_key) do update set page_slug=excluded.page_slug, section_name=excluded.section_name, content=excluded.content, display_order=excluded.display_order, updated_at=now()
         returning *`,
        [page_slug, section_key, section_name, JSON.stringify(content || {}), display_order || 0]
      );
      await audit(req, 'content_publish_direct', 'site_section', r.rows[0].id, { section_key });
      return ok(res, { section: r.rows[0], message: '主管理员已直接发布' });
    }

    const r = await dbQuery(
      `insert into public.content_change_requests (target_type, page_slug, section_key, title, proposed_content, status, submitted_by_admin)
       values ('section',$1,$2,$3,$4,'pending',$5)
       returning *`,
      [page_slug, section_key, section_name, JSON.stringify({ page_slug, section_key, section_name, content: content || {}, display_order: display_order || 0 }), req.user.admin_id]
    );
    await audit(req, 'content_change_request_create', 'content_change_request', r.rows[0].id, { section_key });
    return ok(res, { request: r.rows[0], message: '已提交主管理员审批' });
  } catch (e) {
    return fail(res, 500, '提交内容修改失败', { error: e.message });
  }
});

app.get('/api/admin/content/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`select * from public.content_change_requests order by created_at desc limit 500`);
    return ok(res, { requests: r.rows });
  } catch (e) {
    return fail(res, 500, '获取内容审批列表失败', { error: e.message });
  }
});

app.patch('/api/admin/content/requests/:id/review', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const status = req.body.status;
    const rejectReason = req.body.reject_reason || req.body.rejectReason || null;
    if (!['approved', 'rejected'].includes(status)) return fail(res, 400, '审批状态不正确');

    const r = await dbQuery(
      `update public.content_change_requests
       set status=$1, reject_reason=$2, reviewed_by_admin=$3, reviewed_at=now(), updated_at=now()
       where id=$4
       returning *`,
      [status, rejectReason, req.user.admin_id, id]
    );
    const reqRow = r.rows[0];
    if (!reqRow) return fail(res, 404, '审批记录不存在');

    if (status === 'approved' && reqRow.target_type === 'section') {
      const p = typeof reqRow.proposed_content === 'string' ? JSON.parse(reqRow.proposed_content) : (reqRow.proposed_content || {});
      await dbQuery(
        `insert into public.site_sections (page_slug, section_key, section_name, content, display_order)
         values ($1,$2,$3,$4,$5)
         on conflict (section_key) do update set page_slug=excluded.page_slug, section_name=excluded.section_name, content=excluded.content, display_order=excluded.display_order, updated_at=now()`,
        [p.page_slug || reqRow.page_slug, p.section_key || reqRow.section_key, p.section_name || reqRow.title, JSON.stringify(p.content || {}), p.display_order || 0]
      );
    }
    await audit(req, `content_change_${status}`, 'content_change_request', id, { rejectReason });
    return ok(res, { request: reqRow });
  } catch (e) {
    return fail(res, 500, '内容审批失败', { error: e.message });
  }
});

// 管理员邀请和审批：免费版，不自动发邮件。后台生成邀请链接，复制给对方即可。
app.get('/api/admin/invites', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select i.*, inviter.display_name as inviter_name, reviewer.display_name as reviewer_name
       from public.admin_invites i
       left join public.admin_accounts ia on ia.id=i.inviter_admin_id
       left join public.app_users inviter on inviter.id=ia.user_id
       left join public.admin_accounts ra on ra.id=i.approved_by
       left join public.app_users reviewer on reviewer.id=ra.user_id
       order by i.created_at desc limit 500`
    );
    const invites = r.rows.map(row => ({ ...row, invite_link: row.invite_code ? makeInviteLink(row.invite_code) : null }));
    return ok(res, { invites });
  } catch (e) {
    return fail(res, 500, '获取管理员邀请失败', { error: e.message });
  }
});

app.post('/api/admin/invites', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const inviteeEmail = normalizeEmail(b.invitee_email || b.email);
    const inviteeName = String(b.invitee_name || b.name || '').trim();
    if (!inviteeEmail || !inviteeEmail.includes('@')) return fail(res, 400, '被邀请人邮箱不能为空');
    if (!inviteeName) return fail(res, 400, '被邀请人姓名不能为空');
    const code = makeInviteCode();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    const permissions = normalizePermissions(b.permissions) || {};
    const r = await dbQuery(
      `insert into public.admin_invites
       (inviter_admin_id, invitee_email, invitee_phone, invitee_name, admin_level, title, department, permissions, invite_code, status, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'invited',$10)
       returning *`,
      [req.user.admin_id, inviteeEmail, b.invitee_phone || b.phone || null, inviteeName, b.admin_level || 'admin', b.title || null, b.department || null, JSON.stringify(permissions), code, expiresAt]
    );
    await audit(req, 'admin_invite_create', 'admin_invite', r.rows[0].id, { inviteeEmail });
    return ok(res, { invite: { ...r.rows[0], invite_link: makeInviteLink(code) }, message: '邀请已创建。复制邀请链接发给对方，免费，不需要短信或邮件服务。' });
  } catch (e) {
    return fail(res, 500, '创建管理员邀请失败', { error: e.message });
  }
});

app.get('/api/admin/invites/public/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const r = await dbQuery(
      `select id, invitee_email, invitee_phone, invitee_name, admin_level, title, department, status, expires_at
       from public.admin_invites where invite_code=$1 limit 1`,
      [code]
    );
    const invite = r.rows[0];
    if (!invite) return fail(res, 404, '邀请链接不存在');
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return fail(res, 410, '邀请链接已过期，请联系管理员重新邀请');
    if (!['invited', 'accepted'].includes(invite.status)) return fail(res, 400, '邀请状态不可用');
    return ok(res, { invite });
  } catch (e) {
    return fail(res, 500, '读取邀请失败', { error: e.message });
  }
});

app.post('/api/admin/invites/accept', async (req, res) => {
  try {
    const b = req.body || {};
    const code = String(b.code || b.token || '').trim();
    const password = requireStrongPassword(b.password);
    const email = normalizeEmail(b.email || b.invitee_email);
    const name = String(b.name || b.invitee_name || '').trim();
    if (!code) return fail(res, 400, '邀请码不能为空');
    const r = await dbQuery(`select * from public.admin_invites where invite_code=$1 limit 1`, [code]);
    const invite = r.rows[0];
    if (!invite) return fail(res, 404, '邀请链接不存在');
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return fail(res, 410, '邀请链接已过期');
    if (!['invited', 'accepted'].includes(invite.status)) return fail(res, 400, '邀请已处理，不能重复设置');
    if (email && normalizeEmail(invite.invitee_email) !== email) return fail(res, 400, '邮箱与邀请邮箱不一致');
    const passwordHash = await bcrypt.hash(password, 10);
    const personalInfo = {
      name: name || invite.invitee_name,
      email: invite.invitee_email,
      phone: b.phone || invite.invitee_phone || null,
      title: b.title || invite.title || null,
      department: b.department || invite.department || null,
      province: b.province || null,
      city: b.city || null,
      note: b.note || null,
    };
    const updated = await dbQuery(
      `update public.admin_invites
       set status='accepted', accepted_at=now(), accepted_password_hash=$1, personal_info=$2, invitee_phone=coalesce($3, invitee_phone), title=coalesce($4, title), department=coalesce($5, department), updated_at=now()
       where id=$6 returning id, invitee_email, invitee_name, status`,
      [passwordHash, JSON.stringify(personalInfo), personalInfo.phone, personalInfo.title, personalInfo.department, invite.id]
    );
    return ok(res, { invite: updated.rows[0], message: '资料和密码已提交，等待主管理员审批后即可登录后台。' });
  } catch (e) {
    return fail(res, 500, '接受邀请失败', { error: e.message });
  }
});

app.patch('/api/admin/invites/:id/review', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const status = req.body.status;
    if (!['approved', 'rejected'].includes(status)) return fail(res, 400, '审批状态不正确');
    const r0 = await dbQuery(`select * from public.admin_invites where id=$1 limit 1`, [id]);
    const invite = r0.rows[0];
    if (!invite) return fail(res, 404, '邀请不存在');
    if (status === 'approved' && !invite.accepted_password_hash) return fail(res, 400, '对方还没有通过邀请链接设置密码和个人资料');
    const info = typeof invite.personal_info === 'string' ? JSON.parse(invite.personal_info || '{}') : (invite.personal_info || {});

    if (status === 'approved') {
      const u = await dbQuery(
        `insert into public.app_users (email, phone, display_name, role, status, password_hash, is_email_verified)
         values ($1,$2,$3,'admin','active',$4,true)
         on conflict (email) do update set role='admin', status='active', display_name=excluded.display_name, phone=excluded.phone, password_hash=excluded.password_hash, updated_at=now()
         returning id`,
        [normalizeEmail(invite.invitee_email), info.phone || invite.invitee_phone || null, info.name || invite.invitee_name, invite.accepted_password_hash]
      );
      await dbQuery(
        `insert into public.admin_accounts (user_id, admin_level, status, invited_by, approved_by, approved_at, title, department, province, city, permissions, note)
         values ($1,$2,'approved',$3,$4,now(),$5,$6,$7,$8,$9,$10)
         on conflict (user_id) do update set admin_level=excluded.admin_level, status='approved', approved_by=$4, approved_at=now(), title=excluded.title, department=excluded.department, province=excluded.province, city=excluded.city, permissions=excluded.permissions, updated_at=now()`,
        [u.rows[0].id, invite.admin_level || 'admin', invite.inviter_admin_id, req.user.admin_id, info.title || invite.title || null, info.department || invite.department || null, info.province || null, info.city || null, JSON.stringify(normalizePermissions(invite.permissions)), info.note || '邀请审批通过']
      );
    }

    const r = await dbQuery(
      `update public.admin_invites set status=$1, approved_by=$2, approved_at=now(), reject_reason=$3, updated_at=now()
       where id=$4 returning *`,
      [status, req.user.admin_id, req.body.reject_reason || req.body.rejectReason || null, id]
    );
    await audit(req, `admin_invite_${status}`, 'admin_invite', id, {});
    return ok(res, { invite: { ...r.rows[0], invite_link: r.rows[0].invite_code ? makeInviteLink(r.rows[0].invite_code) : null }, message: status === 'approved' ? '管理员已批准启用' : '邀请已拒绝' });
  } catch (e) {
    return fail(res, 500, '管理员邀请审批失败', { error: e.message });
  }
});


// 直接创建管理员：主管理员在后台添加，无需邀请链接
app.post('/api/admin/accounts', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const email = normalizeEmail(b.email);
    const name = String(b.name || b.display_name || '').trim();
    const phone = String(b.phone || '').trim() || null;
    const password = requireStrongPassword(b.password);
    const adminLevel = ['super_admin', 'admin', 'editor', 'reviewer', 'viewer'].includes(b.admin_level) ? b.admin_level : 'admin';
    if (!email || !email.includes('@')) return fail(res, 400, '请输入有效邮箱');
    if (!name) return fail(res, 400, '请输入姓名');
    const passwordHash = await bcrypt.hash(password, 10);
    const u = await dbQuery(
      `insert into public.app_users (email, phone, display_name, role, status, password_hash, is_email_verified)
       values ($1,$2,$3,'admin','active',$4,true)
       on conflict (email) do update set role='admin', status='active', display_name=excluded.display_name, phone=excluded.phone, password_hash=excluded.password_hash, updated_at=now()
       returning id`,
      [email, phone, name, passwordHash]
    );
    await dbQuery(
      `insert into public.admin_accounts (user_id, admin_level, status, approved_by, approved_at, title, department, permissions, note)
       values ($1,$2,'approved',$3,now(),$4,$5,$6,$7)
       on conflict (user_id) do update set admin_level=excluded.admin_level, status='approved', approved_by=$3, approved_at=now(), title=excluded.title, department=excluded.department, permissions=excluded.permissions, updated_at=now()`,
      [u.rows[0].id, adminLevel, req.user.admin_id, b.title || null, b.department || null, JSON.stringify(normalizePermissions(b.permissions)), b.note || '后台直接创建']
    );
    await audit(req, 'admin_account_create', 'admin_account', u.rows[0].id, { email, adminLevel });
    return ok(res, { admin: { user_id: u.rows[0].id, email, name, admin_level: adminLevel }, message: '管理员已直接创建：对方用邮箱 + 初始密码即可登录后台，登录后可自行修改密码。若该邮箱已有账号，将自动升级为管理员。' });
  } catch (e) {
    return fail(res, 500, '创建管理员失败', { error: e.message });
  }
});

// 地区数据接口，后面导入全国省市区县后可直接用
app.get('/api/regions', async (req, res) => {
  try {
    const parent = req.query.parent;
    const params = [];
    let where = '';
    if (parent) { params.push(parent); where = 'where parent_code=$1'; }
    const r = await dbQuery(`select code,name,level,parent_code from public.region_catalog ${where} order by code asc`, params);
    return ok(res, { regions: r.rows });
  } catch (e) {
    return fail(res, 500, '获取地区失败', { error: e.message });
  }
});

// 短信接口占位：正式接阿里云/腾讯云短信后启用
app.post('/api/sms/send', async (req, res) => {
  return fail(res, 501, '短信验证码服务尚未接入。下一期接入阿里云或腾讯云短信。');
});

// ==================== 内容系统与校友中心（V1 追加） ====================

function slugify(text = '') {
  const base = String(text || '').trim().toLowerCase();
  const latin = base.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return (latin || 'post') + '-' + crypto.randomBytes(3).toString('hex');
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getOptionalUser(req) {
  const token = getBearer(req);
  if (!token) return null;
  try { return jwt.verify(token, TOKEN_SECRET); } catch { return null; }
}

async function ensureAlumniProfileExtras() {
  if (!pool) return;
  await dbQuery(`alter table public.alumni_profiles add column if not exists enrollment_year text`).catch(() => {});
  await dbQuery(`alter table public.alumni_verifications add column if not exists enrollment_year text`).catch(() => {});
}

async function ensureContentTables() {
  if (!pool) return;
  await dbQuery(`create table if not exists public.news_articles (
    id bigserial primary key,
    slug text unique not null,
    title text not null,
    summary text,
    content text,
    cover_url text,
    category text default '综合',
    author text,
    source text,
    is_published boolean default true,
    published_at timestamptz default now(),
    view_count integer default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    created_by bigint
  )`);
  await dbQuery(`create table if not exists public.events (
    id bigserial primary key,
    slug text unique,
    title text not null,
    summary text,
    content text,
    cover_url text,
    category text default '校友活动',
    location text,
    start_time timestamptz,
    end_time timestamptz,
    signup_deadline timestamptz,
    capacity integer,
    is_published boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    created_by bigint
  )`);
  await dbQuery(`create table if not exists public.event_registrations (
    id bigserial primary key,
    event_id bigint not null references public.events(id) on delete cascade,
    user_id bigint references public.app_users(id) on delete set null,
    name text not null,
    phone text,
    email text,
    remark text,
    status text default 'registered',
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (event_id, phone)
  )`);
  // 老库可能在加唯一约束前就建了表，这里补上（先清理重复，再建唯一索引，保证报名不报错）
  await dbQuery(
    `delete from public.event_registrations a using public.event_registrations b
     where a.event_id = b.event_id and a.phone = b.phone and a.id < b.id`
  ).catch(() => {});
  await dbQuery(
    `create unique index if not exists idx_event_regs_event_phone on public.event_registrations(event_id, phone)`
  ).catch(() => {});
  await dbQuery(`create table if not exists public.uploads (
    id text primary key,
    user_id bigint references public.app_users(id) on delete set null,
    filename text,
    mime_type text,
    size_bytes integer,
    purpose text,
    data text,
    created_at timestamptz default now()
  )`);
}

// ---------- 新闻公告（公开） ----------
app.get('/api/news', async (req, res) => {
  try {
    const { category, q } = req.query;
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 10), 50);
    const params = [];
    const wheres = [`is_published = true`];
    if (category && category !== '全部') { params.push(category); wheres.push(`category = $${params.length}`); }
    if (q) { params.push(`%${q}%`); wheres.push(`(title ilike $${params.length} or summary ilike $${params.length})`); }
    const where = wheres.join(' and ');
    const count = await dbQuery(`select count(*)::int as total from public.news_articles where ${where}`, params);
    const total = count.rows[0].total;
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select id, slug, title, summary, cover_url, category, author, source, published_at, view_count
       from public.news_articles
       where ${where}
       order by published_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    const categories = await dbQuery(`select distinct category from public.news_articles where is_published=true order by category asc`);
    return ok(res, { total, page, pageSize, items: r.rows, categories: categories.rows.map((row) => row.category) });
  } catch (e) {
    return fail(res, 500, '获取新闻列表失败', { error: e.message });
  }
});

app.get('/api/news/:slug', async (req, res) => {
  try {
    const r = await dbQuery(
      `update public.news_articles set view_count = view_count + 1
       where slug = $1 and is_published = true
       returning *`,
      [req.params.slug]
    );
    if (!r.rows[0]) return fail(res, 404, '新闻不存在');
    return ok(res, { article: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取新闻详情失败', { error: e.message });
  }
});

// ---------- 新闻公告（管理） ----------
app.get('/api/admin/news', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
    const q = req.query.q;
    const params = [];
    let where = '';
    if (q) { params.push(`%${q}%`); where = `where (title ilike $1 or summary ilike $1)`; }
    const count = await dbQuery(`select count(*)::int as total from public.news_articles ${where}`, params);
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select id, slug, title, summary, category, author, is_published, published_at, view_count, created_at, updated_at
       from public.news_articles ${where}
       order by published_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取新闻列表失败', { error: e.message });
  }
});

app.post('/api/admin/news', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return fail(res, 400, '标题不能为空');
    const slug = String(b.slug || '').trim() || slugify(title);
    const publishedAt = b.published_at || new Date().toISOString();
    const r = await dbQuery(
      `insert into public.news_articles
       (slug, title, summary, content, cover_url, category, author, source, is_published, published_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning *`,
      [slug, title, b.summary || null, b.content || null, b.cover_url || null, b.category || '综合', b.author || null, b.source || null, b.is_published !== false, publishedAt, req.user.admin_id]
    );
    await audit(req, 'news_create', 'news_article', r.rows[0].id, { title });
    return ok(res, { article: r.rows[0], message: '新闻已发布' });
  } catch (e) {
    return fail(res, 500, '发布新闻失败', { error: e.message });
  }
});

app.patch('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return fail(res, 400, '标题不能为空');
    const r = await dbQuery(
      `update public.news_articles set
        title=$1, summary=$2, content=$3, cover_url=$4, category=$5, author=$6, source=$7,
        is_published=$8, published_at=$9, updated_at=now()
       where id=$10 returning *`,
      [title, b.summary || null, b.content || null, b.cover_url || null, b.category || '综合', b.author || null, b.source || null, b.is_published !== false, b.published_at || new Date().toISOString(), req.params.id]
    );
    if (!r.rows[0]) return fail(res, 404, '新闻不存在');
    await audit(req, 'news_update', 'news_article', req.params.id, { title });
    return ok(res, { article: r.rows[0], message: '新闻已更新' });
  } catch (e) {
    return fail(res, 500, '更新新闻失败', { error: e.message });
  }
});

app.delete('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`delete from public.news_articles where id=$1 returning id`, [req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '新闻不存在');
    await audit(req, 'news_delete', 'news_article', req.params.id, {});
    return ok(res, { message: '新闻已删除' });
  } catch (e) {
    return fail(res, 500, '删除新闻失败', { error: e.message });
  }
});

// ---------- 活动中心（公开） ----------
app.get('/api/events', async (req, res) => {
  try {
    const mode = req.query.mode || 'upcoming';
    const q = req.query.q;
    const params = [];
    const wheres = [`e.is_published = true`];
    if (mode === 'upcoming') wheres.push(`(e.end_time >= now() or e.end_time is null)`);
    if (mode === 'past') wheres.push(`(e.end_time < now())`);
    if (q) { params.push(`%${q}%`); wheres.push(`(e.title ilike $${params.length} or e.summary ilike $${params.length})`); }
    const where = wheres.join(' and ');
    const order = mode === 'past' ? `e.start_time desc` : `e.start_time asc`;
    const r = await dbQuery(
      `select e.id, e.slug, e.title, e.summary, e.cover_url, e.category, e.location,
              e.start_time, e.end_time, e.signup_deadline, e.capacity,
              (select count(*) from public.event_registrations er where er.event_id = e.id) as registrations_count
       from public.events e
       where ${where}
       order by ${order}
       limit 100`,
      params
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取活动列表失败', { error: e.message });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const r = await dbQuery(
      `select e.*, (select count(*) from public.event_registrations er where er.event_id = e.id) as registrations_count
       from public.events e
       where (e.id::text = $1 or e.slug = $1) and e.is_published = true
       limit 1`,
      [req.params.id]
    );
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    return ok(res, { event: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取活动详情失败', { error: e.message });
  }
});

app.post('/api/events/:id/register', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return fail(res, 400, '姓名和手机号不能为空');
    const ev = await dbQuery(`select * from public.events where (id::text=$1 or slug=$1) and is_published=true limit 1`, [req.params.id]);
    if (!ev.rows[0]) return fail(res, 404, '活动不存在');
    const event = ev.rows[0];
    if (event.signup_deadline && new Date(event.signup_deadline) < new Date()) return fail(res, 400, '报名已截止');
    if (event.capacity) {
      const cnt = await dbQuery(`select count(*)::int as c from public.event_registrations where event_id::text=$1`, [event.id]);
      if (cnt.rows[0].c >= event.capacity) return fail(res, 400, '活动名额已满');
    }
    const me = getOptionalUser(req);
    const email = b.email || null;
    const remark = b.remark || null;
    const duplicate = await dbQuery(
      `select id from public.event_registrations where event_id::text=$1 and phone=$2 limit 1`,
      [event.id, phone]
    );
    const r = duplicate.rows[0]
      ? await dbQuery(
          `update public.event_registrations set name=$2, email=$3, remark=$4, updated_at=now()
           where id::text=$1 returning *`,
          [duplicate.rows[0].id, name, email, remark]
        )
      : await dbQuery(
          `insert into public.event_registrations (event_id, user_id, name, phone, email, remark, status)
           values ($1,$2,$3,$4,$5,$6,'registered')
           returning *`,
          [event.id, me?.user_id || null, name, phone, email, remark]
        );
    return ok(res, { registration: r.rows[0], message: '报名成功，期待与你在活动中相见' });
  } catch (e) {
    return fail(res, 500, `报名失败：${e.message}`, { error: e.message });
  }
});

// ---------- 活动中心（管理） ----------
app.get('/api/admin/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
    const r = await dbQuery(
      `select e.*, (select count(*) from public.event_registrations er where er.event_id = e.id) as registrations_count
       from public.events e
       order by e.start_time desc nulls last
       limit $1 offset $2`,
      [pageSize, (page - 1) * pageSize]
    );
    const count = await dbQuery(`select count(*)::int as total from public.events`);
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取活动列表失败', { error: e.message });
  }
});

app.post('/api/admin/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return fail(res, 400, '标题不能为空');
    const slug = String(b.slug || '').trim() || slugify(title);
    const r = await dbQuery(
      `insert into public.events
       (slug, title, summary, content, cover_url, category, location, start_time, end_time, signup_deadline, capacity, is_published, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [slug, title, b.summary || null, b.content || null, b.cover_url || null, b.category || '校友活动', b.location || null, b.start_time || null, b.end_time || null, b.signup_deadline || null, b.capacity ? Number(b.capacity) : null, b.is_published !== false, req.user.admin_id]
    );
    await audit(req, 'event_create', 'event', r.rows[0].id, { title });
    return ok(res, { event: r.rows[0], message: '活动已创建' });
  } catch (e) {
    return fail(res, 500, '创建活动失败', { error: e.message });
  }
});

app.patch('/api/admin/events/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return fail(res, 400, '标题不能为空');
    const r = await dbQuery(
      `update public.events set
        title=$1, summary=$2, content=$3, cover_url=$4, category=$5, location=$6,
        start_time=$7, end_time=$8, signup_deadline=$9, capacity=$10, is_published=$11, updated_at=now()
       where id=$12 returning *`,
      [title, b.summary || null, b.content || null, b.cover_url || null, b.category || '校友活动', b.location || null, b.start_time || null, b.end_time || null, b.signup_deadline || null, b.capacity ? Number(b.capacity) : null, b.is_published !== false, req.params.id]
    );
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    await audit(req, 'event_update', 'event', req.params.id, { title });
    return ok(res, { event: r.rows[0], message: '活动已更新' });
  } catch (e) {
    return fail(res, 500, '更新活动失败', { error: e.message });
  }
});

app.delete('/api/admin/events/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`delete from public.events where id=$1 returning id`, [req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    await audit(req, 'event_delete', 'event', req.params.id, {});
    return ok(res, { message: '活动已删除' });
  } catch (e) {
    return fail(res, 500, '删除活动失败', { error: e.message });
  }
});

app.get('/api/admin/events/:id/registrations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select er.*, e.title as event_title
       from public.event_registrations er
       join public.events e on e.id = er.event_id
       where er.event_id = $1
       order by er.created_at desc
       limit 1000`,
      [req.params.id]
    );
    return ok(res, { registrations: r.rows });
  } catch (e) {
    return fail(res, 500, '获取报名列表失败', { error: e.message });
  }
});

app.patch('/api/admin/event-registrations/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = req.body.status;
    if (!['registered', 'cancelled', 'checked_in'].includes(status)) return fail(res, 400, '状态不正确');
    const r = await dbQuery(`update public.event_registrations set status=$1, updated_at=now() where id=$2 returning *`, [status, req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '报名记录不存在');
    return ok(res, { registration: r.rows[0], message: '报名状态已更新' });
  } catch (e) {
    return fail(res, 500, '更新报名状态失败', { error: e.message });
  }
});

// ---------- 文件上传（学信网截图等，暂存数据库，正式接入 R2/S3 后替换） ----------
app.post('/api/uploads', async (req, res) => {
  try {
    const b = req.body || {};
    const data = String(b.data || '');
    if (!data) return fail(res, 400, '请选择文件');
    const base64 = data.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return fail(res, 400, '文件内容为空');
    if (buf.length > 5 * 1024 * 1024) return fail(res, 400, '文件不能超过 5MB');
    const mime = String(b.mime_type || '').toLowerCase();
    if (mime && !mime.startsWith('image/')) return fail(res, 400, '仅支持图片文件');
    const id = crypto.randomBytes(12).toString('hex');
    const me = getOptionalUser(req);
    await dbQuery(
      `insert into public.uploads (id, user_id, filename, mime_type, size_bytes, purpose, data)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, me?.user_id || null, String(b.filename || 'upload').slice(0, 255), mime || 'application/octet-stream', buf.length, String(b.purpose || 'other').slice(0, 40), base64]
    );
    return ok(res, { upload: { id, url: `/api/uploads/${id}`, mime_type: mime, size_bytes: buf.length } });
  } catch (e) {
    return fail(res, 500, '上传失败', { error: e.message });
  }
});

app.get('/api/uploads/:id', async (req, res) => {
  try {
    const r = await dbQuery(`select mime_type, data from public.uploads where id=$1 limit 1`, [req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '文件不存在');
    res.set('Content-Type', r.rows[0].mime_type || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(r.rows[0].data, 'base64'));
  } catch (e) {
    return fail(res, 500, '读取文件失败', { error: e.message });
  }
});

// 素材库：列出全部上传的图片（管理员）
app.get('/api/admin/uploads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select id, filename, mime_type, size_bytes, purpose, created_at
       from public.uploads order by created_at desc limit 300`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取素材列表失败', { error: e.message });
  }
});

// 删除素材（管理员）
app.delete('/api/uploads/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`delete from public.uploads where id=$1 returning id`, [req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '素材不存在');
    return ok(res, { message: '素材已删除' });
  } catch (e) {
    return fail(res, 500, '删除素材失败', { error: e.message });
  }
});

// ---------- 校友中心 ----------
app.get('/api/alumni/me', requireAuth, async (req, res) => {
  try {
    const userResult = await dbQuery(
      `select id, display_name, email, phone, role, status, created_at, last_login_at
       from public.app_users where id=$1 limit 1`,
      [req.user.user_id]
    );
    if (!userResult.rows[0]) return fail(res, 404, '用户不存在');
    const profileResult = await dbQuery(`select * from public.alumni_profiles where user_id=$1 limit 1`, [req.user.user_id]);
    const verifyResult = await dbQuery(
      `select id, applicant_type, name, phone, graduation_year, class_name, homeroom_teacher,
              university_graduated, chsi_proof_url, student_card_url, admission_notice_url, status, reject_reason, created_at
       from public.alumni_verifications
       where phone = $1
       order by created_at desc limit 5`,
      [userResult.rows[0].phone || '']
    );
    return ok(res, { user: userResult.rows[0], profile: profileResult.rows[0] || null, verifications: verifyResult.rows });
  } catch (e) {
    return fail(res, 500, '获取个人信息失败', { error: e.message });
  }
});

app.put('/api/alumni/me', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const profile = await dbQuery(`select id from public.alumni_profiles where user_id=$1 limit 1`, [req.user.user_id]);
    if (!profile.rows[0]) return fail(res, 400, '请先完成校友认证');
    const r = await dbQuery(
      `update public.alumni_profiles set
        industry=$1, company=$2, position_title=$3, wechat=$4, bio=$5,
        avatar_url=$6, public_contact=$7,
        current_province=coalesce($8, current_province), current_city=coalesce($9, current_city),
        enrollment_year=coalesce($11, enrollment_year), graduation_year=coalesce($12, graduation_year),
        updated_at=now()
       where user_id=$10 returning *`,
      [b.industry || null, b.company || null, b.position_title || null, b.wechat || null, b.bio || null, b.avatar_url || null, b.public_contact === true, b.current_province || null, b.current_city || null, req.user.user_id, b.enrollment_year || null, b.graduation_year || null]
    );
    return ok(res, { profile: r.rows[0], message: '资料已更新' });
  } catch (e) {
    return fail(res, 500, '更新资料失败', { error: e.message });
  }
});

// ---------- 数据统计与导出 ----------
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [users, alumni, verifications, news, events, registrations] = await Promise.all([
      dbQuery(`select count(*)::int as total from public.app_users`),
      dbQuery(`select count(*)::int as total from public.app_users where role='alumni'`),
      dbQuery(`select status, count(*)::int as total from public.alumni_verifications group by status`),
      dbQuery(`select count(*)::int as total from public.news_articles`),
      dbQuery(`select count(*)::int as total from public.events`),
      dbQuery(`select count(*)::int as total from public.event_registrations`)
    ]);
    const byStatus = {};
    verifications.rows.forEach((row) => { byStatus[row.status] = row.total; });
    return ok(res, {
      stats: {
        users: users.rows[0].total,
        alumni: alumni.rows[0].total,
        news: news.rows[0].total,
        events: events.rows[0].total,
        registrations: registrations.rows[0].total,
        verifications: byStatus
      }
    });
  } catch (e) {
    return fail(res, 500, '获取统计数据失败', { error: e.message });
  }
});

app.get('/api/admin/alumni', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
    const q = req.query.q;
    const params = [];
    const wheres = [];
    if (q) { params.push(`%${q}%`); wheres.push(`(p.name ilike $${params.length} or p.company ilike $${params.length} or p.phone ilike $${params.length})`); }
    const where = wheres.length ? 'where ' + wheres.join(' and ') : '';
    const count = await dbQuery(`select count(*)::int as total from public.alumni_profiles p ${where}`, params);
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select p.*, u.email, u.status as user_status, u.created_at as user_created_at
       from public.alumni_profiles p
       left join public.app_users u on u.id = p.user_id
       ${where}
       order by p.id desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取校友列表失败', { error: e.message });
  }
});

app.get('/api/admin/alumni/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select p.name, p.phone, p.graduation_year, p.class_name, p.province, p.city, p.county,
              p.current_province, p.current_city, p.industry, p.company, p.position_title,
              p.public_contact, p.created_at
       from public.alumni_profiles p
       order by p.graduation_year desc nulls last, p.name asc`
    );
    const csvEscape = (value) => {
      const s = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['姓名', '手机号', '毕业届别', '班级', '生源地省', '生源地市', '生源地县', '现居省', '现居市', '行业', '单位', '职务', '公开电话', '入库时间'];
    const rows = r.rows.map((row) => [
      row.name, row.phone, row.graduation_year, row.class_name, row.province, row.city, row.county,
      row.current_province, row.current_city, row.industry, row.company, row.position_title,
      row.public_contact ? '是' : '否', row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : ''
    ]);
    const csv = '\ufeff' + [headers, ...rows].map((line) => line.map(csvEscape).join(',')).join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="alumni-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (e) {
    return fail(res, 500, '导出通讯录失败', { error: e.message });
  }
});


app.get('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`select * from public.news_articles where id=$1 limit 1`, [req.params.id]);
    if (!r.rows[0]) return fail(res, 404, '新闻不存在');
    return ok(res, { article: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取新闻失败', { error: e.message });
  }
});

app.get('/api/admin/events/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select e.*, (select count(*) from public.event_registrations er where er.event_id = e.id) as registrations_count
       from public.events e
       where e.id::text = $1
       limit 1`,
      [req.params.id]
    );
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    return ok(res, { event: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取活动失败', { error: e.message });
  }
});
// ==================== 用户管理 / 校友导入 / 微信登录（V1 追加） ====================

const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';
const WECHAT_LOGIN_REDIRECT = (process.env.WECHAT_LOGIN_REDIRECT || `${PUBLIC_SITE_URL}/account.html`).replace(/\/$/, '');

async function ensureUserTableExtras() {
  if (!pool) return;
  await dbQuery(`alter table public.app_users add column if not exists wechat_openid text`);
  await dbQuery(`create unique index if not exists idx_app_users_wechat_openid on public.app_users(wechat_openid) where wechat_openid is not null`);
}

// ---------- 用户管理 ----------
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
    const q = req.query.q;
    const params = [];
    const wheres = [];
    if (q) {
      params.push(`%${q}%`);
      wheres.push(`(u.display_name ilike $${params.length} or u.phone ilike $${params.length} or u.email ilike $${params.length})`);
    }
    const where = wheres.length ? 'where ' + wheres.join(' and ') : '';
    const count = await dbQuery(`select count(*)::int as total from public.app_users u ${where}`, params);
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select u.id, u.display_name, u.email, u.phone, u.role, u.status, u.created_at, u.last_login_at, u.wechat_openid,
              a.admin_level, a.status as admin_status,
              p.graduation_year, p.class_name
       from public.app_users u
       left join public.admin_accounts a on a.user_id = u.id
       left join public.alumni_profiles p on p.user_id = u.id
       ${where}
       order by u.id desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取用户列表失败', { error: e.message });
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const allowedRoles = ['pending_alumni', 'alumni', 'admin'];
    const allowedStatus = ['pending', 'active', 'disabled'];
    if (b.role && !allowedRoles.includes(b.role)) return fail(res, 400, '用户角色不正确');
    if (b.status && !allowedStatus.includes(b.status)) return fail(res, 400, '用户状态不正确');

    const current = await dbQuery(`select * from public.app_users where id=$1 limit 1`, [id]);
    if (!current.rows[0]) return fail(res, 404, '用户不存在');
    if (current.rows[0].phone === 'ROOT_ADMIN') return fail(res, 403, '不能修改主管理员账号');

    const r = await dbQuery(
      `update public.app_users set role=coalesce($1, role), status=coalesce($2, status), updated_at=now()
       where id=$3 returning id, display_name, role, status`,
      [b.role || null, b.status || null, id]
    );
    await audit(req, 'user_update', 'app_user', id, { role: b.role, status: b.status });
    return ok(res, { user: r.rows[0], message: '用户信息已更新' });
  } catch (e) {
    return fail(res, 500, '更新用户失败', { error: e.message });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const current = await dbQuery(`select * from public.app_users where id=$1 limit 1`, [id]);
    if (!current.rows[0]) return fail(res, 404, '用户不存在');
    if (current.rows[0].phone === 'ROOT_ADMIN') return fail(res, 403, '主管理员请通过环境变量修改密码');
    const newPassword = String(req.body?.password || '').trim() || crypto.randomBytes(6).toString('base64url');
    if (newPassword.length < 8) return fail(res, 400, '新密码至少 8 位');
    const hash = await bcrypt.hash(newPassword, 10);
    const uInfo = current.rows[0];
    await dbQuery(
      `update public.app_users set password_hash=$1, updated_at=now()
       where id=$2
          or (email is not null and lower(email)=lower($3))
          or (phone is not null and phone=$4)`,
      [hash, id, uInfo.email || '', uInfo.phone || null]
    );
    await audit(req, 'user_reset_password', 'app_user', id, {});
    return ok(res, { message: '密码已重置', temp_password: newPassword });
  } catch (e) {
    return fail(res, 500, '重置密码失败', { error: e.message });
  }
});

// ---------- 校友数据导入（CSV，Excel 另存为 CSV 即可） ----------
function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  cells.push(current.trim());
  return cells;
}

app.post('/api/admin/alumni/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const csv = String(req.body?.csv || '').replace(/^\ufeff/, '').trim();
    if (!csv) return fail(res, 400, '请提供 CSV 内容');
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return fail(res, 400, 'CSV 至少需要表头和一行数据');

    const headers = parseCsvLine(lines[0]);
    const map = {};
    headers.forEach((header, i) => {
      const key = String(header || '').toLowerCase();
      if (key.includes('姓名') || key === 'name') map.name = i;
      if (key.includes('手机') || key.includes('电话') || key === 'phone') map.phone = i;
      if (key.includes('届') || key.includes('毕业年份') || key.includes('年份')) map.graduation_year = i;
      if (key.includes('班级') || key === 'class') map.class_name = i;
      if (key.includes('行业')) map.industry = i;
      if (key.includes('单位') || key.includes('公司')) map.company = i;
      if (key.includes('职务')) map.position_title = i;
      if (key.includes('现居') || key.includes('所在城市')) map.current_city = i;
    });
    if (map.name === undefined || map.phone === undefined) return fail(res, 400, 'CSV 表头需包含「姓名」和「手机号」两列');

    let imported = 0;
    let skipped = 0;
    const errors = [];
    for (let idx = 1; idx < lines.length; idx++) {
      const cells = parseCsvLine(lines[idx]);
      const name = String(cells[map.name] || '').trim();
      const phone = String(cells[map.phone] || '').trim();
      if (!name || !phone) { skipped++; continue; }
      try {
        const u = await dbQuery(
          `insert into public.app_users (phone, display_name, role, status, is_phone_verified)
           values ($1,$2,'alumni','active',true)
           on conflict (phone) do update set display_name=excluded.display_name, role='alumni', status='active', updated_at=now()
           returning id`,
          [phone, name]
        );
        const userId = u.rows[0].id;
        await dbQuery(
          `insert into public.alumni_profiles
           (user_id, name, phone, graduation_year, class_name, industry, company, position_title, current_city, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
           on conflict (user_id) do update set
            name=excluded.name, phone=excluded.phone, graduation_year=excluded.graduation_year, class_name=excluded.class_name,
            industry=excluded.industry, company=excluded.company, position_title=excluded.position_title,
            current_city=excluded.current_city, status='active', updated_at=now()`,
          [userId, name, phone, cells[map.graduation_year] || null, cells[map.class_name] || null, cells[map.industry] || null, cells[map.company] || null, cells[map.position_title] || null, cells[map.current_city] || null]
        );
        imported++;
      } catch (e) {
        skipped++;
        if (errors.length < 10) errors.push(`第 ${idx + 1} 行：${e.message}`);
      }
    }
    await audit(req, 'alumni_import', 'alumni_profile', null, { imported, skipped });
    return ok(res, { imported, skipped, errors, message: `导入完成：成功 ${imported} 条，跳过 ${skipped} 条` });
  } catch (e) {
    return fail(res, 500, '导入失败', { error: e.message });
  }
});

// ---------- 微信登录 ----------
app.get('/api/auth/wechat/config', (req, res) => {
  const enabled = Boolean(WECHAT_APPID && WECHAT_SECRET);
  return ok(res, {
    enabled,
    appid: WECHAT_APPID || '',
    authorize_url: enabled
      ? `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(WECHAT_APPID)}&redirect_uri=${encodeURIComponent(WECHAT_LOGIN_REDIRECT)}&response_type=code&scope=snsapi_login#wechat_redirect`
      : ''
  });
});

app.post('/api/auth/wechat/login', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return fail(res, 400, '缺少微信授权码');
    if (!WECHAT_APPID || !WECHAT_SECRET) return fail(res, 400, '微信登录尚未配置（缺少 WECHAT_APPID / WECHAT_SECRET 环境变量）');

    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(WECHAT_APPID)}&secret=${encodeURIComponent(WECHAT_SECRET)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const wxResponse = await fetch(tokenUrl);
    const wx = await wxResponse.json();
    if (!wx.openid) return fail(res, 401, '微信授权失败：' + (wx.errmsg || '未知错误'));

    const found = await dbQuery(
      `select id as user_id, display_name, email, phone, role, status, wechat_openid
       from public.app_users
       where wechat_openid = $1
       limit 1`,
      [wx.openid]
    );
    let user = found.rows[0];
    if (!user) {
      const created = await dbQuery(
        `insert into public.app_users (display_name, role, status, wechat_openid, is_phone_verified)
         values ($1,'pending_alumni','pending',$2,false)
         returning id as user_id, display_name, email, phone, role, status, wechat_openid`,
        ['微信用户', wx.openid]
      );
      user = created.rows[0];
    }
    if (user.status === 'disabled') return fail(res, 403, '账号已禁用');

    const token = signToken({ ...user, admin_id: null, admin_level: null });
    await dbQuery(`update public.app_users set last_login_at=now(), updated_at=now() where id=$1`, [user.user_id]).catch(() => {});
    return ok(res, { token, user: { name: user.display_name, email: user.email, phone: user.phone, role: user.role, status: user.status }, message: '微信登录成功' });
  } catch (e) {
    return fail(res, 500, '微信登录失败', { error: e.message });
  }
});

// ==================== 密码重置 / 修改密码（V1 追加） ====================

async function ensurePasswordResetTable() {
  if (!pool) return;
  await dbQuery(`create table if not exists public.password_resets (
    id bigserial primary key,
    user_id bigint not null references public.app_users(id) on delete cascade,
    token_hash text not null,
    expires_at timestamptz not null,
    used boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
}

// 忘记密码：仅限已通过认证的校友。生成重置二维码（邀请码），扫码获取邀请码后填写并设置新密码
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) return fail(res, 400, '请输入有效邮箱');
    const r = await dbQuery(`select id, role, status from public.app_users where email=$1 limit 1`, [email]);
    const user = r.rows[0];
    if (!user) return fail(res, 404, '该邮箱未注册，请先注册账号');
    if (!['alumni', 'admin', 'super_admin'].includes(user.role) || user.status !== 'active') {
      return fail(res, 403, '该账号尚未完成校友认证，无法自助重置密码，请联系管理员处理');
    }
    await dbQuery(`delete from public.password_resets where user_id=$1 and used=false and expires_at < now()`, [user.id]).catch(() => {});
    const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += codeChars[Math.floor(Math.random() * codeChars.length)];
    const token = code;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await dbQuery(
      `insert into public.password_resets (user_id, token_hash, expires_at)
       values ($1,$2, now() + interval '30 minutes')`,
      [user.id, tokenHash]
    );
    return ok(res, {
      reset_code: code,
      qr_image_url: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(code)}`,
      message: '已生成重置二维码：请用手机扫码查看「邀请码」，填写邀请码与新密码即可重置（30 分钟内有效）'
    });
  } catch (e) {
    return fail(res, 500, '生成重置码失败', { error: e.message });
  }
});

// 使用重置码设置新密码
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || '').trim();
    const customPassword = String(req.body?.password || '').trim();
    if (!email || !token) return fail(res, 400, '邮箱与激活码不能为空');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await dbQuery(
      `select pr.id, pr.expires_at, u.id as user_id
       from public.password_resets pr
       join public.app_users u on u.id = pr.user_id
       where lower(u.email) = lower($1) and pr.token_hash = $2 and pr.used = false
       order by pr.created_at desc
       limit 1`,
      [email, tokenHash]
    );
    const row = r.rows[0];
    if (!row) return fail(res, 400, '激活码无效或已使用');
    if (new Date(row.expires_at) < new Date()) return fail(res, 400, '激活码已过期，请重新获取');
    const finalPassword = customPassword.length >= 8 ? customPassword : makeRandomPassword();
    const hash = await bcrypt.hash(finalPassword, 10);
    const userInfo = await dbQuery(`select email, phone from public.app_users where id=$1 limit 1`, [row.user_id]);
    // 同步到同一人的所有账号行（邮箱行 + 手机号行），保证用邮箱或手机号都能登录
    await dbQuery(
      `update public.app_users set password_hash=$1, updated_at=now()
       where id=$2
          or (email is not null and lower(email)=lower($3))
          or (phone is not null and phone=$4)`,
      [hash, row.user_id, userInfo.rows[0]?.email || email, userInfo.rows[0]?.phone || null]
    );
    await dbQuery(`update public.password_resets set used=true, updated_at=now() where id=$1`, [row.id]);
    return ok(res, { default_password: finalPassword, message: '激活成功！请用「邮箱 + 默认密码」登录，登录后可在个人中心修改密码。' });
  } catch (e) {
    return fail(res, 500, '激活失败', { error: e.message });
  }
});

// 已登录用户自助修改密码（校友/管理员通用）
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const oldPassword = String(req.body?.old_password || '');
    const password = requireStrongPassword(req.body?.password);
    const r = await dbQuery(`select password_hash from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    const user = r.rows[0];
    if (!user) return fail(res, 404, '用户不存在');
    if (user.password_hash) {
      const matched = await bcrypt.compare(oldPassword, user.password_hash);
      if (!matched) return fail(res, 401, '原密码不正确');
    }
    const hash = await bcrypt.hash(password, 10);
    const userInfo = await dbQuery(`select email, phone from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    // 修改密码同样同步到同一人的所有账号行
    await dbQuery(
      `update public.app_users set password_hash=$1, updated_at=now()
       where id=$2
          or (email is not null and lower(email)=lower($3))
          or (phone is not null and phone=$4)`,
      [hash, req.user.user_id, userInfo.rows[0]?.email || '', userInfo.rows[0]?.phone || null]
    );
    await audit(req, 'user_change_password', 'app_user', req.user.user_id, {});
    return ok(res, { message: '密码已修改，下次登录请使用新密码' });
  } catch (e) {
    return fail(res, 500, '修改密码失败', { error: e.message });
  }
});

// ==================== 第二阶段：验证码登录 / 论坛 / 招聘 / 捐赠 / 通知 / 地图 / 签到 ====================

async function ensurePhase2Tables() {
  if (!pool) return;
  await dbQuery(`create table if not exists public.login_codes (
    id bigserial primary key,
    email text not null,
    code_hash text not null,
    purpose text default 'login',
    expires_at timestamptz not null,
    used boolean default false,
    created_at timestamptz default now()
  )`);
  await dbQuery(`create index if not exists idx_login_codes_email on public.login_codes (email)`);
  await dbQuery(`create table if not exists public.forum_categories (
    id bigserial primary key,
    name text not null,
    description text,
    sort_order integer default 0,
    is_active boolean default true,
    created_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.forum_posts (
    id bigserial primary key,
    category_id bigint references public.forum_categories(id) on delete set null,
    user_id bigint references public.app_users(id) on delete set null,
    author_name text,
    title text not null,
    content text not null,
    view_count integer default 0,
    reply_count integer default 0,
    is_pinned boolean default false,
    is_locked boolean default false,
    status text default 'published',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.forum_replies (
    id bigserial primary key,
    post_id bigint not null references public.forum_posts(id) on delete cascade,
    user_id bigint references public.app_users(id) on delete set null,
    author_name text,
    content text not null,
    created_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.jobs (
    id bigserial primary key,
    company text not null,
    title text not null,
    location text,
    type text default '全职',
    salary text,
    description text,
    requirements text,
    contact text,
    is_published boolean default true,
    created_by bigint,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.job_applications (
    id bigserial primary key,
    job_id bigint not null references public.jobs(id) on delete cascade,
    user_id bigint references public.app_users(id) on delete set null,
    name text not null,
    phone text,
    email text,
    resume_url text,
    note text,
    status text default 'submitted',
    created_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.donations (
    id bigserial primary key,
    user_id bigint references public.app_users(id) on delete set null,
    donor_name text not null,
    amount numeric(12,2) not null,
    purpose text default '校友基金',
    message text,
    payment_method text default '线下转账',
    payment_ref text,
    status text default 'pending',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
  await dbQuery(`create table if not exists public.notifications (
    id bigserial primary key,
    user_id bigint references public.app_users(id) on delete cascade,
    title text not null,
    content text,
    link text,
    is_read boolean default false,
    created_at timestamptz default now()
  )`);
  await dbQuery(`create index if not exists idx_notifications_user on public.notifications (user_id, is_read)`);
  await dbQuery(`create table if not exists public.map_points (
    id bigserial primary key,
    name text not null,
    province text,
    city text,
    longitude text,
    latitude text,
    category text default '联络站',
    description text,
    is_active boolean default true,
    created_by bigint,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
}

// ---------- 邮箱验证码登录 ----------
app.post('/api/auth/send-login-code', async (req, res) => {
  try {
    const identifier = normalizeEmail(req.body?.email || req.body?.account || '');
    if (!identifier) return fail(res, 400, '请输入邮箱或手机号');
    const isPhone = /^\d{6,}$/.test(identifier);
    if (!isPhone && !identifier.includes('@')) return fail(res, 400, '请输入有效的邮箱或手机号');
    const r = isPhone
      ? await dbQuery(`select id, phone from public.app_users where phone=$1 limit 1`, [identifier])
      : await dbQuery(`select id, phone from public.app_users where lower(email)=lower($1) limit 1`, [identifier]);
    if (!r.rows[0]) return fail(res, 404, '该账号未注册，请先在「注册」页完成注册认证');
    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const recent = await dbQuery(
      `select id from public.login_codes where email=$1 and used=false and created_at > now() - interval '60 seconds' limit 1`,
      [identifier]
    ).catch(() => ({ rows: [] }));
    if (recent.rows[0]) return fail(res, 429, '验证码刚刚已发送，请 60 秒后再试');
    await dbQuery(`delete from public.login_codes where email=$1 and used=false and expires_at < now()`, [identifier]).catch(() => {});
    await dbQuery(
      `insert into public.login_codes (email, code_hash, purpose, expires_at)
       values ($1,$2,'login', now() + interval '10 minutes')
       returning id`,
      [identifier, codeHash]
    );
    return ok(res, {
      login_code: code,
      message: '验证码已生成（当前未接入邮件/短信服务，请使用页面上的验证码，10 分钟内有效）'
    });
  } catch (e) {
    return fail(res, 500, '发送验证码失败', { error: e.message });
  }
});

app.post('/api/auth/code-login', async (req, res) => {
  try {
    const identifier = normalizeEmail(req.body?.email || req.body?.account || '');
    const code = String(req.body?.code || '').trim();
    if (!identifier || !/^\d{6}$/.test(code)) return fail(res, 400, '请输入邮箱/手机号和 6 位验证码');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const r = await dbQuery(
      `select lc.id, lc.expires_at, u.id as user_id, u.display_name, u.phone, u.role, u.status
       from public.login_codes lc
       join public.app_users u on (lower(u.email) = lower($1) or u.phone = $1)
       where lc.email = $1 and lc.code_hash = $2 and lc.used = false and lc.purpose = 'login'
       order by lc.created_at desc
       limit 1`,
      [identifier, codeHash]
    );
    const row = r.rows[0];
    if (!row) return fail(res, 400, '验证码无效或已使用');
    if (new Date(row.expires_at) < new Date()) return fail(res, 400, '验证码已过期，请重新获取');
    await dbQuery(`update public.login_codes set used=true where id=$1`, [row.id]);
    const token = jwt.sign(
      { user_id: row.user_id, role: row.role, type: 'alumni' },
      TOKEN_SECRET,
      { expiresIn: '7d' }
    );
    await audit(req, 'auth_login_code', 'app_user', row.user_id, { identifier });
    return ok(res, {
      token,
      user: { name: row.display_name, email: identifier, phone: row.phone, role: row.role, status: row.status },
      message: '验证码登录成功'
    });
  } catch (e) {
    return fail(res, 500, '验证码登录失败', { error: e.message });
  }
});

// ---------- 校友论坛（公开） ----------
app.get('/api/forum/categories', async (req, res) => {
  try {
    const r = await dbQuery(
      `select fc.*, (select count(*)::int from public.forum_posts p where p.category_id=fc.id and p.status='published') as post_count
       from public.forum_categories fc
       where fc.is_active = true
       order by fc.sort_order asc, fc.id asc`
    );
    return ok(res, { categories: r.rows });
  } catch (e) {
    return fail(res, 500, '获取论坛版块失败', { error: e.message });
  }
});

app.get('/api/forum/posts', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 10), 50);
    const categoryId = parsePositiveInt(req.query.categoryId, 0);
    const q = req.query.q;
    const params = [];
    const wheres = [`p.status = 'published'`];
    if (categoryId) { params.push(categoryId); wheres.push(`p.category_id = $${params.length}`); }
    if (q) { params.push(`%${q}%`); wheres.push(`(p.title ilike $${params.length} or p.content ilike $${params.length})`); }
    const where = wheres.join(' and ');
    const count = await dbQuery(`select count(*)::int as total from public.forum_posts p where ${where}`, params);
    const total = count.rows[0].total;
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select p.id, p.category_id, c.name as category_name, p.user_id, p.author_name, p.title, p.view_count,
              p.reply_count, p.is_pinned, p.created_at, p.updated_at
       from public.forum_posts p
       left join public.forum_categories c on c.id = p.category_id
       where ${where}
       order by p.is_pinned desc, p.updated_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return ok(res, { total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取帖子失败', { error: e.message });
  }
});

app.get('/api/forum/posts/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    if (!id) return fail(res, 400, '帖子不存在');
    await dbQuery(`update public.forum_posts set view_count = view_count + 1 where id=$1 and status='published'`, [id]).catch(() => {});
    const r = await dbQuery(
      `select p.*, c.name as category_name
       from public.forum_posts p
       left join public.forum_categories c on c.id = p.category_id
       where p.id=$1 and p.status='published'`,
      [id]
    );
    const post = r.rows[0];
    if (!post) return fail(res, 404, '帖子不存在');
    const replies = await dbQuery(
      `select * from public.forum_replies where post_id=$1 order by created_at asc`,
      [id]
    );
    return ok(res, { post, replies: replies.rows });
  } catch (e) {
    return fail(res, 500, '获取帖子详情失败', { error: e.message });
  }
});

app.post('/api/forum/posts', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const content = String(b.content || '').trim();
    const categoryId = parsePositiveInt(b.category_id, 0);
    if (!title) return fail(res, 400, '标题不能为空');
    if (content.length < 5) return fail(res, 400, '内容至少 5 个字');
    if (!categoryId) return fail(res, 400, '请选择版块');
    const me = await dbQuery(`select display_name from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    const authorName = (me.rows[0] && me.rows[0].display_name) || '校友';
    const r = await dbQuery(
      `insert into public.forum_posts (category_id, user_id, author_name, title, content)
       values ($1,$2,$3,$4,$5) returning *`,
      [categoryId, req.user.user_id, authorName, title, content]
    );
    await audit(req, 'forum_post_create', 'forum_post', r.rows[0].id, { title });
    return ok(res, { post: r.rows[0], message: '发布成功' });
  } catch (e) {
    return fail(res, 500, '发布失败', { error: e.message });
  }
});

app.post('/api/forum/posts/:id/replies', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const content = String(req.body?.content || '').trim();
    if (!id) return fail(res, 400, '帖子不存在');
    if (content.length < 2) return fail(res, 400, '回复内容至少 2 个字');
    const post = await dbQuery(`select id, is_locked, status from public.forum_posts where id=$1 limit 1`, [id]);
    if (!post.rows[0]) return fail(res, 404, '帖子不存在');
    if (post.rows[0].is_locked) return fail(res, 403, '该帖已锁定，无法回复');
    const me = await dbQuery(`select display_name from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    const authorName = (me.rows[0] && me.rows[0].display_name) || '校友';
    const r = await dbQuery(
      `insert into public.forum_replies (post_id, user_id, author_name, content)
       values ($1,$2,$3,$4) returning *`,
      [id, req.user.user_id, authorName, content]
    );
    await dbQuery(`update public.forum_posts set reply_count = reply_count + 1, updated_at = now() where id=$1`, [id]);
    return ok(res, { reply: r.rows[0], message: '回复成功' });
  } catch (e) {
    return fail(res, 500, '回复失败', { error: e.message });
  }
});

// ---------- 校友论坛（管理） ----------
app.get('/api/admin/forum/posts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select p.*, c.name as category_name
       from public.forum_posts p
       left join public.forum_categories c on c.id = p.category_id
       order by p.created_at desc
       limit 500`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取帖子失败', { error: e.message });
  }
});

app.patch('/api/admin/forum/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const sets = [];
    const params = [];
    ['status', 'is_pinned', 'is_locked', 'title', 'content', 'category_id'].forEach((key) => {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${key} = $${params.length}`);
      }
    });
    if (!sets.length) return fail(res, 400, '没有可更新的内容');
    params.push(id);
    const r = await dbQuery(
      `update public.forum_posts set ${sets.join(', ')}, updated_at = now() where id = $${params.length} returning *`,
      params
    );
    if (!r.rows[0]) return fail(res, 404, '帖子不存在');
    await audit(req, 'forum_post_update', 'forum_post', id, {});
    return ok(res, { post: r.rows[0], message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新帖子失败', { error: e.message });
  }
});

app.delete('/api/admin/forum/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    await dbQuery(`delete from public.forum_posts where id=$1`, [id]);
    await audit(req, 'forum_post_delete', 'forum_post', id, {});
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除帖子失败', { error: e.message });
  }
});

app.post('/api/admin/forum/categories', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return fail(res, 400, '版块名称不能为空');
    const r = await dbQuery(
      `insert into public.forum_categories (name, description, sort_order, is_active)
       values ($1,$2,$3,$4) returning *`,
      [name, b.description || null, parsePositiveInt(b.sort_order, 0), b.is_active !== false]
    );
    await audit(req, 'forum_category_create', 'forum_category', r.rows[0].id, { name });
    return ok(res, { category: r.rows[0], message: '版块已创建' });
  } catch (e) {
    return fail(res, 500, '创建版块失败', { error: e.message });
  }
});

app.patch('/api/admin/forum/categories/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const sets = [];
    const params = [];
    ['name', 'description', 'sort_order', 'is_active'].forEach((key) => {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${key} = $${params.length}`);
      }
    });
    if (!sets.length) return fail(res, 400, '没有可更新的内容');
    params.push(id);
    const r = await dbQuery(`update public.forum_categories set ${sets.join(', ')} where id=$${params.length} returning *`, params);
    if (!r.rows[0]) return fail(res, 404, '版块不存在');
    return ok(res, { category: r.rows[0], message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新版块失败', { error: e.message });
  }
});

// ---------- 校友招聘（公开） ----------
app.get('/api/jobs', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 10), 50);
    const q = req.query.q;
    const params = [];
    let where = `where is_published = true`;
    if (q) {
      params.push(`%${q}%`);
      where += ` and (company ilike $${params.length} or title ilike $${params.length} or location ilike $${params.length})`;
    }
    const count = await dbQuery(`select count(*)::int as total from public.jobs ${where}`, params);
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select id, company, title, location, type, salary, is_published, created_at
       from public.jobs ${where}
       order by created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取招聘信息失败', { error: e.message });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(`select * from public.jobs where id=$1 and is_published=true`, [id]);
    if (!r.rows[0]) return fail(res, 404, '招聘信息不存在');
    return ok(res, { job: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取招聘详情失败', { error: e.message });
  }
});

app.post('/api/jobs/:id/apply', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return fail(res, 400, '姓名和联系电话不能为空');
    const job = await dbQuery(`select id from public.jobs where id=$1 and is_published=true`, [id]);
    if (!job.rows[0]) return fail(res, 404, '招聘信息不存在');
    const r = await dbQuery(
      `insert into public.job_applications (job_id, user_id, name, phone, email, resume_url, note)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [id, req.user ? req.user.user_id : null, name, phone, b.email || null, b.resume_url || null, b.note || null]
    );
    return ok(res, { application: r.rows[0], message: '简历已投递，招聘方会尽快联系你' });
  } catch (e) {
    return fail(res, 500, '投递失败', { error: e.message });
  }
});

// ---------- 校友招聘（管理） ----------
app.get('/api/admin/jobs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`select j.*, (select count(*)::int from public.job_applications ja where ja.job_id = j.id) as applications_count from public.jobs j order by j.created_at desc limit 500`);
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取招聘列表失败', { error: e.message });
  }
});

app.post('/api/admin/jobs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const company = String(b.company || '').trim();
    const title = String(b.title || '').trim();
    if (!company || !title) return fail(res, 400, '公司和职位不能为空');
    const r = await dbQuery(
      `insert into public.jobs (company, title, location, type, salary, description, requirements, contact, is_published, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [company, title, b.location || null, b.type || '全职', b.salary || null, b.description || null, b.requirements || null, b.contact || null, b.is_published !== false, req.user.admin_id]
    );
    await audit(req, 'job_create', 'job', r.rows[0].id, { company, title });
    return ok(res, { job: r.rows[0], message: '招聘信息已发布' });
  } catch (e) {
    return fail(res, 500, '发布招聘失败', { error: e.message });
  }
});

app.patch('/api/admin/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const sets = [];
    const params = [];
    ['company', 'title', 'location', 'type', 'salary', 'description', 'requirements', 'contact', 'is_published'].forEach((key) => {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${key} = $${params.length}`);
      }
    });
    if (!sets.length) return fail(res, 400, '没有可更新的内容');
    params.push(id);
    const r = await dbQuery(`update public.jobs set ${sets.join(', ')}, updated_at = now() where id=$${params.length} returning *`, params);
    if (!r.rows[0]) return fail(res, 404, '招聘信息不存在');
    await audit(req, 'job_update', 'job', id, {});
    return ok(res, { job: r.rows[0], message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新招聘失败', { error: e.message });
  }
});

app.delete('/api/admin/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    await dbQuery(`delete from public.jobs where id=$1`, [id]);
    await audit(req, 'job_delete', 'job', id, {});
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除招聘失败', { error: e.message });
  }
});

app.get('/api/admin/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(`select * from public.jobs where id=$1`, [id]);
    if (!r.rows[0]) return fail(res, 404, '招聘信息不存在');
    return ok(res, { job: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取招聘详情失败', { error: e.message });
  }
});
app.get('/api/admin/jobs/:id/applications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(
      `select ja.*, j.company, j.title
       from public.job_applications ja
       join public.jobs j on j.id = ja.job_id
       where ja.job_id = $1
       order by ja.created_at desc`,
      [id]
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取投递记录失败', { error: e.message });
  }
});

app.patch('/api/admin/job-applications/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const status = String(req.body?.status || '').trim();
    if (!['submitted', 'contacted', 'interview', 'accepted', 'rejected'].includes(status)) return fail(res, 400, '状态不正确');
    const r = await dbQuery(`update public.job_applications set status=$1 where id=$2 returning *`, [status, id]);
    if (!r.rows[0]) return fail(res, 404, '投递记录不存在');
    return ok(res, { application: r.rows[0], message: '状态已更新' });
  } catch (e) {
    return fail(res, 500, '更新失败', { error: e.message });
  }
});

// ---------- 在线捐赠 ----------
app.get('/api/donations', async (req, res) => {
  try {
    const r = await dbQuery(
      `select id, donor_name, amount, purpose, message, created_at
       from public.donations where status='confirmed'
       order by created_at desc
       limit 100`
    );
    const sum = await dbQuery(`select coalesce(sum(amount),0)::numeric(12,2) as total, count(*)::int as count from public.donations where status='confirmed'`);
    return ok(res, { items: r.rows, total: sum.rows[0].total, count: sum.rows[0].count });
  } catch (e) {
    return fail(res, 500, '获取捐赠记录失败', { error: e.message });
  }
});

app.post('/api/donations', async (req, res) => {
  try {
    const b = req.body || {};
    const donorName = String(b.donor_name || '').trim();
    const amount = Number(b.amount);
    if (!donorName) return fail(res, 400, '请填写捐赠人姓名');
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, '捐赠金额必须大于 0');
    const orderNo = genOrderNo();
    const r = await dbQuery(
      `insert into public.donations (user_id, donor_name, amount, purpose, message, payment_method, payment_ref, order_no, payment_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning *`,
      [req.user ? req.user.user_id : null, donorName, amount.toFixed(2), b.purpose || '校友基金', b.message || null, b.payment_method || '线下转账', b.payment_ref || null, orderNo]
    );
    const paymentHint = (b.payment_method === '微信' || b.payment_method === '支付宝')
      ? '在线收款网关待接入，请按后台确认流程线下转账或联系校友会。'
      : '请按校友会提供的收款账户完成转账，转账时备注订单号。';
    return ok(res, { donation: r.rows[0], order_no: orderNo, message: `捐赠意向已提交（订单号：${orderNo}）。${paymentHint} 管理员确认后将在捐赠榜展示。` });
  } catch (e) {
    return fail(res, 500, '提交捐赠失败', { error: e.message });
  }
});

app.get('/api/admin/donations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(`select * from public.donations order by created_at desc limit 500`);
    const sum = await dbQuery(`select coalesce(sum(amount),0)::numeric(12,2) as total, count(*)::int as count from public.donations where status='confirmed'`);
    return ok(res, { items: r.rows, total: sum.rows[0].total, count: sum.rows[0].count });
  } catch (e) {
    return fail(res, 500, '获取捐赠列表失败', { error: e.message });
  }
});

app.patch('/api/admin/donations/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const status = String(req.body?.status || '').trim();
    if (!['pending', 'confirmed', 'rejected'].includes(status)) return fail(res, 400, '状态不正确');
    const r = await dbQuery(`update public.donations set status=$1, updated_at=now() where id=$2 returning *`, [status, id]);
    if (!r.rows[0]) return fail(res, 404, '捐赠记录不存在');
    await audit(req, 'donation_' + status, 'donation', id, {});
    return ok(res, { donation: r.rows[0], message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新捐赠失败', { error: e.message });
  }
});

// ---------- 消息通知 ----------
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 100);
    const offset = (page - 1) * pageSize;
    const count = await dbQuery(`select count(*)::int as total from public.notifications where user_id=$1`, [req.user.user_id]);
    const r = await dbQuery(
      `select * from public.notifications where user_id=$1 order by created_at desc limit $2 offset $3`,
      [req.user.user_id, pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取通知失败', { error: e.message });
  }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(`select count(*)::int as count from public.notifications where user_id=$1 and is_read=false`, [req.user.user_id]);
    return ok(res, { count: r.rows[0].count });
  } catch (e) {
    return fail(res, 500, '获取未读数量失败', { error: e.message });
  }
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.all) {
      await dbQuery(`update public.notifications set is_read=true where user_id=$1`, [req.user.user_id]);
    } else {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (ids.length) {
        await dbQuery(
          `update public.notifications set is_read=true where user_id=$1 and id = any($2::bigint[])`,
          [req.user.user_id, ids]
        );
      }
    }
    return ok(res, { message: '已标记为已读' });
  } catch (e) {
    return fail(res, 500, '操作失败', { error: e.message });
  }
});

let wechatAccessTokenCache = null;
async function wechatAccessToken() {
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) return null;
  if (wechatAccessTokenCache && wechatAccessTokenCache.expiresAt > Date.now()) return wechatAccessTokenCache.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(process.env.WECHAT_APPID)}&secret=${encodeURIComponent(process.env.WECHAT_SECRET)}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!data.access_token) return null;
  wechatAccessTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return data.access_token;
}

async function pushWechatTemplate(openid, title, content, link) {
  const token = await wechatAccessToken();
  if (!token) return { ok: false, message: '微信未配置或获取 token 失败' };
  const templateId = process.env.WECHAT_TEMPLATE_ID;
  if (!templateId) return { ok: false, message: '未配置 WECHAT_TEMPLATE_ID' };
  const url = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`;
  const payload = {
    touser: openid,
    template_id: templateId,
    page: link || 'pages/index/index',
    data: {
      thing1: { value: String(title).slice(0, 20) },
      thing2: { value: String(content).slice(0, 20) },
      time3: { value: new Date().toLocaleString('zh-CN', { hour12: false }) }
    }
  };
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    return data.errcode === 0 ? { ok: true } : { ok: false, message: data.errmsg || '微信推送失败' };
  } catch (e) {
    return { ok: false, message: '微信推送异常' };
  }
}

app.post('/api/admin/notifications/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return fail(res, 400, '通知标题不能为空');
    const content = String(b.content || '').trim() || title;
    const link = b.link ? String(b.link) : null;
    const channel = ['site', 'wechat', 'email', 'all'].includes(b.channel) ? b.channel : 'site';
    let result;
    if (b.user_id) {
      const r = await dbQuery(
        `insert into public.notifications (user_id, title, content, link, channel)
         values ($1,$2,$3,$4,$5) returning *`,
        [b.user_id, title, content, link, channel]
      );
      result = { rows: r.rows, sent: 1 };
    } else {
      // 广播给所有已注册用户
      const users = await dbQuery(`select id from public.app_users`);
      for (const row of users.rows) {
        await dbQuery(
          `insert into public.notifications (user_id, title, content, link, channel) values ($1,$2,$3,$4,$5)`,
          [row.id, title, content, link, channel]
        );
      }
      result = { rows: [{ id: null }], sent: users.rows.length };
    }
    // 微信/邮件渠道推送（尽力而为，失败不影响站内通知）
    const channelNote = [];
    if (channel === 'wechat' || channel === 'all') {
      const targets = b.user_id
        ? await dbQuery(`select wechat_openid from public.app_users where id=$1 and wechat_openid is not null`, [b.user_id])
        : await dbQuery(`select wechat_openid from public.app_users where wechat_openid is not null and wechat_openid <> ''`);
      let pushed = 0;
      let failed = 0;
      for (const t of targets.rows) {
        const r = await pushWechatTemplate(t.wechat_openid, title, content, link);
        if (r.ok) pushed += 1; else failed += 1;
      }
      channelNote.push(`微信模板消息 ${pushed} 成功${failed ? `、${failed} 失败` : ''}`);
    }
    if (channel === 'email' || channel === 'all') {
      channelNote.push(process.env.SMTP_HOST ? '邮件已按配置尝试发送（邮件网关待接入）' : '未配置 SMTP，邮件渠道跳过');
    }
    await audit(req, 'notification_send', 'notification', result.rows[0].id, { title, broadcast: !b.user_id, channel });
    const base = b.user_id ? '通知已发送' : `通知已广播给 ${result.sent} 位用户`;
    return ok(res, { message: channelNote.length ? `${base}；${channelNote.join('；')}` : base });
  } catch (e) {
    return fail(res, 500, '发送通知失败', { error: e.message });
  }
});

// ---------- 校友地图 ----------
app.get('/api/alumni/map', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select current_province, current_city, count(*)::int as count
       from public.alumni_profiles
       where status='approved' and current_province is not null and current_province <> ''
       group by current_province, current_city
       order by count desc`
    );
    const provinces = await dbQuery(
      `select current_province, count(*)::int as count
       from public.alumni_profiles
       where status='approved' and current_province is not null and current_province <> ''
       group by current_province
       order by count desc`
    );
    return ok(res, { cities: r.rows, provinces: provinces.rows });
  } catch (e) {
    return fail(res, 500, '获取校友分布失败', { error: e.message });
  }
});

// 地图标注点（公开，前台展示）
app.get('/api/map/points', async (req, res) => {
  try {
    const r = await dbQuery(
      `select id, name, province, city, longitude, latitude, category, description
       from public.map_points
       where is_active = true
       order by province asc, city asc, id asc
       limit 500`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取地图标注点失败', { error: e.message });
  }
});

// 地图标注点（管理端）
app.get('/api/admin/map/points', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select * from public.map_points order by province asc, city asc, id desc limit 500`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取地图标注点失败', { error: e.message });
  }
});

app.post('/api/admin/map/points', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return fail(res, 400, '标注点名称不能为空');
    const r = await dbQuery(
      `insert into public.map_points (name, province, city, longitude, latitude, category, description, is_active, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [name, b.province || null, b.city || null, b.longitude || null, b.latitude || null,
       b.category || '联络站', b.description || null, b.is_active !== false, req.user.admin_id]
    );
    await audit(req, 'map_point_create', 'map_point', r.rows[0].id, { name });
    return ok(res, { point: r.rows[0], message: '标注点已添加' });
  } catch (e) {
    return fail(res, 500, '添加标注点失败', { error: e.message });
  }
});

app.patch('/api/admin/map/points/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const r = await dbQuery(
      `update public.map_points set
         name=$1, province=$2, city=$3, longitude=$4, latitude=$5,
         category=$6, description=$7, is_active=$8, updated_at=now()
       where id=$9 returning *`,
      [String(b.name || '').trim(), b.province || null, b.city || null, b.longitude || null,
       b.latitude || null, b.category || '联络站', b.description || null, b.is_active !== false, id]
    );
    if (!r.rows[0]) return fail(res, 404, '标注点不存在');
    await audit(req, 'map_point_update', 'map_point', id, { name: r.rows[0].name });
    return ok(res, { point: r.rows[0], message: '标注点已更新' });
  } catch (e) {
    return fail(res, 500, '更新标注点失败', { error: e.message });
  }
});

app.delete('/api/admin/map/points/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(`delete from public.map_points where id=$1 returning id`, [id]);
    if (!r.rows[0]) return fail(res, 404, '标注点不存在');
    await audit(req, 'map_point_delete', 'map_point', id, {});
    return ok(res, { message: '标注点已删除' });
  } catch (e) {
    return fail(res, 500, '删除标注点失败', { error: e.message });
  }
});

// ---------- 活动二维码签到 ----------
function checkinToken(eventId) {
  const payload = `checkin:${eventId}`;
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex').slice(0, 24);
}

app.post('/api/admin/events/:id/checkin-code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(`select id, title from public.events where id=$1`, [id]);
    if (!r.rows[0]) return fail(res, 404, '活动不存在');
    const token = checkinToken(id);
    const checkinUrl = `${PUBLIC_SITE_URL}/checkin.html?event=${id}&code=${token}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(checkinUrl)}`;
    return ok(res, { checkin_url: checkinUrl, qr_image_url: qrUrl, token });
  } catch (e) {
    return fail(res, 500, '生成签到码失败', { error: e.message });
  }
});

app.post('/api/events/checkin', async (req, res) => {
  try {
    const b = req.body || {};
    const eventId = parsePositiveInt(b.event_id, 0);
    const code = String(b.code || '').trim();
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!eventId || !code) return fail(res, 400, '参数不完整');
    if (checkinToken(eventId) !== code) return fail(res, 403, '签到码无效');
    if (!name || !phone) return fail(res, 400, '请填写姓名和手机号');
    const reg = await dbQuery(
      `select id from public.event_registrations where event_id=$1 and phone=$2 limit 1`,
      [eventId, phone]
    );
    if (reg.rows[0]) {
      await dbQuery(`update public.event_registrations set status='checked_in', updated_at=now() where id=$1`, [reg.rows[0].id]);
    } else {
      await dbQuery(
        `insert into public.event_registrations (event_id, user_id, name, phone, status)
         values ($1,$2,$3,$4,'checked_in')`,
        [eventId, req.user ? req.user.user_id : null, name, phone]
      ).catch(async () => {
        const dup = await dbQuery(`select id from public.event_registrations where event_id=$1 and phone=$2 limit 1`, [eventId, phone]);
        if (dup.rows[0]) await dbQuery(`update public.event_registrations set status='checked_in', updated_at=now() where id=$1`, [dup.rows[0].id]);
      });
    }
    await audit(req, 'event_checkin', 'event', eventId, { name, phone });
    return ok(res, { message: `${name}，签到成功！` });
  } catch (e) {
    return fail(res, 500, '签到失败', { error: e.message });
  }
});

// ==================== 第三轮补充：管理端通知/版块/内容区块种子 ====================

async function ensureSitePagesSeed() {
  if (!pool) return;
  const pages = [
    { slug: 'home', title: '首页', description: '海林市高级中学校友（新海高人）官方网站首页' },
    { slug: 'about', title: '校友会介绍', description: '海林市高级中学校友（新海高人）简介' },
    { slug: 'news', title: '新闻公告', description: '校友会新闻与公告' },
    { slug: 'events', title: '活动中心', description: '校友会活动' },
    { slug: 'contact', title: '联系我们', description: '联系我们' },
    { slug: 'alumni', title: '校友风采', description: '杰出校友风采展示' },
    { slug: 'directory', title: '校友名录', description: '已认证校友名录查询' },
    { slug: 'forum', title: '校友论坛', description: '校友交流互助' },
    { slug: 'jobs', title: '新海高人招聘', description: '新海高人招聘' },
    { slug: 'companies', title: '校友企业', description: '校友企业黄页' },
    { slug: 'map', title: '校友地图', description: '校友分布与地标' },
    { slug: 'messages', title: '校友私信', description: '校友站内沟通' },
    { slug: 'checkin', title: '活动签到', description: '活动扫码签到' },
    { slug: 'news-detail', title: '新闻详情', description: '新闻详情页' }
  ];
  for (const p of pages) {
    const exists = await dbQuery("select id from public.site_pages where slug=$1 limit 1", [p.slug]);
    if (!exists.rows[0]) {
      await dbQuery('insert into public.site_pages (slug, title, description, is_public, sort_order) ' + 'values ($1,$2,$3,true,0) on conflict (slug) do nothing', [p.slug, p.title, p.description]);
    }
  }
}

async function ensureSiteSectionsSeed() {
  if (!pool) return;
  const seed = [
    { page_slug: 'home', section_key: 'home_hero', section_name: '首页横幅', content: { hero_title: '共忆青春海高路，同筑未来校友情', hero_subtitle: '海林市高级中学校友（新海高人）欢迎你', hero_bg_url: '', btn_text: '加入我们', btn_link: 'account.html' } },
    { page_slug: 'home', section_key: 'home_notice', section_name: '首页公告', content: { notice_text: '欢迎校友回家！请登录后完成校友认证。' } },
    { page_slug: 'home', section_key: 'home_stats', section_name: '数据概览', content: { stats: [{ label: '校友会员', value: '0' }, { label: '活动组织', value: '0' }, { label: '服务母校', value: '0' }] } },
    { page_slug: 'home', section_key: 'home_figures', section_name: '校友论坛', content: { title: '校友论坛', subtitle: '校友交流互助，分享工作生活，重逢海高情谊。', items: [] } },
    { page_slug: 'home', section_key: 'home_services', section_name: '校友服务', content: { title: '校友服务', subtitle: '为校友提供更贴心的服务', items: [] } },
    { page_slug: 'about', section_key: 'about_intro', section_name: '校友会介绍', content: { title: '校友会介绍', content: '' } },
    { page_slug: 'about', section_key: 'about_contact', section_name: '联系方式', content: { email: 'xinhaigaoren@126.com', address: '黑龙江省牡丹江市海林市', phone: '' } },
    { page_slug: 'about', section_key: 'about_body', section_name: '介绍页正文', content: { html: '' } },
    { page_slug: 'contact', section_key: 'contact_info', section_name: '联系我们', content: { email: 'xinhaigaoren@126.com', address: '黑龙江省牡丹江市海林市', phone: '', wechat: '' } },
    { page_slug: 'about', section_key: 'about_hero', section_name: '介绍页横幅', content: { eyebrow: 'About', title: '新海高人', subtitle: '联络校友、服务校友、回馈母校、助力家乡。' } },
    { page_slug: 'news', section_key: 'news_hero', section_name: '新闻页横幅', content: { eyebrow: 'News', title: '新闻公告', subtitle: '记录母校发展，发布校友资讯，传递海高声音。' } },
    { page_slug: 'events', section_key: 'events_hero', section_name: '活动页横幅', content: { eyebrow: 'Events', title: '活动中心', subtitle: '返校日、主题论坛、班级聚会、志愿服务……期待与你重逢。' } },
    { page_slug: 'directory', section_key: 'directory_hero', section_name: '名录页横幅', content: { eyebrow: 'Directory', title: '校友名录', subtitle: '已认证校友专属：查询同窗、找到同行。' } },
    { page_slug: 'forum', section_key: 'forum_hero', section_name: '论坛页横幅', content: { eyebrow: 'Forum', title: '校友论坛', subtitle: '校友交流互助，分享工作生活，重逢海高情谊。' } },
    { page_slug: 'jobs', section_key: 'jobs_hero', section_name: '招聘页横幅', content: { eyebrow: 'Jobs', title: '新海高人招聘', subtitle: '新海高人企业发布职位，校友人才精准对接。' } },
    { page_slug: 'companies', section_key: 'companies_hero', section_name: '企业页横幅', content: { eyebrow: 'Companies', title: '校友企业', subtitle: '凝聚校友企业力量，促进合作共赢。' } },
    { page_slug: 'map', section_key: 'map_hero', section_name: '地图页横幅', content: { eyebrow: 'Map', title: '校友地图', subtitle: '天涯海角，海高人同在。看看校友们都分布在哪里。' } },
    { page_slug: 'messages', section_key: 'messages_hero', section_name: '私信页横幅', content: { eyebrow: 'Messages', title: '校友私信', subtitle: '站内即时沟通，聊聊近况、约场球、叙叙旧。' } },
    { page_slug: 'checkin', section_key: 'checkin_hero', section_name: '签到页横幅', content: { eyebrow: 'Check-in', title: '活动签到', subtitle: '扫码签到，记录你的每一次到场。' } },
    { page_slug: 'contact', section_key: 'contact_hero', section_name: '联系页横幅', content: { eyebrow: 'Contact', title: '联系我们', subtitle: '校友会秘书处欢迎校友来信来访。' } }
  ];
  for (const item of seed) {
    const exists = await dbQuery(`select id from public.site_sections where section_key=$1 limit 1`, [item.section_key]);
    if (!exists.rows[0]) {
      await dbQuery(
        `insert into public.site_sections (page_slug, section_key, section_name, content, display_order)
         values ($1,$2,$3,$4,$5) on conflict (section_key) do nothing`,
        [item.page_slug, item.section_key, item.section_name, JSON.stringify(item.content), 0]
      );
    }
  }
}

// 品牌名统一：把旧名称自动更新为新名称（覆盖已存在数据）
async function ensureBrandRename() {
  if (!pool) return;
  const oldName = '海林市高级中学校友会';
  const newName = '海林市高级中学校友（新海高人）';
  const walk = async (sectionKey) => {
    const rows = await dbQuery(
      `select id, content from public.site_sections where section_key=$1 limit 1`,
      [sectionKey]
    ).catch(() => ({ rows: [] }));
    for (const row of rows.rows || []) {
      let c = row.content;
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
      if (!c || typeof c !== 'object') continue;
      let changed = false;
      for (const key of Object.keys(c)) {
        if (typeof c[key] === 'string' && c[key].includes(oldName)) {
          c[key] = c[key].split(oldName).join(newName);
          changed = true;
        }
      }
      if (changed) await dbQuery(
        `update public.site_sections set content=$1, updated_at=now() where id=$2`,
        [JSON.stringify(c), row.id]
      );
    }
  };
  await walk('footer_info');
  await walk('home_hero');
}

// 存量数据修复：凡有已通过认证记录的手机号，对应 app_users 一律提升为已认证校友
async function ensureAlumniRoleSync() {
  if (!pool) return;
  await dbQuery(
    `update public.app_users u
     set role='alumni', status='active', updated_at=now()
     where (u.role='pending_alumni' or u.status='pending')
       and u.phone is not null
       and exists (select 1 from public.alumni_verifications v
                   where v.phone = u.phone and v.status='approved')`
  ).catch(() => {});
}

// 官网栏目改名 / 删除捐赠板块：把数据库里已存的内容同步到新版
async function ensureHomeRename() {
  if (!pool) return;
  const patchSection = async (sectionKey, mutate) => {
    const rows = await dbQuery(
      `select id, content from public.site_sections where section_key=$1 limit 1`,
      [sectionKey]
    ).catch(() => ({ rows: [] }));
    for (const row of rows.rows || []) {
      let c = row.content;
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
      if (!c || typeof c !== 'object') continue;
      mutate(c);
      await dbQuery(
        `update public.site_sections set content=$1, updated_at=now() where id=$2`,
        [JSON.stringify(c), row.id]
      ).catch(() => {});
    }
  };
  await patchSection('home_figures', (c) => {
    if (c.title === '校友风采') c.title = '校友论坛';
    if (typeof c.subtitle === 'string' && c.subtitle.includes('杰出')) c.subtitle = '校友交流互助，分享工作生活，重逢海高情谊。';
  });
  await patchSection('home_join', (c) => {
    if (c.title === '加入海高校友会') c.title = '加入新海高人';
  });
  await patchSection('about_hero', (c) => {
    if (c.title === '校友会介绍') c.title = '新海高人';
  });
  // 概况四宫格改为后台可单独编辑：去掉旧的整段 HTML，回退到四个可编辑字段
  await patchSection('home_about_body', (c) => {
    if ('html' in c) delete c.html;
  });
  await patchSection('home_about', (c) => {
    if (c.title === '校友会概况') c.title = '新海高人概况';
  });
  // 联系邮箱统一改为新邮箱（覆盖页脚、联系页等所有已存内容）
  const allSections = await dbQuery(`select id, content from public.site_sections`).catch(() => ({ rows: [] }));
  for (const row of allSections.rows || []) {
    let c = row.content;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
    if (!c || typeof c !== 'object') continue;
    let changed = false;
    for (const key of Object.keys(c)) {
      if (typeof c[key] === 'string' && c[key].includes('alumni@example.com')) {
        c[key] = c[key].split('alumni@example.com').join('xinhaigaoren@126.com');
        changed = true;
      }
    }
    if (changed) await dbQuery(
      `update public.site_sections set content=$1, updated_at=now() where id=$2`,
      [JSON.stringify(c), row.id]
    ).catch(() => {});
  }
  await patchSection('jobs_hero', (c) => {
    if (c.title === '校友招聘') c.title = '新海高人招聘';
  });
  await patchSection('home_services_body', (c) => {
    if (typeof c.html === 'string' && c.html) {
      c.html = c.html
        .replace(/<a href="donate\.html"[^>]*><span>03<\/span>[^<]*<\/a>/, '<a href="forum.html"><span>03</span>校友论坛</a>')
        .replace(/地区联络站与班级联络人/g, '地区联络站和地区联络人')
        .replace(/奖助学金与公益项目/g, '校友论坛');
    }
  });
  // 删除已不存在的捐赠板块
  await dbQuery(`delete from public.site_sections where section_key in ('home_donate','donate_hero')`).catch(() => {});
  await dbQuery(`delete from public.site_pages where slug='donate'`).catch(() => {});
}

app.get('/api/admin/forum/categories', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select fc.*, (select count(*)::int from public.forum_posts p where p.category_id=fc.id) as post_count
       from public.forum_categories fc
       order by fc.sort_order asc, fc.id asc`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取版块失败', { error: e.message });
  }
});

app.get('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 50), 200);
    const offset = (page - 1) * pageSize;
    const count = await dbQuery(`select count(*)::int as total from public.notifications`);
    const r = await dbQuery(
      `select n.*, u.display_name as user_name
       from public.notifications n
       left join public.app_users u on u.id = n.user_id
       order by n.created_at desc
       limit $1 offset $2`,
      [pageSize, offset]
    );
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取通知记录失败', { error: e.message });
  }
});

app.delete('/api/admin/notifications/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    if (!id) return fail(res, 400, '通知不存在');
    await dbQuery(`delete from public.notifications where id=$1`, [id]);
    await audit(req, 'notification_delete', 'notification', id, {});
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除通知失败', { error: e.message });
  }
});

// 管理端读取全部内容区块（含未公开页面）
app.get('/api/admin/content/sections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = req.query.page;
    const params = [];
    let where = '';
    if (page) { params.push(page); where = 'where page_slug=$1'; }
    const r = await dbQuery(`select * from public.site_sections ${where} order by page_slug asc, display_order asc, created_at asc`, params);
    return ok(res, { sections: r.rows });
  } catch (e) {
    return fail(res, 500, '获取内容区块失败', { error: e.message });
  }
});
// ==================== 第三阶段：私信聊天 / 企业黄页 / 通知渠道 / 捐赠订单 / 智能搜索 ====================

async function ensurePhase3Tables() {
  if (!pool) return;
  await dbQuery(`create table if not exists public.conversations (
    id bigserial primary key,
    user_a bigint not null references public.app_users(id) on delete cascade,
    user_b bigint not null references public.app_users(id) on delete cascade,
    last_message_at timestamptz default now(),
    created_at timestamptz default now(),
    unique (user_a, user_b)
  )`);
  await dbQuery(`create table if not exists public.messages (
    id bigserial primary key,
    conversation_id bigint not null references public.conversations(id) on delete cascade,
    sender_id bigint references public.app_users(id) on delete set null,
    content text not null,
    is_read boolean default false,
    created_at timestamptz default now()
  )`);
  await dbQuery(`create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at)`);
  await dbQuery(`create table if not exists public.companies (
    id bigserial primary key,
    name text not null,
    logo_url text,
    industry text,
    city text,
    website text,
    intro text,
    contact text,
    owner_user_id bigint references public.app_users(id) on delete set null,
    status text default 'published',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`);
  await dbQuery(`alter table public.notifications add column if not exists channel text default 'site'`);
  await dbQuery(`alter table public.donations add column if not exists order_no text`);
  await dbQuery(`alter table public.donations add column if not exists payment_status text default 'pending'`);
}

// 会话双方规范化：始终 user_a < user_b，保证唯一
function conversationPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// ---------- 即时聊天（站内私信，轮询） ----------
app.post('/api/messages/conversations', requireAuth, async (req, res) => {
  try {
    const peerId = parsePositiveInt(req.body?.peer_id, 0);
    if (!peerId) return fail(res, 400, '请选择聊天对象');
    if (peerId === req.user.user_id) return fail(res, 400, '不能和自己聊天');
    const peer = await dbQuery(`select id from public.app_users where id=$1 and status='active' limit 1`, [peerId]);
    if (!peer.rows[0]) return fail(res, 404, '对方不存在');
    const [a, b] = conversationPair(req.user.user_id, peerId);
    const r = await dbQuery(
      `insert into public.conversations (user_a, user_b)
       values ($1,$2)
       on conflict (user_a, user_b) do update set last_message_at = now()
       returning *`,
      [a, b]
    );
    return ok(res, { conversation: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '创建会话失败', { error: e.message });
  }
});

app.get('/api/messages/conversations', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select c.id, c.user_a, c.user_b, c.last_message_at,
              (select count(*)::int from public.messages m where m.conversation_id=c.id and m.sender_id <> $1 and m.is_read=false) as unread_count,
              (select content from public.messages m where m.conversation_id=c.id order by m.created_at desc limit 1) as last_message,
              (select created_at from public.messages m where m.conversation_id=c.id order by m.created_at desc limit 1) as last_message_at2,
              (case when c.user_a = $1 then c.user_b else c.user_a end) as peer_id,
              (select display_name from public.app_users u where u.id = (case when c.user_a = $1 then c.user_b else c.user_a end)) as peer_name
       from public.conversations c
       where c.user_a = $1 or c.user_b = $1
       order by c.last_message_at desc
       limit 200`,
      [req.user.user_id]
    );
    return ok(res, { conversations: r.rows });
  } catch (e) {
    return fail(res, 500, '获取会话列表失败', { error: e.message });
  }
});

app.get('/api/messages/conversations/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const convo = await dbQuery(
      `select * from public.conversations where id=$1 and (user_a=$2 or user_b=$2) limit 1`,
      [id, req.user.user_id]
    );
    if (!convo.rows[0]) return fail(res, 404, '会话不存在');
    const r = await dbQuery(
      `select m.*, u.display_name as sender_name
       from public.messages m
       left join public.app_users u on u.id = m.sender_id
       where m.conversation_id=$1
       order by m.created_at asc
       limit 500`,
      [id]
    );
    await dbQuery(
      `update public.messages set is_read=true where conversation_id=$1 and sender_id <> $2 and is_read=false`,
      [id, req.user.user_id]
    );
    const peerId = convo.rows[0].user_a === req.user.user_id ? convo.rows[0].user_b : convo.rows[0].user_a;
    const peer = await dbQuery(`select display_name from public.app_users where id=$1 limit 1`, [peerId]);
    return ok(res, { messages: r.rows, peer_id: peerId, peer_name: (peer.rows[0] && peer.rows[0].display_name) || '校友', conversation_id: id });
  } catch (e) {
    return fail(res, 500, '获取消息失败', { error: e.message });
  }
});

app.post('/api/messages/conversations/:id', requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const content = String(req.body?.content || '').trim();
    if (!content) return fail(res, 400, '消息不能为空');
    if (content.length > 2000) return fail(res, 400, '消息过长（最多 2000 字）');
    const convo = await dbQuery(
      `select * from public.conversations where id=$1 and (user_a=$2 or user_b=$2) limit 1`,
      [id, req.user.user_id]
    );
    if (!convo.rows[0]) return fail(res, 404, '会话不存在');
    const r = await dbQuery(
      `insert into public.messages (conversation_id, sender_id, content) values ($1,$2,$3) returning *`,
      [id, req.user.user_id, content]
    );
    await dbQuery(`update public.conversations set last_message_at=now() where id=$1`, [id]);
    return ok(res, { message: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '发送失败', { error: e.message });
  }
});

app.get('/api/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(
      `select count(*)::int as count
       from public.messages m
       join public.conversations c on c.id = m.conversation_id
       where (c.user_a=$1 or c.user_b=$1) and m.sender_id <> $1 and m.is_read=false`,
      [req.user.user_id]
    );
    return ok(res, { count: r.rows[0].count });
  } catch (e) {
    return fail(res, 500, '获取未读数量失败', { error: e.message });
  }
});

app.get('/api/admin/messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select m.id, m.content, m.created_at, m.is_read, m.sender_id,
              s.display_name as sender_name,
              c.user_a, c.user_b,
              (select display_name from public.app_users u where u.id = c.user_a) as user_a_name,
              (select display_name from public.app_users u where u.id = c.user_b) as user_b_name
       from public.messages m
       join public.conversations c on c.id = m.conversation_id
       left join public.app_users s on s.id = m.sender_id
       order by m.created_at desc
       limit 300`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取消息记录失败', { error: e.message });
  }
});

// ---------- 校友企业黄页 ----------
app.get('/api/companies', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 12), 50);
    const q = req.query.q;
    const industry = req.query.industry;
    const params = [];
    const wheres = [`status='published'`];
    if (q) { params.push(`%${q}%`); wheres.push(`(name ilike $${params.length} or intro ilike $${params.length} or city ilike $${params.length})`); }
    if (industry) { params.push(industry); wheres.push(`industry = $${params.length}`); }
    const where = wheres.join(' and ');
    const count = await dbQuery(`select count(*)::int as total from public.companies where ${where}`, params);
    const offset = (page - 1) * pageSize;
    const r = await dbQuery(
      `select id, name, logo_url, industry, city, website, intro, contact, created_at
       from public.companies where ${where}
       order by created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    const industries = await dbQuery(`select distinct industry from public.companies where status='published' and industry is not null and industry <> '' order by industry`);
    return ok(res, { total: count.rows[0].total, page, pageSize, items: r.rows, industries: industries.rows.map((row) => row.industry) });
  } catch (e) {
    return fail(res, 500, '获取企业列表失败', { error: e.message });
  }
});

app.get('/api/companies/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const r = await dbQuery(`select * from public.companies where id=$1 and status='published'`, [id]);
    if (!r.rows[0]) return fail(res, 404, '企业不存在');
    return ok(res, { company: r.rows[0] });
  } catch (e) {
    return fail(res, 500, '获取企业详情失败', { error: e.message });
  }
});

app.post('/api/companies', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return fail(res, 400, '企业名称不能为空');
    const r = await dbQuery(
      `insert into public.companies (name, logo_url, industry, city, website, intro, contact, owner_user_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning *`,
      [name, b.logo_url || null, b.industry || null, b.city || null, b.website || null, b.intro || null, b.contact || null, req.user.user_id]
    );
    await audit(req, 'company_submit', 'company', r.rows[0].id, { name });
    return ok(res, { company: r.rows[0], message: '企业信息已提交，管理员审核后展示在黄页' });
  } catch (e) {
    return fail(res, 500, '提交企业失败', { error: e.message });
  }
});

// ---------- 校友企业黄页（管理） ----------
app.get('/api/admin/companies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `select c.*, u.display_name as owner_name
       from public.companies c
       left join public.app_users u on u.id = c.owner_user_id
       order by c.created_at desc
       limit 500`
    );
    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, '获取企业列表失败', { error: e.message });
  }
});

app.post('/api/admin/companies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return fail(res, 400, '企业名称不能为空');
    const r = await dbQuery(
      `insert into public.companies (name, logo_url, industry, city, website, intro, contact, owner_user_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [name, b.logo_url || null, b.industry || null, b.city || null, b.website || null, b.intro || null, b.contact || null, b.owner_user_id || null, b.status || 'published']
    );
    await audit(req, 'company_create', 'company', r.rows[0].id, { name });
    return ok(res, { company: r.rows[0], message: '企业已创建' });
  } catch (e) {
    return fail(res, 500, '创建企业失败', { error: e.message });
  }
});

app.patch('/api/admin/companies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const b = req.body || {};
    const sets = [];
    const params = [];
    ['name', 'logo_url', 'industry', 'city', 'website', 'intro', 'contact', 'status'].forEach((key) => {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${key} = $${params.length}`);
      }
    });
    if (!sets.length) return fail(res, 400, '没有可更新的内容');
    params.push(id);
    const r = await dbQuery(`update public.companies set ${sets.join(', ')}, updated_at=now() where id=$${params.length} returning *`, params);
    if (!r.rows[0]) return fail(res, 404, '企业不存在');
    await audit(req, 'company_update', 'company', id, {});
    return ok(res, { company: r.rows[0], message: '已更新' });
  } catch (e) {
    return fail(res, 500, '更新企业失败', { error: e.message });
  }
});

app.delete('/api/admin/companies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    await dbQuery(`delete from public.companies where id=$1`, [id]);
    await audit(req, 'company_delete', 'company', id, {});
    return ok(res, { message: '已删除' });
  } catch (e) {
    return fail(res, 500, '删除企业失败', { error: e.message });
  }
});

// ---------- 捐赠订单升级 ----------
function genOrderNo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `D${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// ---------- 智能校友搜索（模糊搜索；配置 AI_API_KEY 后可启用 AI 增强） ----------
app.get('/api/alumni/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return fail(res, 400, '请输入至少 2 个字');
    const params = [`%${q}%`];
    const r = await dbQuery(
      `select p.id, p.name, p.graduation_year, p.class_name, p.current_province, p.current_city,
              p.industry, p.company, p.position_title, p.bio
       from public.alumni_profiles p
       where p.status='approved'
         and (p.name ilike $1 or p.company ilike $1 or p.position_title ilike $1 or p.industry ilike $1
              or p.current_city ilike $1 or p.current_province ilike $1 or p.bio ilike $1)
       order by case when p.name ilike $1 then 0 when p.company ilike $1 then 1 else 2 end, p.graduation_year desc
       limit 50`,
      params
    );
    const aiEnabled = Boolean(process.env.AI_API_KEY);
    return ok(res, {
      items: r.rows,
      mode: aiEnabled ? 'ai' : 'fuzzy',
      note: aiEnabled ? 'AI 增强搜索' : '当前为模糊搜索（配置 AI_API_KEY 后可启用 AI 增强）'
    });
  } catch (e) {
    return fail(res, 500, '搜索失败', { error: e.message });
  }
});
// 当前登录用户信息（含 user_id）
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const r = await dbQuery(`select id, display_name, email, phone, role, status from public.app_users where id=$1 limit 1`, [req.user.user_id]);
    if (!r.rows[0]) return fail(res, 404, '用户不存在');
    const u = r.rows[0];
    return ok(res, { user: { user_id: u.id, name: u.display_name, email: u.email, phone: u.phone, role: u.role, status: u.status } });
  } catch (e) {
    return fail(res, 500, '获取用户信息失败', { error: e.message });
  }
});
app.use((req, res) => {
  fail(res, 404, '接口不存在');
});

bootstrapSchema()
  .then(() => ensureRootAdmin())
  .then(() => ensureContentTables())
  .then(() => ensureUserTableExtras())
  .then(() => ensurePasswordResetTable())
  .then(() => ensureAlumniProfileExtras())
  .then(() => ensurePhase2Tables())
  .then(() => ensureSitePagesSeed())
  .then(() => ensureSiteSectionsSeed())
  .then(() => ensureBrandRename())
  .then(() => ensureAlumniRoleSync())
  .then(() => ensureHomeRename())
  .then(() => ensurePhase3Tables())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`hailin alumni backend running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('startup failed:', e);
    app.listen(PORT, () => {
      console.log(`hailin alumni backend running without database init on http://localhost:${PORT}`);
    });
  });
