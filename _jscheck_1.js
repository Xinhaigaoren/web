
    /* ==========================================
       动态统计 + 真实收藏 + 头像上传（后端持久化）
       ========================================== */
    const favCard = document.getElementById('favCard');
    const avatarEl2 = document.getElementById('userAvatar');
    const avatarInput = document.getElementById('avatarInput');

    function alumniToken() { return localStorage.getItem('alumniToken'); }

    async function apiCall(method, path, body) {
        const token = alumniToken();
        if (!token) return null;
        try {
            const resp = await fetch(API_BASE_URL + path, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: body ? JSON.stringify(body) : undefined
            });
            return await resp.json();
        } catch (err) { return null; }
    }

    function setAvatar(url) {
        if (!url) return;
        const u = readUser() || {};
        if (u.name) {
            avatarEl2.textContent = '';
            avatarEl2.classList.add('has-photo');
            avatarEl2.style.backgroundImage = "url('" + url + "')";
        }
    }

    /* 图片压缩为 240x240 方形 dataURL */
    function compressAvatar(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const size = 240;
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                const min = Math.min(img.width, img.height);
                const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
                ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    avatarEl2.addEventListener('click', () => {
        if (!alumniToken()) { alert('请先登录'); location.href = 'login.html'; return; }
        avatarInput.click();
    });
    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;
        const dataUrl = await compressAvatar(file);
        const r = await apiCall('PUT', '/api/alumni/me', { avatar_url: dataUrl });
        if (r && r.profile) {
            setAvatar(dataUrl);
            alert('头像已更新');
        } else {
            alert('头像更新失败，请先完成校友认证');
        }
        avatarInput.value = '';
    });

    /* 收藏：真实持久化 */
    favCard.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!alumniToken()) { alert('请先登录'); location.href = 'login.html'; return; }
        const on = !favCard.classList.contains('on');
        let r;
        if (on) r = await apiCall('POST', '/api/favorites', { service_key: 'card' });
        else r = await apiCall('DELETE', '/api/favorites/card');
        if (r && r.ok) {
            favCard.classList.toggle('on', on);
            const isFavTab = document.querySelector('.tab.active')?.dataset.tab === 'favorites';
            if (!on && isFavTab) document.querySelector('.service-card').style.display = 'none';
        }
    });

    /* Tab 切换：我的收藏只显示已收藏服务 */
    document.querySelectorAll('.tab').forEach((t) => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
            const mode = t.dataset.tab;
            const card = document.querySelector('.service-card');
            const favOn = favCard.classList.contains('on');
            if (mode === 'favorites') card.style.display = favOn ? '' : 'none';
            else card.style.display = '';
        });
    });

    /* 初始化：统计动态化 + 收藏状态 + 头像 */
    (async () => {
        if (!alumniToken()) return;
        const nums = document.querySelectorAll('.stat-item .num');
        const me = await apiCall('GET', '/api/alumni/me');
        if (me && me.user) {
            const role = me.user.role;
            const p = me.profile || {};
            if (role === 'alumni') { nums[0].textContent = '0'; nums[1].textContent = '1'; }
            else { nums[0].textContent = '1'; nums[1].textContent = '0'; }
            nums[2].textContent = '0';
            if (p.avatar_url) setAvatar(p.avatar_url);
            /* 管理员身份标识 */
            const nameSpan = document.getElementById('userName');
            if (role === 'super_admin' || role === 'admin') {
                nameSpan.textContent = nameSpan.textContent.replace(/\s*（管理员）$/, '') + '（管理员）';
            }
        }
        const fav = await apiCall('GET', '/api/favorites');
        if (fav && fav.favorites && fav.favorites.indexOf('card') !== -1) favCard.classList.add('on');
    })();
