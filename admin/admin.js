const API_BASE_URL = window.HAILIN_CONFIG?.API_BASE_URL || 'https://hailin-alumni-api.onrender.com';
const tokenKey = 'hailin_admin_token';
const userKey = 'hailin_admin_user';

const loginPanel = document.querySelector('#loginPanel');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#loginForm');
const loginStatus = document.querySelector('#loginStatus');
const userInfo = document.querySelector('#userInfo');
const rows = document.querySelector('#applicationRows');
const requestRows = document.querySelector('#requestRows');
const refreshBtn = document.querySelector('#refreshBtn');
const logoutBtn = document.querySelector('#logoutBtn');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const homeForm = document.querySelector('#homeForm');
const homeStatus = document.querySelector('#homeStatus');
const loadHomeBtn = document.querySelector('#loadHomeBtn');
const loadRequestsBtn = document.querySelector('#loadRequestsBtn');
const invitePanel = document.querySelector('#invitePanel');
const acceptInviteForm = document.querySelector('#acceptInviteForm');
const inviteAcceptStatus = document.querySelector('#inviteAcceptStatus');
const backToLoginBtn = document.querySelector('#backToLoginBtn');
const inviteAdminForm = document.querySelector('#inviteAdminForm');
const directAdminForm = document.querySelector('#directAdminForm');
const directAdminStatus = document.querySelector('#directAdminStatus');
const inviteStatus = document.querySelector('#inviteStatus');
const inviteLinkOutput = document.querySelector('#inviteLinkOutput');
const inviteRows = document.querySelector('#inviteRows');
const adminRows = document.querySelector('#adminRows');
const loadAdminsBtn = document.querySelector('#loadAdminsBtn');
const profileForm = document.querySelector('#profileForm');
const profileStatus = document.querySelector('#profileStatus');
const passwordForm = document.querySelector('#passwordForm');
const passwordStatus = document.querySelector('#passwordStatus');

function getToken() { return localStorage.getItem(tokenKey); }
function setToken(token) { localStorage.setItem(tokenKey, token); }
function clearToken() { localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); }
function getUser() { try { return JSON.parse(localStorage.getItem(userKey) || '{}'); } catch { return {}; } }
function setUser(user) { localStorage.setItem(userKey, JSON.stringify(user || {})); }

function showDashboard() {
  const user = getUser();
  loginPanel.hidden = true;
  if (invitePanel) invitePanel.hidden = true;
  dashboard.hidden = false;
  userInfo.textContent = user.name ? `当前账号：${user.name}（${user.role || ''}${user.admin_level ? ' / ' + user.admin_level : ''}）` : '已登录';
}

function showLogin() {
  loginPanel.hidden = false;
  if (invitePanel) invitePanel.hidden = true;
  dashboard.hidden = true;
}

function showInvitePanel() {
  loginPanel.hidden = true;
  if (invitePanel) invitePanel.hidden = false;
  dashboard.hidden = true;
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusText(status) {
  return {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    need_more_info: '需补充材料',
    active: '启用',
    invited: '已邀请',
    accepted: '待主管理员审批',
    disabled: '已停用'
  }[status] || status || '未知';
}

function applicantTypeText(value) {
  return {
    graduated_alumni: '毕业校友',
    current_student: '在校师生',
    teacher: '教师',
    alumni: '校友'
  }[value] || value || '未填写';
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const message = data.message || data.error || '接口请求失败';
    // 管理员权限被停止 / 登录失效时，强制退出后台回到登录页
    if (response.status === 401 || /已被停止|未启用/.test(message)) {
      clearToken();
      setTimeout(() => { if (dashboard && !dashboard.hidden) showLogin(); }, 0);
    }
    throw new Error(message);
  }
  return data;
}

function setActiveTab(tabName) {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
  panels.forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}Panel`));
  if (tabName === 'applications') loadApplications();
  if (tabName === 'homeEditor') loadHomeContent();
  if (tabName === 'pageEditor') loadPageEditor();
  if (tabName === 'map') loadMapAdmin();
  if (tabName === 'contentRequests') loadContentRequests();
  if (tabName === 'admins') loadAdminManagement();
  if (tabName === 'account') loadMyAccount();
  if (tabName === 'news') loadNews();
  if (tabName === 'events') loadEvents();
  if (tabName === 'stats') loadStats();
  if (tabName === 'alumni') loadAlumniList();
  if (tabName === 'users') loadUsers();
  if (tabName === 'content') loadContentSections();
  if (tabName === 'forum') loadForum();
  if (tabName === 'jobs') loadJobsAdmin();
  if (tabName === 'notifications') loadNotificationsAdmin();
  if (tabName === 'companies') loadCompaniesAdmin();
  if (tabName === 'chat') loadChatAdmin();
  if (tabName === 'media') loadMedia();
}

tabs.forEach(tab => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

function updateCounts(items) {
  document.querySelector('#totalCount').textContent = items.length;
  document.querySelector('#pendingCount').textContent = items.filter(item => item.status === 'pending').length;
  document.querySelector('#approvedCount').textContent = items.filter(item => item.status === 'approved').length;
  document.querySelector('#rejectedCount').textContent = items.filter(item => item.status === 'rejected').length;
}

function materialLinks(item) {
  const links = [];
  if (item.chsi_proof_url) links.push(['学信网证明', item.chsi_proof_url]);
  if (item.student_card_url) links.push(['学生证件', item.student_card_url]);
  if (item.admission_notice_url) links.push(['录取通知书', item.admission_notice_url]);
  const extra = safeJson(item.extra_materials);
  if (Array.isArray(extra)) {
    extra.forEach((url, index) => {
      if (url) links.push([`补充材料${index + 1}`, url]);
    });
  }
  if (!links.length) return '未上传';
  return `<div class="material-list">${links.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`).join('')}</div>`;
}

async function loadApplications() {
  rows.innerHTML = '<tr><td colspan="7">正在加载……</td></tr>';
  try {
    const data = await api('/api/applications');
    const items = data.verifications || data.applications || data.items || [];
    updateCounts(items);
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="7">暂无申请</td></tr>';
      return;
    }
    const accountStatusMap = { active: '启用', pending: '待审核', disabled: '已停用' };
    rows.innerHTML = items.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(applicantTypeText(item.applicant_type))}<br>${escapeHtml(item.graduation_year || item.school_year || '')} ${escapeHtml(item.class_name || '')}<br>${escapeHtml(item.homeroom_teacher || '')}</td>
        <td>${escapeHtml([item.province, item.city, item.county].filter(Boolean).join(' / '))}<br>${escapeHtml([item.current_province, item.current_city, item.current_county].filter(Boolean).join(' / '))}</td>
        <td>${escapeHtml(item.phone || '')}<br>${escapeHtml(item.account_email || item.email || '')}</td>
        <td>${materialLinks(item)}</td>
        <td><span class="badge ${escapeHtml(item.status)}">${statusText(item.status)}</span>${item.account_status ? `<br><small>账号：${accountStatusMap[item.account_status] || item.account_status}</small>` : ''}</td>
        <td>
          <div class="row-actions">
            <button class="approve" data-review-id="${item.id}" data-status="approved">通过</button>
            <button class="reject" data-review-id="${item.id}" data-status="rejected">拒绝</button>
            <button class="ghost" data-review-id="${item.id}" data-status="need_more_info">补充</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
    if (String(error.message).includes('登录') || String(error.message).includes('过期') || String(error.message).includes('权限')) {
      clearToken();
      showLogin();
    }
  }
}

async function loadHomeContent() {
  homeStatus.textContent = '正在读取首页内容……';
  homeStatus.className = 'status';
  try {
    const data = await api(`/api/site/home?t=${Date.now()}`);
    const sections = {};
    (data.sections || []).forEach(item => {
      sections[item.section_key] = typeof item.content === 'string' ? safeJson(item.content) : (item.content || {});
    });
    const hero = sections.home_hero || {};
    const notice = sections.home_notice || {};
    const stats = sections.home_stats || {};
    homeForm.hero_title.value = hero.title || '';
    homeForm.hero_subtitle.value = hero.subtitle || '';
    homeForm.notice_text.value = notice.text || '';
    homeForm.stats_founded.value = stats.founded || '';
    homeForm.stats_alumni.value = stats.alumni || '';
    homeForm.stats_regions.value = stats.regions || '';
    const about = sections.home_about || {};
    const figures = sections.home_figures || {};
    const services = sections.home_services || {};
    const join = sections.home_join || {};
    homeForm.about_title.value = about.title || '';
    homeForm.about_intro.value = about.content || '';
    homeForm.figures_title.value = figures.title || '';
    homeForm.figures_subtitle.value = figures.subtitle || '';
    homeForm.services_title.value = services.title || '';
    homeForm.services_subtitle.value = services.subtitle || '';
    homeForm.join_title.value = join.title || '';
    const heroImg = hero.image || '';
    homeForm.hero_image.value = heroImg;
    renderCoverPreview('heroImgPreview', heroImg);
    const aboutBody = sections.home_about_body || {};
    const figuresBody = sections.home_figures_body || {};
    const servicesBody = sections.home_services_body || {};
    homeForm.about_box1_title.value = aboutBody.box1_title || '';
    homeForm.about_box1_content.value = aboutBody.box1_content || '';
    homeForm.about_box2_title.value = aboutBody.box2_title || '';
    homeForm.about_box2_content.value = aboutBody.box2_content || '';
    homeForm.about_box3_title.value = aboutBody.box3_title || '';
    homeForm.about_box3_content.value = aboutBody.box3_content || '';
    homeForm.about_box4_title.value = aboutBody.box4_title || '';
    homeForm.about_box4_content.value = aboutBody.box4_content || '';
    homeForm.figures_body_html.value = typeof figuresBody.html === 'string' ? figuresBody.html : '';
    homeForm.services_body_html.value = typeof servicesBody.html === 'string' ? servicesBody.html : '';
    try {
      const fd = await api('/api/site/sections?page=footer&t=' + Date.now());
      const footerSec = (fd.sections || []).find((s) => s.section_key === 'footer_info');
      const fc = footerSec ? safeJson(footerSec.content) : {};
      homeForm.footer_name.value = fc.name || '';
      homeForm.footer_about.value = fc.about || '';
      homeForm.footer_email.value = fc.email || '';
      homeForm.footer_address.value = fc.address || '';
    } catch (_) {}
    homeStatus.textContent = '首页内容已读取。';
    homeStatus.className = 'status ok';
  } catch (error) {
    homeStatus.textContent = `读取失败：${error.message}`;
    homeStatus.className = 'status';
  }
}

