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

const API_BASE_URL = window.HAILIN_CONFIG?.API_BASE_URL || 'http://localhost:3000';

// 顶栏登录状态（校友中心账号）
(function () {
  const holder = document.querySelector('[data-account]');
  if (!holder) return;
  const tokenKey = 'xh_alumni_token';
  const userKey = 'xh_alumni_user';
  let user = null;
  try { user = JSON.parse(localStorage.getItem(userKey) || '{}'); } catch (_) {}
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  if (user && user.name) {
    holder.innerHTML = `<span class="account-name">${escape(user.name)}</span><a href="account.html">个人中心</a><a href="#" data-logout>退出</a>`;
    const logout = holder.querySelector('[data-logout]');
    if (logout) logout.addEventListener('click', (event) => {
      event.preventDefault();
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
      location.reload();
    });
  } else {
    holder.innerHTML = '<a href="account.html">校友登录/注册</a><a href="directory.html">校友名录</a><a href="admin/">管理员入口</a>';
  }
})();
