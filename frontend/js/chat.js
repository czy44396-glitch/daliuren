/**
 * 对话面板 — WebSocket AI 解盘 + Skill 路由 + 逐段反馈 + 保存到笔记
 */
const Chat = {
    ws: null,
    _skills: [],
    _currentSkillId: 'auto',
    _lastAiResponse: '',     // 最近一条AI回复，用于反馈
    _lastSkillUsed: '',       // 最近一条回复使用的skill
    _lastQuestion: '',        // 最近一次提问
    _feedbackIsAccurate: true, // 反馈预设（true=准确, false=纠错）
    _feedbackSections: [],     // 逐段标注结果

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

        // 反馈弹窗关闭
        $on('btn-close-feedback', 'click', () => {
            document.getElementById('feedback-modal').style.display = 'none';
        });

        // 反馈准确/不准确切换
        $on('fb-accurate', 'click', () => {
            this._feedbackIsAccurate = true;
            document.getElementById('fb-correction-row').style.display = 'none';
            document.getElementById('fb-sections-row').style.display = '';
            document.getElementById('fb-accurate').style.background = 'rgba(45,138,86,0.08)';
            document.getElementById('fb-inaccurate').style.background = '';
        });
        $on('fb-inaccurate', 'click', () => {
            this._feedbackIsAccurate = false;
            document.getElementById('fb-correction-row').style.display = '';
            document.getElementById('fb-sections-row').style.display = '';
            document.getElementById('fb-inaccurate').style.background = 'rgba(184,58,46,0.08)';
            document.getElementById('fb-accurate').style.background = '';
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

        // AI 回复带 Skill 标签
        if (role === 'assistant' && meta && meta.skill_name) {
            const matched = meta.skill_matched ? `（匹配：${meta.skill_matched.join('、')}）` : '';
            html = `<div class="chat-skill-tag">◇ ${meta.skill_name} ${matched}</div>` + html;
        }
        div.innerHTML = html;

        // AI 回复的操作按钮栏
        if (role === 'assistant' && content && content.length > 20) {
            const bar = document.createElement('div');
            bar.className = 'chat-fb-bar';

            // 反馈按钮
            const fbAccurate = document.createElement('button');
            fbAccurate.className = 'chat-fb-btn accurate';
            fbAccurate.title = '逐段标注对错';
            fbAccurate.textContent = '✓ 反馈纠错';
            fbAccurate.addEventListener('click', () => this._openFeedback('accurate'));

            // 保存到案例笔记按钮
            const saveBtn = document.createElement('button');
            saveBtn.className = 'chat-fb-btn save-note';
            saveBtn.title = '将此解读保存到当前案例的个人笔记';
            saveBtn.textContent = '📝 保存到笔记';
            saveBtn.style.cssText = 'margin-left:4px;padding:2px 10px;border:1px solid rgba(45,138,86,0.3);border-radius:4px;background:rgba(45,138,86,0.04);color:#2d8a56;cursor:pointer;font-family:inherit;font-size:11px;white-space:nowrap';
            saveBtn.addEventListener('click', () => this._saveResponseToNotes(content));

            bar.appendChild(fbAccurate);
            bar.appendChild(saveBtn);
            div.appendChild(bar);
        }

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    _md(text) {
        var html = text
            .replace(/### (.+)/g, '<h3>$1</h3>')
            .replace(/## (.+)/g, '<h2>$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/^- (.+)/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.+)$/m, '<p>$1</p>')
            .replace(/<p><h/g, '<h').replace(/<\/h([23])><\/p>/g, '</h$1>')
            .replace(/<p><li>/g, '<ul><li>').replace(/<\/li><\/p>/g, '</li></ul>');

        // 合并连续的 </ul><ul> 为一个 <ul>
        html = html.replace(/<\/ul>\s*<ul>/g, '');

        return html;
    },

    // ====== 保存 AI 回复到当前案例笔记 ======
    _saveResponseToNotes(aiContent) {
        // 确定案例 ID：优先使用当前已加载的案例，否则自动创建新案例
        var caseId = (typeof currentLoadedCaseId !== 'undefined') ? currentLoadedCaseId : null;
        var caseObj = caseId ? (typeof _caseGet !== 'undefined' ? _caseGet(caseId) : null) : null;

        if (!caseObj) {
            // 没有已加载案例，自动创建新案例
            if (typeof currentPanData === 'undefined' || !currentPanData) {
                Chat.addMessage('system', '⚠️ 没有盘面数据，无法创建案例。请先排盘。');
                return;
            }
            caseId = 'case_' + Date.now();
            var sz = (currentPanData['时间'] || {})['四柱'] || {};
            var sc = currentPanData['三传'] || {};
            var nowStr = new Date().toISOString().replace('T',' ').slice(0,19);
            caseObj = {
                id: caseId,
                name: (sz['年柱']||'') + '年 ' + (sz['日柱']||'') + '日 ' + (sc['方法']||'') + '课',
                tags: ['AI解读'],
                category: 'AI解读',
                created: nowStr,
                pan_data: currentPanData,
                personal_notes: '',
                personal_notes_updated: '',
                actual_outcome: ''
            };
            if (typeof _casePut !== 'undefined') {
                _casePut(caseObj);
                // 更新全局状态
                if (typeof currentLoadedCaseId !== 'undefined') currentLoadedCaseId = caseId;
                if (typeof updateMyNotesBtn !== 'undefined') updateMyNotesBtn(caseObj);
            }
        }

        // 追加 AI 回复到笔记
        var existing = (caseObj.personal_notes || '').trim();
        var ts = new Date().toISOString().replace('T',' ').slice(0,16);
        var newNote = existing
            ? existing + '\n\n---\n\n## AI 解读记录 (' + ts + ')\n\n' + aiContent
            : '## AI 解读记录 (' + ts + ')\n\n' + aiContent;
        caseObj.personal_notes = newNote;
        caseObj.personal_notes_updated = ts;

        if (typeof _casePut !== 'undefined') _casePut(caseObj);
        Chat.addMessage('system', '✅ 解读已保存到案例「' + caseObj.name + '」的个人笔记中。可在案例库中打开笔记继续编辑完善。');
    },

    // ====== 反馈弹窗（逐段标注） ======
    _openFeedback(preset) {
        this._feedbackIsAccurate = (preset !== 'inaccurate');
        this._feedbackSections = [];

        document.getElementById('feedback-modal').style.display = 'flex';
        document.getElementById('fb-correction').value = '';
        document.getElementById('fb-outcome').value = '';
        document.getElementById('fb-msg').style.display = 'none';
        document.getElementById('fb-correction-row').style.display = 'none';
        document.getElementById('fb-accurate').style.background = '';
        document.getElementById('fb-inaccurate').style.background = '';

        if (!this._feedbackIsAccurate) {
            document.getElementById('fb-correction-row').style.display = '';
            document.getElementById('fb-inaccurate').style.background = 'rgba(184,58,46,0.08)';
        } else {
            document.getElementById('fb-accurate').style.background = 'rgba(45,138,86,0.08)';
        }

        // 构建逐段标注区域
        this._buildSectionFeedback();
    },

    // 将 AI 回复拆分为段落，每段可选对/错
    _buildSectionFeedback() {
        var container = document.getElementById('fb-sections-row');
        if (!container) return;
        container.style.display = '';

        var text = this._lastAiResponse || '';
        // 按 ## 或 ### 或空行拆段
        var rawParts = text.split(/\n\n+/);
        var parts = [];
        for (var i = 0; i < rawParts.length; i++) {
            var p = rawParts[i].trim();
            if (!p) continue;
            // 如果段落太长（>300字），在句号处再拆
            if (p.length > 300) {
                var sentences = p.split(/(?<=[。！？])/);
                var chunk = '';
                for (var j = 0; j < sentences.length; j++) {
                    chunk += sentences[j];
                    if (chunk.length > 150) {
                        parts.push(chunk.trim());
                        chunk = '';
                    }
                }
                if (chunk.trim()) parts.push(chunk.trim());
            } else {
                parts.push(p);
            }
        }

        this._feedbackSections = parts.map(function(p, idx) {
            return { index: idx, text: p, isAccurate: true, correction: '' };
        });

        var html = '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">逐段标注：点击每段切换 <span style="color:#2d8a56">✓准确</span> / <span style="color:#b83a2e">✗错误</span></div>';
        html += '<div style="max-height:300px;overflow-y:auto;border:1px solid #e0d5c1;border-radius:8px">';

        for (var i = 0; i < this._feedbackSections.length; i++) {
            var sec = this._feedbackSections[i];
            var preview = sec.text.replace(/[#*`\n]/g, '').substring(0, 80);
            if (sec.text.length > 80) preview += '…';
            html += '<div class="fb-section-item" data-idx="' + i + '" style="display:flex;align-items:flex-start;gap:6px;padding:6px 8px;border-bottom:1px solid #f0ebe0;cursor:pointer;transition:background 0.15s">';
            html += '<span class="fb-section-badge" style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:50%;border:2px solid #2d8a56;color:#2d8a56;font-size:10px;font-weight:bold;flex-shrink:0;margin-top:1px">✓</span>';
            html += '<span class="fb-section-text" style="font-size:11px;color:#3a3632;line-height:1.5;word-break:break-all">' + preview + '</span>';
            html += '</div>';
        }
        html += '</div>';

        // 当前选错段落汇总输入
        html += '<div id="fb-sections-summary" style="margin-top:8px;font-size:0.7rem;color:var(--bronze);display:none"></div>';

        container.innerHTML = html;

        // 绑定点击事件
        var self = this;
        container.querySelectorAll('.fb-section-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var idx = parseInt(this.dataset.idx);
                var sec = self._feedbackSections[idx];
                sec.isAccurate = !sec.isAccurate;

                var badge = this.querySelector('.fb-section-badge');
                if (sec.isAccurate) {
                    badge.style.borderColor = '#2d8a56';
                    badge.style.color = '#2d8a56';
                    badge.textContent = '✓';
                    item.style.background = '';
                } else {
                    badge.style.borderColor = '#b83a2e';
                    badge.style.color = '#b83a2e';
                    badge.textContent = '✗';
                    item.style.background = 'rgba(184,58,46,0.04)';
                }

                self._updateSectionsSummary();
            });
        });
    },

    _updateSectionsSummary() {
        var wrongParts = this._feedbackSections.filter(function(s) { return !s.isAccurate; });
        var summaryEl = document.getElementById('fb-sections-summary');
        var correctionRow = document.getElementById('fb-correction-row');
        var correctionTextarea = document.getElementById('fb-correction');

        if (wrongParts.length > 0) {
            summaryEl.style.display = '';
            summaryEl.textContent = '已标记 ' + wrongParts.length + ' 处错误（共 ' + this._feedbackSections.length + ' 段），请在下方补充具体纠正说明：';
            correctionRow.style.display = '';
            this._feedbackIsAccurate = false;
            // 预填纠正提示
            if (!correctionTextarea.value.trim()) {
                var hints = wrongParts.map(function(s) {
                    return '▸ ' + s.text.replace(/[#*`\n]/g, '').substring(0, 50) + '… → ';
                });
                correctionTextarea.placeholder = '请针对标记为 ✗ 的段落写出纠正：\n' + hints.join('\n');
            }
            document.getElementById('fb-inaccurate').style.background = 'rgba(184,58,46,0.08)';
            document.getElementById('fb-accurate').style.background = '';
        } else {
            summaryEl.style.display = 'none';
            if (!this._feedbackIsAccurate) {
                // 用户原本选了不准确但现在所有段都标对
                this._feedbackIsAccurate = true;
                correctionRow.style.display = 'none';
                document.getElementById('fb-accurate').style.background = 'rgba(45,138,86,0.08)';
                document.getElementById('fb-inaccurate').style.background = '';
            }
        }
    },

    async _submitFeedback() {
        var correction = document.getElementById('fb-correction').value.trim();
        var outcome = document.getElementById('fb-outcome').value.trim();
        var msgEl = document.getElementById('fb-msg');

        // 构建逐段反馈数据
        var sectionFeedback = this._feedbackSections.map(function(s) {
            return { text: s.text.substring(0, 200), is_accurate: s.isAccurate };
        });
        var wrongCount = sectionFeedback.filter(function(s) { return !s.is_accurate; }).length;

        // 如果不准确且有错段但没写纠正说明，提示
        if (!this._feedbackIsAccurate && wrongCount > 0 && !correction) {
            msgEl.style.display = '';
            msgEl.style.color = '#b83a2e';
            msgEl.textContent = '请补充具体纠正说明（哪里有误、正确应该是什么）';
            return;
        }

        // 如果选了准确或全部标对
        var isAccurate = this._feedbackIsAccurate || (wrongCount === 0);

        try {
            var resp = await fetch('/api/reflections/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    skill_id: this._lastSkillUsed || '',
                    question: this._lastQuestion || '',
                    ai_response: this._lastAiResponse || '',
                    feedback: isAccurate ? 'accurate' : 'inaccurate',
                    correction: correction,
                    actual_outcome: outcome,
                    section_feedback: sectionFeedback,
                    wrong_count: wrongCount,
                }),
            });
            var r = await resp.json();
            if (r.success) {
                msgEl.style.display = '';
                msgEl.style.color = '#2d8a56';

                // 检查是否有自动 Skill 修正
                var autoCorrect = r.auto_correct;
                var domainLabel = (autoCorrect && autoCorrect.domain === 'destiny') ? '推命' : '占卜';

                if (!isAccurate && correction) {
                    var autoMsg = '纠错已提交（标记 ' + wrongCount + ' 处错误）';
                    if (autoCorrect) {
                        autoMsg += '\n🧠 Skill 自动修正已保存 → `' + autoCorrect.updated_file + '`（' + domainLabel + '领域）';
                    }
                    msgEl.textContent = autoMsg;
                    document.getElementById('feedback-modal').style.display = 'none';

                    // 在聊天中通知 Skill 修正
                    if (autoCorrect) {
                        this.addMessage('system', '🔧 **Skill 自动修正完成**\n\n根据你的纠正，已自动更新 `' + autoCorrect.updated_file + '`（' + domainLabel + '领域）。\n下次解读会使用修正后的规则，避免重复相同错误。');
                    }

                    var reAsk = '【纠错重解】我之前对你的解读有误，请根据以下纠正重新分析：\n\n' +
                        '❌ 错误点：' + correction + '\n\n' +
                        '原问题：' + (this._lastQuestion || '请分析此课盘') + '\n\n' +
                        '请重新解读，这次要特别注意上述错误点，给出正确的分析。';
                    this.sendMessage(reAsk);
                } else {
                    var msg = '反馈已提交，感谢！';
                    if (wrongCount > 0) msg += '（标记了 ' + wrongCount + ' 处需改进）';
                    msgEl.textContent = msg;
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
