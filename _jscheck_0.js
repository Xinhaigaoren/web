
    /* 登录用户信息：优先从后端接口实时获取（需 alumniToken），失败时回退本地存储 */
    const API_BASE_URL = 'https://hailin-alumni-api.onrender.com';
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');

    function readUser() {
        try {
            const raw = localStorage.getItem('alumniUser');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function applyUser(info) {
        if (info && info.name) {
            avatarEl.textContent = info.name.slice(-1);
            nameEl.textContent = '*' + info.name;
        } else {
            avatarEl.textContent = '?';
            nameEl.textContent = '未登录';
        }
    }

    (async () => {
        const token = localStorage.getItem('alumniToken');
        if (!token) {
            applyUser(readUser());
            return;
        }
        try {
            const resp = await fetch(API_BASE_URL + '/api/alumni/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json();
            if (resp.ok && data.user) {
                const u = data.user;
                const profile = data.profile || {};
                localStorage.setItem('alumniUser', JSON.stringify({
                    name: u.display_name || profile.name || u.name || '',
                    phone: u.phone || '',
                    email: u.email || '',
                    graduateYear: profile.graduation_year || '',
                    className: profile.class_name || ''
                }));
                applyUser({ name: u.display_name || profile.name || u.name });
            } else {
                applyUser(readUser());
            }
        } catch (err) {
            applyUser(readUser());
        }
    })();