async function saveSection(payload) {
  return api('/api/admin/content/sections', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

homeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  homeStatus.textContent = '正在保存……';
  homeStatus.className = 'status';
  const form = Object.fromEntries(new FormData(homeForm).entries());
  try {
    const results = [];
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_hero',
      section_name: '首页横幅',
      display_order: 1,
      content: {
        title: form.hero_title || '',
        subtitle: form.hero_subtitle || '',
        image: form.hero_image || ''
      }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_notice',
      section_name: '首页公告',
      display_order: 2,
      content: {
        text: form.notice_text || ''
      }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_stats',
      section_name: '首页数据',
      display_order: 3,
      content: {
        founded: form.stats_founded || '',
        alumni: form.stats_alumni || '',
        regions: form.stats_regions || ''
      }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_about',
      section_name: '校友会概况',
      display_order: 4,
      content: { title: form.about_title || '', content: form.about_intro || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_figures',
      section_name: '校友论坛',
      display_order: 5,
      content: { title: form.figures_title || '', subtitle: form.figures_subtitle || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_services',
      section_name: '校友服务',
      display_order: 6,
      content: { title: form.services_title || '', subtitle: form.services_subtitle || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_join',
      section_name: '加入新海高人',
      display_order: 7,
      content: { title: form.join_title || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home', section_key: 'home_about_body', section_name: '概况四宫格', display_order: 9,
      content: {
        box1_title: form.about_box1_title || '', box1_content: form.about_box1_content || '',
        box2_title: form.about_box2_title || '', box2_content: form.about_box2_content || '',
        box3_title: form.about_box3_title || '', box3_content: form.about_box3_content || '',
        box4_title: form.about_box4_title || '', box4_content: form.about_box4_content || ''
      }
    }));
    results.push(await saveSection({
      page_slug: 'home', section_key: 'home_figures_body', section_name: '校友论坛卡片', display_order: 10,
      content: { html: form.figures_body_html || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home', section_key: 'home_services_body', section_name: '校友服务入口', display_order: 11,
      content: { html: form.services_body_html || '' }
    }));
    results.push(await saveSection({
      page_slug: 'footer', section_key: 'footer_info', section_name: '网站页脚', display_order: 0,
      content: { name: form.footer_name || '', about: form.footer_about || '', email: form.footer_email || '', address: form.footer_address || '' }
    }));
    homeStatus.textContent = results.map(item => item.message || '保存成功').join('\n');
    homeStatus.className = 'status ok';
    await loadContentRequests();
  } catch (error) {
    homeStatus.textContent = `保存失败：${error.message}`;
    homeStatus.className = 'status';
  }
});

async function loadContentRequests() {
  requestRows.innerHTML = '<tr><td colspan="5">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/content/requests');
    const items = data.requests || [];
    if (!items.length) {
      requestRows.innerHTML = '<tr><td colspan="5">暂无内容审批</td></tr>';
      return;
    }
    requestRows.innerHTML = items.map(item => {
      const proposed = typeof item.proposed_content === 'string' ? safeJson(item.proposed_content) : (item.proposed_content || {});
      return `
        <tr>
          <td>${escapeHtml(item.title || '')}</td>
          <td>${escapeHtml(item.page_slug || '')}<br>${escapeHtml(item.section_key || '')}</td>
          <td><pre class="inline-json">${escapeHtml(JSON.stringify(proposed.content || proposed, null, 2))}</pre></td>
          <td><span class="badge ${escapeHtml(item.status)}">${statusText(item.status)}</span></td>
          <td>
            <div class="row-actions">
              <button class="approve" data-content-id="${item.id}" data-status="approved" ${item.status !== 'pending' ? 'disabled' : ''}>通过</button>
              <button class="reject" data-content-id="${item.id}" data-status="rejected" ${item.status !== 'pending' ? 'disabled' : ''}>拒绝</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    requestRows.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}


function adminLevelText(level) {
  return {
    super_admin: '主管理员',
    admin: '普通管理员',
    editor: '内容编辑员',
    reviewer: '审核员',
    viewer: '只读查看'
  }[level] || level || '普通管理员';
}

async function loadAdminManagement() {
  await Promise.allSettled([loadAdmins(), loadInvites()]);
}

async function loadAdmins() {
  if (!adminRows) return;
  adminRows.innerHTML = '<tr><td colspan="5">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/accounts');
    const items = data.admins || [];
    if (!items.length) {
      adminRows.innerHTML = '<tr><td colspan="5">暂无管理员</td></tr>';
      return;
    }
    adminRows.innerHTML = items.map(item => `
      <tr>
        <td>${escapeHtml(item.display_name || '')}<br><small>${escapeHtml(item.email || '')}</small></td>
        <td>${escapeHtml(item.phone || '')}</td>
        <td>
          <select class="level-select" data-admin-level-id="${item.admin_id}" ${item.admin_level === 'super_admin' ? 'disabled' : ''}>
            ${['admin','editor','reviewer','viewer','super_admin'].map(level => `<option value="${level}" ${item.admin_level === level ? 'selected' : ''}>${adminLevelText(level)}</option>`).join('')}
          </select>
          <br>
          <span class="badge ${escapeHtml(item.admin_status)}">${statusText(item.admin_status)}</span>
        </td>
        <td>${escapeHtml(item.title || '')}<br>${escapeHtml([item.department, item.province, item.city].filter(Boolean).join(' / '))}</td>
        <td>
          <div class="row-actions">
            <button class="ghost" data-save-admin-id="${item.admin_id}" ${item.admin_level === 'super_admin' ? 'disabled' : ''}>保存权限</button>
            <button class="reject" data-disable-admin-id="${item.admin_id}" ${item.admin_level === 'super_admin' ? 'disabled' : ''}>停用</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    adminRows.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadInvites() {
  if (!inviteRows) return;
  inviteRows.innerHTML = '<tr><td colspan="5">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/invites');
    const items = data.invites || [];
    if (!items.length) {
      inviteRows.innerHTML = '<tr><td colspan="5">暂无邀请</td></tr>';
      return;
    }
    inviteRows.innerHTML = items.map(item => `
      <tr>
        <td>${escapeHtml(item.invitee_name || '')}<br><small>${escapeHtml(item.invitee_email || '')}</small></td>
        <td>${adminLevelText(item.admin_level)}</td>
        <td><span class="badge ${escapeHtml(item.status)}">${statusText(item.status)}</span></td>
        <td>
          ${item.invite_link ? `<div class="mono-link">${escapeHtml(item.invite_link)}</div><button class="ghost copy-link" data-copy-link="${escapeHtml(item.invite_link)}">复制</button>` : '无'}
          <div class="invite-hint">已接受后，主管理员点“批准启用”。</div>
        </td>
        <td>
          <div class="row-actions">
            <button class="approve" data-invite-review-id="${item.id}" data-status="approved" ${item.status !== 'accepted' ? 'disabled' : ''}>批准启用</button>
            <button class="reject" data-invite-review-id="${item.id}" data-status="rejected" ${['approved','rejected'].includes(item.status) ? 'disabled' : ''}>拒绝</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    inviteRows.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadMyAccount() {
  if (!profileForm) return;
  try {
    const data = await api('/api/admin/me');
    const u = data.user || {};
    profileForm.display_name.value = u.display_name || u.name || '';
    profileForm.email.value = u.email || '';
    profileForm.phone.value = u.phone || '';
  } catch (_) {}
}

async function setupInviteFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  if (!code || !acceptInviteForm) return false;
  showInvitePanel();
  inviteAcceptStatus.textContent = '正在读取邀请……';
  try {
    const data = await api(`/api/admin/invites/public/${encodeURIComponent(code)}`);
    const invite = data.invite || {};
    acceptInviteForm.code.value = code;
    acceptInviteForm.email.value = invite.invitee_email || '';
    acceptInviteForm.name.value = invite.invitee_name || '';
    acceptInviteForm.phone.value = invite.invitee_phone || '';
    acceptInviteForm.title.value = invite.title || '';
    acceptInviteForm.department.value = invite.department || '';
    inviteAcceptStatus.textContent = '邀请有效，请设置密码并提交。';
    inviteAcceptStatus.className = 'status ok';
    return true;
  } catch (error) {
    inviteAcceptStatus.textContent = error.message;
    inviteAcceptStatus.className = 'status';
    return true;
  }
}

function adminLoginMethod() {
  const active = document.querySelector('[data-admin-login].active');
  return active ? active.dataset.adminLogin : 'password';
}
document.querySelectorAll('[data-admin-login]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-admin-login]').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-admin-pane]').forEach((pane) => { pane.hidden = pane.dataset.adminPane !== btn.dataset.adminLogin; });
    loginStatus.textContent = '';
  });
});

const adminSendCodeBtn = document.getElementById('adminSendCodeBtn');
const adminCodeBox = document.getElementById('adminCodeBox');
const adminCodeText = document.getElementById('adminCodeText');
let adminSendTimer = null;
if (adminSendCodeBtn) {
  adminSendCodeBtn.addEventListener('click', async () => {
    const account = String(document.getElementById('adminLoginAccount').value || '').trim();
    if (!account) { loginStatus.textContent = '请先输入管理员账号（邮箱或手机号）'; return; }
    if (!/^\d{6,}$/.test(account) && !account.includes('@')) { loginStatus.textContent = '请输入有效的邮箱或手机号'; return; }
    adminSendCodeBtn.disabled = true;
    adminSendCodeBtn.textContent = '发送中…';
    try {
      const data = await api('/api/auth/send-login-code', { method: 'POST', body: JSON.stringify({ email: account }) });
      if (data.login_code) {
        if (adminCodeText) adminCodeText.textContent = data.login_code;
        if (adminCodeBox) adminCodeBox.hidden = false;
        const codeInput = document.getElementById('adminLoginCode');
        if (codeInput) codeInput.value = data.login_code;
        loginStatus.textContent = '验证码已发送并自动填入，点击「登录后台」即可';
      } else {
        loginStatus.textContent = data.message || '验证码已发送';
      }
      let seconds = 60;
      clearInterval(adminSendTimer);
      adminSendTimer = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(adminSendTimer);
          adminSendCodeBtn.disabled = false;
          adminSendCodeBtn.textContent = '重新获取';
        } else {
          adminSendCodeBtn.textContent = `${seconds} 秒后重发`;
        }
      }, 1000);
    } catch (error) {
      loginStatus.textContent = error.message;
      adminSendCodeBtn.disabled = false;
      adminSendCodeBtn.textContent = '获取验证码';
    }
  });
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginStatus.textContent = '';
  const method = adminLoginMethod();
  try {
    const path = method === 'code' ? '/api/admin/code-login' : '/api/admin/login';
    const body = method === 'code'
      ? { email: document.getElementById('adminLoginAccount').value, code: document.getElementById('adminLoginCode').value }
      : Object.fromEntries(new FormData(loginForm).entries());
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || '登录失败');
    setToken(data.token);
    setUser(data.user || {});
    showDashboard();
    await Promise.allSettled([loadApplications(), loadHomeContent(), loadContentRequests()]);
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

rows.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-review-id]');
  if (!button) return;
  const reason = button.dataset.status === 'rejected' ? prompt('请输入拒绝原因，可留空：') : '';
  button.disabled = true;
  try {
    await api(`/api/applications/${button.dataset.reviewId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: button.dataset.status, reject_reason: reason || null })
    });
    await loadApplications();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

requestRows.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-content-id]');
  if (!button) return;
  const reason = button.dataset.status === 'rejected' ? prompt('请输入拒绝原因，可留空：') : '';
  button.disabled = true;
  try {
    await api(`/api/admin/content/requests/${button.dataset.contentId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ status: button.dataset.status, reject_reason: reason || null })
    });
    await loadContentRequests();
    await loadHomeContent();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});


if (inviteAdminForm) {
  inviteAdminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    inviteStatus.textContent = '正在生成邀请……';
    inviteStatus.className = 'status';
    inviteLinkOutput.value = '';
    try {
      const body = Object.fromEntries(new FormData(inviteAdminForm).entries());
      const data = await api('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) });
      inviteStatus.textContent = data.message || '邀请已创建';
      inviteStatus.className = 'status ok';
      inviteLinkOutput.value = data.invite?.invite_link || '';
      await loadInvites();
    } catch (error) {
      inviteStatus.textContent = error.message;
      inviteStatus.className = 'status';
    }
  });
}

if (directAdminForm) {
  const genAdminPwdBtn = document.querySelector('#genAdminPwdBtn');
  if (genAdminPwdBtn) {
    genAdminPwdBtn.addEventListener('click', () => {
      const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let pwd = '';
      for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
      const input = directAdminForm.querySelector('input[name="password"]');
      if (input) input.value = pwd;
    });
  }
  directAdminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    directAdminStatus.textContent = '正在创建……';
    directAdminStatus.className = 'status';
    try {
      const body = Object.fromEntries(new FormData(directAdminForm).entries());
      const data = await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify(body) });
      directAdminStatus.textContent = data.message || '管理员已创建';
      directAdminStatus.className = 'status ok';
      directAdminForm.reset();
      await loadAdmins();
    } catch (error) {
      directAdminStatus.textContent = error.message;
      directAdminStatus.className = 'status';
    }
  });
}

if (acceptInviteForm) {
  acceptInviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    inviteAcceptStatus.textContent = '正在提交……';
    inviteAcceptStatus.className = 'status';
    try {
      const body = Object.fromEntries(new FormData(acceptInviteForm).entries());
      const data = await api('/api/admin/invites/accept', { method: 'POST', body: JSON.stringify(body) });
      inviteAcceptStatus.textContent = data.message || '已提交，等待审批';
      inviteAcceptStatus.className = 'status ok';
      acceptInviteForm.querySelector('button[type="submit"]').disabled = true;
    } catch (error) {
      inviteAcceptStatus.textContent = error.message;
      inviteAcceptStatus.className = 'status';
    }
  });
}

if (backToLoginBtn) backToLoginBtn.addEventListener('click', showLogin);

if (inviteRows) {
  inviteRows.addEventListener('click', async (event) => {
    const copy = event.target.closest('button[data-copy-link]');
    if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copyLink);
      copy.textContent = '已复制';
      setTimeout(() => copy.textContent = '复制', 1200);
      return;
    }
    const button = event.target.closest('button[data-invite-review-id]');
    if (!button) return;
    const reason = button.dataset.status === 'rejected' ? prompt('请输入拒绝原因，可留空：') : '';
    button.disabled = true;
    try {
      await api(`/api/admin/invites/${button.dataset.inviteReviewId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: button.dataset.status, reject_reason: reason || null })
      });
      await loadAdminManagement();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  });
}

