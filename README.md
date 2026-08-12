# 海林市高级中学校友会平台（Xinhai Alumni Platform）

海高人在线校友平台：官网 + 校友认证 + 管理后台 + 第二阶段社区功能（论坛 / 招聘 / 捐赠 / 地图 / 通知 / 扫码签到）。

## 功能总览

- **官网前台**（静态站点，GitHub Pages 可直接部署）
  - `index.html` 首页、`about.html` 校友会介绍、`news.html` 新闻公告、`events.html` 活动中心
  - `directory.html` 校友名录、`account.html` 登录/注册/认证/个人中心
  - `forum.html` 校友论坛、`jobs.html` 校友招聘、`donate.html` 在线捐赠
  - `map.html` 校友地图、`checkin.html` 活动扫码签到、`contact.html` 联系我们
- **校友系统**
  - 注册/登录：密码登录、邮箱验证码登录、微信登录（可配置）
  - 校友认证：上传学信网截图等证明材料，管理员审核
  - 忘记密码（邮箱 + 重置码）、个人中心自助修改密码
  - 我的消息：接收管理员推送的站内通知
- **管理后台** `/admin/`
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
- 后台：HTML + CSS + 原生 JS（`admin/admin.js`）
- 后端：Node.js + Express（`server/server.js`）
- 数据库：PostgreSQL（Supabase 可用），建表语句见 `server/schema.sql`，服务启动时自动补齐新表

## 文件说明

```text
index.html / about.html / news.html / news-detail.html / events.html
directory.html / account.html / contact.html / forum.html / jobs.html
donate.html / map.html / checkin.html   官网页面
style.css / pages.css / site.js / script.js   官网样式与脚本
config.js            前端接口地址配置
admin/               管理后台（index.html / admin.js / admin.css）
server/              Node.js 后端（server.js / schema.sql / .env.example）
assets/              图片资源
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

## 部署

- 前台：GitHub Pages 部署仓库根目录即可
- 后端：部署到任意 Node.js 服务（Render / Railway / 云服务器），设置环境变量
- 微信登录：配置 `.env` 中的 `WECHAT_APPID` / `WECHAT_SECRET` 后自动启用
- 消息推送目前为站内通知；后续可扩展微信模板消息 / 邮件 / 短信网关

## 隐私与合规

- 学信网截图等证明材料仅管理员可见，建议配合私有对象存储
- 不要将用户敏感资料提交到 GitHub 仓库
- 上线前请补充《隐私政策》《用户协议》与数据保留策略