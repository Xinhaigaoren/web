-- ============================================================
-- 海林市高级中学校友会 / 新海高人校友平台 数据库 Schema
-- 适用：PostgreSQL（Supabase）
-- 说明：所有语句均可重复执行（create table if not exists）
-- ============================================================

-- ---------- 用户 ----------
create table if not exists public.app_users (
  id bigserial primary key,
  phone text unique,
  email text unique,
  display_name text not null,
  role text not null default 'pending_alumni',   -- pending_alumni / alumni / admin / super_admin
  status text not null default 'pending',        -- pending / active / disabled
  password_hash text,
  is_phone_verified boolean default false,
  is_email_verified boolean default false,
  last_login_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 管理员账号 ----------
create table if not exists public.admin_accounts (
  id bigserial primary key,
  user_id bigint not null unique references public.app_users(id) on delete cascade,
  admin_level text not null default 'admin',     -- super_admin / admin / editor / reviewer / viewer
  status text not null default 'pending',        -- pending / approved / disabled
  invited_by bigint,
  approved_by bigint,
  approved_at timestamptz,
  title text,
  department text,
  province text,
  city text,
  permissions jsonb default '{}',
  last_password_changed_at timestamptz,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 校友认证申请 ----------
create table if not exists public.alumni_verifications (
  id bigserial primary key,
  applicant_type text default 'graduated_alumni',
  name text not null,
  phone text not null,
  gender text,
  id_tail text,
  province text,
  city text,
  county text,
  current_province text,
  current_city text,
  current_county text,
  graduation_year text,
  class_name text,
  homeroom_teacher text,
  school_year text,
  current_school text,
  university_graduated text,
  chsi_proof_url text,
  student_card_url text,
  admission_notice_url text,
  extra_materials text default '[]',
  consent_personal_info boolean default true,
  consent_material_review boolean default true,
  status text not null default 'pending',        -- pending / approved / rejected / need_more_info
  reject_reason text,
  reviewed_by bigint,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 校友档案 ----------
create table if not exists public.alumni_profiles (
  id bigserial primary key,
  user_id bigint unique references public.app_users(id) on delete cascade,
  verification_id bigint references public.alumni_verifications(id) on delete set null,
  name text not null,
  phone text,
  province text,
  city text,
  county text,
  current_province text,
  current_city text,
  current_county text,
  graduation_year text,
  class_name text,
  homeroom_teacher text,
  industry text,
  company text,
  position_title text,
  wechat text,
  bio text,
  avatar_url text,
  public_contact boolean default false,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 官网页面与内容区块 ----------
create table if not exists public.site_pages (
  id bigserial primary key,
  slug text unique not null,
  title text,
  description text,
  current_content text,
  sort_order integer default 0,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.site_sections (
  id bigserial primary key,
  page_slug text not null,
  section_key text unique not null,
  section_name text not null,
  content text default '{}',
  display_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.content_change_requests (
  id bigserial primary key,
  target_type text default 'section',
  page_slug text,
  section_key text,
  title text,
  proposed_content text,
  status text not null default 'pending',
  submitted_by_admin bigint,
  reviewed_by_admin bigint,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 管理员邀请 ----------
create table if not exists public.admin_invites (
  id bigserial primary key,
  invite_code text unique not null,
  invitee_email text not null,
  invitee_name text,
  invitee_phone text,
  title text,
  department text,
  admin_level text default 'admin',
  permissions jsonb default '{}',
  inviter_admin_id bigint,
  status text not null default 'invited',        -- invited / accepted / approved / rejected
  accepted_at timestamptz,
  accepted_password_hash text,
  personal_info text,
  approved_by bigint,
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 审计日志 ----------
create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_user_id bigint,
  actor_role text,
  action text,
  target_type text,
  target_id text,
  ip_address text,
  user_agent text,
  detail text,
  created_at timestamptz default now()
);

-- ---------- 地区目录 ----------
create table if not exists public.region_catalog (
  code text primary key,
  name text not null,
  level integer,
  parent_code text
);

-- ============================================================
-- 以下为内容系统与校友中心新增表
-- ============================================================

-- ---------- 新闻公告 ----------
create table if not exists public.news_articles (
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
);

-- ---------- 活动 ----------
create table if not exists public.events (
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
);

-- ---------- 活动报名 ----------
create table if not exists public.event_registrations (
  id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  user_id bigint references public.app_users(id) on delete set null,
  name text not null,
  phone text,
  email text,
  remark text,
  status text default 'registered',   -- registered / cancelled / checked_in
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (event_id, phone)
);

-- ---------- 上传文件（学信网截图等；接入 R2/S3 后可迁移） ----------
create table if not exists public.uploads (
  id text primary key,
  user_id bigint references public.app_users(id) on delete set null,
  filename text,
  mime_type text,
  size_bytes integer,
  purpose text,
  data text,
  created_at timestamptz default now()
);

-- ---------- 索引 ----------
create index if not exists idx_alumni_verifications_status on public.alumni_verifications(status);
create index if not exists idx_alumni_profiles_user on public.alumni_profiles(user_id);
create index if not exists idx_news_published on public.news_articles(published_at desc);
create index if not exists idx_events_time on public.events(start_time);
create index if not exists idx_event_regs_event on public.event_registrations(event_id);
create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);