if (adminRows) {
  adminRows.addEventListener('click', async (event) => {
    const save = event.target.closest('button[data-save-admin-id]');
    const disable = event.target.closest('button[data-disable-admin-id]');
    if (!save && !disable) return;
    const id = (save || disable).dataset.saveAdminId || (save || disable).dataset.disableAdminId;
    const row = (save || disable).closest('tr');
    const level = row.querySelector('[data-admin-level-id]')?.value;
    try {
      await api(`/api/admin/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(disable ? { status: 'disabled' } : { admin_level: level })
      });
      await loadAdmins();
    } catch (error) {
      alert(error.message);
    }
  });
}

if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    profileStatus.textContent = '正在保存……';
    profileStatus.className = 'status';
    try {
      const body = Object.fromEntries(new FormData(profileForm).entries());
      const data = await api('/api/admin/account/profile', { method: 'PATCH', body: JSON.stringify(body) });
      profileStatus.textContent = data.message || '已保存';
      profileStatus.className = 'status ok';
    } catch (error) {
      profileStatus.textContent = error.message;
      profileStatus.className = 'status';
    }
  });
}

if (passwordForm) {
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passwordStatus.textContent = '正在修改……';
    passwordStatus.className = 'status';
    const body = Object.fromEntries(new FormData(passwordForm).entries());
    if (body.password !== body.password_confirm) {
      passwordStatus.textContent = '两次新密码不一致';
      return;
    }
    try {
      const data = await api('/api/admin/account/password', { method: 'POST', body: JSON.stringify(body) });
      passwordStatus.textContent = data.message || '密码已修改';
      passwordStatus.className = 'status ok';
      passwordForm.reset();
    } catch (error) {
      passwordStatus.textContent = error.message;
      passwordStatus.className = 'status';
    }
  });
}

if (loadAdminsBtn) loadAdminsBtn.addEventListener('click', loadAdminManagement);

refreshBtn.addEventListener('click', () => {
  const active = document.querySelector('.tab.active')?.dataset.tab || 'applications';
  setActiveTab(active);
});
loadHomeBtn.addEventListener('click', loadHomeContent);
loadRequestsBtn.addEventListener('click', loadContentRequests);
logoutBtn.addEventListener('click', () => {
  clearToken();
  showLogin();
});

setupInviteFromUrl().then((handled) => {
  if (handled) return;
  if (getToken()) {
    showDashboard();
    Promise.allSettled([loadApplications(), loadHomeContent(), loadContentRequests()]);
  } else {
    showLogin();
  }
});

// ==================== 内容系统与校友中心（V1 追加） ====================
const newsRows = document.querySelector('#newsRows');
const newsEditor = document.querySelector('#newsEditor');
const newsForm = document.querySelector('#newsForm');
const newsStatus = document.querySelector('#newsStatus');
const newNewsBtn = document.querySelector('#newNewsBtn');
const newsCancelBtn = document.querySelector('#newsCancelBtn');
const eventRows = document.querySelector('#eventRows');
const eventEditor = document.querySelector('#eventEditor');
const eventForm = document.querySelector('#eventForm');
const eventStatus = document.querySelector('#eventStatus');
const newEventBtn = document.querySelector('#newEventBtn');
const eventCancelBtn = document.querySelector('#eventCancelBtn');
const registrationsCard = document.querySelector('#registrationsCard');
const registrationsTitle = document.querySelector('#registrationsTitle');
const registrationRows = document.querySelector('#registrationRows');
const closeRegistrationsBtn = document.querySelector('#closeRegistrationsBtn');
const loadStatsBtn = document.querySelector('#loadStatsBtn');
const exportAlumniBtn = document.querySelector('#exportAlumniBtn');
const alumniSearch = document.querySelector('#alumniSearch');
const alumniRows = document.querySelector('#alumniRows');
const alumniPagination = document.querySelector('#alumniPagination');

function toDatetimeLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 新闻管理 ----------
let newsPage = 1;
async function loadNews(page = 1) {
  newsPage = page;
  if (!newsRows) return;
  newsRows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  try {
    const data = await api(`/api/admin/news?page=${page}&pageSize=20`);
    const items = data.items || [];
    if (!items.length) {
      newsRows.innerHTML = '<tr><td colspan="6">暂无新闻，点击「新建新闻」发布第一篇。</td></tr>';
      return;
    }
    newsRows.innerHTML = items.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td>${escapeHtml(item.category || '综合')}</td>
        <td>${escapeHtml(String(item.published_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${item.view_count || 0}</td>
        <td>${item.is_published ? '<span class="badge approved">已发布</span>' : '<span class="badge draft">草稿</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="ghost" data-news-edit="${item.id}">编辑</button>
            <button class="reject" data-news-delete="${item.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    newsRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

function openNewsEditor(item) {
  if (!newsEditor) return;
  newsEditor.hidden = false;
  newsEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#newsEditorTitle').textContent = item ? '编辑新闻' : '新建新闻';
  newsForm.reset();
  newsStatus.textContent = '';
  const newsContentEditor = document.getElementById('newsContentEditor');
  if (newsContentEditor) newsContentEditor.innerHTML = '';
  if (item) {
    newsForm.id.value = item.id;
    newsForm.title.value = item.title || '';
    newsForm.category.value = item.category || '';
    newsForm.author.value = item.author || '';
    newsForm.summary.value = item.summary || '';
    newsForm.cover_url.value = item.cover_url || '';
    renderCoverPreview('newsCoverPreview', newsForm.cover_url.value);
    newsForm.content.value = item.content || '';
    if (newsContentEditor) newsContentEditor.innerHTML = item.content || '';
    newsForm.is_published.checked = item.is_published !== false;
  }
}

if (newsForm) {
  newsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    newsStatus.textContent = '正在保存……';
    newsStatus.className = 'status';
    const body = Object.fromEntries(new FormData(newsForm).entries());
    body.is_published = body.is_published === 'on';
    const id = body.id;
    delete body.id;
    try {
      const data = await api(id ? `/api/admin/news/${id}` : '/api/admin/news', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      newsStatus.textContent = data.message || '已保存';
      newsStatus.className = 'status ok';
      newsEditor.hidden = true;
      await loadNews(newsPage);
    } catch (error) {
      newsStatus.textContent = error.message;
      newsStatus.className = 'status';
    }
  });
}

if (newNewsBtn) newNewsBtn.addEventListener('click', () => openNewsEditor(null));
if (newsCancelBtn) newsCancelBtn.addEventListener('click', () => { newsEditor.hidden = true; });

if (newsRows) {
  newsRows.addEventListener('click', async (event) => {
    const edit = event.target.closest('button[data-news-edit]');
    const del = event.target.closest('button[data-news-delete]');
    if (edit) {
      try {
        const data = await api(`/api/admin/news/${edit.dataset.newsEdit}`);
        openNewsEditor(data.article);
      } catch (error) {
        alert(error.message);
      }
    }
    if (del) {
      if (!confirm('确定删除这篇新闻吗？删除后不可恢复。')) return;
      del.disabled = true;
      try {
        await api(`/api/admin/news/${del.dataset.newsDelete}`, { method: 'DELETE' });
        await loadNews(newsPage);
      } catch (error) {
        alert(error.message);
        del.disabled = false;
      }
    }
  });
}

// ---------- 活动管理 ----------
let eventPage = 1;
async function loadEvents(page = 1) {
  eventPage = page;
  if (!eventRows) return;
  eventRows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  try {
    const data = await api(`/api/admin/events?page=${page}&pageSize=20`);
    const items = data.items || [];
    if (!items.length) {
      eventRows.innerHTML = '<tr><td colspan="6">暂无活动，点击「新建活动」创建。</td></tr>';
      return;
    }
    eventRows.innerHTML = items.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td>${escapeHtml(fmtDateTime(item.start_time) || '待定')}</td>
        <td>${escapeHtml(item.location || '')}</td>
        <td>${item.registrations_count || 0}${item.capacity ? ` / ${item.capacity}` : ''}</td>
        <td>${item.is_published ? '<span class="badge approved">已发布</span>' : '<span class="badge draft">草稿</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="ghost" data-event-regs="${item.id}" data-event-title="${escapeHtml(item.title)}">报名</button>
            <button class="ghost" data-event-checkin="${item.id}" data-event-title="${escapeHtml(item.title)}">签到码</button>
            <button class="ghost" data-event-edit="${item.id}">编辑</button>
            <button class="reject" data-event-delete="${item.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    eventRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

function openEventEditor(item) {
  if (!eventEditor) return;
  eventEditor.hidden = false;
  eventEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#eventEditorTitle').textContent = item ? '编辑活动' : '新建活动';
  eventForm.reset();
  eventStatus.textContent = '';
  const eventContentEditor = document.getElementById('eventContentEditor');
  if (eventContentEditor) eventContentEditor.innerHTML = '';
  if (item) {
    eventForm.id.value = item.id;
    eventForm.title.value = item.title || '';
    eventForm.category.value = item.category || '';
    eventForm.location.value = item.location || '';
    eventForm.start_time.value = toDatetimeLocal(item.start_time);
    eventForm.end_time.value = toDatetimeLocal(item.end_time);
    eventForm.signup_deadline.value = toDatetimeLocal(item.signup_deadline);
    eventForm.capacity.value = item.capacity || '';
    eventForm.cover_url.value = item.cover_url || '';
    renderCoverPreview('eventCoverPreview', eventForm.cover_url.value);
    eventForm.summary.value = item.summary || '';
    eventForm.content.value = item.content || '';
    if (eventContentEditor) eventContentEditor.innerHTML = item.content || '';
    eventForm.is_published.checked = item.is_published !== false;
  }
}

if (eventForm) {
  eventForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    eventStatus.textContent = '正在保存……';
    eventStatus.className = 'status';
    const body = Object.fromEntries(new FormData(eventForm).entries());
    body.is_published = body.is_published === 'on';
    body.start_time = fromDatetimeLocal(body.start_time);
    body.end_time = fromDatetimeLocal(body.end_time);
    body.signup_deadline = fromDatetimeLocal(body.signup_deadline);
    body.capacity = body.capacity ? Number(body.capacity) : null;
    const id = body.id;
    delete body.id;
    try {
      const data = await api(id ? `/api/admin/events/${id}` : '/api/admin/events', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      eventStatus.textContent = data.message || '已保存';
      eventStatus.className = 'status ok';
      eventEditor.hidden = true;
      await loadEvents(eventPage);
    } catch (error) {
      eventStatus.textContent = error.message;
      eventStatus.className = 'status';
    }
  });
}

if (newEventBtn) newEventBtn.addEventListener('click', () => openEventEditor(null));
if (eventCancelBtn) eventCancelBtn.addEventListener('click', () => { eventEditor.hidden = true; });

if (eventRows) {
  eventRows.addEventListener('click', async (event) => {
    const regs = event.target.closest('button[data-event-regs]');
    const checkin = event.target.closest('button[data-event-checkin]');
    const edit = event.target.closest('button[data-event-edit]');
    const del = event.target.closest('button[data-event-delete]');
    if (regs) {
      await loadRegistrations(regs.dataset.eventRegs, regs.dataset.eventTitle);
      return;
    }
    if (checkin) {
      try {
        const data = await api(`/api/admin/events/${checkin.dataset.eventCheckin}/checkin-code`, { method: 'POST' });
        showCheckinModal(data, checkin.dataset.eventTitle);
      } catch (error) {
        alert(error.message);
      }
      return;
    }
    if (edit) {
      try {
        const data = await api(`/api/admin/events/${edit.dataset.eventEdit}`);
        openEventEditor(data.event);
      } catch (error) {
        alert(error.message);
      }
    }
    if (del) {
      if (!confirm('确定删除该活动吗？相关报名记录也会一并删除。')) return;
      del.disabled = true;
      try {
        await api(`/api/admin/events/${del.dataset.eventDelete}`, { method: 'DELETE' });
        await loadEvents(eventPage);
      } catch (error) {
        alert(error.message);
        del.disabled = false;
      }
    }
  });
}

async function loadRegistrations(eventId, eventTitle) {
  if (!registrationsCard) return;
  registrationsCard.hidden = false;
  registrationsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  registrationsTitle.dataset.eventId = eventId;
  registrationsTitle.textContent = `活动报名：${eventTitle || ''}`;
  registrationRows.innerHTML = '<tr><td colspan="7">正在加载……</td></tr>';
  try {
    const data = await api(`/api/admin/events/${eventId}/registrations`);
    const items = data.registrations || [];
    if (!items.length) {
      registrationRows.innerHTML = '<tr><td colspan="7">暂无报名</td></tr>';
      return;
    }
    registrationRows.innerHTML = items.map(item => {
      const statusClass = { registered: 'registered', cancelled: 'cancelled', checked_in: 'checked_in' }[item.status] || 'draft';
      const statusName = { registered: '已报名', cancelled: '已取消', checked_in: '已签到' }[item.status] || item.status;
      return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.phone || '')}</td>
          <td>${escapeHtml(item.email || '')}</td>
          <td>${escapeHtml(item.remark || '')}</td>
          <td>${escapeHtml(String(item.created_at || '').slice(0, 16).replace('T', ' '))}</td>
          <td><span class="badge ${statusClass}">${statusName}</span></td>
          <td>
            <div class="row-actions">
              <button class="approve" data-reg-status="${item.id}" data-status="checked_in" ${item.status === 'checked_in' ? 'disabled' : ''}>签到</button>
              <button class="ghost" data-reg-status="${item.id}" data-status="cancelled" ${item.status === 'cancelled' ? 'disabled' : ''}>取消</button>
              <button class="ghost" data-reg-status="${item.id}" data-status="registered" ${item.status === 'registered' ? 'disabled' : ''}>恢复</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    registrationRows.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

if (closeRegistrationsBtn) closeRegistrationsBtn.addEventListener('click', () => { registrationsCard.hidden = true; });

if (registrationRows) {
  registrationRows.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-reg-status]');
    if (!button) return;
    button.disabled = true;
    try {
      await api(`/api/admin/event-registrations/${button.dataset.regStatus}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: button.dataset.status })
      });
      const title = registrationsTitle ? registrationsTitle.textContent.replace('活动报名：', '') : '';
      await loadRegistrations(registrationsTitle.dataset.eventId || '', title);
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  });
}

