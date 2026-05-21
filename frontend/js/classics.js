/**
 * 典籍研习面板 — 六壬经典浏览、搜索、AI解读、引用到解盘
 */
const Classics = {
    _catalog: null,
    _currentBook: null,
    _currentSectionId: null,
    _searchMode: false,

    // ========== 初始化 ==========

    init() {
        // 打开抽屉
        document.getElementById('btn-classics').addEventListener('click', () => this.open());

        // 关闭抽屉
        document.getElementById('cls-btn-close-drawer').addEventListener('click', () => this.close());
        document.getElementById('classics-overlay').addEventListener('click', () => this.close());

        // 返回目录
        document.getElementById('cls-btn-back-catalog').addEventListener('click', () => this.showCatalog());

        // 搜索
        document.getElementById('cls-btn-search').addEventListener('click', () => this._doSearch());
        document.getElementById('cls-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._doSearch();
        });

        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('classics-drawer').classList.contains('open')) {
                this.close();
            }
        });
    },

    // ========== 开关抽屉 ==========

    open() {
        document.getElementById('classics-drawer').classList.add('open');
        document.getElementById('classics-overlay').classList.add('active');
        // 首次打开时加载目录
        if (!this._catalog) {
            this._fetchCatalog();
        }
    },

    close() {
        document.getElementById('classics-drawer').classList.remove('open');
        document.getElementById('classics-overlay').classList.remove('active');
    },

    // ========== 加载目录 ==========

    async _fetchCatalog() {
        try {
            const res = await fetch('/api/classics/catalog');
            const data = await res.json();
            if (data.success) {
                this._catalog = data.catalog;
                this._renderBookList();
            }
        } catch (e) {
            console.error('加载典籍目录失败:', e);
            this._toast('加载目录失败，请检查网络');
        }
    },

    _renderBookList() {
        const sidebar = document.getElementById('cls-sidebar');
        sidebar.innerHTML = this._catalog.map(b => `
            <div class="cls-book-item" data-book-id="${b.id}">
                ${b.title}
                <span class="cls-book-author">${b.dynasty} · ${b.author}</span>
            </div>
        `).join('');

        // 点击事件
        sidebar.querySelectorAll('.cls-book-item').forEach(el => {
            el.addEventListener('click', () => {
                sidebar.querySelectorAll('.cls-book-item').forEach(e => e.classList.remove('active'));
                el.classList.add('active');
                this._loadBook(el.dataset.bookId);
            });
        });

        // 清空 TOC 和内容区
        document.getElementById('cls-toc').innerHTML = '';
        document.getElementById('cls-content').innerHTML = `
            <div class="cls-empty">
                <span class="cls-empty-icon">📚</span>
                <span>选择一本书籍开始研习</span>
            </div>`;
        this._searchMode = false;
    },

    // ========== 加载书籍 ==========

    async _loadBook(bookId) {
        try {
            const res = await fetch(`/api/classics/${bookId}`);
            const data = await res.json();
            if (data.success) {
                this._currentBook = data.book;
                this._searchMode = false;
                this._renderToc();
            } else {
                this._toast(data.error || '加载失败');
            }
        } catch (e) {
            console.error('加载书籍失败:', e);
            this._toast('加载书籍失败');
        }
    },

    _renderToc() {
        const toc = document.getElementById('cls-toc');
        const book = this._currentBook;
        if (!book) return;

        let html = '';
        for (const s of book.sections) {
            html += `<div class="cls-section-item" data-section-id="${s.id}">${s.title}</div>`;
            for (const sub of (s.subsections || [])) {
                html += `<div class="cls-section-item sub" data-section-id="${sub.id}">${sub.title}</div>`;
            }
        }

        toc.innerHTML = html;
        toc.querySelectorAll('.cls-section-item').forEach(el => {
            el.addEventListener('click', () => {
                toc.querySelectorAll('.cls-section-item').forEach(e => e.classList.remove('active'));
                el.classList.add('active');
                this._loadSection(el.dataset.sectionId);
            });
        });

        // 清空内容区
        document.getElementById('cls-content').innerHTML = `
            <div class="cls-empty">
                <span class="cls-empty-icon">📖</span>
                <span>选择章节阅读</span>
            </div>`;
    },

    // ========== 加载章节 ==========

    async _loadSection(sectionId) {
        if (!this._currentBook) return;
        this._currentSectionId = sectionId;

        try {
            const res = await fetch(`/api/classics/${this._currentBook.id}/section/${sectionId}`);
            const data = await res.json();
            if (data.success) {
                this._renderContent(data);
            } else {
                this._toast(data.error || '加载失败');
            }
        } catch (e) {
            console.error('加载章节失败:', e);
            this._toast('加载章节失败');
        }
    },

    _renderContent(data) {
        const sec = data.section;
        const content = document.getElementById('cls-content');

        let html = `
            <div class="cls-content-header">
                <div class="cls-content-title">${sec.title}</div>
                <div class="cls-content-source">《${data.book_title}》 — ${data.book_author || ''}</div>
            </div>
            <div class="cls-content-text">${this._fmtContent(sec.content || '')}</div>
        `;

        if (sec.commentary) {
            html += `<div class="cls-content-commentary">${this._fmtContent(sec.commentary)}</div>`;
        }

        if (sec.tags && sec.tags.length) {
            html += `<div class="cls-content-tags">${sec.tags.map(t => `<span class="cls-tag">${t}</span>`).join('')}</div>`;
        }

        html += `
            <div class="cls-actions">
                <button class="cls-action-btn cls-action-ai" id="cls-btn-ai-interpret">🤖 AI解读此段</button>
                <button class="cls-action-btn cls-action-ref" id="cls-btn-ref-chat">💬 引用到当前解盘</button>
                <button class="cls-action-btn cls-action-copy" id="cls-btn-copy">📋 复制原文</button>
            </div>
            <div class="cls-ai-result" id="cls-ai-result">
                <div class="cls-ai-result-header">🤖 AI 解读</div>
                <div id="cls-ai-result-text"></div>
            </div>
        `;

        content.innerHTML = html;

        // 绑定操作按钮
        document.getElementById('cls-btn-ai-interpret').addEventListener('click', () => this._aiInterpret());
        document.getElementById('cls-btn-ref-chat').addEventListener('click', () => this._referenceToChat());
        document.getElementById('cls-btn-copy').addEventListener('click', () => this._copyContent(sec));
    },

    _fmtContent(text) {
        if (!text) return '';
        return text
            .replace(/\n/g, '</p><p>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>')
            .replace(/<p><\/p>/g, '');
    },

    // ========== 搜索 ==========

    async _doSearch() {
        const keyword = document.getElementById('cls-search-input').value.trim();
        if (!keyword) return;

        try {
            const res = await fetch('/api/classics/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword }),
            });
            const data = await res.json();
            if (data.success) {
                this._searchMode = true;
                this._renderSearchResults(data);
            } else {
                this._toast(data.error || '搜索失败');
            }
        } catch (e) {
            console.error('搜索失败:', e);
            this._toast('搜索失败');
        }
    },

    _renderSearchResults(data) {
        document.getElementById('cls-sidebar').innerHTML = '';
        document.getElementById('cls-toc').innerHTML = '';

        const content = document.getElementById('cls-content');
        if (!data.results.length) {
            content.innerHTML = `
                <div class="cls-empty">
                    <span class="cls-empty-icon">🔍</span>
                    <span>未找到相关内容</span>
                    <span style="font-size:0.7rem">尝试其他关键词</span>
                </div>`;
            return;
        }

        let html = `<div style="padding-bottom:6px;color:#9a8b7a;font-size:0.8rem">搜索「${data.keyword}」找到 ${data.results.length} 条结果</div>`;
        html += '<div class="cls-search-results">';
        for (const r of data.results) {
            html += `
                <div class="cls-search-item" data-book="${r.book_id}" data-section="${r.section_id}">
                    <div class="sr-book">《${r.book_title}》</div>
                    <div class="sr-title">${r.section_title}</div>
                    <div class="sr-snippet">${r.snippet}</div>
                </div>`;
        }
        html += '</div>';
        content.innerHTML = html;

        content.querySelectorAll('.cls-search-item').forEach(el => {
            el.addEventListener('click', async () => {
                // 先加载对应书籍
                const bookId = el.dataset.book;
                const sectionId = el.dataset.section;

                // 在侧边栏高亮对应书籍
                const sidebar = document.getElementById('cls-sidebar');
                const bookEl = sidebar.querySelector(`[data-book-id="${bookId}"]`);
                if (bookEl) bookEl.classList.add('active');

                // 加载书和章节
                await this._loadBook(bookId);
                this._loadSection(sectionId);
            });
        });
    },

    // ========== 显示目录 ==========

    showCatalog() {
        this._searchMode = false;
        this._currentBook = null;
        this._currentSectionId = null;
        document.getElementById('cls-search-input').value = '';
        document.getElementById('cls-toc').innerHTML = '';
        document.getElementById('cls-content').innerHTML = `
            <div class="cls-empty">
                <span class="cls-empty-icon">📚</span>
                <span>选择一本书籍开始研习</span>
            </div>`;
        if (this._catalog) {
            this._renderBookList();
        }
    },

    // ========== AI 解读 ==========

    async _aiInterpret() {
        if (!this._currentBook || !this._currentSectionId) return;

        const btn = document.getElementById('cls-btn-ai-interpret');
        const resultDiv = document.getElementById('cls-ai-result');
        const resultText = document.getElementById('cls-ai-result-text');

        btn.classList.add('loading');
        btn.textContent = '🤖 AI思考中...';
        resultDiv.classList.remove('visible');
        resultText.textContent = '';

        try {
            const res = await fetch('/api/classics/interpret', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    book_id: this._currentBook.id,
                    section_id: this._currentSectionId,
                    question: '请详细解读此段内容，包括：1) 核心要义 2) 逐句解析 3) 实际运用举例',
                }),
            });
            const data = await res.json();
            if (data.success) {
                resultText.innerHTML = this._mdToHtml(data.interpretation);
                resultDiv.classList.add('visible');
                resultDiv.scrollIntoView({ behavior: 'smooth' });
            } else {
                this._toast(data.error || 'AI解读失败');
            }
        } catch (e) {
            console.error('AI解读失败:', e);
            this._toast('AI解读请求失败');
        } finally {
            btn.classList.remove('loading');
            btn.textContent = '🤖 AI解读此段';
        }
    },

    // ========== 引用到解盘 ==========

    async _referenceToChat() {
        if (!this._currentBook || !this._currentSectionId) return;

        const wsOk = Chat.ws && Chat.ws.readyState === WebSocket.OPEN;

        if (wsOk) {
            // 通过 WebSocket 发送（维持对话上下文）
            Chat.addMessage('user', `📖 引用《${this._currentBook.title}》· ${this._currentSectionId}`);

            Chat.ws.send(JSON.stringify({
                type: 'reference_classic',
                book_id: this._currentBook.id,
                section_id: this._currentSectionId,
                message: '请结合此经典法则分析当前课盘',
            }));
            Chat.addMessage('system', 'AI 正在结合典籍分析...');
            this._toast('已发送到解盘对话，请查看右侧聊天区');
        } else {
            // 降级到 POST（需要当前盘面数据）
            this._toast('请先排盘建立连接后再引用典籍');
        }
    },

    // ========== 复制内容 ==========

    _copyContent(sec) {
        let text = `《${this._currentBook.title}》${sec.title}\n\n${sec.content || ''}`;
        if (sec.commentary) {
            text += `\n\n【注疏】\n${sec.commentary}`;
        }
        navigator.clipboard.writeText(text).then(() => {
            this._toast('已复制到剪贴板');
        }).catch(() => {
            this._toast('复制失败，请手动选择复制');
        });
    },

    // ========== 工具 ==========

    _mdToHtml(text) {
        if (!text) return '';
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

    _toast(msg) {
        let el = document.querySelector('.cls-toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'cls-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._timeout);
        el._timeout = setTimeout(() => el.classList.remove('show'), 2500);
    },
};
