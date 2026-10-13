# 海林市高级中学校友会平台（Xinhai Alumni Platform）

海高人在线校友平台：官网（公网） + 校友中心（内网） + 管理后台 + 社区功能（论坛 / 招聘 / 捐赠 / 地图 / 通知 / 扫码签到）。

## 架构说明（公网 / 内网分离）

- **公网**（GitHub Pages，仅公开信息）：`index.html`、`about.html`、`news.html`、`news-detail.html`、`events.html`、`event-detail.html`、`directory.html`（仅公开名录）、`contact.html`、`companies.html`、`company-detail.html`、`jobs.html`、`job-detail.html`、`donate.html`、`map.html`
- **内网**（`internal/` 子路径，建议部署在独立域名 / VPN / 受控网络后）：`internal/account.html`（登录/注册/认证/个人中心）、`internal/messages.html`（私信）、`internal/forum.html`（论坛）、`internal/checkin.html`（签到）、`internal/post-detail.html`，以及管理后台 `internal/admin/`
- 公网页面不包含内网页面链接与内网接口地址；`robots.txt` 已屏蔽 `/internal/`、`/admin/`、`/server/`
- 内网页面使用与公网完全相同的 `style.css` / `pages.css`，仅多一个「内网」标识与内部功能导航，渲染风格一致

## 功能总览

- **官网前台**（公网，公开信息）
  - 首页 / 校友会介绍 / 新闻公告 / 活动中心 / 校友公开名录 / 联系我们
  - 校友企业黄页（公开展示）、校友招聘（公开职位）、公益捐赠（捐赠公示）、校友地图（聚合分布）
- **校友中心**（内网，需登录）
  - `account.html` 登录 / 注册 / 校友认证 / 个人中心
  - `forum.html` 校友论坛、`messages.html` 站内私信、`checkin.html` 活动扫码签到
- **管理后台** `internal/admin/`
  - 校友认证审批、管理员管理、内容修改审批、我的账号
  - 新闻管理、活动管理（含报名管理）、数据统计、校友名录（导出 / 导入 CSV）
  - 用户管理（启用 / 停用 / 重置密码）
  - **内容区块管理**：官网各页面模块（首页横幅、公告、数据、校友风采、校友服务、联系方式等）直接在后台编辑发布
  - 论坛管理（版块 / 帖子置顶、锁定、隐藏、删除）
  - 招聘管理（职位发布 / 投递跟进）
  - 捐赠管理（确认 / 拒绝，确认后展示在官网捐赠榜）
  - 消息推送（向全部或指定用户发送通知）
  - 活动签到码（生成二维码，校友扫码签到）

## 技术栈

- 前台：HTML + CSS + 原生 JS（`style.css` / `pages.css` / `site.js`）
- 后台：HTML + CSS + 原生 JS（`internal/admin/admin.js`）
- 后端：Node.js + Express（`server/server.js`）
- 数据库：PostgreSQL（Supabase 可用），建表语句见 `server/schema.sql`，服务启动时自动补齐新表

## 文件说明

```text
index.html / about.html / news.html / news-detail.html / events.html
directory.html / contact.html / companies.html / company-detail.html
jobs.html / job-detail.html / donate.html / map.html   公网页面
internal/          内网门户（account / messages / forum / checkin / post-detail / admin）
style.css / pages.css / site.js   官网样式与脚本（公网 / 内网共用）
config.js          前端接口地址配置
server/            Node.js 后端（server.js / schema.sql / .env.example）
assets/            图片资源
```

## 本地开发

```bash
cd server
npm install
cp .env.example .env   # 配置 DATABASE_URL、TOKEN_SECRET 等
npm start              # 后端启动，默认端口 3000
```

前端直接用浏览器打开 `index.html` 即可；接口地址在 `config.js` 中修改：

```js
window.HAILIN_CONFIG = {
  API_BASE_URL: "http://localhost:3000"   // 上线后改为你的后端地址
};
```

内网门户通过 `internal/account.html` 等子路径访问，本地开发直接打开即可；生产环境建议用独立域名或置于 VPN / IP 白名单之后。

## 部署

完整上线步骤见 **docs/上线部署指南.md**（Supabase 建库 → Render 后端 → GitHub Pages 前端 → 内网部署与网络隔离 → 安全清单）。仓库已内置：

- .github/workflows/deploy-pages.yml：推送到 main 自动发布 GitHub Pages
- server/Dockerfile + server/Procfile + server/render.yaml：后端容器化 / Render 部署

## 登录与消息推送

- 登录：密码登录、邮箱验证码登录（微信登录暂缓接入，未配置 `WECHAT_APPID` / `WECHAT_SECRET` 时后端自动禁用）
- 消息推送目前为站内通知；后续可扩展微信模板消息 / 邮件 / 短信网关

## 隐私与合规

- 不要将用户敏感资料提交到 GitHub 仓库（`.env` 中的密钥、数据库连接串等严禁提交）
- 上线前请补充《隐私政策》《用户协议》与数据保留策略
- 公网仅提供公开信息；校友联系方式仅在本人授权公开时展示
