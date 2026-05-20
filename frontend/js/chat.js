/**
 * 对话面板 — 支持 WebSocket AI 解盘
 */
const Chat = {
    ws: null,

    init() {
        // 快速提问
        document.querySelectorAll('#chat-quick-actions .btn').forEach(btn => {
            btn.addEventListener('click', () => this.sendMessage(btn.dataset.query));
        });

        // 发送按钮
        const sendBtn = document.getElementById('btn-chat-send');
        const input = document.getElementById('chat-input');

        sendBtn.addEventListener('click', () => {
            const msg = input.value.trim();
            if (msg) { this.sendMessage(msg); input.value = ''; }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const msg = input.value.trim();
                if (msg) { this.sendMessage(msg); input.value = ''; }
            }
        });
    },

    sendMessage(message) {
        this.addMessage('user', message);
        const wsOk = this.ws && this.ws.readyState === WebSocket.OPEN;
        if (wsOk) {
            this.ws.send(JSON.stringify({ type: 'chat', message: message }));
            this.addMessage('system', 'AI 思考中...');
        } else {
            this.addMessage('assistant',
                '**连接未就绪**\n\nWebSocket 尚未连接，无法进行 AI 解读。请稍等片刻后重试，或刷新页面。\n\n如果问题持续，可以尝试以下操作：\n- 确认服务器正在运行\n- 点击「排盘」按钮重新排盘\n- 刷新页面重新连接');
        }
    },

    onChatResponse(text) {
        // 移除"AI 思考中..."
        const msgs = document.getElementById('chat-messages');
        const thinking = msgs.querySelector('.chat-msg.system:last-child');
        if (thinking && thinking.textContent.includes('思考中')) {
            thinking.remove();
        }
        this.addMessage('assistant', text);
    },

    onError(text) {
        const msgs = document.getElementById('chat-messages');
        const thinking = msgs.querySelector('.chat-msg.system:last-child');
        if (thinking && thinking.textContent.includes('思考中')) {
            thinking.remove();
        }
        this.addMessage('assistant', '**出错了**\n\n' + text);
    },

    addMessage(role, content) {
        const container = document.getElementById('chat-messages');
        const welcome = container.querySelector('.chat-msg.welcome');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;
        div.innerHTML = this._md(content);
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

    clear() {
        document.getElementById('chat-messages').innerHTML = '';
    },

    showWelcome() {
        document.getElementById('chat-messages').innerHTML = `
            <div class="chat-msg welcome">
                ☰<br><br>
                点击 <strong>排盘</strong> 开始占卜<br>
                <span style="font-size:0.75rem;color:var(--text-muted)">然后使用快捷按钮或输入问题进行 AI 解读</span>
            </div>`;
    },

    setWebSocket(ws) { this.ws = ws; }
};
