// ============ 官网共享脚本（内容系统与校友中心） ============
(function () {
  const API_BASE_URL = (window.HAILIN_CONFIG && window.HAILIN_CONFIG.API_BASE_URL) || 'http://localhost:3000';
  const tokenKey = 'xh_alumni_token';
  const userKey = 'xh_alumni_user';
  // 微信等内置浏览器可能禁用 localStorage，这里做内存兜底，避免登录流程中断
  let memoryStore = {};
  function safeStorageGet(key) { try { return localStorage.getItem(key); } catch (_) { return memoryStore[key] === undefined ? null : memoryStore[key]; } }
  function safeStorageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) { memoryStore[key] = value; } }
  function safeStorageRemove(key) { try { localStorage.removeItem(key); } catch (_) { delete memoryStore[key]; } }

  const store = {
    getToken: () => safeStorageGet(tokenKey) || '',
    setToken: (token) => safeStorageSet(tokenKey, token),
    clearAuth: () => { safeStorageRemove(tokenKey); safeStorageRemove(userKey); },
    getUser: () => { try { return JSON.parse(safeStorageGet(userKey) || '{}'); } catch { return {}; } },
    setUser: (user) => safeStorageSet(userKey, JSON.stringify(user || {}))
  };

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = store.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 25000) : null;
      try {
        response = await fetch(`${API_BASE_URL}${path}`, Object.assign({}, options, { headers }, controller ? { signal: controller.signal } : {}));
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? '请求超时：网络较慢或服务暂不可用，请稍后重试' : '网络异常：服务可能正在启动，请稍后刷新重试');
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

  // 把管理员在富文本里填写的相对图片/链接地址（如 /api/uploads/xxx）转换为完整地址
  function absolutizeHtml(html) {
    return String(html || '').replace(/(\bsrc|\bposter|\bhref)=(["'])(\/[^"']*)\2/g, (match, attr, quote, url) => `${attr}=${quote}${assetUrl(url)}${quote}`);
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
    const map = {
      '': 'home', 'index.html': 'home',
      'about.html': 'about', 'news.html': 'news', 'news-detail.html': 'news-detail',
      'events.html': 'events', 'directory.html': 'directory', 'account.html': 'account',
      'forum.html': 'forum', 'jobs.html': 'jobs', 'companies.html': 'companies',
      'map.html': 'map', 'messages.html': 'messages', 'contact.html': 'contact',
      'donate.html': 'donate', 'checkin.html': 'checkin'
    };
    return map[name] || null;
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
              if (content.html) node.innerHTML = absolutizeHtml(content.html);
            } else {
              Object.keys(content).forEach((key) => {
                const child = node.querySelector(`[data-field="${key}"]`);
                const value = content[key];
                if (child && value !== undefined && value !== null && value !== '') child.innerHTML = String(value);
              });
            }
          } else if (typeof content === 'string' && content) {
            node.innerHTML = absolutizeHtml(content);
          }
        });
      });
      const heroSec = (data.sections || []).find((s) => s.section_key === 'home_hero');
      if (heroSec) {
        let hc = heroSec.content;
        if (typeof hc === 'string') { try { hc = JSON.parse(hc); } catch (_) { hc = {}; } }
        // 管理员上传了横幅图就直接整幅显示，不再叠加默认背景或渐变遮罩
        if (hc && hc.image) {
          const media = document.getElementById('heroMedia');
          if (media) media.style.backgroundImage = `url('${assetUrl(hc.image)}')`;
        }
      }
    } catch (error) {
      // keep static content if the API is unavailable
      console.warn('[site] content load skipped:', error.message);
    }
  }
  loadSiteContent();

  // 网站页脚：所有页面统一从接口加载，管理员可后台修改
  async function loadFooter() {
    try {
      const data = await api('/api/site/sections?page=footer&t=' + Date.now());
      const sec = (data.sections || []).find((s) => s.section_key === 'footer_info');
      if (!sec) return;
      let c = sec.content;
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
      if (!c || typeof c !== 'object') return;
      const footer = document.querySelector('footer.site-footer');
      if (!footer) return;
      const set = (sel, val) => {
        if (val === undefined || val === null || val === '') return;
        const el = footer.querySelector(sel);
        if (el) el.innerHTML = String(val);
      };
      set('.footer-grid > div:first-child h2', c.name);
      set('.footer-grid > div:first-child p', c.about);
      set('.footer-grid > div:nth-child(2) p:nth-of-type(1)', c.email);
      set('.footer-grid > div:nth-child(2) p:nth-of-type(2)', c.address);
    } catch (error) { /* 保留静态页脚 */ }
  }
  loadFooter();

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
          const cover = first.cover_url ? ` style="background-image:linear-gradient(135deg, rgba(24,48,89,.12), rgba(39,68,114,.12)), url('${assetUrl(first.cover_url)}')"` : '';
          feature.innerHTML = `<div class="feature-img"${cover}></div><div class="feature-body"><time>${formatDate(first.published_at)}</time><h3><a href="news-detail.html?slug=${encodeURIComponent(first.slug)}">${escapeHtml(first.title)}</a></h3><p>${escapeHtml(first.summary || '')}</p></div>`;
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

  // 返回顶部：统一平滑滚动到页面顶部，保证所有页面可用
  document.querySelectorAll('a[href="#top"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    });
  });

  window.XH = { API_BASE_URL, api, assetUrl, formatDate, escapeHtml, toast, store };
})();