// ---------- 数据统计 ----------
async function loadStats() {
  const set = (id, value) => { const el = document.querySelector(`#${id}`); if (el) el.textContent = value; };
  try {
    const data = await api('/api/admin/stats');
    const s = data.stats || {};
    const v = s.verifications || {};
    set('statUsers', s.users ?? 0);
    set('statAlumni', s.alumni ?? 0);
    set('statNews', s.news ?? 0);
    set('statEvents', s.events ?? 0);
    set('statRegistrations', s.registrations ?? 0);
    set('statPending', v.pending ?? 0);
    set('statApproved', v.approved ?? 0);
    set('statRejected', v.rejected ?? 0);
  } catch (error) {
    const grid = document.querySelector('#statsGrid');
    if (grid) grid.innerHTML = `<div class="empty-tip">${escapeHtml(error.message)}</div>`;
  }
}
if (loadStatsBtn) loadStatsBtn.addEventListener('click', loadStats);

// ---------- 校友名录管理 ----------
let alumniPage = 1;
async function loadAlumniList(page = 1) {
  alumniPage = page;
  if (!alumniRows) return;
  alumniRows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  const q = alumniSearch ? alumniSearch.value.trim() : '';
  const params = new URLSearchParams({ page, pageSize: 20 });
  if (q) params.set('q', q);
  try {
    const data = await api(`/api/admin/alumni?${params.toString()}`);
    const items = data.items || [];
    if (!items.length) {
      alumniRows.innerHTML = '<tr><td colspan="6">暂无数据</td></tr>';
      if (alumniPagination) alumniPagination.innerHTML = '';
      return;
    }
    alumniRows.innerHTML = items.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(item.phone || '')}</td>
        <td>${escapeHtml(item.graduation_year || '')} ${escapeHtml(item.class_name || '')}</td>
        <td>${escapeHtml([item.current_province, item.current_city, item.current_county].filter(Boolean).join(' / ') || '未填写')}</td>
        <td>${escapeHtml([item.position_title, item.company].filter(Boolean).join(' · ') || '未填写')}</td>
        <td>${item.public_contact ? '是' : '否'}</td>
      </tr>
    `).join('');
    const totalPages = Math.max(1, Math.ceil((data.total || 0) / 20));
    let html = `<span class="invite-hint" style="margin-right:auto">共 ${data.total || 0} 条</span>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button type="button" data-alumni-page="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    alumniPagination.innerHTML = html;
  } catch (error) {
    alumniRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

if (alumniPagination) {
  alumniPagination.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-alumni-page]');
    if (btn) loadAlumniList(Number(btn.dataset.alumniPage));
  });
}

if (alumniSearch) {
  let alumniSearchTimer = null;
  alumniSearch.addEventListener('input', () => {
    clearTimeout(alumniSearchTimer);
    alumniSearchTimer = setTimeout(() => loadAlumniList(1), 350);
  });
}

if (exportAlumniBtn) {
  exportAlumniBtn.addEventListener('click', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/alumni/export`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '导出失败');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `校友通讯录-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
  });
}
// ==================== 用户管理 / 校友导入（V1 追加） ====================
const userRows = document.querySelector('#userRows');
const userSearch = document.querySelector('#userSearch');
const userPagination = document.querySelector('#userPagination');
const importAlumniBtn = document.querySelector('#importAlumniBtn');
const importAlumniFile = document.querySelector('#importAlumniFile');
const importStatus = document.querySelector('#importStatus');

let userPage = 1;
function userRoleText(role) {
  return { super_admin: '主管理员', admin: '管理员', alumni: '认证校友', pending_alumni: '待认证校友' }[role] || role || '未知';
}

