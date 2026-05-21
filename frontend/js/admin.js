/**
 * 管理员面板 — 审核上传、用户管理
 */
const Admin = {
    init() {
        $on('btn-admin-panel', 'click', () => this.open());
        $on('btn-close-admin', 'click', () => this.close());

        // Tab 切换
        document.querySelectorAll('#admin-tabs .admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('#admin-tabs .admin-tab').forEach(t => {
                    t.classList.remove('active');
                    t.style.color = '#6b6560';
                    t.style.borderBottomColor = 'transparent';
                });
                tab.classList.add('active');
                tab.style.color = '#1a1614';
                tab.style.borderBottomColor = '#b83a2e';
                if (tab.dataset.tab === 'uploads') {
                    document.getElementById('admin-uploads-panel').style.display = '';
                    document.getElementById('admin-users-panel').style.display = 'none';
                    this._loadUploads();
                } else {
                    document.getElementById('admin-uploads-panel').style.display = 'none';
                    document.getElementById('admin-users-panel').style.display = '';
                    this._loadUsers();
                }
            });
        });
    },

    open() {
        if (!User.isLoggedIn() || !User._user?.is_admin) {
            alert('仅管理员可访问');
            return;
        }
        document.getElementById('admin-modal').style.display = 'flex';
        document.getElementById('admin-msg').style.display = 'none';
        this._loadUploads();
    },

    close() {
        document.getElementById('admin-modal').style.display = 'none';
    },

    _showMsg(text, color) {
        const el = document.getElementById('admin-msg');
        el.style.display = ''; el.style.color = color || '#b83a2e'; el.textContent = text;
    },

    async _loadUploads() {
        const list = document.getElementById('admin-upload-list');
        list.innerHTML = '<div style="text-align:center;color:#9a948c;padding:30px">加载中...</div>';
        try {
            const resp = await fetch('/api/admin/pending-uploads', {
                headers: { 'Authorization': 'Bearer ' + User.getToken() }
            });
            const r = await resp.json();
            if (!r.success) { list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">${r.message}</div>`; return; }
            if (r.items.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:#9a948c;padding:30px">暂无待审核案例</div>';
                return;
            }
            list.innerHTML = r.items.map(item => {
                const statusLabel = item.status === 'approved' ? '<span style="color:#2d8a56">已批准</span>' :
                                   item.status === 'pending' ? '<span style="color:#b8860b">待审核</span>' :
                                   '<span style="color:#b83a2e">已拒绝</span>';
                return `<div style="padding:10px;border-bottom:1px solid rgba(58,54,50,0.05);margin-bottom:2px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div style="flex:1;min-width:0">
                            <div style="font-size:13px;font-weight:600;color:#1a1614;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name||'未命名'}</div>
                            <div style="font-size:10px;color:#6b6560;margin-top:2px">
                                上传者：${item.uploader_name||'--'} · ${item.uploaded_at||''} · ${statusLabel}
                            </div>
                            <div style="font-size:9px;color:#9a948c;margin-top:1px">${(item.tags||[]).join(' · ')}</div>
                        </div>
                        ${item.status === 'pending' ? `
                        <div style="display:flex;gap:4px;flex-shrink:0">
                            <button class="btn-approve" data-id="${item.id}" style="padding:4px 10px;background:#2d8a56;color:#fff;border:none;border-radius:4px;font-size:11px;font-family:inherit;cursor:pointer">批准</button>
                            <button class="btn-reject" data-id="${item.id}" style="padding:4px 10px;background:none;color:#b83a2e;border:1px solid #b83a2e;border-radius:4px;font-size:11px;font-family:inherit;cursor:pointer">拒绝</button>
                        </div>` : ''}
                    </div>
                </div>`;
            }).join('');

            // 绑定按钮
            list.querySelectorAll('.btn-approve').forEach(btn => {
                btn.addEventListener('click', () => this._approve(btn.dataset.id));
            });
            list.querySelectorAll('.btn-reject').forEach(btn => {
                btn.addEventListener('click', () => this._reject(btn.dataset.id));
            });
        } catch(e) { list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">加载失败</div>`; }
    },

    async _approve(id) {
        try {
            const resp = await fetch('/api/admin/approve-upload/' + id, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + User.getToken() }
            });
            const r = await resp.json();
            if (r.success) {
                this._showMsg('已批准', '#2d8a56');
                this._loadUploads();
            } else {
                this._showMsg(r.message || '操作失败');
            }
        } catch(e) { this._showMsg('网络错误'); }
    },

    async _reject(id) {
        if (!confirm('确定拒绝并删除此上传？')) return;
        try {
            const resp = await fetch('/api/admin/reject-upload/' + id, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + User.getToken() }
            });
            const r = await resp.json();
            if (r.success) {
                this._showMsg('已拒绝', '#b83a2e');
                this._loadUploads();
            } else {
                this._showMsg(r.message || '操作失败');
            }
        } catch(e) { this._showMsg('网络错误'); }
    },

    async _loadUsers() {
        const list = document.getElementById('admin-user-list');
        list.innerHTML = '<div style="text-align:center;color:#9a948c;padding:30px">加载中...</div>';
        try {
            const resp = await fetch('/api/admin/users', {
                headers: { 'Authorization': 'Bearer ' + User.getToken() }
            });
            const r = await resp.json();
            if (!r.success) { list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">${r.message}</div>`; return; }
            list.innerHTML = r.users.map(u => `
                <div style="padding:10px;border-bottom:1px solid rgba(58,54,50,0.05);display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <span style="font-size:13px;font-weight:600;color:#1a1614">${u.nickname||u.username}</span>
                        <span style="font-size:10px;color:#6b6560;margin-left:6px">${u.is_admin?'管理员':'用户'} · ${u.created_at||''}</span>
                    </div>
                    <div style="font-size:10px;color:#9a948c">配额 ${u.quota_used}/${u.quota_total}</div>
                </div>
            `).join('');
        } catch(e) { list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">加载失败</div>`; }
    },
};
