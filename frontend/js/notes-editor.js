/**
 * 个人解读笔记 — 编辑器 / 思维导图 / 白板
 * 数据源：_rawMarkdown（单一真相源，存在 _caseData.personal_notes）
 *
 * v5 — 全面重构：
 *   - 格式化工具栏：onmousedown + execCommand（原生 bold/italic/underline）
 *   - 白板：缩放/平移/连线/内联编辑/右键删除
 *   - 思维导图：缩放/平移/双击编辑节点
 *   - Markdown↔HTML 双向转换优化
 */
const NotesEditor = {
    _caseId: null,
    _caseData: null,
    _view: 'editor',
    _rawMarkdown: '',   // 单一真相源
    _blocks: [],        // 解析后的块（仅用于导图/白板）
    _savedRange: null,  // 工具栏按钮按下前保存的光标位置
    _mmCtx: null,
    _mmScale: 1, _mmPanX: 0, _mmPanY: 0, _mmPanning: false, _mmPanStart: null,
    _wbCtx: null,
    _wbNodes: [], _wbEdges: [],
    _wbDragNode: null, _wbDrawEdge: null,
    _wbPanX: 0, _wbPanY: 0, _wbScale: 1,
    _wbPanning: false, _wbPanStart: null,
    _wbW: 600, _wbH: 400,
    _dirty: false,
    _autoSaveTimer: null,

    /** 打开笔记编辑器 */
    open(caseId, caseData) {
        this._caseId = caseId;
        this._caseData = caseData;
        this._rawMarkdown = caseData.personal_notes || '';
        this._dirty = false;
        this._blocks = [];
        this._savedRange = null;

        var modal = document.getElementById('notes-modal-v2');
        if (modal) modal.style.display = 'flex';
        else return;

        document.getElementById('notes-v2-case-label').textContent = caseData.name || '';

        // 领域标签
        var tags = caseData.tags || [];
        var domain = this._detectDomain(tags);
        var domainTag = document.getElementById('notes-v2-domain-tag');
        if (domain === 'destiny') {
            domainTag.style.display = ''; domainTag.textContent = '🔮 推命';
            domainTag.style.background = 'rgba(184,58,46,0.08)'; domainTag.style.color = '#b83a2e';
            document.getElementById('notes-v2-outcome').placeholder = '【推命反推】此命主后来实际的人生轨迹...';
        } else if (domain === 'divination') {
            domainTag.style.display = ''; domainTag.textContent = '🔯 占卜';
            domainTag.style.background = 'rgba(45,138,86,0.08)'; domainTag.style.color = '#2d8a56';
            document.getElementById('notes-v2-outcome').placeholder = '【占卜反推】此事后来实际的发展结果...';
        } else {
            domainTag.style.display = 'none';
        }
        this._domain = domain;

        document.getElementById('notes-v2-outcome').value = caseData.actual_outcome || '';
        var updated = caseData.personal_notes_updated;
        document.getElementById('notes-v2-status').textContent = updated
            ? '上次更新：' + updated.slice(0, 16)
            : '';

        // 延迟渲染确保 modal 布局完成
        var self = this;
        setTimeout(function () { self.switchView('editor'); }, 100);

        // 渲染盘面预览
        this._renderPanPreview(caseData.pan_data);
    },

    _detectDomain(tags) {
        var dk = ['推命', '命理', '命盘', '命运', '八字', '出生', '本命', '大运', '流年'];
        var sk = ['占卜', '占问', '事占', '占验', '事件', '预测', '吉凶', '卜问'];
        for (var i = 0; i < tags.length; i++) {
            for (var j = 0; j < dk.length; j++) { if (tags[i].indexOf(dk[j]) >= 0) return 'destiny'; }
            for (var k = 0; k < sk.length; k++) { if (tags[i].indexOf(sk[k]) >= 0) return 'divination'; }
        }
        return 'general';
    },

    /** 关闭 */
    close() {
        this._saveSilent();
        document.getElementById('notes-modal-v2').style.display = 'none';
    },

    // ========================
    //  视图切换
    // ========================
    switchView(view) {
        // 编辑器 → markdown
        if (this._view === 'editor' && this._dirty) {
            this._rawMarkdown = this._editorHtmlToMd();
            this._dirty = false;
        }
        this._view = view;

        var btns = document.querySelectorAll('#notes-v2-view-bar .btn');
        btns.forEach(function (b) { b.classList.remove('active'); });

        var map = { editor: '笔记编辑', mindmap: '思维导图', whiteboard: '白板' };
        document.getElementById('notes-v2-view-label').textContent = map[view] || '';

        // 清理画布事件（防泄漏）
        var mmCanvas = document.getElementById('notes-v2-mm-canvas');
        var wbCanvas = document.getElementById('notes-v2-wb-canvas');
        [mmCanvas, wbCanvas].forEach(function (c) {
            if (c) {
                c.onmousedown = null; c.onmousemove = null; c.onmouseup = null;
                c.ondblclick = null; c.onwheel = null; c.oncontextmenu = null;
            }
        });
        // 清理内联编辑器
        var inEds = document.querySelectorAll('.wb-inline-editor');
        inEds.forEach(function (el) { el.remove(); });
        // 清理右键菜单
        var ctxMenu = document.querySelector('.wb-ctx-menu');
        if (ctxMenu) ctxMenu.remove();

        if (view === 'editor') {
            document.getElementById('notes-v2-btn-editor').classList.add('active');
            document.getElementById('notes-v2-editor-panel').style.display = '';
            document.getElementById('notes-v2-mindmap-panel').style.display = 'none';
            document.getElementById('notes-v2-whiteboard-panel').style.display = 'none';
            this._renderEditor();
        } else if (view === 'mindmap') {
            document.getElementById('notes-v2-btn-mindmap').classList.add('active');
            document.getElementById('notes-v2-editor-panel').style.display = 'none';
            document.getElementById('notes-v2-mindmap-panel').style.display = '';
            document.getElementById('notes-v2-whiteboard-panel').style.display = 'none';
            this._parseBlocks();
            var self = this;
            setTimeout(function () { self._renderMindMap(); }, 100);
        } else if (view === 'whiteboard') {
            document.getElementById('notes-v2-btn-whiteboard').classList.add('active');
            document.getElementById('notes-v2-editor-panel').style.display = 'none';
            document.getElementById('notes-v2-mindmap-panel').style.display = 'none';
            document.getElementById('notes-v2-whiteboard-panel').style.display = '';
            this._parseBlocks();
            var self2 = this;
            setTimeout(function () { self2._initWhiteboard(); }, 100);
        }
    },

    // ========================
    //  编辑器
    // ========================
    /** Markdown → HTML */
    _mdToHtml(md) {
        if (!md) return '';
        var html = md;
        // 先处理代码块保护
        var codeBlocks = [];
        html = html.replace(/```([\s\S]*?)```/g, function (m, code) {
            codeBlocks.push('<pre class="nb-code-block">' + _escHtml(code.trim()) + '</pre>');
            return '%%CODEBLOCK_' + (codeBlocks.length - 1) + '%%';
        });
        // 标题（先深后浅，避免 ## 匹配 ### 前缀）
        html = html.replace(/^### (.+)$/gm, '<h3 class="nb-h3">$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2 class="nb-h2">$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1 class="nb-h1">$1</h1>');
        // 分隔线
        html = html.replace(/^---\s*$/gm, '<hr class="nb-hr">');
        // 引用
        html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="nb-quote">$1</blockquote>');
        html = html.replace(/^>\s?(.+)$/gm, '<blockquote class="nb-quote">$1</blockquote>');
        // 有序列表
        html = html.replace(/^(\d+)[.、]\s(.+)$/gm, function (m, num, text) {
            return '<div class="nb-li nb-oli"><span class="nb-bullet nb-bullet-num">' + num + '.</span>' + text + '</div>';
        });
        // 无序列表
        html = html.replace(/^[-*]\s(.+)$/gm, '<div class="nb-li"><span class="nb-bullet">•</span>$1</div>');
        // 内联格式
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
        html = html.replace(/__(.+?)__/g, '<u>$1</u>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // 普通段落
        html = html.replace(/^(?!<[hbpdci])(.+)$/gm, '<p class="nb-p">$1</p>');
        // 空行
        html = html.replace(/^(<br>)?$/gm, '<p class="nb-empty"><br></p>');
        // 还原代码块
        html = html.replace(/%%CODEBLOCK_(\d+)%%/g, function (m, idx) {
            return codeBlocks[parseInt(idx)] || '';
        });
        return html;
    },

    /** 渲染编辑器 */
    _renderEditor() {
        var container = document.getElementById('notes-v2-blocks');
        var scrollWrap = document.getElementById('notes-v2-scroll-wrap');
        if (!container) return;
        var html = this._mdToHtml(this._rawMarkdown);
        if (!html || html === '<p class="nb-empty"><br></p>') {
            html = '<p class="nb-p"><br></p>';
        }
        container.innerHTML = html;
        container.setAttribute('contenteditable', 'true');
        this._dirty = false;

        // 重置滚动位置到顶部
        if (scrollWrap) scrollWrap.scrollTop = 0;

        var self = this;
        container.oninput = function () { self._dirty = true; self._scheduleAutoSave(); };
        container.onkeydown = function (e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '    ');
            }
        };
        // 保存光标（工具栏使用）
        container.onfocus = function () { self._savedRange = null; };
        container.onblur = function () {
            var sel = window.getSelection();
            if (sel.rangeCount > 0) {
                self._savedRange = sel.getRangeAt(0).cloneRange();
            }
        };
    },

    /** Editor HTML → Markdown */
    _editorHtmlToMd() {
        var container = document.getElementById('notes-v2-blocks');
        if (!container) return this._rawMarkdown;
        return this._htmlToMd(container.innerHTML);
    },

    /** HTML → Markdown（稳健） */
    _htmlToMd(html) {
        var txt = html;
        // 代码块
        txt = txt.replace(/<pre[^>]*class="[^"]*nb-code-block[^"]*"[^>]*>(.*?)<\/pre>/gi, function (m, code) {
            return '\n```\n' + _unescHtml(code) + '\n```\n';
        });
        // 内联 code
        txt = txt.replace(/<code>(.*?)<\/code>/gi, '`$1`');
        // 内联格式
        txt = txt.replace(/<b>(.*?)<\/b>/gi, '**$1**');
        txt = txt.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
        txt = txt.replace(/<i>(.*?)<\/i>/gi, '*$1*');
        txt = txt.replace(/<em>(.*?)<\/em>/gi, '*$1*');
        txt = txt.replace(/<u>(.*?)<\/u>/gi, '__$1__');
        // 标题
        txt = txt.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
        txt = txt.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
        txt = txt.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
        // 引用
        txt = txt.replace(/<blockquote[^>]*>\s*(?:<p[^>]*>)?(.*?)(?:<\/p>)?\s*<\/blockquote>/gi, '> $1');
        // 自定义列表行 (.nb-li)
        txt = txt.replace(/<div[^>]*class="[^"]*nb-li[^"]*"[^>]*>\s*<span[^>]*class="[^"]*nb-bullet[^"]*"[^>]*>.*?<\/span>\s*(.*?)<\/div>/gi, '- $1');
        // 原生列表项
        txt = txt.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1');
        txt = txt.replace(/<\/ul>\s*<ul>/gi, '');
        txt = txt.replace(/<\/ol>\s*<ol>/gi, '');
        txt = txt.replace(/<ul[^>]*>/gi, '');
        txt = txt.replace(/<\/ul>/gi, '\n');
        txt = txt.replace(/<ol[^>]*>/gi, '');
        txt = txt.replace(/<\/ol>/gi, '\n');
        // 分隔线
        txt = txt.replace(/<hr[^>]*>/gi, '\n---\n');
        // 换行
        txt = txt.replace(/<br\s*\/?>/gi, '\n');
        txt = txt.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
        txt = txt.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
        // 段落（保留文本）
        txt = txt.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1');
        // 移除剩余标签
        txt = txt.replace(/<\/?(?:div|span)[^>]*>/gi, '');
        // HTML 实体
        txt = txt.replace(/&nbsp;/gi, ' ');
        txt = txt.replace(/&amp;/gi, '&');
        txt = txt.replace(/&lt;/gi, '<');
        txt = txt.replace(/&gt;/gi, '>');
        txt = txt.replace(/&quot;/gi, '"');
        // 清理多余空行
        txt = txt.replace(/\n{3,}/g, '\n\n');
        txt = txt.trim();
        return txt;
    },

    // ========================
    //  格式化工具栏
    // ========================
    /**
     * 内联格式化（B / I / U / Code）
     * 通过 onmousedown+preventDefault 防止编辑器失焦，
     * 使用 execCommand 原生应用格式，最终由 _htmlToMd 回写。
     */
    _tbApplyFormat(marker) {
        var container = document.getElementById('notes-v2-blocks');
        if (!container) return;

        // 恢复保存的光标位置
        this._restoreRange();
        container.focus();

        switch (marker) {
            case '**':
                document.execCommand('bold', false, null);
                break;
            case '*':
                document.execCommand('italic', false, null);
                break;
            case '__':
                document.execCommand('underline', false, null);
                break;
            case '`':
                // 代码：切换行内 code 标签
                var sel = window.getSelection();
                if (sel.rangeCount > 0 && !sel.isCollapsed) {
                    var range = sel.getRangeAt(0);
                    var text = range.toString();
                    if (text.startsWith('`') && text.endsWith('`')) {
                        // 已有 code，去掉
                        range.deleteContents();
                        range.insertNode(document.createTextNode(text.slice(1, -1)));
                    } else {
                        range.deleteContents();
                        var codeEl = document.createElement('code');
                        codeEl.textContent = text;
                        range.insertNode(codeEl);
                    }
                } else {
                    // 无选区：插入一对反引号
                    document.execCommand('insertText', false, '``');
                    // 光标移到中间
                    sel = window.getSelection();
                    if (sel.rangeCount > 0) {
                        var r = sel.getRangeAt(0);
                        r.setStart(r.startContainer, r.startOffset - 1);
                        r.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(r);
                    }
                }
                break;
            default:
                break;
        }
        this._dirty = true;
        this._scheduleAutoSave();
        this._updateToolbarState();
    },

    /** 块级标记（H2 / H3 / • / ❝ / ---）— 使用 execCommand 即时视觉反馈 */
    _tbInsertBlockMarker(marker) {
        var container = document.getElementById('notes-v2-blocks');
        if (!container) return;

        this._restoreRange();
        container.focus();

        if (marker === '---') {
            // 分隔线
            var hr = document.createElement('hr');
            hr.className = 'nb-hr';
            var sel = window.getSelection();
            if (sel.rangeCount > 0) {
                var range = sel.getRangeAt(0);
                range.insertNode(hr);
                // 在 hr 后插入空行供继续编辑
                var p = document.createElement('p');
                p.className = 'nb-p';
                p.innerHTML = '<br>';
                range.setStartAfter(hr);
                range.collapse(true);
                if (hr.nextSibling) {
                    hr.parentNode.insertBefore(p, hr.nextSibling);
                } else {
                    hr.parentNode.appendChild(p);
                }
                range.setStart(p, 0);
            }
        } else if (marker === '-') {
            // 无序列表
            document.execCommand('insertUnorderedList', false, null);
            // 给新 ul/li 添加样式类
            setTimeout(function () {
                var lists = container.querySelectorAll('ul:not([class]), ol:not([class])');
                lists.forEach(function (ul) {
                    ul.querySelectorAll('li').forEach(function (li) {
                        if (!li.querySelector('.nb-bullet')) {
                            var sp = document.createElement('span');
                            sp.className = 'nb-bullet';
                            sp.textContent = '•';
                            li.classList.add('nb-li-item');
                            // wrap content
                            var txt = li.textContent;
                            li.innerHTML = '';
                            li.appendChild(sp);
                            li.appendChild(document.createTextNode(' ' + txt));
                        }
                    });
                });
            }, 20);
        } else if (marker === '> ') {
            // 引用
            document.execCommand('formatBlock', false, 'blockquote');
            // 给新 blockquote 添加 class
            setTimeout(function () {
                var bqs = container.querySelectorAll('blockquote:not([class])');
                bqs.forEach(function (bq) { bq.className = 'nb-quote'; });
            }, 20);
        } else if (marker === '##') {
            // H2
            document.execCommand('formatBlock', false, 'h2');
            setTimeout(function () {
                var hs = container.querySelectorAll('h2:not([class])');
                hs.forEach(function (h) { h.className = 'nb-h2'; });
            }, 20);
        } else if (marker === '###') {
            // H3
            document.execCommand('formatBlock', false, 'h3');
            setTimeout(function () {
                var hs = container.querySelectorAll('h3:not([class])');
                hs.forEach(function (h) { h.className = 'nb-h3'; });
            }, 20);
        }

        this._dirty = true;
        this._scheduleAutoSave();
    },

    /** 更新工具栏按钮激活状态 */
    _updateToolbarState() {
        var buttons = document.querySelectorAll('#nb-toolbar button[data-marker]');
        buttons.forEach(function (btn) {
            var marker = btn.getAttribute('data-marker');
            var state = document.queryCommandState(
                marker === '**' ? 'bold' :
                marker === '*' ? 'italic' :
                marker === '__' ? 'underline' : ''
            );
            if (state) btn.classList.add('nb-tb-active');
            else btn.classList.remove('nb-tb-active');
        });
    },

    /** 恢复保存的光标 */
    _restoreRange() {
        if (this._savedRange) {
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(this._savedRange);
        }
    },

    /** 确保光标在 scroll wrapper 可见区域内 */
    _scrollCursorIntoView() {
        var wrap = document.getElementById('notes-v2-scroll-wrap');
        if (!wrap) return;
        var sel = window.getSelection();
        if (!sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        if (!range.collapsed) return; // 有选区时不强制滚动
        var rect = range.getClientRects()[0];
        if (!rect) return;
        var wrapRect = wrap.getBoundingClientRect();
        // 如果光标在可视区下方，往下滚一点
        if (rect.bottom > wrapRect.bottom - 40) {
            wrap.scrollTop += rect.bottom - wrapRect.bottom + 60;
        }
        // 如果光标在可视区上方，往上滚一点
        if (rect.top < wrapRect.top + 40) {
            wrap.scrollTop += rect.top - wrapRect.top - 60;
        }
    },

    // ========================
    //  块解析（导图/白板用）
    // ========================
    _parseBlocks() {
        var raw = this._rawMarkdown || '';
        if (!raw.trim()) { this._blocks = []; return; }
        var lines = raw.split('\n');
        var blocks = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var block = { id: 'b' + i, text: line, level: 0, type: 'p' };
            if (/^### (.+)/.test(line)) { block.type = 'h3'; block.text = RegExp.$1; block.level = 3; }
            else if (/^## (.+)/.test(line)) { block.type = 'h2'; block.text = RegExp.$1; block.level = 2; }
            else if (/^# (.+)/.test(line)) { block.type = 'h1'; block.text = RegExp.$1; block.level = 1; }
            else if (/^[-*]\s(.+)/.test(line)) { block.type = 'li'; block.text = RegExp.$1; block.level = 4; }
            else if (/^\d+[.、]\s(.+)/.test(line)) { block.type = 'oli'; block.text = RegExp.$1; block.level = 4; }
            else if (/^>\s?(.+)/.test(line)) { block.type = 'quote'; block.text = RegExp.$1; block.level = 4; }
            else if (/^---\s*$/.test(line)) { block.type = 'hr'; block.text = ''; block.level = -1; }
            else if (!line.trim()) { block.type = 'empty'; block.text = ''; block.level = -1; }
            block.text = block.text || '';
            blocks.push(block);
        }
        this._blocks = blocks;
    },

    // ========================
    //  思维导图（Canvas — 缩放/平移/点击/径向布局）
    // ========================
    _renderMindMap() {
        var canvas = document.getElementById('notes-v2-mm-canvas');
        if (!canvas) return;
        var panel = document.getElementById('notes-v2-mindmap-panel');
        var rect = panel.getBoundingClientRect();
        var DPR = window.devicePixelRatio || 2;
        canvas.width = rect.width * DPR;
        canvas.height = rect.height * DPR;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        this._mmCtx = canvas.getContext('2d');
        this._mmCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        this._mmW = rect.width;
        this._mmH = rect.height;

        // 重置状态
        this._mmScale = 1;
        this._mmPanX = 0; this._mmPanY = 0;

        // 构建树
        var root = this._buildMindMapTree();
        this._mmRoot = root;

        // 布局（径向树）
        this._layoutMindMap(root, this._mmW / 2, this._mmH / 2, 120);

        this._drawMindMap();

        // 事件
        var self = this;
        canvas.onmousedown = null; canvas.onmousemove = null;
        canvas.onmouseup = null; canvas.ondblclick = null; canvas.onwheel = null;

        canvas.onmousedown = function (e) {
            self._mmPanning = true;
            self._mmPanStart = { x: e.clientX, y: e.clientY };
        };
        canvas.onmousemove = function (e) {
            if (!self._mmPanning) return;
            var dx = e.clientX - self._mmPanStart.x;
            var dy = e.clientY - self._mmPanStart.y;
            self._mmPanX += dx;
            self._mmPanY += dy;
            self._mmPanStart = { x: e.clientX, y: e.clientY };
            self._drawMindMap();
        };
        canvas.onmouseup = function () { self._mmPanning = false; };
        canvas.onwheel = function (e) {
            e.preventDefault();
            var mx = e.clientX - canvas.getBoundingClientRect().left;
            var my = e.clientY - canvas.getBoundingClientRect().top;
            var oldScale = self._mmScale;
            self._mmScale *= e.deltaY > 0 ? 0.92 : 1.08;
            self._mmScale = Math.max(0.2, Math.min(3, self._mmScale));
            self._mmPanX = mx - (mx - self._mmPanX) * (self._mmScale / oldScale);
            self._mmPanY = my - (my - self._mmPanY) * (self._mmScale / oldScale);
            self._drawMindMap();
        };
        canvas.ondblclick = function (e) {
            // 双击空白区：返回编辑器
            self.switchView('editor');
        };
    },

    _buildMindMapTree() {
        var root = { text: (this._caseData ? this._caseData.name : '笔记'), children: [], depth: 0, type: 'root' };
        // 空内容时：示例结构
        if (this._blocks.length === 0) {
            root.children = [
                { text: '使用 ## 创建一级分支', type: 'h2', children: [
                    { text: '使用 ### 创建二级分支', type: 'h3', children: [
                        { text: '使用 - 创建叶子节点', type: 'li', children: [] }
                    ]},
                    { text: '普通段落也是叶子', type: 'p', children: [] }
                ]},
                { text: '🖱 拖拽平移 · 滚轮缩放 · 双击返回', type: 'hint', children: [] },
            ];
            return root;
        }

        // 用层级栈构建树
        var stack = [root]; // stack[0]=root, stack[1]=last h1, stack[2]=last h2, stack[3]=last h3
        for (var i = 0; i < this._blocks.length; i++) {
            var b = this._blocks[i];
            if (!b.text || b.type === 'empty' || b.type === 'hr') continue;
            var node = { text: b.text.substring(0, 80), type: b.type, children: [], depth: 0 };

            if (b.type === 'h1') {
                node.depth = 1;
                root.children.push(node);
                stack = [root, node];  // reset stack at h1
            } else if (b.type === 'h2') {
                node.depth = 2;
                stack = stack.slice(0, 2);  // keep root + h1 only
                var p = stack[stack.length - 1];
                p.children.push(node);
                stack.push(node);
            } else if (b.type === 'h3') {
                node.depth = 3;
                stack = stack.slice(0, 3);  // keep root + h1 + h2
                var p2 = stack[stack.length - 1];
                p2.children.push(node);
                stack.push(node);
            } else {
                // li / p / quote → 挂在当前最深节点下
                node.depth = stack.length;
                stack[stack.length - 1].children.push(node);
            }
        }
        return root;
    },

    _layoutMindMap(node, cx, cy, radius) {
        node._x = cx;
        node._y = cy;
        node._r = node.type === 'root' ? 26 : 20;

        var children = node.children || [];
        if (children.length === 0) return;

        var childR = radius;
        if (childR < 50) childR = 50;

        // 用扇形角度范围
        var totalAngle = Math.min(Math.PI * 0.7, children.length * 0.35);
        var startAngle = -Math.PI / 2 - totalAngle / 2;

        for (var i = 0; i < children.length; i++) {
            var ratio = children.length === 1 ? 0.5 : i / (children.length - 1);
            var angle = startAngle + totalAngle * ratio;
            var nx = cx + Math.cos(angle) * childR;
            var ny = cy + Math.sin(angle) * childR;
            this._layoutMindMap(children[i], nx, ny, childR * 0.6);
        }
    },

    _drawMindMap() {
        var ctx = this._mmCtx;
        if (!ctx) return;
        var W = this._mmW, H = this._mmH;
        ctx.save();
        ctx.clearRect(0, 0, W, H);

        // 背景
        ctx.fillStyle = '#fefcf7';
        ctx.fillRect(0, 0, W, H);

        // 变换
        ctx.translate(this._mmPanX, this._mmPanY);
        ctx.scale(this._mmScale, this._mmScale);

        if (this._mmRoot) this._drawMindMapNode(ctx, this._mmRoot, 0);

        ctx.restore();

        // 底部提示 + 标题
        ctx.fillStyle = '#c0b8a0';
        ctx.font = '10px "Noto Serif SC", serif';
        ctx.textAlign = 'right';
        ctx.fillText('🖱 拖拽平移 · 滚轮缩放 · 双击返回 | ' + (this._caseData ? this._caseData.name : ''), W - 16, H - 10);
    },

    _drawMindMapNode(ctx, node, level) {
        var x = node._x, y = node._y, r = node._r || 20;
        var palettes = [
            ['#d45348', '#8b1a2b'], // level 0: root red
            ['#D4A017', '#8b6914'], // level 1: gold
            ['#2d8a56', '#1a5c36'], // level 2: green
            ['#1a3a5c', '#0d1f33'], // level 3: navy
            ['#7D5A3C', '#4d3624'], // level 4: brown
            ['#c94043', '#8b2023'], // level 5: crimson
        ];
        var p = palettes[Math.min(level, palettes.length - 1)];
        var isRoot = level === 0;

        // 子连线 + 递归
        var children = node.children || [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (!child._x) continue;
            ctx.beginPath();
            ctx.moveTo(x, y);
            // 贝塞尔曲线
            var midX = (x + child._x) / 2;
            var midY = (y + child._y) / 2;
            ctx.quadraticCurveTo(midX, midY, child._x, child._y);
            ctx.strokeStyle = 'rgba(' + (level === 0 ? '184,58,46' : '107,101,96') + ',' + (level === 0 ? '0.3' : '0.18') + ')';
            ctx.lineWidth = level === 0 ? 1.5 : 1;
            ctx.stroke();
            this._drawMindMapNode(ctx, child, level + 1);
        }

        // 节点圆角矩形
        var label = node.text.substring(0, isRoot ? 16 : 20);
        ctx.font = (isRoot ? 'bold 13px' : (level === 1 ? 'bold 11px' : '10px')) + ' "Noto Serif SC", "Microsoft YaHei", serif';
        var tw = ctx.measureText(label).width + 20;
        var th = isRoot ? 32 : (level <= 1 ? 26 : 22);
        var rx2 = th / 2;
        var nx = x - tw / 2;
        var ny = y - th / 2;

        ctx.beginPath();
        ctx.moveTo(nx + rx2, ny);
        ctx.lineTo(nx + tw - rx2, ny);
        ctx.arcTo(nx + tw, ny, nx + tw, ny + rx2, rx2);
        ctx.lineTo(nx + tw, ny + th - rx2);
        ctx.arcTo(nx + tw, ny + th, nx + tw - rx2, ny + th, rx2);
        ctx.lineTo(nx + rx2, ny + th);
        ctx.arcTo(nx, ny + th, nx, ny + th - rx2, rx2);
        ctx.lineTo(nx, ny + rx2);
        ctx.arcTo(nx, ny, nx + rx2, ny, rx2);
        ctx.closePath();

        var grad = ctx.createLinearGradient(nx, ny, nx, ny + th);
        if (isRoot) {
            grad.addColorStop(0, p[0]);
            grad.addColorStop(1, p[1]);
        } else if (level === 1) {
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,252,245,1)');
        } else {
            grad.addColorStop(0, 'rgba(255,255,255,0.95)');
            grad.addColorStop(1, 'rgba(254,252,247,0.95)');
        }
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = isRoot ? p[0] : 'rgba(' + (level === 1 ? '212,160,23' : '158,139,114') + ',0.4)';
        ctx.lineWidth = isRoot ? 2 : 1;
        ctx.stroke();

        // 文字
        ctx.fillStyle = isRoot ? '#fff' : '#1a1614';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
    },

    // ========================
    //  白板（Canvas — 节点 / 连线 / 内联编辑）
    // ========================
    _initWhiteboard() {
        var canvas = document.getElementById('notes-v2-wb-canvas');
        if (!canvas) return;
        var panel = document.getElementById('notes-v2-whiteboard-panel');
        var rect = panel.getBoundingClientRect();
        var DPR = window.devicePixelRatio || 2;
        this._wbW = rect.width; this._wbH = rect.height;
        canvas.width = this._wbW * DPR;
        canvas.height = this._wbH * DPR;
        canvas.style.width = this._wbW + 'px';
        canvas.style.height = this._wbH + 'px';
        this._wbCtx = canvas.getContext('2d');
        this._wbCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

        // 重置状态
        this._wbScale = 1;
        this._wbPanX = 0; this._wbPanY = 0;

        var self = this;

        // 从块生成初始节点（仅首次）
        if (this._wbNodes.length === 0) {
            var nodes = [];
            var y = 60;
            var lastHeading = null;
            for (var i = 0; i < this._blocks.length; i++) {
                var b = this._blocks[i];
                if (!b.text || b.type === 'empty' || b.type === 'hr') continue;
                var isHeading = b.type === 'h1' || b.type === 'h2' || b.type === 'h3';
                var node = {
                    id: 'wn' + i,
                    text: b.text.substring(0, 80),
                    x: isHeading ? 60 : 100,
                    y: y,
                    w: Math.min(Math.max(b.text.length * 11 + 50, 100), 300),
                    h: isHeading ? 36 : 28,
                    type: b.type,
                    color: isHeading ? '#b83a2e' : (b.type === 'li' ? '#2d8a56' : '#3a3632'),
                };
                nodes.push(node);
                y += node.h + (isHeading ? 24 : 14);

                if (isHeading) lastHeading = node;
                else if (lastHeading) {
                    // 去重
                    var already = this._wbEdges.some(function (ed) { return ed.from === lastHeading.id && ed.to === node.id; });
                    if (!already) this._wbEdges.push({ from: lastHeading.id, to: node.id });
                }
            }
            this._wbNodes = nodes;
        }

        this._drawWhiteboard();

        // 清理旧事件
        canvas.onmousedown = null; canvas.onmousemove = null;
        canvas.onmouseup = null; canvas.ondblclick = null;
        canvas.onwheel = null; canvas.oncontextmenu = null;

        // 绑定事件
        canvas.onmousedown = function (e) { self._wbMouseDown(e); };
        canvas.onmousemove = function (e) { self._wbMouseMove(e); };
        canvas.onmouseup = function (e) { self._wbMouseUp(e); };
        canvas.ondblclick = function (e) { self._wbDblClick(e); };
        canvas.onwheel = function (e) {
            e.preventDefault();
            var crect = canvas.getBoundingClientRect();
            var mx = e.clientX - crect.left, my = e.clientY - crect.top;
            var oldScale = self._wbScale;
            self._wbScale *= e.deltaY > 0 ? 0.92 : 1.08;
            self._wbScale = Math.max(0.15, Math.min(4, self._wbScale));
            self._wbPanX = mx - (mx - self._wbPanX) * (self._wbScale / oldScale);
            self._wbPanY = my - (my - self._wbPanY) * (self._wbScale / oldScale);
            self._drawWhiteboard();
        };
        canvas.oncontextmenu = function (e) {
            e.preventDefault();
            var crect = canvas.getBoundingClientRect();
            var mx = e.clientX - crect.left, my = e.clientY - crect.top;
            var wb = self._screenToWb(mx, my);
            for (var i = self._wbNodes.length - 1; i >= 0; i--) {
                var n = self._wbNodes[i];
                if (wb.x >= n.x && wb.x <= n.x + n.w && wb.y >= n.y && wb.y <= n.y + n.h) {
                    self._wbShowContextMenu(e.clientX, e.clientY, i);
                    return;
                }
            }
            // 右键空白：删除上下文菜单
            var cm = document.querySelector('.wb-ctx-menu');
            if (cm) cm.remove();
        };

        // 点击背景关闭菜单
        document.addEventListener('click', function (e) {
            var cm = document.querySelector('.wb-ctx-menu');
            if (cm && !cm.contains(e.target)) cm.remove();
        });

        // 浮动快捷工具栏
        this._wbEnsureToolbar(panel);
    },

    _wbEnsureToolbar(panel) {
        // 移除旧工具栏
        var old = panel.querySelector('.wb-float-toolbar');
        if (old) old.remove();

        var self = this;
        var tb = document.createElement('div');
        tb.className = 'wb-float-toolbar';
        tb.style.cssText =
            'position:absolute;top:10px;left:10px;z-index:50;display:flex;gap:4px;' +
            'background:rgba(255,255,255,0.95);border:1px solid #e0d5c1;border-radius:8px;' +
            'padding:4px;box-shadow:0 2px 12px rgba(0,0,0,0.08)';
        tb.innerHTML =
            '<button title="添加节点" style="width:30px;height:28px;border:1px solid #e0d5c1;border-radius:6px;background:#fff;cursor:pointer;font-size:16px;line-height:1;color:#3a3632">+</button>' +
            '<button title="自动排列" style="width:30px;height:28px;border:1px solid #e0d5c1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;line-height:1;color:#6b6560">⟳</button>' +
            '<button title="清空白板" style="width:30px;height:28px;border:1px solid rgba(184,58,46,0.15);border-radius:6px;background:#fff;cursor:pointer;font-size:13px;line-height:1;color:#b83a2e">✕</button>';

        tb.querySelectorAll('button')[0].onclick = function () {
            // 在视口中央添加节点
            var cx = (self._wbW / 2 - self._wbPanX) / self._wbScale;
            var cy = (self._wbH / 2 - self._wbPanY) / self._wbScale;
            var nn = {
                id: 'wn' + Date.now(),
                text: '', x: cx - 80, y: cy - 15, w: 180, h: 30,
                type: 'p', color: '#3a3632',
            };
            self._wbNodes.push(nn);
            self._drawWhiteboard();
            self._wbStartInlineEdit(nn, self._wbNodes.length - 1, null);
        };
        tb.querySelectorAll('button')[1].onclick = function () {
            // 自动排列：按原始顺序垂直排列
            var startY = 60;
            for (var i = 0; i < self._wbNodes.length; i++) {
                var n = self._wbNodes[i];
                n.x = n.type === 'h1' || n.type === 'h2' || n.type === 'h3' ? 60 : 100;
                n.y = startY;
                startY += n.h + 16;
            }
            self._drawWhiteboard();
            self._wbToBlocks();
        };
        tb.querySelectorAll('button')[2].onclick = function () {
            if (confirm('确定清空所有白板节点和连线吗？此操作不可恢复。')) {
                self._wbNodes = [];
                self._wbEdges = [];
                self._drawWhiteboard();
                self._rawMarkdown = '';
                self._scheduleAutoSave();
            }
        };

        panel.appendChild(tb);
    },

    _wbToScreen(x, y) {
        return { x: x * this._wbScale + this._wbPanX, y: y * this._wbScale + this._wbPanY };
    },
    _screenToWb(mx, my) {
        return { x: (mx - this._wbPanX) / this._wbScale, y: (my - this._wbPanY) / this._wbScale };
    },

    _drawWhiteboard() {
        var ctx = this._wbCtx;
        var W = this._wbW, H = this._wbH;
        if (!ctx) return;
        ctx.save();
        ctx.clearRect(0, 0, W, H);

        // 背景
        ctx.fillStyle = '#fefcf7';
        ctx.fillRect(0, 0, W, H);

        // 变换
        ctx.translate(this._wbPanX, this._wbPanY);
        ctx.scale(this._wbScale, this._wbScale);

        // 网格
        var gs = 40;
        var xStart = Math.floor(-this._wbPanX / this._wbScale / gs) * gs;
        var yStart = Math.floor(-this._wbPanY / this._wbScale / gs) * gs;
        var xCount = Math.ceil(W / this._wbScale / gs) + 2;
        var yCount = Math.ceil(H / this._wbScale / gs) + 2;
        ctx.strokeStyle = 'rgba(224,213,193,0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (var xi = 0; xi < xCount; xi++) {
            var gx = xStart + xi * gs;
            ctx.moveTo(gx, yStart); ctx.lineTo(gx, yStart + yCount * gs);
        }
        for (var yi = 0; yi < yCount; yi++) {
            var gy = yStart + yi * gs;
            ctx.moveTo(xStart, gy); ctx.lineTo(xStart + xCount * gs, gy);
        }
        ctx.stroke();

        // 连线
        for (var i = 0; i < this._wbEdges.length; i++) {
            var e = this._wbEdges[i];
            var fn = this._findWbNode(e.from), tn = this._findWbNode(e.to);
            if (!fn || !tn) continue;
            var fx = fn.x + fn.w / 2, fy = fn.y + fn.h;
            var tx = tn.x + tn.w / 2, ty = tn.y;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            // 贝塞尔曲线
            var cy = (fy + ty) / 2;
            ctx.bezierCurveTo(fx, cy, tx, cy, tx, ty);
            ctx.strokeStyle = 'rgba(184,58,46,0.18)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // 箭头
            var ax = tx, ay = ty;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - 4, ay - 7);
            ctx.lineTo(ax + 4, ay - 7);
            ctx.closePath();
            ctx.fillStyle = 'rgba(184,58,46,0.2)';
            ctx.fill();
        }

        // 节点
        for (var j = 0; j < this._wbNodes.length; j++) {
            var n = this._wbNodes[j];
            var isHeading = n.type === 'h1' || n.type === 'h2' || n.type === 'h3';
            ctx.beginPath();
            var rx = 8, ry = 8;
            var x = n.x, y = n.y, nw = n.w, nh = n.h;
            ctx.moveTo(x + rx, y);
            ctx.lineTo(x + nw - rx, y);
            ctx.quadraticCurveTo(x + nw, y, x + nw, y + rx);
            ctx.lineTo(x + nw, y + nh - ry);
            ctx.quadraticCurveTo(x + nw, y + nh, x + nw - rx, y + nh);
            ctx.lineTo(x + rx, y + nh);
            ctx.quadraticCurveTo(x, y + nh, x, y + nh - ry);
            ctx.lineTo(x, y + rx);
            ctx.quadraticCurveTo(x, y, x + rx, y);
            ctx.closePath();

            ctx.fillStyle = isHeading
                ? 'rgba(184,58,46,0.06)'
                : (n.type === 'li' ? 'rgba(45,138,86,0.04)' : 'rgba(255,255,255,0.95)');
            ctx.fill();
            ctx.strokeStyle = n.color;
            ctx.lineWidth = isHeading ? 2 : 1;
            ctx.stroke();

            // 文本
            ctx.fillStyle = '#1a1614';
            ctx.font = (isHeading ? 'bold 12px' : '10.5px') + ' "Noto Serif SC", "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            var txt = n.text.substring(0, 35);
            if (n.text.length > 35) txt += '…';
            ctx.fillText(txt, n.x + n.w / 2, n.y + n.h / 2);
        }

        ctx.restore();

        // 提示文字（屏幕坐标）
        ctx.fillStyle = '#c0b8a0';
        ctx.font = '10px "Noto Serif SC", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('双击添加/编辑节点 · 拖拽移动 · Shift+拖拽连线 · 滚轮缩放 · 右键删除节点 · 拖拽画布平移', W - 16, H - 10);
    },

    _findWbNode(id) {
        for (var i = 0; i < this._wbNodes.length; i++) {
            if (this._wbNodes[i].id === id) return this._wbNodes[i];
        }
        return null;
    },

    _wbShowContextMenu(px, py, nodeIdx) {
        // 移除已有菜单
        var existing = document.querySelector('.wb-ctx-menu');
        if (existing) existing.remove();

        var self = this;
        var menu = document.createElement('div');
        menu.className = 'wb-ctx-menu';
        menu.style.cssText =
            'position:fixed;z-index:200;left:' + px + 'px;top:' + py + 'px;' +
            'background:#fff;border:1px solid #e0d5c1;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.12);' +
            'padding:4px 0;min-width:120px;font-size:12px;font-family:"Noto Serif SC",sans-serif';
        menu.innerHTML =
            '<div style="padding:6px 14px;cursor:pointer;color:#b83a2e;border-radius:4px;margin:0 4px" ' +
            'onmouseover="this.style.background=\'rgba(184,58,46,0.06)\'" ' +
            'onmouseout="this.style.background=\'transparent\'">🗑 删除此节点</div>' +
            '<div style="padding:6px 14px;cursor:pointer;color:#3a3632;border-radius:4px;margin:0 4px" ' +
            'onmouseover="this.style.background=\'rgba(58,54,50,0.04)\'" ' +
            'onmouseout="this.style.background=\'transparent\'">✏️ 编辑文字</div>';

        menu.querySelectorAll('div')[0].onclick = function () {
            self._wbNodes.splice(nodeIdx, 1);
            // 清理相关连线
            var nid = self._wbNodes.length > nodeIdx ? '' : '';
            self._wbEdges = self._wbEdges.filter(function (ed) {
                return ed.from !== self._wbNodes[nodeIdx]?.id && ed.to !== self._wbNodes[nodeIdx]?.id;
            });
            self._drawWhiteboard();
            self._wbToBlocks();
            self._scheduleAutoSave();
            menu.remove();
        };
        menu.querySelectorAll('div')[1].onclick = function () {
            self._wbStartInlineEdit(self._wbNodes[nodeIdx], nodeIdx, null);
            menu.remove();
        };

        document.body.appendChild(menu);
    },

    _wbMouseDown(e) {
        if (e.button === 2) return; // 右键由 contextmenu 处理
        var rect = e.target.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var wb = this._screenToWb(mx, my);

        // 检查节点（逆序）
        for (var i = this._wbNodes.length - 1; i >= 0; i--) {
            var n = this._wbNodes[i];
            if (wb.x >= n.x && wb.x <= n.x + n.w && wb.y >= n.y && wb.y <= n.y + n.h) {
                if (e.shiftKey) {
                    this._wbDrawEdge = { from: n.id, to: null, mx: wb.x, my: wb.y };
                } else {
                    this._wbDragNode = { node: n, ox: wb.x - n.x, oy: wb.y - n.y };
                }
                return;
            }
        }
        // 空白拖拽平移
        this._wbPanning = true;
        this._wbPanStart = { x: e.clientX, y: e.clientY };
    },

    _wbMouseMove(e) {
        var rect = e.target.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var wb = this._screenToWb(mx, my);

        if (this._wbDragNode) {
            this._wbDragNode.node.x = wb.x - this._wbDragNode.ox;
            this._wbDragNode.node.y = wb.y - this._wbDragNode.oy;
            this._drawWhiteboard();
        } else if (this._wbDrawEdge) {
            this._wbDrawEdge.mx = wb.x; this._wbDrawEdge.my = wb.y;
            this._drawWhiteboard();
            var fn = this._findWbNode(this._wbDrawEdge.from);
            if (fn) {
                var ctx = this._wbCtx;
                ctx.save();
                ctx.translate(this._wbPanX, this._wbPanY);
                ctx.scale(this._wbScale, this._wbScale);
                ctx.beginPath();
                ctx.moveTo(fn.x + fn.w / 2, fn.y + fn.h);
                ctx.bezierCurveTo(
                    fn.x + fn.w / 2, (fn.y + fn.h + wb.y) / 2,
                    wb.x, (fn.y + fn.h + wb.y) / 2,
                    wb.x, wb.y
                );
                ctx.strokeStyle = 'rgba(184,58,46,0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        } else if (this._wbPanning && this._wbPanStart) {
            var dx = e.clientX - this._wbPanStart.x;
            var dy = e.clientY - this._wbPanStart.y;
            this._wbPanX += dx;
            this._wbPanY += dy;
            this._wbPanStart = { x: e.clientX, y: e.clientY };
            this._drawWhiteboard();
        }
    },

    _wbMouseUp(e) {
        if (this._wbDrawEdge) {
            var rect = e.target.getBoundingClientRect();
            var mx = e.clientX - rect.left, my = e.clientY - rect.top;
            var wb = this._screenToWb(mx, my);
            for (var i = 0; i < this._wbNodes.length; i++) {
                var n = this._wbNodes[i];
                if (wb.x >= n.x && wb.x <= n.x + n.w && wb.y >= n.y && wb.y <= n.y + n.h &&
                    n.id !== this._wbDrawEdge.from) {
                    var dup = this._wbEdges.some(function (ed) {
                        return ed.from === this._wbDrawEdge.from && ed.to === n.id;
                    }.bind(this));
                    if (!dup) this._wbEdges.push({ from: this._wbDrawEdge.from, to: n.id });
                    break;
                }
            }
            this._wbDrawEdge = null;
            this._drawWhiteboard();
            this._wbToBlocks();
            this._scheduleAutoSave();
        }
        this._wbDragNode = null;
        this._wbPanning = false;
        this._wbPanStart = null;
    },

    _wbDblClick(e) {
        var rect = e.target.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var wb = this._screenToWb(mx, my);
        var self = this;

        // 双击节点 → 内联编辑
        for (var i = this._wbNodes.length - 1; i >= 0; i--) {
            var n = this._wbNodes[i];
            if (wb.x >= n.x && wb.x <= n.x + n.w && wb.y >= n.y && wb.y <= n.y + n.h) {
                self._wbStartInlineEdit(n, i, e);
                return;
            }
        }
        // 双击空白 → 创建新节点
        var newNode = {
            id: 'wn' + Date.now(),
            text: '',
            x: wb.x - 80, y: wb.y - 15,
            w: 180, h: 30,
            type: 'p', color: '#3a3632',
        };
        this._wbNodes.push(newNode);
        this._drawWhiteboard();
        this._wbStartInlineEdit(newNode, this._wbNodes.length - 1, e);
    },

    _wbStartInlineEdit(node, idx, e) {
        var self = this;
        // 清除已有编辑器
        var existing = document.querySelectorAll('.wb-inline-editor');
        existing.forEach(function (el) { el.remove(); });

        var canvas = document.getElementById('notes-v2-wb-canvas');
        var panel = document.getElementById('notes-v2-whiteboard-panel');
        if (!canvas || !panel) return;

        var s = this._wbToScreen(node.x, node.y);
        var input = document.createElement('textarea');
        input.className = 'wb-inline-editor';
        input.value = node.text;
        input.style.cssText =
            'position:absolute;z-index:100;min-width:180px;min-height:30px;' +
            'padding:6px 10px;border:2px solid #b83a2e;border-radius:8px;' +
            'font-family:"Noto Serif SC","Microsoft YaHei",serif;font-size:12px;line-height:1.6;' +
            'resize:both;background:#fff;color:#1a1614;box-shadow:0 4px 20px rgba(0,0,0,0.15);' +
            'left:' + Math.round(s.x - 2) + 'px;top:' + Math.round(s.y - 2) + 'px;' +
            'width:' + Math.max(node.w, 180) + 'px;';
        input._wbNode = node;
        input._wbIdx = idx;

        panel.appendChild(input);
        setTimeout(function () { input.focus(); input.select(); }, 50);

        input.addEventListener('blur', function () { self._wbFinishInlineEdit(input); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                if (input._wbNode._origText !== undefined) {
                    input._wbNode.text = input._wbNode._origText;
                    if (!input._wbNode._origText) {
                        // 新建空节点取消后删除
                        var ix = self._wbNodes.indexOf(input._wbNode);
                        if (ix >= 0) self._wbNodes.splice(ix, 1);
                    }
                }
                self._wbFinishInlineEdit(input);
                self._drawWhiteboard();
            }
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                self._wbFinishInlineEdit(input);
                self._drawWhiteboard();
            }
        });
        node._origText = node.text;
    },

    _wbFinishInlineEdit(input) {
        var node = input._wbNode;
        var val = input.value.trim();
        if (val) {
            node.text = val;
            node.w = Math.min(Math.max(val.length * 11 + 50, 100), 350);
            delete node._origText;
        } else if (node._origText === '') {
            // 新建空节点被取消
            var idx = this._wbNodes.indexOf(node);
            if (idx >= 0) this._wbNodes.splice(idx, 1);
        }
        if (input.parentNode) input.remove();
        this._wbToBlocks();
        this._scheduleAutoSave();
    },

    /** 白板节点 → _rawMarkdown */
    _wbToBlocks() {
        var lines = [];
        for (var i = 0; i < this._wbNodes.length; i++) {
            var n = this._wbNodes[i];
            if (n.type === 'h1') lines.push('# ' + n.text);
            else if (n.type === 'h2') lines.push('## ' + n.text);
            else if (n.type === 'h3') lines.push('### ' + n.text);
            else if (n.type === 'li') lines.push('- ' + n.text);
            else lines.push(n.text);
        }
        this._rawMarkdown = lines.join('\n');
        this._dirty = false;
    },

    // ========================
    //  盘面预览
    // ========================
    _renderPanPreview(panData) {
        var previewEl = document.getElementById('notes-v2-pan-preview');
        if (!previewEl) return;
        if (!panData) {
            previewEl.innerHTML = '<div style="padding:40px;text-align:center;color:#9c8b72">无盘面数据</div>';
            return;
        }

        var html = '<svg id="notes-v2-preview-svg" viewBox="0 0 660 600" style="width:100%;height:auto;max-height:300px"></svg>';

        var sike = panData['四课详情'] || [];
        var dgAll = panData['遁干'] || {};
        var tjAll = panData['十二天将'] || {};
        var xk = panData['旬空'] || [];
        var DZC_m = {
            '子': '#1a3a5c', '亥': '#1a3a5c', '丑': '#7D5A3C', '未': '#7D5A3C',
            '辰': '#7D5A3C', '戌': '#7D5A3C', '巳': '#c94043', '午': '#c94043',
            '寅': '#2d7d46', '卯': '#2d7d46', '申': '#D4A017', '酉': '#D4A017'
        };
        var TJS_m = {
            '贵人': '贵', '螣蛇': '蛇', '朱雀': '朱', '六合': '合',
            '勾陈': '勾', '青龙': '龙', '天空': '空', '白虎': '虎',
            '太常': '常', '玄武': '玄', '太阴': '阴', '天后': '后'
        };

        if (sike.length) {
            html += '<div style="display:flex;gap:4px;margin-top:4px">';
            for (var si = 0; si < sike.length; si++) {
                var sk = sike[si];
                var sn = sk['上神'], dp = sk['地盘'];
                var snK = xk.indexOf(sn) >= 0;
                var dg = dgAll[sn] || '';
                var tjF = tjAll[sk['地盘地支'] || sk['地盘']] || '';
                html += '<div style="flex:1;text-align:center;padding:3px 2px;background:#fefcf7;border:1px solid #e0d5c1;border-radius:4px;font-size:9px">';
                html += '<div style="color:#9c8b72">' + dg + ' ' + (TJS_m[tjF] || '') + '</div>';
                html += '<div style="font-size:22px;font-weight:700;color:' + (snK ? '#bbb' : (DZC_m[sn] || '#2c2416')) + '">' + sn + '</div>';
                html += '<div style="font-size:15px;font-weight:700;color:' + (DZC_m[dp] || '#2c2416') + '">' + dp + '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        var sanc = panData['三传'] || {};
        if (sanc['初传']) {
            var scZ = [sanc['初传'], sanc['中传'], sanc['末传']];
            html += '<div style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:4px">';
            for (var ii = 0; ii < 3; ii++) {
                html += '<span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;border:2px solid ' +
                    (DZC_m[scZ[ii]] || '#2c2416') + ';color:' + (DZC_m[scZ[ii]] || '#2c2416') +
                    ';font-size:16px;font-weight:700;text-align:center;background:#fff">' + scZ[ii] + '</span>';
                if (ii < 2) html += '<span style="color:#b83a2e;font-weight:bold;font-size:12px">→</span>';
            }
            html += '<span style="font-size:9px;color:#6b5e4a;margin-left:2px">' + (sanc['方法'] || '') + '课</span>';
            html += '</div>';
        }

        previewEl.innerHTML = html;

        if (typeof _renderTiandiPanSVG_to === 'function') {
            var self = this;
            setTimeout(function () {
                _renderTiandiPanSVG_to(panData, 'notes-v2-preview-svg');
            }, 50);
        }
    },

    // ========================
    //  保存
    // ========================
    _saveSilent() {
        if (!this._caseData) return;
        if (this._dirty && this._view === 'editor') {
            this._rawMarkdown = this._editorHtmlToMd();
            this._dirty = false;
        }
        // 直接保存原始 markdown（单一真相源）
        this._caseData.personal_notes = this._rawMarkdown;
        this._caseData.personal_notes_updated = new Date().toISOString().replace('T', ' ').slice(0, 19);
        this._caseData.actual_outcome = document.getElementById('notes-v2-outcome')?.value || '';

        if (typeof _casePut !== 'undefined') _casePut(this._caseData);

        var statusEl = document.getElementById('notes-v2-status');
        if (statusEl) {
            statusEl.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            statusEl.style.color = '#2d8a56';
            setTimeout(function () { statusEl.style.color = ''; }, 2000);
        }
    },

    save() {
        this._saveSilent();
    },

    _scheduleAutoSave() {
        clearTimeout(this._autoSaveTimer);
        var self = this;
        this._autoSaveTimer = setTimeout(function () { self._saveSilent(); }, 3000);
    },

    /** 反推分析 */
    async iterate() {
        if (!this._caseData || !this._caseId) return;
        var outcome = document.getElementById('notes-v2-outcome')?.value.trim();
        if (!outcome) { alert('请先填写实际结果再反推'); return; }
        this._saveSilent();
        this.close();

        var domain = this._domain || 'general';
        var domainLabel = domain === 'destiny' ? '推命' : (domain === 'divination' ? '占卜' : '通用');
        var targetSkill = domain === 'destiny' ? 'mingli' : (domain === 'divination' ? 'shaoyanhe' : 'auto');

        if (typeof Chat !== 'undefined') Chat.addMessage('system', '正在进行【' + domainLabel + '】反推分析...');
        try {
            var resp = await fetch('/api/reflections/iterate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pan_data: this._caseData.pan_data,
                    question: '请分析此课盘',
                    ai_response: this._caseData.personal_notes || '',
                    actual_outcome: outcome,
                    user_notes: this._caseData.personal_notes || '',
                    domain: domain,
                    skill_id: targetSkill,
                })
            });
            var r = await resp.json();
            if (r.success) {
                if (typeof Chat !== 'undefined') {
                    Chat.onChatResponse(r.analysis, { skill_id: 'iterate_' + domain, skill_name: '自反迭代反推【' + domainLabel + '】' });
                    if (r.auto_correct) {
                        Chat.addMessage('system', '🔧 Skill 自动修正完成 → `' + r.auto_correct.updated_file + '`（' + domainLabel + '领域）');
                    }
                    Chat.addMessage('system', '【' + domainLabel + '】反推分析完成。教训已自动保存。');
                }
                if (r.lessons && this._caseData) {
                    var ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
                    this._caseData.personal_notes = (this._caseData.personal_notes || '') + '\n\n---\n\n## 反推教训 (' + ts + ', ' + domainLabel + ')\n\n' + r.lessons;
                    this._caseData.personal_notes_updated = ts;
                    if (typeof _casePut !== 'undefined') _casePut(this._caseData);
                }
            } else {
                if (typeof Chat !== 'undefined') Chat.onError(r.error || '反推分析失败');
            }
        } catch (e) {
            if (typeof Chat !== 'undefined') Chat.onError(e.message);
        }
    },
};

// ========================
//  工具函数
// ========================
function _escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _unescHtml(s) {
    return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

// 全局桥接函数
function openNotesEditorV2(caseId, caseData) {
    NotesEditor.open(caseId, caseData);
}
