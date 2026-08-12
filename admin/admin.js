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
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || '接口请求失败');
  return data;
}

function setActiveTab(tabName) {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
  panels.forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}Panel`));
  if (tabName === 'applications') loadApplications();
  if (tabName === 'homeEditor') loadHomeContent();
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
  if (tabName === 'donations') loadDonationsAdmin();
  if (tabName === 'notifications') loadNotificationsAdmin();
  if (tabName === 'companies') loadCompaniesAdmin();
  if (tabName === 'chat') loadChatAdmin();
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
    rows.innerHTML = items.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(applicantTypeText(item.applicant_type))}<br>${escapeHtml(item.graduation_year || item.school_year || '')} ${escapeHtml(item.class_name || '')}<br>${escapeHtml(item.homeroom_teacher || '')}</td>
        <td>${escapeHtml([item.province, item.city, item.county].filter(Boolean).join(' / '))}<br>${escapeHtml([item.current_province, item.current_city, item.current_county].filter(Boolean).join(' / '))}</td>
        <td>${escapeHtml(item.phone || '')}<br>${escapeHtml(item.email || '')}</td>
        <td>${materialLinks(item)}</td>
        <td><span class="badge ${escapeHtml(item.status)}">${statusText(item.status)}</span></td>
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
    const donate = sections.home_donate || {};
    homeForm.about_title.value = about.title || '';
    homeForm.about_intro.value = about.content || '';
    homeForm.figures_title.value = figures.title || '';
    homeForm.figures_subtitle.value = figures.subtitle || '';
    homeForm.services_title.value = services.title || '';
    homeForm.services_subtitle.value = services.subtitle || '';
    homeForm.join_title.value = join.title || '';
    homeForm.donate_title.value = donate.title || '';
    homeForm.donate_intro.value = donate.intro || '';
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
        subtitle: form.hero_subtitle || ''
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
      section_name: '校友风采',
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
      section_name: '加入我们',
      display_order: 7,
      content: { title: form.join_title || '' }
    }));
    results.push(await saveSection({
      page_slug: 'home',
      section_key: 'home_donate',
      section_name: '支持母校',
      display_order: 8,
      content: { title: form.donate_title || '', intro: form.donate_intro || '' }
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

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginStatus.textContent = '';
  const formData = new FormData(loginForm);
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
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
  if (item) {
    newsForm.id.value = item.id;
    newsForm.title.value = item.title || '';
    newsForm.category.value = item.category || '';
    newsForm.author.value = item.author || '';
    newsForm.summary.value = item.summary || '';
    newsForm.cover_url.value = item.cover_url || '';
    newsForm.content.value = item.content || '';
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
        <td>${escapeHtml(item.start_time ? String(item.start_time).slice(0, 16).replace('T', ' ') : '待定')}</td>
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
    eventForm.summary.value = item.summary || '';
    eventForm.content.value = item.content || '';
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
  userRows.innerHTML = '<tr><td colspan="6">正在加载……</td></tr>';
  const q = userSearch ? userSearch.value.trim() : '';
  const params = new URLSearchParams({ page, pageSize: 20 });
  if (q) params.set('q', q);
  try {
    const data = await api(`/api/admin/users?${params.toString()}`);
    const items = data.items || [];
    if (!items.length) {
      userRows.innerHTML = '<tr><td colspan="6">暂无用户</td></tr>';
      userPagination.innerHTML = '';
      return;
    }
    userRows.innerHTML = items.map(item => {
      const isRoot = item.phone === 'ROOT_ADMIN' || item.admin_level === 'super_admin';
      const statusClass = { active: 'approved', disabled: 'rejected', pending: 'pending' }[item.status] || 'draft';
      const source = item.wechat_openid ? '微信用户' : '';
      return `
        <tr>
          <td><strong>${escapeHtml(item.display_name)}</strong>${source ? `<br><small>${escapeHtml(source)}</small>` : ''}</td>
          <td>${escapeHtml(item.phone || '')}<br>${escapeHtml(item.email || '')}</td>
          <td>${userRoleText(item.role)}${item.admin_level ? `<br><small>${adminLevelText(item.admin_level)}</small>` : ''}</td>
          <td><span class="badge ${statusClass}">${statusText(item.status)}</span></td>
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
    userRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
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

// ---------- 捐赠管理 ----------
async function loadDonationsAdmin() {
  const box = document.querySelector('#donationRows');
  if (!box) return;
  box.innerHTML = '<tr><td colspan="8">正在加载……</td></tr>';
  try {
    const data = await api('/api/admin/donations');
    document.querySelector('#donationTotal').textContent = Number(data.total || 0).toLocaleString('zh-CN');
    document.querySelector('#donationCount').textContent = data.count || 0;
    const items = data.items || [];
    const statusMap = { pending: '待确认', confirmed: '已确认', rejected: '已拒绝' };
    box.innerHTML = items.length ? items.map((d) => `
      <tr>
        <td>${escapeHtml(d.donor_name)}</td>
        <td><strong>¥${Number(d.amount).toLocaleString('zh-CN')}</strong></td>
        <td>${escapeHtml(d.purpose || '校友基金')}</td>
        <td>${escapeHtml(d.payment_method || '')}</td>
        <td>${escapeHtml(d.message || '')}</td>
        <td>${escapeHtml(String(d.created_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td><span class="badge ${d.status === 'confirmed' ? 'approved' : d.status === 'rejected' ? 'cancelled' : 'pending'}">${statusMap[d.status] || d.status}</span></td>
        <td><div class="row-actions">
          <button class="approve" data-donation-status="${d.id}" data-status="confirmed" ${d.status === 'confirmed' ? 'disabled' : ''}>确认</button>
          <button class="reject" data-donation-status="${d.id}" data-status="rejected" ${d.status === 'rejected' ? 'disabled' : ''}>拒绝</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="8">暂无捐赠记录</td></tr>';
  } catch (error) {
    box.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
  }
}
if (document.querySelector('#donationRows')) {
  document.querySelector('#donationRows').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-donation-status]');
    if (!btn) return;
    try {
      await api(`/api/admin/donations/${btn.dataset.donationStatus}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
      loadDonationsAdmin();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#loadDonationsBtn').addEventListener('click', () => { loadDonationsAdmin(); });
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