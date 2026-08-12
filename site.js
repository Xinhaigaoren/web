// ============ 官网共享脚本（内容系统与校友中心） ============
(function () {
  const API_BASE_URL = (window.HAILIN_CONFIG && window.HAILIN_CONFIG.API_BASE_URL) || 'http://localhost:3000';
  const tokenKey = 'xh_alumni_token';
  const userKey = 'xh_alumni_user';

  const store = {
    getToken: () => localStorage.getItem(tokenKey) || '',
    setToken: (token) => localStorage.setItem(tokenKey, token),
    clearAuth: () => { localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); },
    getUser: () => { try { return JSON.parse(localStorage.getItem(userKey) || '{}'); } catch { return {}; } },
    setUser: (user) => localStorage.setItem(userKey, JSON.stringify(user || {}))
  };

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = store.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, Object.assign({}, options, { headers }));
    } catch (e) {
      throw new Error('网络异常：服务可能正在启动，请稍后刷新重试');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const err = new Error(data.message || '请求失败，请稍后重试');
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function assetUrl(path) {
    if (!path) return '';
    return /^https?:/i.test(path) ? path : `${API_BASE_URL}${path}`;
  }

  function formatDate(value, withTime = false) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    const base = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
    return withTime ? `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}` : base;
  }

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, type = 'success') {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  // 移动端导航
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (event) => {
      if (event.target.matches('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 顶栏登录状态
  function renderAccountLink() {
    const holder = document.querySelector('[data-account]');
    if (!holder) return;
    const user = store.getUser();
    if (user && user.name) {
      holder.innerHTML = `<span class="account-name">${escapeHtml(user.name)}</span><a href="account.html">个人中心</a><a href="#" data-logout>退出</a>`;
      const logout = holder.querySelector('[data-logout]');
      if (logout) logout.addEventListener('click', (event) => {
        event.preventDefault();
        store.clearAuth();
        location.reload();
      });
    } else {
      holder.innerHTML = '<a href="account.html">校友登录/注册</a><a href="directory.html">校友名录</a><a href="admin/">管理员入口</a>';
    }
  }
  renderAccountLink();

  // content system: admin edits show up on the public site after refresh
  function detectSiteSlug() {
    const name = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (name === '' || name === 'index.html') return 'home';
    if (name === 'about.html') return 'about';
    if (name === 'contact.html') return 'contact';
    return null;
  }

  async function loadSiteContent() {
    const slug = detectSiteSlug();
    if (!slug) return;
    try {
      const data = await api(`/api/site/${slug}?t=${Date.now()}`);
      const page = data.page || {};
      if (page.title) document.title = page.title;
      if (page.description) {
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute('content', page.description);
      }
      (data.sections || []).forEach((section) => {
        let content = section.content;
        if (typeof content === 'string') {
          try { content = JSON.parse(content); } catch (_) { /* keep raw */ }
        }
        const nodes = document.querySelectorAll(`[data-section="${section.section_key}"]`);
        nodes.forEach((node) => {
          if (content && typeof content === 'object') {
            if (node.dataset.field) {
              const value = content[node.dataset.field];
              if (value !== undefined && value !== null && value !== '') node.innerHTML = String(value);
            } else if (typeof content.html === 'string') {
              if (content.html) node.innerHTML = content.html;
            } else {
              Object.keys(content).forEach((key) => {
                const child = node.querySelector(`[data-field="${key}"]`);
                const value = content[key];
                if (child && value !== undefined && value !== null && value !== '') child.innerHTML = String(value);
              });
            }
          } else if (typeof content === 'string' && content) {
            node.innerHTML = content;
          }
        });
      });
    } catch (error) {
      // keep static content if the API is unavailable
      console.warn('[site] content load skipped:', error.message);
    }
  }
  loadSiteContent();

  // 首页动态内容：新闻与活动从接口加载，点击可进入详情页
  async function loadHomeDynamic() {
    try {
      const newsData = await api('/api/news?page=1&pageSize=3&t=' + Date.now());
      const newsItems = newsData.items || [];
      if (newsItems.length) {
        const list = document.getElementById('homeNewsList');
        if (list) {
          list.innerHTML = newsItems.map((item) =>
            `<a href="news-detail.html?slug=${encodeURIComponent(item.slug)}"><time>${formatDate(item.published_at)}</time><span>${escapeHtml(item.title)}</span></a>`
          ).join('');
        }
        const feature = document.getElementById('homeNewsFeature');
        if (feature) {
          const first = newsItems[0];
          feature.innerHTML = `<div class="feature-img"></div><div class="feature-body"><time>${formatDate(first.published_at)}</time><h3><a href="news-detail.html?slug=${encodeURIComponent(first.slug)}">${escapeHtml(first.title)}</a></h3><p>${escapeHtml(first.summary || '')}</p></div>`;
        }
      }
    } catch (error) { /* 接口不可用时保留静态内容 */ }

    try {
      const eventsData = await api('/api/events?page=1&pageSize=3&t=' + Date.now());
      const eventItems = eventsData.items || [];
      const box = document.getElementById('homeEvents');
      if (box && eventItems.length) {
        box.innerHTML = eventItems.map((item) => {
          const d = new Date(item.start_time);
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `<a class="event-link" href="events.html"><time><strong>${day}</strong><span>${month}月</span></time><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary || '')}</p></div></a>`;
        }).join('');
      }
    } catch (error) { /* 接口不可用时保留静态内容 */ }
  }
  loadHomeDynamic();

  window.XH = { API_BASE_URL, api, assetUrl, formatDate, escapeHtml, toast, store };
})();