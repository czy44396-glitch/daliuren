/**
 * 用户管理 — QQ邮箱登录/注册 + 验证码快捷登录
 */
const User = {
    _token: null,
    _user: null,
    _codeTimer: null,
    _codeCountdown: 0,

    init() {
        const saved = localStorage.getItem('dal-liuren-user');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this._token = data.token;
                this._user = data.user;
            } catch(e) {}
        }

        $on('info-portal-login', 'click', () => this._openLogin());
        $on('btn-login', 'click', () => this._openLogin());
        $on('btn-close-login', 'click', () => this._closeLogin());

        // 邮箱登录/注册
        $on('btn-email-login', 'click', () => this._emailLogin());
        $on('btn-email-register', 'click', () => this._emailRegister());

        // 验证码登录
        $on('btn-send-code', 'click', () => this._sendCode());
        $on('btn-verify-code', 'click', () => this._verifyCodeLogin());

        // Enter 快捷
        const pwEl = document.getElementById('login-password');
        if (pwEl) pwEl.addEventListener('keydown', (e) => { if (e.key==='Enter') this._emailLogin(); });
        const codeEl = document.getElementById('login-code');
        if (codeEl) codeEl.addEventListener('keydown', (e) => { if (e.key==='Enter') this._verifyCodeLogin(); });

        // 上传
        $on('btn-upload-case', 'click', () => this._uploadCurrentCase());

        // 检查 SMTP 是否可用，不可用则隐藏验证码登录
        this._checkSmtpStatus();

        this._updateUI();
    },

    async _checkSmtpStatus() {
        try {
            const resp = await fetch('/api/auth/email/send-code', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email: 'check@test.local' }),
            });
            const r = await resp.json();
            // 如果返回 SMTP 未配置，隐藏验证码区域
            if (!r.success && r.message && r.message.includes('SMTP')) {
                document.getElementById('code-login-area').style.display = 'none';
            }
        } catch(e) {
            // 网络错误也隐藏
            document.getElementById('code-login-area').style.display = 'none';
        }
    },

    isLoggedIn() { return !!this._token; },
    getToken() { return this._token; },
    getUserId() { return this._user ? this._user.id : 'guest'; },

    gateOrLogin() {
        if (this.isLoggedIn()) return true;
        this._openLogin();
        return false;
    },

    _openLogin() {
        if (this.isLoggedIn()) {
            if (confirm('确定退出登录？')) {
                this._token = null; this._user = null;
                localStorage.removeItem('dal-liuren-user');
                this._updateUI();
            }
            return;
        }
        document.getElementById('login-modal').style.display = 'flex';
        this._clearMsg();
        document.getElementById('login-password').value = '';
        document.getElementById('register-nickname-row').style.display = 'none';
        // 重置验证码区域
        document.getElementById('code-input-row').style.display = 'none';
        document.getElementById('btn-verify-code').style.display = 'none';
        document.getElementById('btn-send-code').style.display = '';
        document.getElementById('send-code-hint').textContent = '';
        if (this._codeTimer) { clearInterval(this._codeTimer); this._codeTimer = null; }

        // 自动填充上次登录的邮箱
        const savedEmail = localStorage.getItem('dal-liuren-email');
        const emailEl = document.getElementById('login-email');
        if (savedEmail && emailEl) {
            emailEl.value = savedEmail;
            document.getElementById('login-password').focus();
        } else if (emailEl) {
            emailEl.focus();
        }
    },

    _closeLogin() {
        document.getElementById('login-modal').style.display = 'none';
        if (this._codeTimer) { clearInterval(this._codeTimer); this._codeTimer = null; }
    },

    _showMsg(text, color) {
        const el = document.getElementById('login-msg');
        el.style.display = ''; el.style.color = color || '#b83a2e'; el.textContent = text;
    },
    _clearMsg() { const el = document.getElementById('login-msg'); if (el) el.style.display = 'none'; },

    async _emailLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value.trim();
        if (!email || !password) { this._showMsg('请填写邮箱和密码'); return; }
        this._showMsg('登录中...', '#6b6560');
        try {
            const resp = await fetch('/api/auth/email/login', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email, password }),
            });
            const r = await resp.json();
            if (r.success) { this._onLoginSuccess(r); }
            else { this._showMsg(r.message || '登录失败'); }
        } catch(e) { this._showMsg('网络错误：'+e.message); }
    },

    async _emailRegister() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const nickname = document.getElementById('register-nickname')?.value?.trim() || '';

        if (!email || !password) { this._showMsg('请填写邮箱和密码'); return; }
        if (password.length < 6) { this._showMsg('密码至少6位'); return; }

        // 首次点击显示昵称输入，再次点击确认注册
        const nickRow = document.getElementById('register-nickname-row');
        if (nickRow && nickRow.style.display === 'none') {
            nickRow.style.display = '';
            document.getElementById('register-nickname').focus();
            this._showMsg('请填写昵称后再次点击注册', '#6b6560');
            return;
        }

        this._showMsg('注册中...', '#6b6560');
        try {
            const resp = await fetch('/api/auth/email/register', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email, password, nickname }),
            });
            const r = await resp.json();
            if (r.success) { this._onLoginSuccess(r); }
            else { this._showMsg(r.message || '注册失败'); }
        } catch(e) { this._showMsg('网络错误：'+e.message); }
    },

    // ====== 验证码快捷登录 ======
    async _sendCode() {
        const email = document.getElementById('login-email').value.trim();
        if (!email || !email.includes('@')) { this._showMsg('请先输入邮箱'); return; }
        if (this._codeCountdown > 0) { this._showMsg(`请 ${this._codeCountdown} 秒后再试`); return; }

        this._showMsg('发送中...', '#6b6560');
        const btn = document.getElementById('btn-send-code');
        btn.disabled = true;

        try {
            const resp = await fetch('/api/auth/email/send-code', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email }),
            });
            const r = await resp.json();
            if (r.success) {
                this._clearMsg();
                document.getElementById('code-input-row').style.display = '';
                document.getElementById('btn-verify-code').style.display = '';
                document.getElementById('btn-send-code').style.display = 'none';
                document.getElementById('send-code-hint').textContent = '验证码已发送至 ' + email;
                document.getElementById('login-code').focus();

                this._codeCountdown = 60;
                const hint = document.getElementById('send-code-hint');
                this._codeTimer = setInterval(() => {
                    this._codeCountdown--;
                    if (this._codeCountdown <= 0) {
                        clearInterval(this._codeTimer); this._codeTimer = null;
                        btn.disabled = false;
                        btn.style.display = '';
                        document.getElementById('btn-verify-code').style.display = 'none';
                        document.getElementById('code-input-row').style.display = 'none';
                        if (hint) hint.textContent = '';
                    } else {
                        if (hint) hint.textContent = `验证码已发送 · ${this._codeCountdown}s 内有效`;
                    }
                }, 1000);
            } else {
                this._showMsg(r.message || '发送失败');
                btn.disabled = false;
            }
        } catch(e) {
            this._showMsg('网络错误：'+e.message);
            btn.disabled = false;
        }
    },

    async _verifyCodeLogin() {
        const email = document.getElementById('login-email').value.trim();
        const code = document.getElementById('login-code').value.trim();
        if (!email || !code) { this._showMsg('请填写邮箱和验证码'); return; }
        if (code.length !== 6) { this._showMsg('请输入6位验证码'); return; }

        this._showMsg('验证中...', '#6b6560');
        try {
            const resp = await fetch('/api/auth/email/verify-code', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ email, code }),
            });
            const r = await resp.json();
            if (r.success) {
                this._onLoginSuccess(r);
            } else {
                this._showMsg(r.message || '验证失败');
            }
        } catch(e) { this._showMsg('网络错误：'+e.message); }
    },

    _onLoginSuccess(r) {
        this._token = r.token;
        this._user = r.user;
        localStorage.setItem('dal-liuren-user', JSON.stringify({token: r.token, user: r.user}));
        // 记住邮箱
        const email = document.getElementById('login-email').value.trim();
        if (email) localStorage.setItem('dal-liuren-email', email);
        this._closeLogin();
        this._updateUI();
    },

    _updateUI() {
        const btn = document.getElementById('btn-login');
        const nick = document.getElementById('user-nick');
        const upload = document.getElementById('btn-upload-case');
        const portalLoginLabel = document.getElementById('portal-login-label');
        const portalLoginText = document.getElementById('portal-login-text');
        const portalLoginNode = document.getElementById('info-portal-login');

        const adminBtn = document.getElementById('btn-admin-panel');

        if (this.isLoggedIn()) {
            if (btn) btn.textContent = '退出';
            if (nick) {
                nick.style.display = 'flex';
                const quota = this._user ? `(${(this._user.quota_used||0)}/${this._user.quota_total||30})` : '';
                nick.innerHTML = `<span style="color:#1a1614;font-weight:600">${this._user?.nickname||this._user?.username||''}</span><span style="color:#9a948c;font-size:10px">${quota}</span>`;
            }
            if (upload) upload.style.display = '';
            if (adminBtn) adminBtn.style.display = this._user?.is_admin ? '' : 'none';
            if (portalLoginLabel) portalLoginLabel.textContent = '已';
            if (portalLoginText) portalLoginText.textContent = (this._user?.nickname||this._user?.username||'用户').slice(0,3);
            if (portalLoginNode) portalLoginNode.title = '点击退出登录';
        } else {
            if (btn) btn.textContent = '登录';
            if (nick) nick.style.display = 'none';
            if (upload) upload.style.display = 'none';
            if (adminBtn) adminBtn.style.display = 'none';
            if (portalLoginLabel) portalLoginLabel.textContent = '登';
            if (portalLoginText) portalLoginText.textContent = '登录';
            if (portalLoginNode) portalLoginNode.title = '注册/登录';
        }
    },

    async refreshQuota() {
        if (!this._token) return;
        try {
            const resp = await fetch('/api/auth/me', { headers:{'Authorization':'Bearer '+this._token} });
            const r = await resp.json();
            if (r.success && r.user) {
                this._user = r.user;
                localStorage.setItem('dal-liuren-user', JSON.stringify({token:this._token, user:r.user}));
                this._updateUI();
            }
        } catch(e) {}
    },

    async _uploadCurrentCase() {
        if (!currentPanData) { alert('请先排盘'); return; }
        if (!this.isLoggedIn()) { alert('请先登录'); return; }
        const sc = currentPanData['三传'] || {};
        const sz = (currentPanData['时间']||{})['四柱'] || {};
        try {
            const resp = await fetch('/api/cases/upload', {
                method:'POST',
                headers:{'Content-Type':'application/json', 'Authorization':'Bearer '+this._token},
                body: JSON.stringify({
                    pan_data: currentPanData,
                    name: `${sz['年柱']||''}${sz['月柱']||''}${sz['日柱']||''} · ${sc['方法']||''}课`,
                    tags: [sc['方法']||'', sc['初传']||'', sc['中传']||'', sc['末传']||''].filter(Boolean),
                }),
            });
            const r = await resp.json();
            if (r.success) { alert(r.message || '案例已提交，等待管理员审核'); }
            else { alert('上传失败：' + (r.message||r.error||'')); }
        } catch(e) { alert('网络错误：' + e.message); }
    },
};
