# 上线部署指南（海林市高级中学校友会平台）

> 本文档为部署记录与维护指南（2026-08 已上线，2026-10 完成红色主视觉升级与公网/内网分离改造）。

## 已上线地址

- 公网官网：https://xinhaigaoren.github.io/web/
- 内网门户：https://xinhaigaoren.github.io/web/internal/（登录/注册/认证/个人中心/私信/论坛/签到）
- 管理后台：https://xinhaigaoren.github.io/web/internal/admin/
- 后端 API：https://hailin-alumni-api.onrender.com
- 健康检查：https://hailin-alumni-api.onrender.com/api/health
- 源代码仓库：https://github.com/Xinhaigaoren/web

> 注意：GitHub Pages 本身是公网托管。**内网门户在 GitHub Pages 上仅是「入口不公开」，并不等于真正的网络隔离**。生产环境如需强隔离，请按下文「内网网络隔离」部署。

## 架构

```text
浏览器
 ├── GitHub Pages 静态站点（公网页面 / internal/ 内网页面 / 管理后台，由 GitHub Actions 自动发布）
 └── Render 后端 API（server/server.js，Node.js + Express，Free 实例）
       └── Supabase PostgreSQL（项目 hailin-alumni，Free 计划，长期保留）
```

## 公网 / 内网页面划分

### 公网（仅公开信息，无登录入口）

| 页面 | 说明 |
| --- | --- |
| index.html | 官网首页（导航与页脚无登录入口） |
| about.html | 校友会介绍 |
| news.html / news-detail.html | 新闻公告 |
| events.html / event-detail.html | 活动中心（公开报名表单） |
| directory.html | 校友公开名录（联系方式仅在本人授权公开时展示） |
| companies.html / company-detail.html | 校友企业黄页（仅公开展示） |
| jobs.html / job-detail.html | 校友招聘（公开职位） |
| donate.html | 公益捐赠（捐赠公示，公网只读） |
| map.html | 校友地图（聚合分布数据） |
| contact.html | 联系我们 |

### 内网（`internal/` 子路径，仅内网可见）

| 页面 | 说明 |
| --- | --- |
| internal/account.html | 登录 / 注册 / 校友认证 / 个人中心 |
| internal/messages.html | 站内私信 |
| internal/forum.html | 校友论坛 |
| internal/checkin.html | 活动扫码签到 |
| internal/post-detail.html | 论坛帖子详情 |
| internal/admin/ | 管理后台 |

隔离要点：

- 公网 HTML 源码中**不含**任何内网页面链接或内网接口地址（已通过扫描验证）
- `robots.txt` 已屏蔽 `/internal/`、`/admin/`、`/server/`
- `sitemap.xml` 仅包含公网页面
- 内网页面与公网共用 `style.css` / `pages.css`，渲染风格完全一致，仅多「内网」标识与内部功能导航
- 内网接口（登录、认证、私信、论坛、签到、管理）均有后端鉴权中间件；公网接口仅提供公开数据

## 内网网络隔离（生产环境建议）

GitHub Pages 无法真正限制访问，若内网门户需要强隔离，任选其一：

1. **独立域名 + 网关鉴权**：将 `internal/` 目录部署到独立域名（如 internal.example.com）并置于 Nginx / Cloudflare Access / VPN 之后，仅允许白名单 IP 或登录员工访问。
2. **同站访问控制**：在 CDN / 反向代理层对 `/internal/` 路径加 IP 白名单或 HTTP Basic Auth。
3. **后端托管**：把内网页面改为由后端渲染/托管，后端仅在内网网段响应 `/internal/` 请求。

## 关键配置

### 后端（Render Web Service：hailin-alumni-api）

已配置环境变量：

```text
DATABASE_URL=postgresql://hailin_alumni_db_user:xxxx@dpg-xxxx-a/hailin_alumni_db
TOKEN_SECRET=（已设置随机长串）
ADMIN_USER=admin
ADMIN_PASSWORD=（已设置强密码，见下文「管理员登录」）
PUBLIC_SITE_URL=https://xinhaigaoren.github.io/web
# 微信登录暂缓接入：未配置 WECHAT_APPID / WECHAT_SECRET 时后端自动禁用微信登录
```

- 构建命令：`npm install`
- 启动命令：`node server.js`
- 后端已连接 GitHub 仓库，推送 main 自动重新部署。

### 数据库（Supabase PostgreSQL：hailin-alumni）

- 计划：Free（500 MB，长期保留；仅当连续 7 天无访问时自动暂停，重新恢复即可继续使用，数据不丢失）
- 表结构：`server/schema.sql`（后端启动时自动执行建表与默认数据种子，无需手动操作）
- 默认页面：后端启动自动写入 home/about/news/events/contact/alumni 页面及首页横幅等区块，可直接在管理后台编辑。

### 管理员登录

- 后台地址：https://xinhaigaoren.github.io/web/internal/admin/
- 账号：`admin`
- 密码：`Hailin@2026#Admin`
- 登录后请到「系统设置」或直接修改环境变量 `ADMIN_PASSWORD` 更换为你的专属密码。

## 微信登录（暂缓接入）

- 本项目当前**跳过微信接入**，未申请微信开放平台认证（300 元/次费用暂缓）。
- 后端 `/api/auth/wechat/*` 代码已保留但默认禁用：只有配置 `WECHAT_APPID` / `WECHAT_SECRET` 后才启用。
- 内网登录页（internal/account.html）已移除微信登录按钮。
- 未来如需开通：注册微信开放平台 → 开发者资质认证（300 元）→ 创建网站应用 → 配置 `WECHAT_APPID` / `WECHAT_SECRET` / `WECHAT_LOGIN_REDIRECT` → 在开放平台配置授权回调域。优先实现 PC 端扫码登录。

## 日常更新流程

1. 改代码后推送 `main`：GitHub Actions 自动发布前台，Render 自动重新部署后端。
2. 管理员在后台直接编辑：新闻、活动、首页横幅、校友风采、校友服务等（无需改代码）。
3. 校友管理：内网登录 → 提交校友认证（含学信网截图）→ 管理员审核。

## 常见问题

- 后端返回 500 / 数据库连接失败：检查 Render 上 `DATABASE_URL` 是否指向有效数据库（免费库过期会导致连接失败）。
- 数据库暂停：登录 Supabase 控制台点击 Resume project 恢复（数据自动还原）；恢复后无需改任何配置。
- GitHub Pages 更新慢：Actions 完成后等待 1-2 分钟生效。
- 图片上传 413：上传接口限制 10MB，前端限制 5MB 图片。
- 内网页面打不开 / 样式错乱：确认直接访问 `internal/xxx.html`，且浏览器无缓存旧版 `style.css` / `pages.css`（文件带版本号，改版本号即可强制刷新）。

## 安全清单（上线前检查）

- [ ] 把 `ADMIN_PASSWORD` 换成只有你知道的强密码
- [ ] 数据库升级为 Basic 计划（避免 30 天过期丢数据），或迁移到 Supabase 长期免费库
- [ ] 学信网截图改存私有对象存储（Cloudflare R2 / S3），并开启数据库备份
- [ ] 发布《隐私政策》《用户协议》页面（模板见 `docs/privacy-template.md`）
- [ ] 确认 `.env` 未提交到 GitHub（`server/.env` 已在 .gitignore 中）
- [ ] 确认公网页面无内网链接、内网接口均带鉴权（可跑回归脚本验证）
- [ ] 微信登录如需开通再走开放平台认证流程（当前暂缓）