async function loadUsers(page = 1) {
  userPage = page;
  if (!userRows) return;
  userRows.innerHTML = '<tr><td colspan="7">正在加载……</td></tr>';
  const q = userSearch ? userSearch.value.trim() : '';
  const params = new URLSearchParams({ page, pageSize: 20 });
  if (q) params.set('q', q);
  try {
    const data = await api(`/api/admin/users?${params.toString()}`);
    const items = data.items || [];
    if (!items.length) {
      userRows.innerHTML = '<tr><td colspan="7">暂无用户</td></tr>';
      userPagination.innerHTML = '';
      return;
    }
    const verifyMap = { approved: '已认证', rejected: '已拒绝', pending: '待审核', need_more_info: '需补充材料' };
    userRows.innerHTML = items.map(item => {
      const isRoot = item.phone === 'ROOT_ADMIN' || item.admin_level === 'super_admin';
      const statusClass = { active: 'approved', disabled: 'rejected', pending: 'pending' }[item.status] || 'draft';
      const vStatus = item.verification_status || '';
      const verifyClass = { approved: 'approved', rejected: 'rejected', pending: 'pending', need_more_info: 'need_more_info' }[vStatus] || 'draft';
      const source = item.wechat_openid ? '微信用户' : '';
      return `
        <tr>
          <td><strong>${escapeHtml(item.display_name)}</strong>${source ? `<br><small>${escapeHtml(source)}</small>` : ''}</td>
          <td>${escapeHtml(item.phone || '')}<br>${escapeHtml(item.email || '')}</td>
          <td>${userRoleText(item.role)}${item.admin_level ? `<br><small>${adminLevelText(item.admin_level)}</small>` : ''}</td>
          <td><span class="badge ${statusClass}">${statusText(item.status)}</span></td>
          <td><span class="badge ${verifyClass}">${verifyMap[vStatus] || '未申请认证'}</span></td>
          <td>${escapeHtml(String(item.created_at || '').slice(0, 10))}</td>
          <td>
            <div class="row-actions">
              <button class="ghost" data-user-role="${item.id}" data-role="${item.role === 'alumni' ? 'pending_alumni' : 'alumni'}" ${isRoot ? 'disabled' : ''}>${item.role === 'alumni' ? '取消认证' : '设为校友'}</button>
              <button class="ghost" data-user-status="${item.id}" data-status="${item.status === 'disabled' ? 'active' : 'disabled'}" ${isRoot ? 'disabled' : ''}>${item.status === 'disabled' ? '启用' : '停用'}</button>
              <button class="ghost" data-user-reset="${item.id}" ${isRoot ? 'disabled' : ''}>重置密码</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
    const totalPages = Math.max(1, Math.ceil((data.total || 0) / 20));
    let html = `<span class="invite-hint" style="margin-right:auto">共 ${data.total || 0} 条</span>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button type="button" data-user-page="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    userPagination.innerHTML = html;
  } catch (error) {
    userRows.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

if (userPagination) {
  userPagination.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-user-page]');
    if (btn) loadUsers(Number(btn.dataset.userPage));
  });
}

if (userSearch) {
  let userSearchTimer = null;
  userSearch.addEventListener('input', () => {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(() => loadUsers(1), 350);
  });
}

if (userRows) {
  userRows.addEventListener('click', async (event) => {
    const roleBtn = event.target.closest('button[data-user-role]');
    const statusBtn = event.target.closest('button[data-user-status]');
    const resetBtn = event.target.closest('button[data-user-reset]');
    if (roleBtn) {
      roleBtn.disabled = true;
      try {
        await api(`/api/admin/users/${roleBtn.dataset.userRole}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: roleBtn.dataset.role })
        });
        await loadUsers(userPage);
      } catch (error) { alert(error.message); roleBtn.disabled = false; }
    }
    if (statusBtn) {
      statusBtn.disabled = true;
      try {
        await api(`/api/admin/users/${statusBtn.dataset.userStatus}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: statusBtn.dataset.status })
        });
        await loadUsers(userPage);
      } catch (error) { alert(error.message); statusBtn.disabled = false; }
    }
    if (resetBtn) {
      const password = prompt('请输入新密码（至少 8 位，留空则自动生成）：');
      if (password === null) return;
      resetBtn.disabled = true;
      try {
        const data = await api(`/api/admin/users/${resetBtn.dataset.userReset}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password })
        });
        alert(`密码已重置：${data.temp_password || '（已设置）'}`);
        await loadUsers(userPage);
      } catch (error) { alert(error.message); resetBtn.disabled = false; }
    }
  });
}

// ---------- 校友 CSV 导入 ----------
if (importAlumniBtn && importAlumniFile) {
  importAlumniBtn.addEventListener('click', () => importAlumniFile.click());
  importAlumniFile.addEventListener('change', async () => {
    const file = importAlumniFile.files[0];
    importAlumniFile.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('文件不能超过 2MB'); return; }
    if (!importStatus) return;
    importStatus.textContent = `正在读取 ${file.name}……`;
    importStatus.className = 'status';
    try {
      const text = await file.text();
      const data = await api('/api/admin/alumni/import', {
        method: 'POST',
        body: JSON.stringify({ csv: text })
      });
      importStatus.textContent = (data.message || '导入完成') + (data.errors && data.errors.length ? '；错误：' + data.errors.join('；') : '');
      importStatus.className = 'status ok';
      await loadAlumniList(1);
    } catch (error) {
      importStatus.textContent = error.message;
      importStatus.className = 'status';
    }
  });
}
// ==================== 第二阶段：内容区块 / 论坛 / 招聘 / 捐赠 / 消息 / 签到 ====================

// ---------- 活动签到码 ----------
function showCheckinModal(data, title) {
  const modal = document.querySelector('#checkinModal');
  if (!modal) return;
  document.querySelector('#checkinModalTitle').textContent = `签到码：${title || ''}`;
  document.querySelector('#checkinQrImg').src = data.qr_image_url || '';
  document.querySelector('#checkinUrlText').textContent = data.checkin_url || '';
  modal.hidden = false;
}
if (document.querySelector('#checkinModal')) {
  document.querySelector('#checkinModalClose').addEventListener('click', () => { document.querySelector('#checkinModal').hidden = true; });
  document.querySelector('#checkinModal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) document.querySelector('#checkinModal').hidden = true;
  });
  document.querySelector('#copyCheckinUrlBtn').addEventListener('click', async () => {
    const url = document.querySelector('#checkinUrlText').textContent;
    try {
      await navigator.clipboard.writeText(url);
      alert('签到链接已复制');
    } catch (error) {
      alert('复制失败，请手动复制上方链接');
    }
  });
}

// ---------- 内容区块管理 ----------
let contentSectionsCache = [];
const CONTENT_PAGES = { home: '首页', about: '校友会介绍', contact: '联系我们' };
function contentPageName(slug) {
  return CONTENT_PAGES[slug] || slug || '';
}
function fillSectionKeySelect() {
  const select = document.querySelector('#contentSectionKey');
  if (!select) return;
  const seen = [];
  select.innerHTML = '<option value="">选择已有区块</option>' + contentSectionsCache
    .filter((s) => {
      if (seen.includes(s.section_key)) return false;
      seen.push(s.section_key);
      return true;
    })
    .map((s) => `<option value="${escapeHtml(s.section_key)}">${escapeHtml(s.section_key)}</option>`).join('');
}
function toggleSectionKeyInput() {
  const select = document.querySelector('#contentSectionKey');
  if (!select) return;
  const isNew = document.querySelector('#newSectionToggle').checked;
  let custom = document.querySelector('#contentSectionKeyCustom');
  if (isNew && !custom) {
    custom = document.createElement('input');
    custom.id = 'contentSectionKeyCustom';
    custom.name = 'section_key';
    custom.placeholder = '如 home_about、footer_links';
    select.insertAdjacentElement('afterend', custom);
  }
  if (custom) custom.hidden = !isNew;
  if (isNew) {
    select.removeAttribute('name');
    custom.value = '';
    custom.focus();
  } else {
    select.setAttribute('name', 'section_key');
    if (custom) custom.removeAttribute('name');
  }
}
async function loadContentSections() {
  const rowsBox = document.querySelector('#contentSectionRows');
  if (!rowsBox) return;
  const pageFilter = document.querySelector('#contentPageFilter')?.value || '';
  rowsBox.innerHTML = '<tr><td colspan="5">正在加载……</td></tr>';
  try {
    const data = await api(`/api/admin/content/sections${pageFilter ? `?page=${encodeURIComponent(pageFilter)}` : ''}`);
    contentSectionsCache = data.sections || [];
    if (!contentSectionsCache.length) {
      rowsBox.innerHTML = '<tr><td colspan="5">暂无内容区块，点击下方表单新建。</td></tr>';
    } else {
      rowsBox.innerHTML = contentSectionsCache.map((s, i) => `
        <tr>
          <td>${contentPageName(s.page_slug)}</td>
          <td><code>${escapeHtml(s.section_key)}</code></td>
          <td>${escapeHtml(s.section_name)}</td>
          <td>${escapeHtml(String(s.updated_at || s.created_at || '').slice(0, 16).replace('T', ' '))}</td>
          <td><div class="row-actions"><button class="ghost" data-content-edit="${i}">编辑</button></div></td>
        </tr>`).join('');
    }
    fillSectionKeySelect();
  } catch (error) {
    rowsBox.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#contentSectionRows')) {
  document.querySelector('#contentSectionRows').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-content-edit]');
    if (!btn) return;
    const s = contentSectionsCache[Number(btn.dataset.contentEdit)];
    if (!s) return;
    const form = document.querySelector('#contentSectionForm');
    form.querySelector('[name="id"]').value = s.id || '';
    form.querySelector('[name="page_slug"]').value = s.page_slug;
    form.querySelector('[name="section_name"]').value = s.section_name || '';
    form.querySelector('[name="display_order"]').value = s.display_order ?? 0;
    form.querySelector('[name="content"]').value = JSON.stringify(safeJson(s.content), null, 2);
    document.querySelector('#newSectionToggle').checked = false;
    toggleSectionKeyInput();
    fillSectionKeySelect();
    form.querySelector('[name="section_key"]').value = s.section_key;
    document.querySelector('#contentSectionStatus').textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelector('#contentSectionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#contentSectionStatus');
    status.textContent = '正在保存……';
    status.className = 'status';
    const fd = new FormData(event.currentTarget);
    let content;
    try {
      content = JSON.parse(fd.get('content') || '{}');
    } catch (error) {
      status.textContent = '内容不是有效的 JSON，请检查格式';
      return;
    }
    const sectionKey = String(fd.get('section_key') || '').trim();
    if (!sectionKey) {
      status.textContent = '请选择或填写区块标识';
      return;
    }
    try {
      const data = await api('/api/admin/content/sections', {
        method: 'POST',
        body: JSON.stringify({
          page_slug: fd.get('page_slug'),
          section_key: sectionKey,
          section_name: String(fd.get('section_name') || '').trim() || sectionKey,
          content,
          display_order: Number(fd.get('display_order') || 0)
        })
      });
      status.textContent = data.message || '已发布';
      status.className = 'status ok';
      loadContentSections();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector('#contentSectionClearBtn').addEventListener('click', () => {
    const form = document.querySelector('#contentSectionForm');
    form.reset();
    document.querySelector('#newSectionToggle').checked = false;
    toggleSectionKeyInput();
    fillSectionKeySelect();
    document.querySelector('#contentSectionStatus').textContent = '';
  });
  document.querySelector('#newSectionToggle').addEventListener('change', toggleSectionKeyInput);
  document.querySelector('#contentPageFilter').addEventListener('change', () => { loadContentSections(); });
  document.querySelector('#contentRefreshBtn').addEventListener('click', () => { loadContentSections(); });
}

// ---------- 页面内容编辑（所有网站页面） ----------
const pageEditorSelect = document.querySelector('#pageEditorSelect');
const pageEditorSectionsBox = document.querySelector('#pageEditorSections');

function pageFieldInput(key, value) {
  if (value !== null && typeof value === 'object') return '';
  const v = value === undefined || value === null ? '' : String(value);
  if (key === 'content' || key === 'html' || key === 'subtitle' || key === 'description' || key === 'intro') {
    return `<label>${escapeHtml(key)}<textarea name="${escapeHtml(key)}" rows="3">${escapeHtml(v)}</textarea></label>`;
  }
  return `<label>${escapeHtml(key)}<input name="${escapeHtml(key)}" value="${escapeHtml(v)}" /></label>`;
}

async function loadPageEditor() {
  if (!pageEditorSelect || !pageEditorSectionsBox) return;
  const slug = pageEditorSelect.value;
  const me = getUser();
  const isSuper = me && me.role === 'super_admin';
  const permNote = isSuper
    ? '<p style="margin:0 0 12px;color:var(--success)">当前为<span style="font-weight:700">主管理员</span>：保存后立即发布到官网。</p>'
    : '<p style="margin:0 0 12px;color:var(--warn)">当前为<span style="font-weight:700">普通管理员</span>：保存后生成审批任务，主管理员审核通过后发布。</p>';
  pageEditorSectionsBox.innerHTML = permNote + '<p class="status">正在加载……</p>';
  try {
    const data = await api(`/api/site/${slug}?t=${Date.now()}`);
    const sections = data.sections || [];
    if (!sections.length) {
      pageEditorSectionsBox.innerHTML = renderPageEditorSection({
        section_key: `${slug}_hero`,
        section_name: '页面横幅',
        content: { eyebrow: '', title: '', subtitle: '' }
      });
      pageEditorSectionsBox.querySelectorAll('form').forEach((form) => form.addEventListener('submit', savePageSection));
      return;
    }
    pageEditorSectionsBox.innerHTML = sections.map((s) => renderPageEditorSection(s)).join('');
    pageEditorSectionsBox.querySelectorAll('form').forEach((form) => form.addEventListener('submit', savePageSection));
    // 整页正文区块初始化富文本编辑器（支持排版、插入图片）
    pageEditorSectionsBox.querySelectorAll('.rich-editor').forEach((editor) => {
      initRichEditor(editor.id, 'html', `${editor.id}_img`);
    });
  } catch (error) {
    pageEditorSectionsBox.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

function renderPageEditorSection(section) {
  const content = safeJson(section.content);
  const keys = Object.keys(content);
  // 整页正文区块（如介绍页正文）用富文本编辑器排版
  if (keys.length === 1 && keys[0] === 'html') {
    const editorId = `pageRich_${section.section_key}`;
    const imgBtnId = `${editorId}_img`;
    return `
      <form class="editor-form" data-section-key="${escapeHtml(section.section_key)}" data-section-name="${escapeHtml(section.section_name || section.section_key)}">
        <fieldset>
          <legend>${escapeHtml(section.section_name || section.section_key)} <code>${escapeHtml(section.section_key)}</code></legend>
          <p style="margin:0 0 10px;color:var(--muted);font-size:13px">支持标题、加粗、列表、引用排版，可上传插入图片。</p>
          <div class="rich-toolbar">
            <button type="button" data-rich-cmd="bold" title="加粗"><strong>B</strong></button>
            <button type="button" data-rich-cmd="italic" title="斜体"><em>I</em></button>
            <button type="button" data-rich-cmd="underline" title="下划线"><u>U</u></button>
            <button type="button" data-rich-cmd="formatBlock" data-rich-value="h3" title="小标题">H</button>
            <button type="button" data-rich-cmd="formatBlock" data-rich-value="p" title="正文">¶</button>
            <button type="button" data-rich-cmd="insertUnorderedList" title="项目符号">• 列表</button>
            <button type="button" data-rich-cmd="insertOrderedList" title="编号列表">1. 列表</button>
            <button type="button" data-rich-cmd="formatBlock" data-rich-value="blockquote" title="引用">引用</button>
            <button type="button" data-rich-cmd="createLink" title="插入链接">链接</button>
            <button type="button" data-rich-cmd="removeFormat" title="清除格式">清除</button>
            <button type="button" id="${imgBtnId}" title="插入图片">图片</button>
          </div>
          <div class="rich-editor" id="${editorId}" contenteditable="true" data-placeholder="在这里编辑正文，支持标题、加粗、列表、引用和插入图片……">${content.html || ''}</div>
          <textarea name="html" hidden></textarea>
          <div class="form-actions" style="margin-top:12px">
            <button type="submit">保存</button>
          </div>
          <p class="status"></p>
        </fieldset>
      </form>`;
  }
  const fields = Object.keys(content)
    .map((k) => pageFieldInput(k, content[k]))
    .filter(Boolean)
    .join('') || '<p class="status">暂无字段</p>';
  return `
    <form class="editor-form" data-section-key="${escapeHtml(section.section_key)}" data-section-name="${escapeHtml(section.section_name || section.section_key)}">
      <fieldset>
        <legend>${escapeHtml(section.section_name || section.section_key)} <code>${escapeHtml(section.section_key)}</code></legend>
        <div class="field-stack">${fields}</div>
        <div class="form-actions" style="margin-top:12px">
          <button type="submit">保存</button>
        </div>
        <p class="status"></p>
      </fieldset>
    </form>`;
}

async function savePageSection(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const sectionKey = form.dataset.sectionKey;
  const sectionName = form.dataset.sectionName || sectionKey;
  const slug = pageEditorSelect.value;
  const status = form.querySelector('.status');
  status.textContent = '正在保存……';
  status.className = 'status';
  const content = {};
  new FormData(form).forEach((value, key) => { content[key] = value; });
  try {
    const data = await api('/api/admin/content/sections', {
      method: 'POST',
      body: JSON.stringify({ page_slug: slug, section_key: sectionKey, section_name: sectionName, content })
    });
    status.textContent = data.message || '已保存';
    status.className = 'status ok';
    loadPageEditor();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'status';
  }
}
if (pageEditorSelect) {
  pageEditorSelect.addEventListener('change', loadPageEditor);
}
if (document.querySelector('#pageEditorRefreshBtn')) {
  document.querySelector('#pageEditorRefreshBtn').addEventListener('click', loadPageEditor);
}

// ---------- 校友地图管理 ----------
const mapPointRows = document.querySelector('#mapPointRows');
const mapStatBox = document.querySelector('#mapStatBox');
const mapPointForm = document.querySelector('#mapPointForm');
const mapPointStatus = document.querySelector('#mapPointStatus');
let mapPointsCache = [];

async function loadMapAdmin() {
  if (!mapPointRows) return;
  mapPointRows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  if (mapStatBox) mapStatBox.innerHTML = '';
  try {
    const [pointsData, statData] = await Promise.all([
      api('/api/admin/map/points'),
      api('/api/alumni/map')
    ]);
    mapPointsCache = pointsData.items || [];
    const provinces = statData.provinces || [];
    const cities = statData.cities || [];
    const total = provinces.reduce((s, p) => s + (p.count || 0), 0);
    if (mapStatBox) {
      mapStatBox.innerHTML = `
        <article><span>${total}</span><small>已认证校友</small></article>
        <article><span>${provinces.length}</span><small>覆盖省份</small></article>
        <article><span>${cities.length}</span><small>覆盖城市</small></article>
        <article><span>${mapPointsCache.length}</span><small>标注点</small></article>`;
    }
    mapPointRows.innerHTML = mapPointsCache.length ? mapPointsCache.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.province || '')}${p.city ? ' / ' + escapeHtml(p.city) : ''}</td>
        <td>${escapeHtml(p.category || '联络站')}</td>
        <td>${escapeHtml(p.description || '')}</td>
        <td>${p.is_active ? '<span class="badge approved">显示</span>' : '<span class="badge draft">隐藏</span>'}</td>
        <td><div class="row-actions">
          <button class="ghost" data-map-edit="${p.id}" type="button">编辑</button>
          <button class="ghost" data-map-delete="${p.id}" type="button">删除</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6">暂无标注点，用下方表单添加</td></tr>';
  } catch (error) {
    mapPointRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

function fillMapPointForm(point) {
  if (!mapPointForm) return;
  mapPointForm.reset();
  const set = (name, value) => { const el = mapPointForm.querySelector(`[name="${name}"]`); if (el) el.value = value || ''; };
  set('id', point ? point.id : '');
  set('name', point ? point.name : '');
  set('province', point ? point.province : '');
  set('city', point ? point.city : '');
  set('category', point ? (point.category || '联络站') : '联络站');
  set('longitude', point ? point.longitude : '');
  set('latitude', point ? point.latitude : '');
  set('description', point ? point.description : '');
  const activeBox = mapPointForm.querySelector('[name="is_active"]');
  if (activeBox) activeBox.checked = point ? point.is_active !== false : true;
  if (mapPointStatus) { mapPointStatus.textContent = ''; mapPointStatus.className = 'status'; }
}

if (mapPointRows) {
  mapPointRows.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('button[data-map-edit]');
    if (editBtn) {
      const point = mapPointsCache.find((p) => String(p.id) === editBtn.dataset.mapEdit);
      if (point) { fillMapPointForm(point); mapPointForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    const deleteBtn = event.target.closest('button[data-map-delete]');
    if (deleteBtn && confirm('确认删除该标注点？')) {
      try {
        await api(`/api/admin/map/points/${deleteBtn.dataset.mapDelete}`, { method: 'DELETE' });
        loadMapAdmin();
      } catch (error) { alert(error.message); }
    }
  });
}
if (mapPointForm) {
  mapPointForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mapPointStatus) { mapPointStatus.textContent = '正在保存……'; mapPointStatus.className = 'status'; }
    const fd = new FormData(mapPointForm);
    const id = fd.get('id');
    const body = {
      name: fd.get('name'),
      province: fd.get('province'),
      city: fd.get('city'),
      category: fd.get('category'),
      longitude: fd.get('longitude'),
      latitude: fd.get('latitude'),
      description: fd.get('description'),
      is_active: fd.get('is_active') ? true : false
    };
    try {
      const data = id
        ? await api(`/api/admin/map/points/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api('/api/admin/map/points', { method: 'POST', body: JSON.stringify(body) });
      if (mapPointStatus) { mapPointStatus.textContent = data.message || '已保存'; mapPointStatus.className = 'status ok'; }
      fillMapPointForm(null);
      loadMapAdmin();
    } catch (error) {
      if (mapPointStatus) { mapPointStatus.textContent = error.message; mapPointStatus.className = 'status'; }
    }
  });
  const resetBtn = document.querySelector('#mapPointResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => fillMapPointForm(null));
}
if (document.querySelector('#mapRefreshBtn')) {
  document.querySelector('#mapRefreshBtn').addEventListener('click', loadMapAdmin);
}

// ---------- 论坛管理 ----------
async function loadForum() {
  const postBox = document.querySelector('#forumPostRows');
  const catBox = document.querySelector('#forumCategoryBox');
  if (!postBox || !catBox) return;
  postBox.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  catBox.innerHTML = '';
  try {
    const [postsData, catsData] = await Promise.all([
      api('/api/admin/forum/posts'),
      api('/api/admin/forum/categories')
    ]);
    const cats = catsData.items || [];
    catBox.innerHTML = `<table>
      <thead><tr><th>版块</th><th>描述</th><th>帖子数</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${cats.map((c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.description || '')}</td>
          <td>${c.post_count || 0}</td>
          <td>${c.is_active ? '<span class="badge approved">启用</span>' : '<span class="badge draft">停用</span>'}</td>
          <td><div class="row-actions"><button class="ghost" data-forum-cat-toggle="${c.id}" data-active="${c.is_active ? 1 : 0}">${c.is_active ? '停用' : '启用'}</button></div></td>
        </tr>`).join('') || '<tr><td colspan="5">暂无版块</td></tr>'}</tbody>
    </table>`;
    const posts = postsData.items || [];
    postBox.innerHTML = posts.length ? posts.map((p) => `
      <tr>
        <td><strong>${p.is_pinned ? '📌 ' : ''}${escapeHtml(p.title)}</strong></td>
        <td>${escapeHtml(p.category_name || '')}</td>
        <td>${escapeHtml(p.author_name || '')}</td>
        <td>${p.reply_count} / ${p.view_count}</td>
        <td>${p.status === 'published' ? '<span class="badge approved">正常</span>' : '<span class="badge draft">隐藏</span>'}${p.is_locked ? ' <span class="badge draft">锁定</span>' : ''}</td>
        <td><div class="row-actions">
          <button class="ghost" data-forum-post-pin="${p.id}" data-pin="${p.is_pinned ? 1 : 0}">${p.is_pinned ? '取消置顶' : '置顶'}</button>
          <button class="ghost" data-forum-post-lock="${p.id}" data-lock="${p.is_locked ? 1 : 0}">${p.is_locked ? '解锁' : '锁定'}</button>
          <button class="ghost" data-forum-post-status="${p.id}" data-status="${p.status === 'published' ? 'hidden' : 'published'}">${p.status === 'published' ? '隐藏' : '恢复'}</button>
          <button class="reject" data-forum-post-delete="${p.id}">删除</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6">暂无帖子</td></tr>';
  } catch (error) {
    postBox.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#forumCategoryBox')) {
  document.querySelector('#forumCategoryBox').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-forum-cat-toggle]');
    if (!btn) return;
    try {
      await api(`/api/admin/forum/categories/${btn.dataset.forumCatToggle}`, { method: 'PATCH', body: JSON.stringify({ is_active: btn.dataset.active === '1' ? false : true }) });
      loadForum();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#forumCategoryAddBtn').addEventListener('click', async () => {
    const nameInput = document.querySelector('#forumCategoryName');
    const name = nameInput.value.trim();
    if (!name) { alert('请输入版块名称'); return; }
    try {
      await api('/api/admin/forum/categories', { method: 'POST', body: JSON.stringify({ name, description: document.querySelector('#forumCategoryDesc').value.trim() }) });
      nameInput.value = '';
      document.querySelector('#forumCategoryDesc').value = '';
      loadForum();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#forumPostRows').addEventListener('click', async (event) => {
    const pin = event.target.closest('button[data-forum-post-pin]');
    const lock = event.target.closest('button[data-forum-post-lock]');
    const status = event.target.closest('button[data-forum-post-status]');
    const del = event.target.closest('button[data-forum-post-delete]');
    try {
      if (pin) await api(`/api/admin/forum/posts/${pin.dataset.forumPostPin}`, { method: 'PATCH', body: JSON.stringify({ is_pinned: pin.dataset.pin === '1' ? false : true }) });
      if (lock) await api(`/api/admin/forum/posts/${lock.dataset.forumPostLock}`, { method: 'PATCH', body: JSON.stringify({ is_locked: lock.dataset.lock === '1' ? false : true }) });
      if (status) await api(`/api/admin/forum/posts/${status.dataset.forumPostStatus}`, { method: 'PATCH', body: JSON.stringify({ status: status.dataset.status }) });
      if (del) {
        if (!confirm('确定删除该帖子吗？')) return;
        await api(`/api/admin/forum/posts/${del.dataset.forumPostDelete}`, { method: 'DELETE' });
      }
      loadForum();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#loadForumBtn').addEventListener('click', () => { loadForum(); });
}

// ---------- 招聘管理 ----------
let currentJobApplicationsId = 0;
function openJobEditor(item) {
  const editor = document.querySelector('#jobEditor');
  if (!editor) return;
  editor.hidden = false;
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#jobEditorTitle').textContent = item ? '编辑职位' : '发布职位';
  const form = document.querySelector('#jobForm');
  form.reset();
  form.querySelector('[name="id"]').value = item ? item.id : '';
  if (item) {
    ['company', 'title', 'location', 'type', 'salary', 'description', 'requirements', 'contact'].forEach((key) => {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = item[key] || '';
    });
    form.querySelector('[name="is_published"]').value = item.is_published === false ? 'false' : 'true';
  }
  document.querySelector('#jobStatus').textContent = '';
}
async function loadJobsAdmin() {
  const box = document.querySelector('#jobRows');
  if (!box) return;
  box.innerHTML = '<tr><td colspan="7">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/jobs');
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((j) => `
      <tr>
        <td><strong>${escapeHtml(j.title)}</strong></td>
        <td>${escapeHtml(j.company)}</td>
        <td>${escapeHtml(j.location || '')}</td>
        <td>${escapeHtml(j.salary || '')}</td>
        <td>${j.applications_count || 0}</td>
        <td>${j.is_published ? '<span class="badge approved">发布中</span>' : '<span class="badge draft">已下架</span>'}</td>
        <td><div class="row-actions">
          <button class="ghost" data-job-apps="${j.id}" data-job-title="${escapeHtml(j.title)}">投递</button>
          <button class="ghost" data-job-edit="${j.id}">编辑</button>
          <button class="reject" data-job-delete="${j.id}">删除</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="7">暂无招聘职位</td></tr>';
  } catch (error) {
    box.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}
async function loadJobApplications(jobId, jobTitle) {
  const card = document.querySelector('#jobApplicationsCard');
  if (!card) return;
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  currentJobApplicationsId = jobId;
  document.querySelector('#jobApplicationsTitle').textContent = `投递记录：${jobTitle || ''}`;
  const box = document.querySelector('#jobApplicationRows');
  box.innerHTML = '<tr><td colspan="8">正在加载……</td></tr>';
  try {
    const data = await api(`/api/admin/jobs/${jobId}/applications`);
    const items = data.items || [];
    const statusMap = { submitted: '待联系', contacted: '已联系', interview: '面试中', accepted: '已录用', rejected: '未通过' };
    box.innerHTML = items.length ? items.map((a) => `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.phone || '')}</td>
        <td>${escapeHtml(a.email || '')}</td>
        <td>${a.resume_url ? `<a href="${escapeHtml(a.resume_url)}" target="_blank" rel="noopener">查看</a>` : ''}</td>
        <td>${escapeHtml(a.note || '')}</td>
        <td>${escapeHtml(String(a.created_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td><span class="badge draft">${statusMap[a.status] || a.status}</span></td>
        <td><div class="row-actions">
          <select data-app-status="${a.id}" style="min-height:32px;border:1px solid #e5e7eb;border-radius:8px;padding:0 6px">
            ${Object.entries(statusMap).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="8">暂无投递</td></tr>';
    box.querySelectorAll('select[data-app-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/admin/job-applications/${sel.dataset.appStatus}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
          loadJobApplications(currentJobApplicationsId, document.querySelector('#jobApplicationsTitle').textContent.replace('投递记录：', ''));
        } catch (error) { alert(error.message); }
      });
    });
  } catch (error) {
    box.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#jobRows')) {
  document.querySelector('#newJobBtn').addEventListener('click', () => { openJobEditor(null); });
  document.querySelector('#jobCancelBtn').addEventListener('click', () => { document.querySelector('#jobEditor').hidden = true; });
  document.querySelector('#jobForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#jobStatus');
    status.textContent = '正在保存……';
    const fd = new FormData(event.currentTarget);
    const id = fd.get('id');
    const body = {
      company: fd.get('company'),
      title: fd.get('title'),
      location: fd.get('location'),
      type: fd.get('type'),
      salary: fd.get('salary'),
      description: fd.get('description'),
      requirements: fd.get('requirements'),
      contact: fd.get('contact'),
      is_published: fd.get('is_published') !== 'false'
    };
    try {
      const data = id
        ? await api(`/api/admin/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api('/api/admin/jobs', { method: 'POST', body: JSON.stringify(body) });
      status.textContent = data.message || '已保存';
      status.className = 'status ok';
      document.querySelector('#jobEditor').hidden = true;
      loadJobsAdmin();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector('#jobRows').addEventListener('click', async (event) => {
    const apps = event.target.closest('button[data-job-apps]');
    const edit = event.target.closest('button[data-job-edit]');
    const del = event.target.closest('button[data-job-delete]');
    if (apps) { await loadJobApplications(apps.dataset.jobApps, apps.dataset.jobTitle); return; }
    if (edit) {
      try {
        const data = await api(`/api/admin/jobs/${edit.dataset.jobEdit}`);
        openJobEditor(data.job);
      } catch (error) { alert(error.message); }
    }
    if (del) {
      if (!confirm('确定删除该职位吗？')) return;
      try { await api(`/api/admin/jobs/${del.dataset.jobDelete}`, { method: 'DELETE' }); loadJobsAdmin(); }
      catch (error) { alert(error.message); }
    }
  });
  document.querySelector('#closeJobApplicationsBtn').addEventListener('click', () => { document.querySelector('#jobApplicationsCard').hidden = true; });
}

// ---------- 消息推送 ----------
async function loadNotificationsAdmin() {
  const box = document.querySelector('#notificationRows');
  if (!box) return;
  box.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/notifications?page=1&pageSize=100');
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((n) => `
      <tr>
        <td><strong>${escapeHtml(n.title)}</strong></td>
        <td>${n.user_id ? escapeHtml(n.user_name || `用户#${n.user_id}`) : '全部用户'}</td>
        <td>${escapeHtml((n.content || '').slice(0, 40))}</td>
        <td>${escapeHtml(String(n.created_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${n.is_read ? '已读' : '<span class="badge pending">未读</span>'}</td>
        <td><div class="row-actions"><button class="reject" data-notification-delete="${n.id}">删除</button></div></td>
      </tr>`).join('') : '<tr><td colspan="6">暂无通知记录</td></tr>';
  } catch (error) {
    box.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#notificationRows')) {
  document.querySelector('#notificationRows').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-notification-delete]');
    if (!btn) return;
    if (!confirm('确定删除该通知吗？')) return;
    try {
      await api(`/api/admin/notifications/${btn.dataset.notificationDelete}`, { method: 'DELETE' });
      loadNotificationsAdmin();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#notificationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#notificationStatus');
    status.textContent = '正在发送……';
    const fd = new FormData(event.currentTarget);
    const target = fd.get('target');
    const body = {
      title: fd.get('title'),
      content: fd.get('content'),
      link: fd.get('link'),
      channel: fd.get('channel') || 'site',
      ...(target === 'user' ? { user_id: Number(fd.get('user_id')) || undefined } : {})
    };
    try {
      const data = await api('/api/admin/notifications/send', { method: 'POST', body: JSON.stringify(body) });
      status.textContent = data.message || '已发送';
      status.className = 'status ok';
      event.currentTarget.reset();
      loadNotificationsAdmin();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector('#loadNotificationsBtn').addEventListener('click', () => { loadNotificationsAdmin(); });
}
// ==================== 第三阶段：企业黄页 / 即时消息 ====================

// ---------- 校友企业黄页（管理） ----------
let companiesAdminCache = [];
function openCompanyEditor(item) {
  const editor = document.querySelector('#companyEditor');
  if (!editor) return;
  editor.hidden = false;
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#companyEditorTitle').textContent = item ? '编辑企业' : '添加企业';
  const form = document.querySelector('#companyAdminForm');
  form.reset();
  form.querySelector('[name="id"]').value = item ? item.id : '';
  if (item) {
    ['name', 'industry', 'city', 'website', 'intro', 'contact'].forEach((key) => {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = item[key] || '';
    });
    form.querySelector('[name="status"]').value = item.status || 'published';
  }
  document.querySelector('#companyAdminStatus').textContent = '';
}
async function loadCompaniesAdmin() {
  const box = document.querySelector('#companyAdminRows');
  if (!box) return;
  box.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/companies');
    companiesAdminCache = data.items || [];
    const statusMap = { published: '已发布', pending: '待审核', hidden: '已隐藏' };
    box.innerHTML = companiesAdminCache.length ? companiesAdminCache.map((c, i) => `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.industry || '')}</td>
        <td>${escapeHtml(c.city || '')}</td>
        <td>${escapeHtml(c.owner_name || '')}</td>
        <td><span class="badge ${c.status === 'published' ? 'approved' : c.status === 'pending' ? 'pending' : 'draft'}">${statusMap[c.status] || c.status}</span></td>
        <td><div class="row-actions">
          <button class="ghost" data-company-status="${c.id}" data-status="published" ${c.status === 'published' ? 'disabled' : ''}>发布</button>
          <button class="ghost" data-company-status="${c.id}" data-status="hidden" ${c.status === 'hidden' ? 'disabled' : ''}>隐藏</button>
          <button class="ghost" data-company-edit="${i}">编辑</button>
          <button class="reject" data-company-delete="${c.id}">删除</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6">暂无企业</td></tr>';
  } catch (error) {
    box.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#companyAdminRows')) {
  document.querySelector('#newCompanyBtn').addEventListener('click', () => { openCompanyEditor(null); });
  document.querySelector('#companyAdminCancelBtn').addEventListener('click', () => { document.querySelector('#companyEditor').hidden = true; });
  document.querySelector('#companyAdminForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#companyAdminStatus');
    status.textContent = '正在保存……';
    const fd = new FormData(event.currentTarget);
    const id = fd.get('id');
    const body = {
      name: fd.get('name'),
      industry: fd.get('industry'),
      city: fd.get('city'),
      website: fd.get('website'),
      intro: fd.get('intro'),
      contact: fd.get('contact'),
      status: fd.get('status')
    };
    try {
      const data = id
        ? await api(`/api/admin/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api('/api/admin/companies', { method: 'POST', body: JSON.stringify(body) });
      status.textContent = data.message || '已保存';
      status.className = 'status ok';
      document.querySelector('#companyEditor').hidden = true;
      loadCompaniesAdmin();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector('#companyAdminRows').addEventListener('click', async (event) => {
    const st = event.target.closest('button[data-company-status]');
    const edit = event.target.closest('button[data-company-edit]');
    const del = event.target.closest('button[data-company-delete]');
    try {
      if (st) await api(`/api/admin/companies/${st.dataset.companyStatus}`, { method: 'PATCH', body: JSON.stringify({ status: st.dataset.status }) });
      if (edit) openCompanyEditor(companiesAdminCache[Number(edit.dataset.companyEdit)]);
      if (del) {
        if (!confirm('确定删除该企业吗？')) return;
        await api(`/api/admin/companies/${del.dataset.companyDelete}`, { method: 'DELETE' });
      }
      loadCompaniesAdmin();
    } catch (error) { alert(error.message); }
  });
}

// ---------- 即时消息记录 ----------
async function loadChatAdmin() {
  const box = document.querySelector('#chatRows');
  if (!box) return;
  box.innerHTML = '<tr><td colspan="5">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/messages');
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((m) => `
      <tr>
        <td>${escapeHtml(m.sender_name || '未知')}</td>
        <td>${escapeHtml(m.user_a_name || '')} ↔ ${escapeHtml(m.user_b_name || '')}</td>
        <td>${escapeHtml((m.content || '').slice(0, 60))}</td>
        <td>${escapeHtml(String(m.created_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${m.is_read ? '已读' : '<span class="badge pending">未读</span>'}</td>
      </tr>`).join('') : '<tr><td colspan="5">暂无消息记录</td></tr>';
  } catch (error) {
    box.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#chatRows')) {
  document.querySelector('#loadChatBtn').addEventListener('click', () => { loadChatAdmin(); });
}


// ---------- 图片上传与校友选择（管理员便捷功能） ----------
function renderCoverPreview(previewId, value) {
  const box = document.getElementById(previewId);
  if (!box) return;
  box.innerHTML = value ? `<img src="${assetUrl(value)}" alt="预览" style="max-width:100%;max-height:140px;border-radius:10px;margin-top:8px" />` : '';
}
function assetUrl(u) { return /^https?:/i.test(u || '') ? u : (API_BASE_URL || '') + u; }
function bindCoverUpload(btnId, inputName, previewId, form) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
      if (file.size > 5 * 1024 * 1024) { alert('图片不能超过 5MB'); return; }
      const oldText = btn.textContent;
      btn.textContent = '上传中……';
      btn.disabled = true;
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const data = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ data: base64, filename: file.name, mime_type: file.type, purpose: 'cover' }) });
        const url = data.upload && data.upload.url;
        const input = form.querySelector(`input[name="${inputName}"]`);
        if (input) input.value = url || '';
        renderCoverPreview(previewId, url || '');
        alert('图片上传成功');
      } catch (error) {
        alert(error.message);
      } finally {
        btn.textContent = oldText;
        btn.disabled = false;
      }
    };
    fileInput.click();
  });
}
bindCoverUpload('newsCoverBtn', 'cover_url', 'newsCoverPreview', newsForm);
bindCoverUpload('eventCoverBtn', 'cover_url', 'eventCoverPreview', eventForm);
bindCoverUpload('heroImgBtn', 'hero_image', 'heroImgPreview', homeForm);

// 移除已上传的封面/横幅图片（仅清空表单字段，文件可在「素材库」里删除）
function bindImageRemove(btnId, inputName, previewId, form) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const input = form.querySelector(`input[name="${inputName}"]`);
    if (input) input.value = '';
    renderCoverPreview(previewId, '');
  });
}
bindImageRemove('newsCoverRemoveBtn', 'cover_url', 'newsCoverPreview', newsForm);
bindImageRemove('eventCoverRemoveBtn', 'cover_url', 'eventCoverPreview', eventForm);
bindImageRemove('heroImgRemoveBtn', 'hero_image', 'heroImgPreview', homeForm);

// ---------- 素材库 ----------
async function loadMedia() {
  const rows = document.getElementById('mediaRows');
  if (!rows) return;
  rows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/uploads');
    const items = data.items || [];
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="6">暂无素材，上传图片后会显示在这里。</td></tr>';
      return;
    }
    rows.innerHTML = items.map((item) => `
      <tr>
        <td><img src="${assetUrl('/api/uploads/' + item.id)}" alt="" style="max-width:90px;max-height:60px;border-radius:6px;object-fit:cover" /></td>
        <td>${escapeHtml(item.filename || item.id)}</td>
        <td>${escapeHtml(item.purpose || '')}</td>
        <td>${Math.round((item.size_bytes || 0) / 1024)} KB</td>
        <td>${escapeHtml(String(item.created_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td><button class="reject" data-media-delete="${escapeAttr(item.id)}">删除</button></td>
      </tr>`).join('');
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}
const mediaRefreshBtn = document.getElementById('mediaRefreshBtn');
if (mediaRefreshBtn) mediaRefreshBtn.addEventListener('click', loadMedia);
const mediaRows = document.getElementById('mediaRows');
if (mediaRows) {
  mediaRows.addEventListener('click', async (event) => {
    const del = event.target.closest('button[data-media-delete]');
    if (!del) return;
    if (!confirm('确定删除这个图片吗？引用它的新闻/页面将无法再显示这张图。')) return;
    del.disabled = true;
    try {
      await api(`/api/uploads/${del.dataset.mediaDelete}`, { method: 'DELETE' });
      await loadMedia();
    } catch (error) {
      alert(error.message);
      del.disabled = false;
    }
  });
}

// ---------- 富文本正文编辑器（新闻/活动详情） ----------
function initRichEditor(editorId, textareaName, imgBtnId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;
  const form = editor.closest('form');
  const textarea = form ? form.querySelector(`textarea[name="${textareaName}"]`) : null;
  const toolbar = editor.parentElement ? editor.parentElement.querySelector('.rich-toolbar') : null;
  function sync() {
    if (textarea) textarea.value = editor.innerHTML;
  }
  if (toolbar) {
    toolbar.querySelectorAll('button[data-rich-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editor.focus();
        const cmd = btn.dataset.richCmd;
        if (cmd === 'createLink') {
          const url = prompt('请输入链接地址（https://…）：');
          if (url) document.execCommand('createLink', false, url);
        } else if (cmd === 'formatBlock') {
          document.execCommand('formatBlock', false, btn.dataset.richValue || 'p');
        } else {
          document.execCommand(cmd, false, null);
        }
        sync();
      });
    });
  }
  const imgBtn = imgBtnId ? document.getElementById(imgBtnId) : null;
  if (imgBtn) {
    imgBtn.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
      fileInput.onchange = async () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
        if (file.size > 5 * 1024 * 1024) { alert('图片不能超过 5MB'); return; }
        const oldText = imgBtn.textContent;
        imgBtn.textContent = '上传中……';
        imgBtn.disabled = true;
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const data = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ data: base64, filename: file.name, mime_type: file.type, purpose: 'content' }) });
          const url = data.upload && data.upload.url;
          if (!url) throw new Error('上传失败');
          editor.focus();
          document.execCommand('insertImage', false, assetUrl(url));
          document.execCommand('insertHTML', false, '<br />');
          sync();
        } catch (error) {
          alert(error.message);
        } finally {
          imgBtn.textContent = oldText;
          imgBtn.disabled = false;
        }
      };
      fileInput.click();
    });
  }
  editor.addEventListener('input', sync);
  editor.addEventListener('blur', sync);
  if (form) form.addEventListener('submit', sync, true);
}
initRichEditor('newsContentEditor', 'content', 'newsContentImgBtn');
initRichEditor('eventContentEditor', 'content', 'eventContentImgBtn');

function escapeAttr(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const alumniPickSelect = document.getElementById('alumniPickSelect');
if (alumniPickSelect) {
  (async () => {
    try {
      const data = await api('/api/admin/alumni?page=1&pageSize=100');
      const items = (data.items || []).filter((a) => a.name && a.email);
      alumniPickSelect.innerHTML = '<option value="">— 从已认证校友选择（自动填充）—</option>' +
        items.map((a) => `<option value="${escapeAttr(a.user_id)}" data-name="${escapeAttr(a.name)}" data-email="${escapeAttr(a.email)}" data-phone="${escapeAttr(a.phone || '')}">${escapeHtml(a.name)}（${escapeHtml(a.email)}）</option>`).join('');
    } catch (error) { /* 接口不可用时保持空列表 */ }
  })();
  alumniPickSelect.addEventListener('change', () => {
    const opt = alumniPickSelect.options[alumniPickSelect.selectedIndex];
    if (!opt || !opt.value) return;
    const name = opt.dataset.name || '';
    const email = opt.dataset.email || '';
    const phone = opt.dataset.phone || '';
    if (directAdminForm) {
      const set = (n, v) => { const el = directAdminForm.querySelector(`[name="${n}"]`); if (el) el.value = v; };
      set('name', name); set('email', email); set('phone', phone);
    }
    if (inviteAdminForm) {
      const set = (n, v) => { const el = inviteAdminForm.querySelector(`[name="${n}"]`); if (el) el.value = v; };
      set('invitee_name', name); set('invitee_email', email); set('invitee_phone', phone);
    }
  });
}
