/**
 * 对话面板 — WebSocket AI 解盘 + Skill 路由 + 自反反馈
 */
const Chat = {
    ws: null,
    _skills: [],
    _currentSkillId: 'auto',
    _lastAiResponse: '',     // 最近一条AI回复，用于反馈
    _lastSkillUsed: '',       // 最近一条回复使用的skill
    _lastQuestion: '',        // 最近一次提问

    init() {
        // 快速提问
        document.querySelectorAll('#chat-quick-actions .btn').forEach(btn => {
            btn.addEventListener('click', () => this.sendMessage(btn.dataset.query));
        });

        // 发送按钮
        $on('btn-chat-send', 'click', () => {
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if (msg) { this.sendMessage(msg); input.value = ''; }
        });

        const input = document.getElementById('chat-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const msg = input.value.trim();
                    if (msg) { this.sendMessage(msg); input.value = ''; }
                }
            });
        }

        // Skill 选择器
        const sel = document.getElementById('chat-skill-select');
        if (sel) {
            sel.addEventListener('change', () => {
                this._currentSkillId = sel.value;
                const label = document.getElementById('chat-skill-label');
                if (label) {
                    label.style.display = sel.value === 'auto' ? 'none' : '';
                    label.textContent = sel.value === 'auto' ? '' : '已选：' + sel.options[sel.selectedIndex].text;
                }
            });
        }

        // 反馈弹窗
        $on('btn-close-feedback', 'click', () => {
            document.getElementById('feedback-modal').style.display = 'none';
        });
        $on('fb-inaccurate', 'click', () => {
            document.getElementById('fb-correction-row').style.display = '';
            document.getElementById('fb-inaccurate').style.background = 'rgba(184,58,46,0.08)';
            document.getElementById('fb-accurate').style.background = '';
        });
        $on('fb-accurate', 'click', () => {
            document.getElementById('fb-correction-row').style.display = 'none';
            document.getElementById('fb-accurate').style.background = 'rgba(45,138,86,0.08)';
            document.getElementById('fb-inaccurate').style.background = '';
        });
        $on('btn-submit-feedback', 'click', () => this._submitFeedback());

        // 初始加载 skill 列表
        this._loadSkills();
    },

    async _loadSkills() {
        try {
            const resp = await fetch('/api/skills/list');
            const r = await resp.json();
            if (r.success) {
                this._skills = r.skills;
                const sel = document.getElementById('chat-skill-select');
                if (sel) {
                    sel.innerHTML = '<option value="auto">自动选择 Skill</option>' +
                        r.skills.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
                }
            }
        } catch (e) { console.warn('[Chat] 加载 skills 失败:', e); }
    },

    sendMessage(message) {
        this._lastQuestion = message;
        this.addMessage('user', message);
        const wsOk = this.ws && this.ws.readyState === WebSocket.OPEN;
        if (wsOk) {
            this.ws.send(JSON.stringify({
                type: 'chat',
                message: message,
                skill_id: this._currentSkillId || 'auto',
            }));
            this.addMessage('system', 'AI 思考中...');
        } else {
            this.addMessage('assistant',
                '**连接未就绪**\n\nWebSocket 尚未连接，无法进行 AI 解读。请稍等片刻后重试，或刷新页面。');
        }
    },

    onChatResponse(text, meta) {
        this._lastAiResponse = text;
        this._lastSkillUsed = (meta && meta.skill_id) || '';

        // 移除"AI 思考中..."
        const msgs = document.getElementById('chat-messages');
        const thinking = msgs.querySelector('.chat-msg.system:last-child');
        if (thinking && thinking.textContent.includes('思考中')) {
            thinking.remove();
        }
        this.addMessage('assistant', text, meta);
    },

    onError(text) {
        const msgs = document.getElementById('chat-messages');
        const thinking = msgs.querySelector('.chat-msg.system:last-child');
        if (thinking && thinking.textContent.includes('思考中')) {
            thinking.remove();
        }
        this.addMessage('assistant', '**出错了**\n\n' + text);
    },

    addMessage(role, content, meta) {
        const container = document.getElementById('chat-messages');
        const welcome = container.querySelector('.chat-msg.welcome');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;

        let html = this._md(content);

        // AI 回复带 Skill 标签和反馈按钮
        if (role === 'assistant' && meta && meta.skill_name) {
            const matched = meta.skill_matched ? `（匹配：${meta.skill_matched.join('、')}）` : '';
            html = `<div class="chat-skill-tag">◇ ${meta.skill_name} ${matched}</div>` + html;
        }
        div.innerHTML = html;

        // 反馈按钮（仅 AI 回复）
        if (role === 'assistant' && content && content.length > 20) {
            const fbBar = document.createElement('div');
            fbBar.className = 'chat-fb-bar';
            fbBar.innerHTML = `
                <button class="chat-fb-btn accurate" title="解读准确">✓ 准确</button>
                <button class="chat-fb-btn inaccurate" title="解读有误">✗ 纠错</button>
            `;
            fbBar.querySelector('.accurate').addEventListener('click', () => this._openFeedback('accurate'));
            fbBar.querySelector('.inaccurate').addEventListener('click', () => this._openFeedback('inaccurate'));
            div.appendChild(fbBar);
        }

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    _md(text) {
        return text
            .replace(/### (.+)/g, '<h3>$1</h3>')
            .replace(/## (.+)/g, '<h2>$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/^- (.+)/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.+)$/m, '<p>$1</p>')
            .replace(/<p><h/g, '<h').replace(/<\/h([23])><\/p>/g, '</h$1>')
            .replace(/<p><li>/g, '<ul><li>').replace(/<\/li><\/p>/g, '</li></ul>');
    },

    _openFeedback(preset) {
        document.getElementById('feedback-modal').style.display = 'flex';
        document.getElementById('fb-correction').value = '';
        document.getElementById('fb-outcome').value = '';
        document.getElementById('fb-msg').style.display = 'none';
        document.getElementById('fb-correction-row').style.display = 'none';
        document.getElementById('fb-accurate').style.background = '';
        document.getElementById('fb-inaccurate').style.background = '';

        if (preset === 'inaccurate') {
            document.getElementById('fb-correction-row').style.display = '';
            document.getElementById('fb-inaccurate').style.background = 'rgba(184,58,46,0.08)';
        } else {
            document.getElementById('fb-accurate').style.background = 'rgba(45,138,86,0.08)';
        }
    },

    async _submitFeedback() {
        const accurateBtn = document.getElementById('fb-accurate');
        const isAccurate = accurateBtn.style.background && accurateBtn.style.background.includes('rgba(45,138,86');
        const correction = document.getElementById('fb-correction').value.trim();
        const outcome = document.getElementById('fb-outcome').value.trim();
        const msgEl = document.getElementById('fb-msg');

        if (!isAccurate && !correction) {
            msgEl.style.display = '';
            msgEl.style.color = '#b83a2e';
            msgEl.textContent = '请说明哪里不对';
            return;
        }

        try {
            const resp = await fetch('/api/reflections/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    skill_id: this._lastSkillUsed || '',
                    question: this._lastQuestion || '',
                    ai_response: this._lastAiResponse || '',
                    feedback: isAccurate ? 'accurate' : 'inaccurate',
                    correction: correction,
                    actual_outcome: outcome,
                }),
            });
            const r = await resp.json();
            if (r.success) {
                msgEl.style.display = '';
                msgEl.style.color = '#2d8a56';
                // 如果是纠错反馈，触发 AI 重新解读
                if (!isAccurate && correction) {
                    msgEl.textContent = '纠错已提交，AI 正在重新解读...';
                    document.getElementById('feedback-modal').style.display = 'none';
                    // 构建重新解读的提示
                    var reAsk = '【纠错重解】我之前对你的解读有误，请根据以下纠正重新分析：\n\n' +
                        '❌ 错误点：' + correction + '\n\n' +
                        '原问题：' + (this._lastQuestion || '请分析此课盘') + '\n\n' +
                        '请重新解读，这次要特别注意上述错误点，给出正确的分析。';
                    this.sendMessage(reAsk);
                } else {
                    msgEl.textContent = '反馈已提交，感谢！';
                    setTimeout(function() { document.getElementById('feedback-modal').style.display = 'none'; }, 1500);
                }
            } else {
                msgEl.style.display = '';
                msgEl.style.color = '#b83a2e';
                msgEl.textContent = '提交失败：' + (r.error || '');
            }
        } catch (e) {
            msgEl.style.display = '';
            msgEl.style.color = '#b83a2e';
            msgEl.textContent = '网络错误：' + e.message;
        }
    },

    clear() {
        document.getElementById('chat-messages').innerHTML = '';
    },

    showWelcome() {
        document.getElementById('chat-messages').innerHTML = `
            <div class="chat-msg welcome">
                <span style="font-size:1.8rem;opacity:0.4">◇</span><br><br>
                等待排盘完成…<br>
                <span style="font-size:0.75rem;color:var(--text3)">使用快捷按钮或输入问题进行 AI 解读</span>
            </div>`;
    },

    setWebSocket(ws) { this.ws = ws; }
};
