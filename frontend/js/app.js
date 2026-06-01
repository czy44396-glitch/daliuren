/**
 * 大六壬排盘解盘 — 主应用
 * 两阶段流程：时间参数入口页 → 排盘结果页
 */
let ws = null;
let currentPanData = null;
let compareContext = null;
let currentCategory = '';
let currentLoadedCaseId = null;

// 安全事件绑定：元素缺失时仅警告，不阻断后续代码
function $on(id, event, fn) {
    const el = document.getElementById(id);
    if (el) { el.addEventListener(event, fn); return true; }
    console.warn('[app] 缺失元素跳过绑定:', id, event);
    return false;
}

/**
 * 工具栏事件路由表（事件委托模式）
 * 点击任意工具栏按钮，根据 id 派发到对应处理函数。
 * 只依赖 toolbar-actions 一个元素，单个按钮缺失不影响其余功能。
 */
const _toolbarActions = {
    'btn-save-case':       () => showSaveModal(),
    'btn-cases':           () => showCases(),
    'btn-history':         () => showHistory(),
    'btn-view-board':      () => switchToBoardView(),
    'btn-view-analysis':   () => switchToAnalysisView(),
    'btn-my-notes':        () => openMyNotes(),
    'btn-correct-sc':      () => showCorrectSCModal(),
    'btn-correct-yj':      () => showCorrectYJModal(),
    'btn-export-img':      () => exportCurrentPan(),
    'btn-classics':        () => { if (typeof Classics !== 'undefined') Classics.open(); },
    'btn-back-portal':     () => backToPortal(),
};
function _toolbarClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const fn = _toolbarActions[btn.id];
    if (fn) { try { fn(); } catch(err) { console.error('[app] 工具栏按钮错误:', btn.id, err); } }
}

function openMyNotes() {
    if (!currentLoadedCaseId) return;
    fetch(`/api/cases/${currentLoadedCaseId}`)
        .then(r => r.json())
        .then(r => { if (r.success) openNotesEditor(currentLoadedCaseId, r.case); })
        .catch(e => console.error(e));
}
function exportCurrentPan() {
    if (!currentPanData) { alert('请先排盘'); return; }
    exportAsImage();
}

// ====== WebSocket ======
function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${location.host}/ws/chat`;
    try {
        ws = new WebSocket(url);
        ws.onopen = () => {
            Chat.setWebSocket(ws);
            if (currentPanData) {
                const msg = {type:'set_pan',data:currentPanData};
                ws.send(JSON.stringify(msg));
            }
        };
        ws.onmessage = (e) => {
            try {
                const m = JSON.parse(e.data);
                if (m.type === 'chat_response') {
                    Chat.onChatResponse(m.message, {
                        skill_id: m.skill_id,
                        skill_name: m.skill_name,
                        skill_matched: m.skill_matched,
                    });
                    if (m.style_used) {
                        const hint = document.getElementById('style-hint');
                        if (hint) {
                            hint.style.display = '';
                            hint.textContent = `已参考 ${m.style_case_count || 0} 个你的解读笔记`;
                            hint.style.color = '#5a8a4a';
                        }
                    }
                } else if (m.type === 'error') Chat.onError(m.message);
                else if (m.type === 'pan_ready') console.log('[WS] synced');
            } catch (err) { console.error('[WS] parse:', err); }
        };
        ws.onclose = () => { Chat.setWebSocket(null); setTimeout(connectWebSocket, 3000); };
        ws.onerror = () => {};
    } catch (e) { setTimeout(connectWebSocket, 3000); }
}

// ====== 从入口页读取参数 ======
function getPortalParams() {
    const gv = (id) => parseInt(document.getElementById(id)?.value) || 0;
    return {
        year: gv('param-year') || 2026,
        month: gv('param-month') || 1,
        day: gv('param-day') || 1,
        hour: gv('param-hour') || 0,
        minute: gv('param-minute') || 0,
        zhanshi: null,
        yuejiang_override: null,
        sex: document.getElementById('param-sex')?.value || '男',
        birth_year: gv('param-birth-year') || null,
        birth_ganzhi: null,
    };
}

// ====== 入口页显示同步（更新符文盘） ======
function portalSyncDisplay() {
    const y = document.getElementById('param-year')?.value || '2026';
    const m = document.getElementById('param-month')?.value || '5';
    const d = document.getElementById('param-day')?.value || '21';
    const h = document.getElementById('param-hour')?.value || '17';
    const mi = document.getElementById('param-minute')?.value || '0';

    // 更新符文盘显示
    const setRune = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setRune('rune-year', y);
    setRune('rune-month', m);
    setRune('rune-day', d);
    setRune('rune-hour', h);
    // 更新干支显示（如果有的话，通过 API 获取）
    updateGanzhiDisplay(y, m, d, h);
    // 同步隐藏 span
    const el = document.getElementById('portal-disp-full');
    if (el) el.textContent = `${y}年${m}月${d}日 ${h}:${mi}`;
}

async function updateGanzhiDisplay(y, m, d, h) {
    try {
        const resp = await fetch('/api/paipan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year: parseInt(y), month: parseInt(m), day: parseInt(d), hour: parseInt(h), minute: 0, sex: '男' }),
        });
        const r = await resp.json();
        if (r.success) {
            const sz = r.data['时间']['四柱'];
            const setGz = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setGz('rune-year-gz', sz['年柱'] + '年');
            setGz('rune-month-gz', sz['月柱'] + '月');
            setGz('rune-day-gz', sz['日柱'] + '日');
            setGz('rune-hour-gz', sz['时柱'] + '时');

            // 更新左侧四柱标签
            const setStick = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setStick('stick-nian', sz['年柱']);
            setStick('stick-yue', sz['月柱']);
            setStick('stick-ri', sz['日柱']);
            setStick('stick-shi', sz['时柱']);
        }
    } catch (e) { /* 静默处理 */ }
}

function portalFixDayMax() {
    const y = parseInt(document.getElementById('param-year')?.value) || 2026;
    const m = parseInt(document.getElementById('param-month')?.value) || 1;
    const maxDay = new Date(y, m, 0).getDate();
    const dayInp = document.getElementById('param-day');
    if (dayInp) {
        dayInp.max = maxDay;
        if (parseInt(dayInp.value) > maxDay) dayInp.value = maxDay;
    }
}

// 换子时 → 日柱自动跨日
function handleHourDayLink(oldHour, newHour) {
    if (oldHour === newHour) return;
    const crossedToZi = oldHour < 23 && newHour === 23;   // 进入子时 → 日+1
    const crossedFromZi = oldHour === 23 && newHour < 23; // 退出子时 → 日-1
    if (!crossedToZi && !crossedFromZi) return;

    const dayInp = document.getElementById('param-day');
    const monthInp = document.getElementById('param-month');
    const yearInp = document.getElementById('param-year');
    let day = parseInt(dayInp.value) || 1;
    let month = parseInt(monthInp.value) || 1;
    let year = parseInt(yearInp.value) || 2026;

    if (crossedToZi) {
        day++;
        const maxDay = new Date(year, month, 0).getDate();
        if (day > maxDay) { day = 1; month++; }
        if (month > 12) { month = 1; year++; }
    } else {
        day--;
        if (day < 1) {
            month--;
            if (month < 1) { month = 12; year--; }
            day = new Date(year, month, 0).getDate();
        }
    }

    yearInp.value = year;
    monthInp.value = month;
    dayInp.value = day;
    portalFixDayMax();
}

// ====== 页面切换 ======
function enterBoard() {
    // 同步入口参数到面板
    const vals = getPortalParams();
    const p = 'board-';
    const setVal = (id, v) => { const el = document.getElementById(p + id); if (el) el.value = v; };
    setVal('param-year', vals.year);
    setVal('param-month', vals.month);
    setVal('param-day', vals.day);
    setVal('param-hour', vals.hour);
    setVal('param-minute', vals.minute);
    setVal('param-sex', vals.sex || '男');
    setVal('param-birth-year', vals.birth_year);

    // 切换视图
    document.getElementById('time-portal').style.display = 'none';
    document.getElementById('board-app').style.display = '';
    document.body.style.background = '#f7f3eb';

    updateShiftTimeLabel();

    // 清除案例追踪
    currentLoadedCaseId = null;
    updateMyNotesBtn(null);
    hideCorrectSCBtn();
    hideViewButtons();

    // 自动排盘
    setTimeout(doPaipan, 50);
}

function backToPortal() {
    // 同步面板值回入口
    const vals = Params.get();
    document.getElementById('param-year').value = vals.year;
    document.getElementById('param-month').value = vals.month;
    document.getElementById('param-day').value = vals.day;
    document.getElementById('param-hour').value = vals.hour;
    document.getElementById('param-minute').value = vals.minute;
    document.getElementById('param-sex').value = vals.sex || '男';
    document.getElementById('param-birth-year').value = vals.birth_year || 1990;
    // 同步 info 节点显示
    const sexEl = document.getElementById('info-sex-val');
    if (sexEl) sexEl.textContent = vals.sex || '男';
    const birthEl = document.getElementById('info-birth-val');
    if (birthEl) birthEl.textContent = vals.birth_year || 1990;
    portalFixDayMax();
    portalSyncDisplay();

    document.getElementById('board-app').style.display = 'none';
    document.getElementById('time-portal').style.display = '';
    document.body.style.background = '';
    currentPanData = null;
    currentLoadedCaseId = null;
    updateMyNotesBtn(null);
    hideCorrectSCBtn();
}

// ====== 排盘 ======
async function doPaipan() {
    const params = Params.get();
    const container = document.getElementById('board-container');
    container.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>排盘中...</span></div>';
    currentPanData = null; compareContext = null;
    currentLoadedCaseId = null; updateMyNotesBtn(null);
    try {
        const resp = await fetch('/api/paipan', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});
        const result = await resp.json();
        if (!result.success) { container.innerHTML = `<div class="error-banner">排盘失败：${result.error||''}</div>`; return; }
        currentPanData = result.data;
        container.innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
        renderBoard(currentPanData);
        Params.setInfo(currentPanData);
        updateShiftTimeLabel();
        resetAnalysisFields(); showViewButtons();
        showCorrectSCBtn();
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
    } catch (err) { container.innerHTML = `<div class="error-banner">网络错误：${err.message}</div>`; }
}

async function doUpdatePan() { await doPaipan(); }

// ====== 换时滚轮 ======
const _SHICHEN = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
// 时辰 → 起始小时映射（子=0, 丑=2, ..., 亥=22）
const _SHI_HOUR = { "子":0,"丑":2,"寅":4,"卯":6,"辰":8,"巳":10,"午":12,"未":14,"申":16,"酉":18,"戌":20,"亥":22 };

function _hourToShichen(h) {
    // 将任意小时归到时辰：子(23,0,1) 丑(1,2,3) 寅(3,4,5) ...
    const idx = Math.floor(((h + 1) % 24) / 2);
    return _SHICHEN[idx] || "";
}

function updateShiftTimeLabel() {
    const el = document.getElementById('shift-time-label');
    if (!el) return;
    const h = parseInt(document.getElementById('board-param-hour')?.value) || 0;
    const sc = _hourToShichen(h);
    el.textContent = `${sc}时`;
}

async function shiftTime(dir) {
    const hourEl = document.getElementById('board-param-hour');
    const dayEl = document.getElementById('board-param-day');
    const monthEl = document.getElementById('board-param-month');
    const yearEl = document.getElementById('board-param-year');
    if (!hourEl || !dayEl) return;

    let hour = parseInt(hourEl.value) || 0;
    let day = parseInt(dayEl.value) || 1;
    let month = parseInt(monthEl.value) || 1;
    let year = parseInt(yearEl.value) || 2026;

    // 归一到时辰起始（偶数小时）
    const oldShiIdx = Math.floor(((hour + 1) % 24) / 2);

    if (dir === 'prev') {
        // 上一时辰 → 子(0) 退回 亥(22)，日减一
        if (oldShiIdx === 0) {
            day--;
            if (day < 1) {
                month--;
                if (month < 1) { month = 12; year--; }
                day = new Date(year, month, 0).getDate();
            }
        }
        hour = _SHI_HOUR[_SHICHEN[(oldShiIdx - 1 + 12) % 12]];
    } else {
        // 下一时辰 → 亥(22) 进到 子(0)，日加一
        if (oldShiIdx === 11) {
            day++;
            const maxD = new Date(year, month, 0).getDate();
            if (day > maxD) { day = 1; month++; }
            if (month > 12) { month = 1; year++; }
        }
        hour = _SHI_HOUR[_SHICHEN[(oldShiIdx + 1) % 12]];
    }

    hourEl.value = hour;
    dayEl.value = day;
    monthEl.value = month;
    yearEl.value = year;

    // 同步入口页
    document.getElementById('param-hour').value = hour;
    document.getElementById('param-day').value = day;
    document.getElementById('param-month').value = month;
    document.getElementById('param-year').value = year;

    updateShiftTimeLabel();
    await doUpdatePan();
}
let _saveTags = [];    // 当前正在编辑的标签列表
let _allTags = [];     // 所有已有标签（含使用次数）

async function loadAllTags() {
    try {
        const resp = await fetch('/api/cases/tags');
        const r = await resp.json();
        if (r.success) _allTags = r.tags;
    } catch(e) { /* 静默 */ }
}

function showSaveModal() {
    if (!currentPanData) { alert('请先排盘'); return; }
    document.getElementById('save-modal').style.display = 'flex';

    // 自动生成建议名称（四柱 + 课式）
    var sz = (currentPanData['时间']||{})['四柱'] || {};
    var sc = currentPanData['三传'] || {};
    var autoName = sz['年柱']+'年'+sz['月柱']+'月'+sz['日柱']+'日 '+sc['方法']+'课';
    var nameInput = document.getElementById('save-name-input');
    nameInput.value = autoName;
    nameInput.select();

    _saveTags = [];
    renderSaveTags();
    renderTagSuggestions();
    document.getElementById('save-tag-input').value = '';
}

function hideSaveModal() { document.getElementById('save-modal').style.display = 'none'; }

function renderSaveTags() {
    const display = document.getElementById('save-tags-display');
    display.innerHTML = _saveTags.map((t, i) =>
        `<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 8px;background:rgba(199,62,58,0.1);border:1px solid rgba(199,62,58,0.3);border-radius:12px;font-size:0.72rem;color:#C73E3A;white-space:nowrap">
            ${t}<span style="cursor:pointer;font-weight:bold;margin-left:2px" data-idx="${i}" class="tag-remove">&times;</span>
        </span>`
    ).join('');
    display.querySelectorAll('.tag-remove').forEach(s => {
        s.addEventListener('click', () => {
            _saveTags.splice(parseInt(s.dataset.idx), 1);
            renderSaveTags();
        });
    });
}

function renderTagSuggestions() {
    const container = document.getElementById('save-tags-suggestions');
    const existing = new Set(_saveTags);
    const available = _allTags.filter(t => !existing.has(t.name));
    if (available.length === 0) {
        container.innerHTML = '<span style="font-size:0.65rem;color:var(--text3)">常用：</span>';
        return;
    }
    container.innerHTML = '<span style="font-size:0.65rem;color:var(--text3)">常用：</span>' +
        available.slice(0, 12).map(t =>
            `<span class="tag-suggestion" data-tag="${t.name.replace(/"/g,'&quot;')}">${t.name}<span style="color:#9c8b72;margin-left:2px;font-size:0.55rem">${t.count}</span></span>`
        ).join('');

    // 事件委托
    container.querySelectorAll('.tag-suggestion').forEach(el => {
        el.addEventListener('click', () => addSaveTag(el.dataset.tag));
    });
}

function addSaveTag(tag) {
    tag = tag.trim();
    if (!tag || _saveTags.includes(tag)) return;
    _saveTags.push(tag);
    renderSaveTags();
    renderTagSuggestions();
    document.getElementById('save-tag-input').value = '';
}

async function confirmSave() {
    const name = document.getElementById('save-name-input').value.trim();
    const tags = _saveTags.length > 0 ? _saveTags : ['其他'];
    hideSaveModal();
    try {
        const resp = await fetch('/api/cases/save', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({pan_data:currentPanData, name, tags, category: tags[0]}),
        });
        const r = await resp.json();
        if (r.success) {
            currentLoadedCaseId = r.id;
            Chat.addMessage('system', `案例已保存：${r.name} [${tags.join('、')}]。点击「✎ 我的解读」撰写个人笔记。`);
            updateMyNotesBtn({ personal_notes: '' });
            loadAllTags(); // 刷新标签列表
        } else { Chat.addMessage('system', `保存失败：${r.error}`); }
    } catch(e) { Chat.addMessage('system', `保存出错: ${e.message}`); }
}

async function loadCaseList() {
    try {
        const [resp, tagResp] = await Promise.all([
            fetch('/api/cases/list'),
            fetch('/api/cases/tags'),
        ]);
        const r = await resp.json();
        if (!r.success) return;
        // 刷新标签
        const tr = await tagResp.json();
        if (tr.success) _allTags = tr.tags;

        const list = document.getElementById('cases-list');
        let cases = r.cases;
        if (currentCategory) {
            cases = cases.filter(c => {
                const tags = c.tags || [c.category || '其他'];
                return tags.includes(currentCategory);
            });
        }
        if (cases.length === 0) {
            list.innerHTML = `<div style="padding:20px;color:var(--text3)">${currentCategory ? `「${currentCategory}」暂无案例` : '暂无保存的案例'}</div>`;
            return;
        }
        list.innerHTML = '';
        cases.forEach(c => {
            const div = document.createElement('div');
            div.className = 'case-item';
            const hasNotes = c.has_notes;
            const tags = c.tags || [c.category || '其他'];
            const tagHtml = tags.map(t =>
                `<span class="case-cat-tag" data-tag="${t}" style="cursor:pointer">${t}</span>`
            ).join('');
            div.innerHTML = `
                <input type="checkbox" class="case-cb" value="${c.id}">
                <span class="case-tags-wrap">${tagHtml}</span>
                <span class="case-name">${c.name}${hasNotes ? '<span class="case-has-notes" title="有个人笔记"></span>' : ''}</span>
                <span class="case-date">${c.created?.slice(0,16)||''}</span>
                <button class="btn btn-sm case-load" data-id="${c.id}">加载</button>
                <button class="btn btn-sm case-btn-notes" data-id="${c.id}">笔记</button>
                <button class="btn btn-sm case-rename" data-id="${c.id}" data-name="${c.name.replace(/"/g,'&quot;')}">改名</button>
                <button class="btn btn-sm case-del" data-id="${c.id}">删</button>`;
            list.appendChild(div);
        });

        // 标签点击筛选
        list.querySelectorAll('.case-cat-tag').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                setCategory(el.dataset.tag);
            });
        });
        list.querySelectorAll('.case-load').forEach(b => b.addEventListener('click', async () => {
            const resp = await fetch(`/api/cases/${b.dataset.id}`);
            const r = await resp.json();
            if (r.success && r.case.pan_data) {
                currentPanData = r.case.pan_data;
                currentLoadedCaseId = r.case.id;
                document.getElementById('board-container').innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
                renderBoard(currentPanData);
                Params.setInfo(currentPanData);
                const pd = r.case.pan_data;
                const timeStr = pd["时间"]["公历"];
                const parts = timeStr.match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
                if (parts) Params.setDate(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]));
                document.getElementById('board-param-zhanshi').value = pd["排盘参数"]["占时"] || 'auto';
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
                document.getElementById('cases-modal').style.display = 'none';
                compareContext = null;
                Chat.clear(); Chat.addMessage('system', `已加载：${r.case.name}`);
                // 显示/隐藏"我的解读"按钮
                updateMyNotesBtn(r.case);
                showCorrectSCBtn();
                // 显示分析面板并加载已有分析
                resetAnalysisFields(); showViewButtons();
                const notes = r.case.personal_notes || '';
                loadAnalysisFromNotes(notes);
            }
        }));
        list.querySelectorAll('.case-rename').forEach(b => b.addEventListener('click', async () => {
            const newName = prompt('新名称：', b.dataset.name);
            if (newName && newName !== b.dataset.name) {
                await fetch(`/api/cases/${b.dataset.id}/rename`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName})});
                loadCaseList();
            }
        }));
        list.querySelectorAll('.case-del').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确认删除？')) return;
            await fetch(`/api/cases/${b.dataset.id}`, {method:'DELETE'});
            loadCaseList();
        }));
        // 笔记按钮
        list.querySelectorAll('.case-btn-notes').forEach(b => b.addEventListener('click', async (e) => {
            e.stopPropagation();
            const caseId = b.dataset.id;
            try {
                const resp = await fetch(`/api/cases/${caseId}`);
                const r = await resp.json();
                if (r.success) {
                    openNotesEditor(caseId, r.case);
                }
            } catch(err) { console.error(err); }
        }));
    } catch(e) { console.error(e); }
}

async function compareCases() {
    const checked = document.querySelectorAll('.case-cb:checked');
    const ids = Array.from(checked).map(cb => cb.value);
    if (ids.length < 2) {
        const h = document.getElementById('compare-hint');
        h.textContent = '⚠ 请至少勾选2个案例'; h.style.color = 'var(--red)';
        setTimeout(() => { h.textContent = '勾选2+案例后点击对比'; h.style.color = 'var(--text3)'; }, 2000);
        return;
    }
    const question = '请找出这些案例的共同特征和关键规律，特别注意三传、六亲、天将的重复模式';
    document.getElementById('cases-modal').style.display = 'none';
    Chat.clear(); Chat.addMessage('system', `正在对比 ${ids.length} 个案例...`);
    try {
        const resp = await fetch('/api/cases/compare', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids, question}),
        });
        const r = await resp.json();
        if (r.success) {
            compareContext = {ids, analysis: r.analysis};
            Chat.onChatResponse(r.analysis);
            Chat.addMessage('system', '对比完成。你可以在下方继续追问。');
        } else { Chat.onError(r.error || '对比失败'); }
    } catch(e) { Chat.onError(e.message); }
}

async function askCompareFollowUp(msg) {
    if (!compareContext) return false;
    Chat.addMessage('system', 'AI 分析中...');
    try {
        const resp = await fetch('/api/cases/compare', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids: compareContext.ids, question: msg, previous_analysis: compareContext.analysis}),
        });
        const r = await resp.json();
        if (r.success) {
            compareContext.analysis = r.analysis;
            Chat.onChatResponse(r.analysis);
        } else { Chat.onError(r.error || '分析失败'); }
    } catch(e) { Chat.onError(e.message); }
    return true;
}

// ====== 历史记录 ======

async function showHistory() {
    document.getElementById('history-modal').style.display = 'flex';
    await loadHistoryList();
}

async function loadHistoryList() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<div style="text-align:center;color:#9a948c;padding:40px 0">加载中...</div>';
    try {
        const resp = await fetch('/api/history/list');
        const r = await resp.json();
        if (!r.success) { list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">加载失败：${r.error||''}</div>`; return; }
        if (r.items.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#9a948c;padding:40px 0">暂无起课记录</div>';
            return;
        }
        list.innerHTML = r.items.map(item => {
            const dt = item.time ? item.time.replace(' ', '\n') : '';
            return `<div class="history-item" data-id="${item.id}" style="padding:10px 8px;border-bottom:1px solid rgba(58,54,50,0.05);cursor:pointer;transition:background 0.2s;border-radius:6px;margin-bottom:2px"
                    onmouseenter="this.style.background='rgba(58,54,50,0.03)'" onmouseleave="this.style.background='transparent'">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                    <div style="flex:1;min-width:0">
                        <div style="color:#1a1614;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.sizhu||'--'}</div>
                        <div style="color:#6b6560;font-size:11px;margin-top:2px">${item.yuejiang||''} · ${item.method||'--'}课</div>
                        <div style="color:#b83a2e;font-size:12px;font-weight:500;margin-top:2px">${item.sanchuan||'--'}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                        <span style="color:#6b6560;font-size:10px;white-space:pre-line;text-align:right;line-height:1.3">${dt}</span>
                        <button class="history-del-btn" data-id="${item.id}" style="background:none;border:1px solid rgba(184,58,46,0.2);color:#b83a2e;font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer">删除</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        // 点击条目加载该盘
        list.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.history-del-btn')) return;
                loadHistoryPan(el.dataset.id);
            });
        });
        // 删除按钮
        list.querySelectorAll('.history-del-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('确定删除这条历史记录？')) return;
                const id = btn.dataset.id;
                await fetch('/api/history/' + id, { method: 'DELETE' });
                loadHistoryList();
            });
        });
    } catch (e) {
        list.innerHTML = `<div style="text-align:center;color:#b83a2e;padding:20px">网络错误：${e.message}</div>`;
    }
}

async function loadHistoryPan(id) {
    try {
        const resp = await fetch('/api/history/' + id);
        const r = await resp.json();
        if (!r.success) { alert('加载失败：' + (r.error||'')); return; }
        const h = r.data;
        // 恢复到入口页参数
        const p = h.params || {};
        document.getElementById('param-year').value = p.year || 2026;
        document.getElementById('param-month').value = p.month || 1;
        document.getElementById('param-day').value = p.day || 1;
        document.getElementById('param-hour').value = p.hour || 0;
        document.getElementById('param-minute').value = p.minute || 0;
        document.getElementById('param-sex').value = p.sex || '男';
        document.getElementById('param-birth-year').value = p.birth_year || 1990;
        document.getElementById('info-sex-val').textContent = p.sex || '男';
        document.getElementById('info-birth-val').textContent = p.birth_year || 1990;
        portalFixDayMax();
        portalSyncDisplay();

        // 设置面板参数并排盘
        const boardP = 'board-';
        const setVal = (id, v) => { const el = document.getElementById(boardP + id); if (el) el.value = v; };
        setVal('param-year', p.year);
        setVal('param-month', p.month);
        setVal('param-day', p.day);
        setVal('param-hour', p.hour);
        setVal('param-minute', p.minute || 0);
        setVal('param-sex', p.sex || '男');
        setVal('param-birth-year', p.birth_year || 1990);

        // 切到排盘页
        document.getElementById('time-portal').style.display = 'none';
        document.getElementById('board-app').style.display = '';
        document.body.style.background = '#f7f3eb';
        document.getElementById('history-modal').style.display = 'none';
        currentLoadedCaseId = null;
        updateMyNotesBtn(null);
        hideCorrectSCBtn();
        hideViewButtons();

        // 直接用历史记录中的盘面数据渲染，不需要重新排盘
        if (h.pan) {
            currentPanData = h.pan;
            document.getElementById('board-container').innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
            renderBoard(currentPanData);
            Params.setInfo(currentPanData);
            resetAnalysisFields();
            showViewButtons();
            showCorrectSCBtn();
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
        } else {
            setTimeout(doPaipan, 300);
        }
    } catch (e) {
        alert('加载失败：' + e.message);
    }
}

async function clearHistory() {
    if (!confirm('确定清空所有起课历史记录？此操作不可恢复。')) return;
    await fetch('/api/history/clear', { method: 'POST' });
    loadHistoryList();
}

function hideHistory() {
    document.getElementById('history-modal').style.display = 'none';
}

async function showCases() {
    document.getElementById('cases-modal').style.display = 'flex';
    await loadAllTags();
    buildFilterBar();
    loadCaseList();
}

function buildFilterBar() {
    const filter = document.getElementById('cases-filter');
    let html = `<button class="btn btn-sm cat-btn ${currentCategory === '' ? 'active' : ''}" data-cat="">全部</button>`;
    const existingNames = new Set(_allTags.map(t => t.name));

    // 显示已有标签
    _allTags.slice(0, 20).forEach(t => {
        html += `<button class="btn btn-sm cat-btn ${currentCategory === t.name ? 'active' : ''}" data-cat="${t.name}">${t.name}<span style="font-size:0.55rem;color:#9c8b72;margin-left:2px">${t.count}</span></button>`;
    });

    // 如果当前筛选标签不在已有列表中，也显示它
    if (currentCategory && !existingNames.has(currentCategory)) {
        html += `<button class="btn btn-sm cat-btn active" data-cat="${currentCategory}">${currentCategory}</button>`;
    }

    html += `<button id="btn-new-cat" class="btn btn-sm" title="新建子库标签">+</button>`;
    filter.innerHTML = html;

    // 绑定事件
    filter.querySelectorAll('.cat-btn').forEach(b => {
        b.addEventListener('click', () => setCategory(b.dataset.cat));
    });
    const newCatBtn = document.getElementById('btn-new-cat');
    if (newCatBtn) newCatBtn.addEventListener('click', addCategory);
}

function setCategory(cat) {
    currentCategory = cat;
    buildFilterBar();
    loadCaseList();
}

function addCategory() {
    const cat = prompt('新建子库标签名称：', '');
    if (!cat || !cat.trim()) return;
    const tag = cat.trim();
    // 添加到本地标签列表以便立即显示
    if (!_allTags.find(t => t.name === tag)) {
        _allTags.push({ name: tag, count: 0 });
    }
    currentCategory = tag;
    buildFilterBar();
    loadCaseList();
}

// ====== 个人解读笔记 ======
let _notesCaseId = null;
let _notesCaseName = '';

function openNotesEditor(caseId, caseData) {
    _notesCaseId = caseId;
    _notesCaseName = caseData.name || '';
    document.getElementById('notes-case-label').textContent = `案例：${_notesCaseName}`;
    const editor = document.getElementById('notes-editor');
    const statusEl = document.getElementById('notes-status');
    statusEl.textContent = '';
    statusEl.className = '';
    editor.value = caseData.personal_notes || '';
    document.getElementById('notes-modal').style.display = 'flex';
    // 如果有内容，更新按钮状态
    if (caseData.personal_notes && caseData.personal_notes.trim()) {
        statusEl.textContent = `上次更新：${(caseData.personal_notes_updated || '').slice(0, 16)}`;
    }
    setTimeout(() => editor.focus(), 200);
}

function hideNotesModal() {
    document.getElementById('notes-modal').style.display = 'none';
    _notesCaseId = null;
}

async function savePersonalNotes() {
    if (!_notesCaseId) return;
    const notes = document.getElementById('notes-editor').value;
    const statusEl = document.getElementById('notes-status');
    statusEl.textContent = '保存中...';
    statusEl.className = '';
    try {
        const resp = await fetch(`/api/cases/${_notesCaseId}/personal-notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes }),
        });
        const r = await resp.json();
        if (r.success) {
            statusEl.textContent = '已保存 ✓';
            statusEl.className = 'saved';
            setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
        } else {
            statusEl.textContent = '保存失败: ' + (r.error || '');
        }
    } catch (e) {
        statusEl.textContent = '保存出错: ' + e.message;
    }
}

function updateMyNotesBtn(caseData) {
    const btn = document.getElementById('btn-my-notes');
    if (!btn) return;
    if (currentLoadedCaseId) {
        btn.style.display = '';
        const hasNotes = caseData && caseData.personal_notes && caseData.personal_notes.trim();
        btn.classList.toggle('has-notes', !!hasNotes);
        btn.title = hasNotes ? '编辑个人解读笔记（已有内容）' : '撰写个人解读笔记';
    } else {
        btn.style.display = 'none';
        btn.classList.remove('has-notes');
    }
}

function showCorrectSCBtn() {
    const btn = document.getElementById('btn-correct-sc');
    if (btn && currentPanData) btn.style.display = '';
    const btn2 = document.getElementById('btn-correct-yj');
    if (btn2 && currentPanData) btn2.style.display = '';
}

function hideCorrectSCBtn() {
    const btn = document.getElementById('btn-correct-sc');
    if (btn) btn.style.display = 'none';
    const btn2 = document.getElementById('btn-correct-yj');
    if (btn2) btn2.style.display = 'none';
}

// ====== 月将矫正 ======
let _selectedYJ = '';

function showCorrectYJModal() {
    if (!currentPanData) { alert('请先排盘'); return; }
    const yj = currentPanData['排盘参数']['月将'];
    _selectedYJ = yj || '';
    document.getElementById('correct-yj-original').textContent = yj || '--';
    document.querySelectorAll('#correct-yj-modal .yj-opt').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.yj === _selectedYJ);
    });
    document.getElementById('correct-yj-modal').style.display = 'flex';
}

function hideCorrectYJModal() {
    document.getElementById('correct-yj-modal').style.display = 'none';
}

async function applyCorrectYJ() {
    if (!_selectedYJ) { alert('请选择月将'); return; }
    try {
        const resp = await fetch('/api/correct-yuejiang', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pan_data: JSON.parse(JSON.stringify(currentPanData)),
                yuejiang: _selectedYJ,
            }),
        });
        const r = await resp.json();
        if (r.success) {
            currentPanData = r.data;
            const container = document.getElementById('board-container');
            container.innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
            renderBoard(currentPanData);
            Params.setInfo(currentPanData);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'set_pan', data: currentPanData }));
            }
            hideCorrectYJModal();
            document.getElementById('info-yuejiang').textContent = _selectedYJ;
            Chat.addMessage('system', `月将已矫正为：${_selectedYJ}（天地盘、四课、三传已全部重建）`);
        } else {
            alert('矫正失败：' + (r.error || ''));
        }
    } catch (e) {
        alert('矫正出错：' + e.message);
    }
}

// ====== 三传矫正 ======
let _originalSanchuan = null;  // 保存原始三传以便恢复

function showCorrectSCModal() {
    if (!currentPanData) { alert('请先排盘'); return; }
    const sc = currentPanData['三传'];
    _originalSanchuan = {
        method: sc['方法'] || '',
        chuchuan: sc['初传'] || '',
        zhongchuan: sc['中传'] || '',
        mochuan: sc['末传'] || '',
    };
    document.getElementById('correct-sc-method').value = _originalSanchuan.method || '元首';
    document.getElementById('correct-sc-c').value = _originalSanchuan.chuchuan || '';
    document.getElementById('correct-sc-z').value = _originalSanchuan.zhongchuan || '';
    document.getElementById('correct-sc-m').value = _originalSanchuan.mochuan || '';
    document.getElementById('correct-sc-original').textContent =
        `自动推算：${_originalSanchuan.method}课 ${_originalSanchuan.chuchuan}→${_originalSanchuan.zhongchuan}→${_originalSanchuan.mochuan}`;
    document.getElementById('correct-sc-modal').style.display = 'flex';
}

function hideCorrectSCModal() {
    document.getElementById('correct-sc-modal').style.display = 'none';
}

async function applyCorrectSC() {
    const method = document.getElementById('correct-sc-method').value.trim();
    const c = document.getElementById('correct-sc-c').value;
    const z = document.getElementById('correct-sc-z').value;
    const m = document.getElementById('correct-sc-m').value;
    if (!c || !z || !m) { alert('请完整填写三传'); return; }

    try {
        const resp = await fetch('/api/correct-sanchuan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pan_data: JSON.parse(JSON.stringify(currentPanData)),
                method, chuchuan: c, zhongchuan: z, mochuan: m,
            }),
        });
        const r = await resp.json();
        if (r.success) {
            currentPanData = r.data;
            // 重新渲染 SVGs
            const container = document.getElementById('board-container');
            container.innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
            renderBoard(currentPanData);
            // 更新顶部信息条
            const sc = currentPanData['三传'];
            const display = document.getElementById('sanchuan-display');
            if (display) {
                display.querySelector('.value').textContent = `${sc['初传']}→${sc['中传']}→${sc['末传']}`;
            }
            const methodDisplay = document.getElementById('method-display');
            if (methodDisplay) {
                methodDisplay.querySelector('.value').textContent = sc['方法'];
            }
            // 同步到 WebSocket
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'set_pan', data: currentPanData }));
            }
            hideCorrectSCModal();
            Chat.addMessage('system', `三传已矫正为：${sc['方法']}课 ${sc['初传']}→${sc['中传']}→${sc['末传']}`);
        } else {
            alert('矫正失败：' + (r.error || ''));
        }
    } catch (e) {
        alert('矫正出错：' + e.message);
    }
}

async function resetSC() {
    if (!_originalSanchuan) return;
    document.getElementById('correct-sc-method').value = _originalSanchuan.method;
    document.getElementById('correct-sc-c').value = _originalSanchuan.chuchuan;
    document.getElementById('correct-sc-z').value = _originalSanchuan.zhongchuan;
    document.getElementById('correct-sc-m').value = _originalSanchuan.mochuan;
}

// ====== 视图切换 ======
function switchToBoardView() {
    document.getElementById('board-view').style.display = '';
    document.getElementById('analysis-view').style.display = 'none';
    document.getElementById('analysis-view').classList.remove('active');
    document.getElementById('btn-view-board').classList.add('btn-primary');
    document.getElementById('btn-view-analysis').classList.remove('btn-primary');
}

function switchToAnalysisView() {
    document.getElementById('board-view').style.display = 'none';
    document.getElementById('analysis-view').style.display = '';
    document.getElementById('analysis-view').classList.add('active');
    document.getElementById('btn-view-board').classList.remove('btn-primary');
    document.getElementById('btn-view-analysis').classList.add('btn-primary');
}

function showViewButtons() {
    document.getElementById('btn-view-board').style.display = '';
    document.getElementById('btn-view-analysis').style.display = '';
    switchToBoardView();
}

function hideViewButtons() {
    document.getElementById('btn-view-board').style.display = 'none';
    document.getElementById('btn-view-analysis').style.display = 'none';
}

function resetAnalysisFields() {
    ['af-keshi','af-sanchuan','af-sike','af-shensha','af-zonghe'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

// ====== 分析笔记面板 ======

async function saveAnalysis() {
    const analysis = {
        keshi: document.getElementById('af-keshi').value.trim(),
        sanchuan: document.getElementById('af-sanchuan').value.trim(),
        sike: document.getElementById('af-sike').value.trim(),
        shensha: document.getElementById('af-shensha').value.trim(),
        zonghe: document.getElementById('af-zonghe').value.trim(),
    };
    // 检查是否有内容
    const hasContent = Object.values(analysis).some(v => v.length > 0);
    if (!hasContent) return;

    const statusEl = document.getElementById('analysis-status');

    if (!currentLoadedCaseId) {
        statusEl.textContent = '请先保存案例';
        statusEl.style.color = '#C73E3A';
        setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000);
        return;
    }

    // 组合成 Markdown 格式保存到 personal_notes
    const md = `## 分析笔记

### 课式总判
${analysis.keshi || '（待填）'}

### 三传分析
${analysis.sanchuan || '（待填）'}

### 四课格局
${analysis.sike || '（待填）'}

### 神煞与天将
${analysis.shensha || '（待填）'}

### 综合断语
${analysis.zonghe || '（待填）'}
`;

    statusEl.textContent = '保存中...';
    try {
        const resp = await fetch(`/api/cases/${currentLoadedCaseId}/personal-notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: md }),
        });
        const r = await resp.json();
        if (r.success) {
            statusEl.textContent = '已保存 ✓';
            statusEl.className = 'saved';
            const myNotesBtn = document.getElementById('btn-my-notes');
            if (myNotesBtn) myNotesBtn.classList.add('has-notes');
            setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
        } else {
            statusEl.textContent = '保存失败: ' + (r.error || '');
        }
    } catch (e) {
        statusEl.textContent = '保存出错: ' + e.message;
    }
}

function loadAnalysisFromNotes(notes) {
    if (!notes || !notes.startsWith('## 分析笔记')) return false;
    // 解析 Markdown 各节
    const sections = { keshi: '', sanchuan: '', sike: '', shensha: '', zonghe: '' };
    const map = { '课式总判': 'keshi', '三传分析': 'sanchuan', '四课格局': 'sike', '神煞与天将': 'shensha', '综合断语': 'zonghe' };
    for (const [key, field] of Object.entries(map)) {
        const re = new RegExp(`### ${key}\\n([\\s\\S]*?)(?=\\n###|$)`, 'm');
        const m = notes.match(re);
        if (m) {
            sections[field] = m[1].trim().replace(/^\(（待填）\)$/, '');
        }
    }
    Object.entries(sections).forEach(([id, val]) => {
        document.getElementById('af-' + id).value = val;
    });
    return true;
}

// ====== 导出 ======
function buildExportHTML(data) {
    const svgEl = document.getElementById('board-svg');
    const svgData = svgEl ? svgEl.outerHTML : '';
    const sikeHTML = document.getElementById('sike-container')?.innerHTML || '';
    const sanchuanHTML = document.getElementById('sanchuan-container')?.innerHTML || '';
    const sz = data["时间"]["四柱"] || {};
    const sc = data["三传"] || {};
    const pm = data["排盘参数"] || {};
    const sj = data["时间"] || {};
    const jq = data["节气"] || {};
    const xk = data["旬空"] || [];
    const dg = data["遁干"] || {};

    let html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>大六壬课例 - ${sz['年柱']||''}${sz['月柱']||''}${sz['日柱']||''}${sz['时柱']||''}</title>
<style>
body{font-family:'Noto Serif SC','SimSun',serif;max-width:720px;margin:0 auto;padding:16px;background:#f7f3eb;color:#2c2416}
.header{display:flex;align-items:center;justify-content:center;gap:16px;padding:10px 0;margin-bottom:12px;border-bottom:1px solid #e0d5c1}
.header .brand{font-size:1.5rem;color:#8b1a2b;font-weight:700;letter-spacing:2px}
.header .gz-row{display:flex;gap:6px;align-items:center}
.header .gz-item{text-align:center}
.header .gz-item .g{color:#b8860b;font-size:0.85rem;font-weight:600}
.header .gz-item .z{color:#8b1a2b;font-size:0.85rem;font-weight:600;display:block}
.header .meta{font-size:0.65rem;color:#9c8b72}
.board-card{background:#fff;border:1px solid #e0d5c1;border-radius:8px;padding:4px;margin-bottom:10px;text-align:center}
.board-svg{width:100%;height:auto}
.sike-sanchuan{display:flex;gap:10px;margin-bottom:10px;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #e0d5c1;border-radius:8px;padding:10px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card h3{font-size:0.75rem;color:#8b1a2b;margin:0 0 6px;letter-spacing:1px;border-bottom:1px solid #e0d5c1;padding-bottom:4px}
.sec-title{font-size:0.8rem;color:#8b1a2b;margin:0 0 8px;letter-spacing:2px;width:100%;text-align:center;font-weight:600}
.sike-grid{display:flex;gap:18px}
.sike-cell{flex:1;text-align:center;padding:18px 14px;background:#fefcf7;border:1px solid #e0d5c1;border-radius:8px}
.sike-dungan{font-size:0.9rem;color:#9c8b72;font-family:'Noto Serif SC',serif}
.sike-jiang{font-size:0.95rem;color:#8b1a2b;font-weight:600;margin:3px 0}
.sike-shang{font-size:2rem;font-weight:700;display:block;font-family:'Noto Serif SC',serif;line-height:1.2}
.sike-di{font-size:2rem;font-weight:700;display:block;margin-top:4px;font-family:'Noto Serif SC',serif;line-height:1.2}
.sanchuan-col{display:flex;flex-direction:column;align-items:center;gap:3px}
.sc-cell-v{text-align:center;padding:4px 10px;background:#fefcf7;border:1px solid #e0d5c1;border-radius:6px}
.sc-zhi{display:inline-block;width:34px;height:34px;line-height:34px;border-radius:50%;border:2px solid;font-size:1.2rem;font-weight:700;font-family:'Noto Serif SC',serif;background:#fff}
.sc-label{font-size:0.62rem;color:#6b5e4a;margin-top:1px}
.sc-arrow-dn{font-size:0.9rem;color:#8b1a2b;font-weight:700;line-height:1}
.info-table{width:100%;border-collapse:collapse;font-size:0.68rem;margin-top:6px}
.info-table th,.info-table td{padding:3px 6px;border:1px solid #e0d5c1;text-align:center}
.info-table th{background:#fdf8f0;color:#8b1a2b;font-weight:500}
.footer{text-align:center;color:#9c8b72;font-size:0.65rem;margin-top:10px}
@media print{body{background:#fff}.card{box-shadow:none;break-inside:avoid}}
</style></head><body>
<div class="header">
<div class="brand">大六壬课例</div>
<div class="gz-row">
${['年','月','日','时'].map(k => '<div class="gz-item"><span class="g">'+(sz[k+'柱']||'--')[0]+'</span><span class="z">'+(sz[k+'柱']||'--')[1]+'</span><span class="meta">'+k+'</span></div>').join('')}
</div>
<div class="meta">${pm['月将']||''}将 · ${jq['当前节气']||''}→${jq['下一节气']||''} · ${sj['昼夜']||''}<br>旬空 ${xk.join('、')} · ${sj['公历']||''}</div>
</div>
<div class="board-card">
<svg viewBox="0 0 660 600" class="board-svg">${svgData.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '')}</svg>
</div>
<div class="sike-sanchuan">
<div style="flex:3;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px">
<h3 class="sec-title">四课</h3><div class="sike-grid">${sikeHTML.replace(/<div class="section-title">[^<]*<\/div>/, '')}</div></div>
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px">
<h3 class="sec-title">三传·${sc['方法']||''}</h3>${sanchuanHTML.replace(/<div class="section-title">[^<]*<\/div>/, '')}</div>
</div>
<div class="card">
<table class="info-table"><tr><th></th>${['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'].map(d=>'<th>'+d+'</th>').join('')}</tr>
<tr><th>天盘</th>${['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'].map(d=>'<td>'+(data['天地盘']||{})[d]+'</td>').join('')}</tr>
<tr><th>天将</th>${['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'].map(d=>'<td>'+(data['十二天将']||{})[d]+'</td>').join('')}</tr>
<tr><th>遁干</th>${['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'].map(d=>'<td>'+dg[d]+'</td>').join('')}</tr></table>
</div>
<div class="footer">行年${data['行年']||'--'}(${(data['行年详情']||{})['年龄']||''}岁) · 日干${sj['日干']||''} · 大六壬排盘系统</div>
</body></html>`;
    return html;
}

function exportAsImage() {
    const data = currentPanData;
    if (!data) { alert('盘面数据缺失，请重新排盘'); return; }

    try {
        const sz = data['时间']?.['四柱'] || {};
        const sc = data['三传'] || {};
        const sike = data['四课详情'] || [];
        const tjAll = data['十二天将'] || {};
        const dgAll = data['遁干'] || {};
        const pm = data['排盘参数'] || {};
        const jq = data['节气'] || {};
        const sj = data['时间'] || {};
        const xk = data['旬空'] || [];
        const td = data['天地盘'] || {};

        // 紧凑布局：天地盘居中 + 四课大卡 + 三传横行
        var W = 1200, H = 1120;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f7f3eb';
        ctx.fillRect(0, 0, W, H);

        // 顶部分隔线
        ctx.strokeStyle = '#e0d5c1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(60, 0); ctx.lineTo(W-60, 0);
        ctx.stroke();

        // 标题行（月将 + 课式 + 四柱 合并一行）
        var headerY = 36;
        ctx.fillStyle = '#8b1a2b';
        ctx.font = 'bold 22px "Noto Serif SC","SimSun",serif';
        ctx.textAlign = 'center';
        ctx.fillText('大六壬课例', W/2, headerY);

        // 四柱 — 直接排在标题下方
        var pillarY = 68;
        var pillars = ['年柱','月柱','日柱','时柱'];
        pillars.forEach(function(k, i) {
            var gz = sz[k] || '--';
            var x = W/2 - 120 + i * 80;
            ctx.font = 'bold 20px "Noto Serif SC",serif';
            ctx.fillStyle = '#b8860b';
            ctx.fillText(gz[0]||'', x, pillarY);
            ctx.fillStyle = '#8b1a2b';
            ctx.fillText(gz[1]||'', x, pillarY + 26);
            ctx.fillStyle = '#9c8b72';
            ctx.font = '11px "Noto Sans SC",sans-serif';
            ctx.fillText(k[0], x, pillarY + 42);
        });

        // 副标题（月将 节气 昼夜 课式）
        var subY = 130;
        ctx.fillStyle = '#9c8b72';
        ctx.font = '16px "Noto Sans SC","Microsoft YaHei",sans-serif';
        ctx.fillText(pm['月将']+'将 · '+jq['当前节气']+'→'+jq['下一节气']+' · '+sj['昼夜']+' · '+sc['方法']+'课', W/2, subY);

        // ===== 天地盘十二宫（紧凑） =====
        var DZ_list = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
        var DZC_map = {'子':'#1a3a5c','亥':'#1a3a5c','丑':'#7D5A3C','未':'#7D5A3C','辰':'#7D5A3C','戌':'#7D5A3C','巳':'#c94043','午':'#c94043','寅':'#2d7d46','卯':'#2d7d46','申':'#D4A017','酉':'#D4A017'};
        var TJS_map = {'贵人':'贵','螣蛇':'蛇','朱雀':'朱','六合':'合','勾陈':'勾','青龙':'龙','天空':'空','白虎':'虎','太常':'常','玄武':'玄','太阴':'阴','天后':'后'};
        var TJC_map = {'贵人':'#7D5A3C','天空':'#7D5A3C','勾陈':'#7D5A3C','太常':'#7D5A3C','青龙':'#2d7d46','六合':'#2d7d46','白虎':'#D4A017','太阴':'#D4A017','天后':'#1a3a5c','玄武':'#1a3a5c','螣蛇':'#c94043','朱雀':'#c94043'};
        var POS_map = {'巳':[0,0],'午':[0,1],'未':[0,2],'申':[0,3],'辰':[1,0],'酉':[1,3],'卯':[2,0],'戌':[2,3],'寅':[3,0],'丑':[3,1],'子':[3,2],'亥':[3,3]};

        var cw = 132, ch = 112, cgap = 6;
        var boardW = 4*cw + 3*cgap;
        var boardH = 4*ch + 3*cgap;
        var boardX = Math.floor((W - boardW) / 2);
        var boardY = 155;

        // 白底边框
        ctx.fillStyle = '#fff';
        ctx.fillRect(boardX-3, boardY-3, boardW+6, boardH+6);
        ctx.strokeStyle = '#e0d5c1';
        ctx.lineWidth = 1;
        ctx.strokeRect(boardX-3, boardY-3, boardW+6, boardH+6);

        for (var di_idx = 0; di_idx < DZ_list.length; di_idx++) {
            var di = DZ_list[di_idx];
            var pos = POS_map[di];
            var cx = boardX + pos[1]*(cw+cgap);
            var cy = boardY + pos[0]*(ch+cgap);
            var tian = td[di] || '';
            var jiang = tjAll[di] || '';
            var dun = dgAll[tian] || '';
            var clrDi = DZC_map[di] || '#2c2416';
            var clrTian = DZC_map[tian] || '#2c2416';
            var tianK = xk.indexOf(tian) >= 0;
            var diK = xk.indexOf(di) >= 0;
            var midX = cx + cw/2;
            var midY = cy + ch/2;

            ctx.fillStyle = '#fefcf7';
            ctx.fillRect(cx, cy, cw, ch);
            ctx.strokeStyle = clrDi;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(cx, cy, cw, ch, 5);
            ctx.stroke();

            // 遁干
            ctx.fillStyle = '#6b5e4a';
            ctx.font = 'bold 11px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(dun, midX, midY - 28);

            // 天将
            var tjS = TJS_map[jiang] || '';
            var tjClr = TJC_map[jiang] || '#8b1a2b';
            ctx.fillStyle = tjClr;
            ctx.font = 'bold 17px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(tjS, midX, midY - 8);

            // 天盘地支
            if (tianK) {
                ctx.beginPath();
                ctx.arc(midX, midY + 14, 19, 0, Math.PI*2);
                ctx.strokeStyle = clrTian;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.fillStyle = tianK ? '#bbb' : clrTian;
            ctx.font = 'bold 26px "Noto Serif SC",serif';
            ctx.fillText(tian, midX, midY + 22);

            // 地盘地支
            if (diK) {
                ctx.beginPath();
                ctx.roundRect(cx+cw-25, cy+ch-20, 14, 14, 2);
                ctx.strokeStyle = clrDi;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.fillStyle = diK ? '#bbb' : clrDi;
            ctx.font = 'bold 13px "Noto Serif SC",serif';
            ctx.textAlign = 'end';
            ctx.fillText(di, cx+cw-12, cy+ch-8);
            ctx.textAlign = 'center';
        }

        // ===== 四课（大幅放大，核心可读） =====
        var sikeY = boardY + boardH + 18;
        var cellW = 240, cellH = 180, cellGap = 10;
        var sikeTotalW = 4*cellW + 3*cellGap;
        var sikeX = Math.floor((W - sikeTotalW) / 2);

        // 四课标题
        ctx.fillStyle = '#8b1a2b';
        ctx.font = 'bold 14px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText('四      课', W/2, sikeY - 4);

        for (var si = 0; si < sike.length; si++) {
            var sk = sike[si];
            var sn = sk['上神'];
            var dp = sk['地盘'];
            var snKong = xk.indexOf(sn) >= 0;
            var clrSn = snKong ? '#bbb' : (DZC_map[sn] || '#2c2416');
            var clrDp = DZC_map[dp] || '#2c2416';
            var dg = dgAll[sn] || '';
            var tjFull = tjAll[sk['地盘地支']||sk['地盘']] || '';
            var tj = TJS_map[tjFull] || '';

            var sx = sikeX + si*(cellW+cellGap);
            var sy = sikeY;
            var scx = sx + cellW/2;

            ctx.fillStyle = '#fefcf7';
            ctx.fillRect(sx, sy, cellW, cellH);
            ctx.strokeStyle = '#e0d5c1';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx, sy, cellW, cellH);

            // 遁干
            ctx.fillStyle = '#9c8b72';
            ctx.font = 'bold 15px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(dg, scx, sy + 24);

            // 天将
            ctx.fillStyle = '#8b1a2b';
            ctx.font = 'bold 18px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(tj, scx, sy + 48);

            // 上神（超大号）
            ctx.fillStyle = clrSn;
            ctx.font = 'bold 48px "Noto Serif SC",serif';
            ctx.fillText(sn, scx, sy + 108);

            // 地盘
            ctx.fillStyle = clrDp;
            ctx.font = 'bold 20px "Noto Serif SC",serif';
            ctx.fillText(dp, scx, sy + 155);
        }

        // ===== 三传（居中横排，大圆醒目） =====
        var sanY = sikeY + cellH + 30;
        ctx.fillStyle = '#8b1a2b';
        ctx.font = 'bold 16px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText('三  传  ·  '+sc['方法']+'课', W/2, sanY);

        var items = [
            {z:sc['初传'],l:'初传'},
            {z:sc['中传'],l:'中传'},
            {z:sc['末传'],l:'末传'}
        ];
        var scStep = 170;  // 圆圈间距
        var scStartX = W/2 - scStep;  // 中传在中心
        var scCY = sanY + 50;
        var scR = 36;  // 圆圈半径

        for (var ii = 0; ii < 3; ii++) {
            var scX = scStartX + ii * scStep;
            var clr = DZC_map[items[ii].z] || '#2c2416';
            var izKong = xk.indexOf(items[ii].z) >= 0;
            if (izKong) clr = '#bbb';

            // 圆圈
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(scX, scCY, scR, 0, Math.PI*2);
            ctx.fill();
            ctx.strokeStyle = clr;
            ctx.lineWidth = 3;
            ctx.stroke();

            // 地支大字
            ctx.fillStyle = clr;
            ctx.font = 'bold 36px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(items[ii].z, scX, scCY + 12);

            // 标签
            ctx.fillStyle = '#6b5e4a';
            ctx.font = 'bold 13px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(items[ii].l, scX, scCY + scR + 22);

            // 箭头（1→2, 2→3）
            if (ii < 2) {
                var arrX = (scX + scStartX + scStep) / 2;
                ctx.fillStyle = '#b83a2e';
                ctx.font = 'bold 22px sans-serif';
                ctx.fillText('→', arrX, scCY + 8);
            }
        }

        // ===== 底部信息栏 =====
        var footerY = scCY + scR + 50;
        ctx.fillStyle = '#9c8b72';
        ctx.font = '14px "Noto Sans SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('旬空：'+(xk.join('、')||'无')+'   |   行年：'+(data['行年']||'--')+'（'+((data['行年详情']||{})['年龄']||'')+'岁）   |   '+(sj['公历']||''), W/2, footerY);
        ctx.fillText('日干 '+sj['日干']+'（'+({'甲':'木','乙':'木','丙':'火','丁':'火','戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水'})[sj['日干']]||''+'）   |   日支 '+sj['日支'], W/2, footerY + 20);

        // ===== 导出分发：按平台 + PWA状态选择最佳策略 =====
        var filename = '大六壬_'+(sz['年柱']||'')+(sz['月柱']||'')+(sz['日柱']||'')+'.png';
        var isAndroid = /Android/i.test(navigator.userAgent);
        var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        var isPWA = window.matchMedia('(display-mode: standalone)').matches;

        if (isPWA) {
            // PWA 独立模式（主屏图标入口）：弹窗预览最可靠
            // Android PWA 中 a.click() 下载不触发；iOS PWA 不支持 download
            var dataUrl = canvas.toDataURL('image/png');
            _showImageModal(dataUrl, filename);
        } else if (isAndroid) {
            // Android 浏览器：直接下载
            if (typeof canvas.toBlob === 'function') {
                canvas.toBlob(function(blob) {
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url; a.download = filename;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(function() {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }, 500);
                }, 'image/png');
            } else {
                _triggerDownload(canvas.toDataURL('image/png'), filename);
            }
        } else if (isIOS) {
            // iOS Safari：弹窗预览 + 长按保存
            var dataUrl2 = canvas.toDataURL('image/png');
            _showImageModal(dataUrl2, filename);
        } else {
            // 桌面端：直接下载
            _triggerDownload(canvas.toDataURL('image/png'), filename);
        }

        // ---- 辅助函数 ----
        function _triggerDownload(url, fname) {
            var a = document.createElement('a');
            a.href = url; a.download = fname;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() { document.body.removeChild(a); }, 300);
        }

        function _showImageModal(dataUrl, fname) {
            // 移除旧弹窗
            var old = document.querySelector('.export-img-modal');
            if (old) old.remove();

            var modal = document.createElement('div');
            modal.className = 'export-img-modal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,20,0.95);z-index:9999;padding:16px;overflow:auto;display:flex;flex-direction:column;align-items:center';

            // 标题栏
            var bar = document.createElement('div');
            bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;max-width:600px;padding:8px 0;flex-shrink:0';
            var title = document.createElement('span');
            title.textContent = fname;
            title.style.cssText = 'color:#9a948c;font-size:13px;font-family:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
            var closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'width:36px;height:36px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#c4b393;border-radius:50%;font-size:18px;cursor:pointer;flex-shrink:0;margin-left:12px;line-height:1';
            closeBtn.onclick = function() { modal.remove(); };
            bar.appendChild(title);
            bar.appendChild(closeBtn);

            // 图片容器（独立点击区，不关闭弹窗）
            var imgWrap = document.createElement('div');
            imgWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;width:100%;max-width:600px;min-height:0';
            var img = document.createElement('img');
            img.src = dataUrl;
            img.style.cssText = 'max-width:100%;max-height:70vh;border-radius:6px;border:2px solid rgba(255,255,255,0.1);object-fit:contain';
            // 阻止事件冒泡，防止点击图片关闭弹窗
            img.onclick = function(e) { e.stopPropagation(); };
            imgWrap.appendChild(img);

            // 底部提示
            var tip = document.createElement('p');
            tip.textContent = '长按上方图片 → 保存到相册';
            tip.style.cssText = 'color:#c4b393;margin:16px 0 8px;font-size:15px;font-family:"Noto Serif SC",serif;text-align:center;flex-shrink:0';

            // 点击背景关闭
            modal.onclick = function(e) {
                if (e.target === modal) modal.remove();
            };

            modal.appendChild(bar);
            modal.appendChild(imgWrap);
            modal.appendChild(tip);
            document.body.appendChild(modal);
        }
    } catch(e) {
        console.error('[export] error:', e);
        alert('导出失败：'+e.message+'\n请尝试使用截图工具保存。');
    }
}

// ====== 符文盘点击编辑（年月日时手动输入） ======
function attachRuneEdit() {
    document.querySelectorAll('#time-portal .rune-disc').forEach(disc => {
        const param = disc.dataset.param;  // "year" | "month" | "day" | "hour"
        const valueEl = disc.querySelector('.rune-value');
        if (!valueEl || !param) return;

        let editing = false;

        valueEl.style.pointerEvents = 'auto';
        valueEl.style.cursor = 'text';
        valueEl.title = '点击输入或滚轮调节';

        valueEl.addEventListener('click', (e) => {
            if (editing) return;
            // 忽略 spin 按钮冒上来的事件
            if (e.target.closest('.rune-spin') || e.target.closest('.quadrant-now')) return;

            editing = true;
            const inp = document.getElementById('param-' + param);
            const curVal = inp ? inp.value : valueEl.textContent;
            const discEl = disc;

            // 创建编辑包裹器
            const wrap = document.createElement('div');
            wrap.className = 'rune-edit-wrap';

            // 减号按钮
            const btnMinus = document.createElement('button');
            btnMinus.textContent = '−';
            btnMinus.className = 'rune-edit-btn';
            btnMinus.addEventListener('mousedown', (e2) => {
                e2.preventDefault(); e2.stopPropagation();
                adjustRuneValue(-1);
            });

            // 输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.pattern = '[0-9]*';
            input.value = curVal;
            input.className = 'rune-edit-input';

            // 加号按钮
            const btnPlus = document.createElement('button');
            btnPlus.textContent = '+';
            btnPlus.className = 'rune-edit-btn';
            btnPlus.addEventListener('mousedown', (e2) => {
                e2.preventDefault(); e2.stopPropagation();
                adjustRuneValue(1);
            });

            wrap.appendChild(btnMinus);
            wrap.appendChild(input);
            wrap.appendChild(btnPlus);

            // 隐藏原值，插入编辑器
            valueEl.style.visibility = 'hidden';
            discEl.appendChild(wrap);

            function adjustRuneValue(delta) {
                const hiddenInp = document.getElementById('param-' + param);
                const mn = parseInt(hiddenInp?.min) || (param === 'year' ? 1900 : param === 'hour' ? 0 : 1);
                const mx = parseInt(hiddenInp?.max) || (param === 'year' ? 2100 : param === 'hour' ? 23 : 12);
                let v = parseInt(input.value) || 0;
                v = Math.max(mn, Math.min(mx, v + delta));
                input.value = v;
                if (hiddenInp) hiddenInp.value = v;
            }

            function finishEdit() {
                const hiddenInp = document.getElementById('param-' + param);
                let v = parseInt(input.value);
                const mn = parseInt(hiddenInp?.min) || (param === 'year' ? 1900 : param === 'hour' ? 0 : 1);
                const mx = parseInt(hiddenInp?.max) || (param === 'year' ? 2100 : param === 'hour' ? 23 : 12);
                if (isNaN(v) || v < mn) v = mn;
                if (v > mx) v = mx;
                if (hiddenInp) hiddenInp.value = v;
                valueEl.textContent = v;
                valueEl.style.visibility = '';
                if (wrap.parentNode) wrap.remove();
                editing = false;

                // 小时跨子时处理
                if (param === 'hour') {
                    handleHourDayLink(parseInt(curVal) || 0, v);
                }
                portalFixDayMax();
                portalSyncDisplay();
            }

            input.addEventListener('blur', finishEdit);
            input.addEventListener('keydown', (e2) => {
                if (e2.key === 'Enter') { e2.preventDefault(); finishEdit(); }
                if (e2.key === 'Escape') {
                    e2.preventDefault();
                    // 取消编辑，恢复原值
                    const hiddenInp = document.getElementById('param-' + param);
                    valueEl.textContent = hiddenInp ? hiddenInp.value : curVal;
                    valueEl.style.visibility = '';
                    if (wrap.parentNode) wrap.remove();
                    editing = false;
                }
                if (e2.key === 'ArrowUp') { e2.preventDefault(); adjustRuneValue(1); }
                if (e2.key === 'ArrowDown') { e2.preventDefault(); adjustRuneValue(-1); }
            });

            setTimeout(() => { input.focus(); input.select(); }, 50);
        });
    });
}

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', () => {
    // 启动粒子星空
    Starfield.init();
    document.body.style.background = '';

    // 自动跳到当下时刻
    (function setNow() {
        const n = new Date();
        document.getElementById('param-year').value = n.getFullYear();
        document.getElementById('param-month').value = n.getMonth() + 1;
        document.getElementById('param-day').value = n.getDate();
        document.getElementById('param-hour').value = n.getHours();
        document.getElementById('param-minute').value = n.getMinutes();
        portalFixDayMax();
        portalSyncDisplay();
    })();

    // 加载遮罩渐隐
    setTimeout(() => {
        const veil = document.getElementById('loading-veil');
        if (veil) veil.classList.add('hidden');
    }, 800);

    // ====== 入口页事件（三维天眼） ======
    // 符文盘滚轮按钮
    document.querySelectorAll('#time-portal .rune-spin').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const disc = btn.closest('.rune-disc');
            if (!disc) return;
            const param = disc.dataset.param;
            const inp = document.getElementById('param-' + param);
            if (!inp) return;
            const oldHour = param === 'hour' ? (parseInt(inp.value) || 0) : null;
            const dir = btn.dataset.action === 'up' ? 1 : -1;
            let val = (parseInt(inp.value) || 0) + dir;
            const mn = parseInt(inp.min) || 0;
            const mx = parseInt(inp.max) || (param === 'year' ? 2100 : param === 'hour' ? 23 : param === 'minute' ? 59 : param === 'day' ? 31 : 12);
            if (val < mn) val = mx;
            if (val > mx) val = mn;
            inp.value = val;
            if (param === 'hour' && oldHour !== null) handleHourDayLink(oldHour, val);
            if (param === 'month' || param === 'year') portalFixDayMax();
            portalSyncDisplay();
        });
    });

    // 符文盘点击激活
    document.querySelectorAll('#time-portal .rune-disc').forEach(disc => {
        disc.addEventListener('click', (e) => {
            // 不处理 spin 按钮点击
            if (e.target.closest('.rune-spin') || e.target.closest('.quadrant-now')) return;
            document.querySelectorAll('#time-portal .rune-disc').forEach(d => d.classList.remove('active'));
            disc.classList.add('active');
        });
    });

    // 符文盘滚轮调节
    document.querySelectorAll('#time-portal .rune-disc').forEach(disc => {
        disc.addEventListener('wheel', (e) => {
            e.preventDefault();
            const param = disc.dataset.param;
            const inp = document.getElementById('param-' + param);
            if (!inp) return;
            const oldHour = param === 'hour' ? (parseInt(inp.value) || 0) : null;
            const dir = e.deltaY < 0 ? 1 : -1;
            let val = (parseInt(inp.value) || 0) + dir;
            const mn = parseInt(inp.min) || 0;
            const mx = parseInt(inp.max) || (param === 'year' ? 2100 : param === 'hour' ? 23 : param === 'minute' ? 59 : param === 'day' ? 31 : 12);
            if (val < mn) val = mx;
            if (val > mx) val = mn;
            inp.value = val;
            if (param === 'hour' && oldHour !== null) handleHourDayLink(oldHour, val);
            if (param === 'month' || param === 'year') portalFixDayMax();
            portalSyncDisplay();
        }, { passive: false });
    });

    // "此刻"快捷按钮（每个象限）
    document.querySelectorAll('#time-portal .quadrant-now').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const param = btn.dataset.param;
            const n = new Date();
            const map = {
                year: n.getFullYear(),
                month: n.getMonth() + 1,
                day: n.getDate(),
                hour: n.getHours(),
            };
            const inp = document.getElementById('param-' + param);
            if (inp && map[param] !== undefined) {
                inp.value = map[param];
                if (param === 'minute') inp.value = n.getMinutes();
                portalFixDayMax();
                portalSyncDisplay();
            }
        });
    });

    // 性别切换
    document.getElementById('info-sex').addEventListener('click', () => {
        const inp = document.getElementById('param-sex');
        const newVal = inp.value === '男' ? '女' : '男';
        inp.value = newVal;
        document.getElementById('info-sex-val').textContent = newVal;
    });

    // 生年编辑 — 横向输入，加减按钮 + 直接输入
    let birthEditMode = false;
    document.getElementById('info-birth').addEventListener('click', () => {
        if (birthEditMode) return;
        birthEditMode = true;
        const node = document.getElementById('info-birth');
        const valEl = document.getElementById('info-birth-val');
        const curVal = valEl.textContent;

        // 切换到横向编辑模式
        node.style.writingMode = 'horizontal-tb';
        node.style.overflow = 'visible';
        node.style.gap = '2px';
        node.style.padding = '6px 8px';
        node.style.width = 'auto';
        node.style.minWidth = '120px';
        node.style.minHeight = 'auto';
        node.style.height = 'auto';
        valEl.textContent = '';

        // 减号按钮
        const btnMinus = document.createElement('button');
        btnMinus.textContent = '−';
        btnMinus.className = 'birth-adj-btn';
        btnMinus.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); adjustBirth(-1); });
        btnMinus.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); adjustBirth(-1); });

        // 输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.value = curVal;
        input.className = 'birth-input';
        input.addEventListener('blur', () => finishBirthEdit(valEl, node));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finishBirthEdit(valEl, node); });
        input.addEventListener('click', (e) => e.stopPropagation());

        // 加号按钮
        const btnPlus = document.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.className = 'birth-adj-btn';
        btnPlus.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); adjustBirth(1); });
        btnPlus.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); adjustBirth(1); });

        valEl.appendChild(btnMinus);
        valEl.appendChild(input);
        valEl.appendChild(btnPlus);
        setTimeout(() => input.focus(), 100);
    });

    function adjustBirth(delta) {
        const input = document.querySelector('#info-birth-val .birth-input');
        if (!input) return;
        let v = parseInt(input.value) || 1990;
        v = Math.max(1, Math.min(2100, v + delta));
        input.value = v;
        document.getElementById('param-birth-year').value = v;
    }

    function finishBirthEdit(valEl, node) {
        const input = valEl.querySelector('.birth-input');
        const v = input ? (parseInt(input.value) || 1990) : 1990;
        document.getElementById('param-birth-year').value = v;
        // 恢复竖向布局
        node.style.writingMode = '';
        node.style.overflow = '';
        node.style.gap = '';
        node.style.padding = '';
        node.style.width = '';
        node.style.minWidth = '';
        node.style.minHeight = '';
        node.style.height = '';
        valEl.textContent = v;
        birthEditMode = false;
    }

    // ====== 干支日历面板 ======
    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth() + 1;
    let calSelected = null; // {year, month, day}

    async function calendarLoad(year, month) {
        calYear = year; calMonth = month;
        document.getElementById('cal-title').textContent = `${year}年 ${month}月`;
        const grid = document.getElementById('cal-grid');
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#a89a82;">加载中...</div>';
        try {
            const resp = await fetch(`/api/calendar/month?year=${year}&month=${month}`);
            const data = await resp.json();
            if (!data.success) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#C73E3A;">加载失败</div>`; return; }
            renderCalendar(data);
        } catch (e) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#C73E3A;">网络错误</div>`; }
    }

    function renderCalendar(data) {
        const grid = document.getElementById('cal-grid');
        const days = data.days;
        if (!days.length) return;

        // Python weekday: 0=Mon … 6=Sun → grid starts Sun(0), so offset = (wd+1)%7
        const firstWeekday = (days[0].weekday + 1) % 7;
        let html = '';
        for (let i = 0; i < firstWeekday; i++) {
            html += '<div class="cal-day-cell other-month"><span class="cal-day-num"></span></div>';
        }

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

        days.forEach(d => {
            const isToday = d.date === todayStr;
            const isSel = calSelected && calSelected.year === d.year && calSelected.month === d.month && calSelected.day === d.day;
            let cls = 'cal-day-cell';
            if (isToday) cls += ' today';
            if (isSel) cls += ' selected';
            html += `<div class="${cls}" data-date="${d.date}" data-year="${d.year}" data-month="${d.month}" data-day="${d.day}">
                <span class="cal-day-num">${d.day}</span>
                <span class="cal-day-gz">${d.ri_zhu}</span>
                <span class="cal-day-lunar">${d.lunar || ''}</span>
            </div>`;
        });

        grid.innerHTML = html;

        // 点击日期
        grid.querySelectorAll('.cal-day-cell:not(.other-month)').forEach(cell => {
            cell.addEventListener('click', () => {
                const y = parseInt(cell.dataset.year);
                const m = parseInt(cell.dataset.month);
                const d = parseInt(cell.dataset.day);
                calSelected = { year: y, month: m, day: d };
                document.getElementById('param-year').value = y;
                document.getElementById('param-month').value = m;
                document.getElementById('param-day').value = d;
                portalFixDayMax();
                portalSyncDisplay();
                document.getElementById('gz-calendar-panel').style.display = 'none';
            });
        });
    }

    // 打开日历面板
    document.getElementById('info-gz-panel').addEventListener('click', () => {
        const panel = document.getElementById('gz-calendar-panel');
        if (panel.style.display === 'none' || !panel.style.display) {
            // 同步到当前选中的年月
            const curY = parseInt(document.getElementById('param-year')?.value) || new Date().getFullYear();
            const curM = parseInt(document.getElementById('param-month')?.value) || new Date().getMonth() + 1;
            calSelected = { year: curY, month: curM, day: parseInt(document.getElementById('param-day')?.value) || 1 };
            calYear = curY; calMonth = curM;
            panel.style.display = 'block';
            calendarLoad(calYear, calMonth);
        } else {
            panel.style.display = 'none';
        }
    });

    // 关闭日历
    document.getElementById('btn-cal-close').addEventListener('click', () => {
        document.getElementById('gz-calendar-panel').style.display = 'none';
    });

    // 上/下月
    document.getElementById('btn-cal-prev').addEventListener('click', () => {
        if (calMonth === 1) { calMonth = 12; calYear--; }
        else calMonth--;
        calendarLoad(calYear, calMonth);
    });
    document.getElementById('btn-cal-next').addEventListener('click', () => {
        if (calMonth === 12) { calMonth = 1; calYear++; }
        else calMonth++;
        calendarLoad(calYear, calMonth);
    });

    // 今天按钮
    document.getElementById('btn-cal-today').addEventListener('click', () => {
        const n = new Date();
        calYear = n.getFullYear(); calMonth = n.getMonth() + 1;
        calSelected = { year: calYear, month: calMonth, day: n.getDate() };
        document.getElementById('param-year').value = calYear;
        document.getElementById('param-month').value = calMonth;
        document.getElementById('param-day').value = n.getDate();
        document.getElementById('param-hour').value = n.getHours();
        document.getElementById('param-minute').value = n.getMinutes();
        portalFixDayMax();
        portalSyncDisplay();
        document.getElementById('gz-calendar-panel').style.display = 'none';
    });

    // ====== 干支历搜索（四柱渐进筛选） ======
    let _gzSearchTimer = null;
    const gzSearch = async () => {
        const nian = document.getElementById('param-gz-nian')?.value.trim() || '';
        const yue = document.getElementById('param-gz-yue')?.value.trim() || '';
        const ri = document.getElementById('param-gz-ri')?.value.trim() || '';
        const shi = document.getElementById('param-gz-shi')?.value.trim() || '';
        const resDiv = document.getElementById('gz-results');

        // 至少有一个柱才搜索
        if (!nian && !yue && !ri && !shi) { resDiv.textContent = ''; return; }

        resDiv.textContent = '查询中...';
        try {
            const resp = await fetch('/api/ganzhi-search', {
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({nian_zhu:nian, yue_zhu:yue, ri_zhu:ri, shi_zhu:shi}),
            });
            const r = await resp.json();
            if (r.success && r.matches.length > 0) {
                const hasRi = ri.length >= 2;
                let html = '';

                if (!hasRi) {
                    // 年柱/月柱级别 → 列出选项供进一步筛选
                    const years = [...new Set(r.matches.map(m => m.date.slice(0,4)))];
                    const yearMonths = [...new Set(r.matches.map(m => m.date.slice(0,7)))];
                    html = '<span style="color:#a89a82;font-size:10px;">'
                        + (nian ? `${nian}年 ` : '') + (yue ? `${yue}月 ` : '')
                        + `匹配 ${years.length} 个年份 · ${yearMonths.length} 个月份</span><br>`;
                    // 列出匹配年份
                    years.forEach(y => {
                        html += `<span class="gz-link-year" data-year="${y}"
                            style="cursor:pointer;color:#D4A574;margin:2px 6px;font-size:12px;display:inline-block;">${y}</span>`;
                    });
                    // 如果有月柱，也列出具体月份
                    if (yue) {
                        html += '<br><span style="color:#a89a82;font-size:10px;">具体月份:</span> ';
                        r.matches.slice(0, 12).forEach(m => {
                            html += `<span class="gz-link-date" data-date="${m.date}" data-hour="${m.hour||12}"
                                style="cursor:pointer;color:#C73E3A;margin:2px 4px;font-size:10px;">${m.date.slice(0,7)}</span>`;
                        });
                    }
                } else {
                    // 日柱级别 → 列出具体日期
                    html = '<span style="color:rgba(168,154,130,0.5);font-size:10px;">'
                        + `匹配 ${r.matches.length} 个日期</span><br>`;
                    r.matches.forEach((m, i) => {
                        const sz = m.sizhu;
                        html += `<span class="gz-link-date" data-date="${m.date}" data-hour="${m.hour||12}"
                            style="cursor:pointer;color:${i===0?'#C73E3A':'#D4A574'};margin:2px 8px;font-size:11px;white-space:nowrap;display:inline-block;"
                            title="点击跳转">${m.date} ${sz['年柱']}${sz['月柱']}${sz['日柱']}${sz['时柱']}</span>`;
                    });
                }
                resDiv.innerHTML = html;

                // 点击年份 → 设置年 + 填入年柱输入框
                resDiv.querySelectorAll('.gz-link-year').forEach(el => {
                    el.addEventListener('click', () => {
                        const y = parseInt(el.dataset.year);
                        document.getElementById('param-year').value = y;
                        document.getElementById('param-gz-nian').value = r.matches[0]?.sizhu?.['年柱'] || '';
                        portalFixDayMax();
                        portalSyncDisplay();
                        resDiv.innerHTML = `<span style="color:#D4A574;font-size:10px;">已选 ${y} 年，可继续输入月/日/时柱缩小范围</span>`;
                    });
                });

                // 点击具体日期 → 设置全部参数 + 跳转
                resDiv.querySelectorAll('.gz-link-date').forEach(el => {
                    el.addEventListener('click', () => {
                        const [y,m,d] = el.dataset.date.split('-').map(Number);
                        const h = parseInt(el.dataset.hour) || 12;
                        document.getElementById('param-year').value = y;
                        document.getElementById('param-month').value = m;
                        document.getElementById('param-day').value = d;
                        document.getElementById('param-hour').value = h;
                        document.getElementById('param-minute').value = 0;
                        portalFixDayMax();
                        portalSyncDisplay();
                        document.getElementById('gz-calendar-panel').style.display = 'none';
                        setTimeout(() => enterBoard(), 400);
                    });
                });
            } else {
                resDiv.textContent = r.hint || '未找到匹配日期';
            }
        } catch(e) { resDiv.textContent = '查询出错'; }
    };

    // 在所有四柱输入框上绑定实时搜索（带防抖）
    ['param-gz-nian','param-gz-yue','param-gz-ri','param-gz-shi'].forEach(id => {
        const inp = document.getElementById(id);
        if (!inp) return;
        inp.addEventListener('input', () => {
            clearTimeout(_gzSearchTimer);
            const val = inp.value.trim();
            // 年/月/日柱输入2字符时触发，时柱0字符时也触发（跟随日柱）
            if (id === 'param-gz-shi') {
                _gzSearchTimer = setTimeout(gzSearch, 300);
            } else if (val.length === 0) {
                _gzSearchTimer = setTimeout(gzSearch, 300);
            } else if (val.length >= 2) {
                _gzSearchTimer = setTimeout(gzSearch, 300);
            }
        });
    });
    document.getElementById('btn-gz-search').addEventListener('click', gzSearch);

    // 太极球体点击效果
    document.getElementById('taiji3d').addEventListener('click', function() {
        this.classList.toggle('active');
        const fall = this.querySelector('.ren-fall');
        if (fall) {
            fall.style.animation = 'none';
            fall.offsetHeight;
            fall.style.animation = 'meteorFall 1.5s cubic-bezier(0.4,0,0.2,1) forwards';
        }
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        if (typeof Starfield !== 'undefined' && Starfield.burst) {
            Starfield.burst(cx, cy, 2.5);
        }
    });

    // 左侧四柱速查：点击 → 打开日历面板 + 填入对应柱进行搜索
    document.querySelectorAll('#time-portal .stick-node').forEach(node => {
        node.addEventListener('click', function() {
            const pillar = this.dataset.pillar;
            const val = this.textContent.trim();
            if (!pillar || !val || val.length < 2) return;

            // 打开日历面板
            const panel = document.getElementById('gz-calendar-panel');
            if (panel) panel.style.display = '';

            // 填入对应柱的输入框
            const inputMap = { nian: 'param-gz-nian', yue: 'param-gz-yue', ri: 'param-gz-ri', shi: 'param-gz-shi' };
            const inputId = inputMap[pillar];
            if (inputId) {
                const inp = document.getElementById(inputId);
                if (inp) { inp.value = val; inp.focus(); }
            }

            // 高亮当前点击
            document.querySelectorAll('#time-portal .stick-node').forEach(s => s.classList.remove('active'));
            this.classList.add('active');

            // 触发搜索
            if (typeof gzSearch === 'function') gzSearch();
        });
    });

    // 底部撕裂时空按钮
    document.getElementById('tear-portal-btn').addEventListener('click', function(e) {
        // 创建波纹
        const rect = this.getBoundingClientRect();
        const ripple = document.createElement('div');
        ripple.className = 'tear-ripple';
        ripple.style.left = (e.clientX || rect.left + rect.width/2) + 'px';
        ripple.style.top = (e.clientY || rect.top + rect.height/2) + 'px';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 1500);

        // 粒子爆发
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        if (typeof Starfield !== 'undefined' && Starfield.burst) {
            Starfield.burst(cx, cy, 3);
        }

        // 视觉反馈
        this.style.transform = 'translateY(8px)';
        this.style.opacity = '0.6';
        setTimeout(() => {
            this.style.transform = '';
            this.style.opacity = '';
            enterBoard();
        }, 150);
    });

    // ====== 面板页事件 ======
    // 换时滚轮
    $on('btn-shift-prev', 'click', () => shiftTime('prev'));
    $on('btn-shift-next', 'click', () => shiftTime('next'));

    // 工具栏事件委托在 #toolbar 上（而非 toolbar-actions），覆盖 brand 区域和 actions 区域所有按钮
    $on('toolbar', 'click', _toolbarClick);

    // 三传矫正弹窗
    $on('btn-apply-correct-sc', 'click', applyCorrectSC);
    $on('btn-cancel-correct-sc', 'click', hideCorrectSCModal);
    $on('btn-close-correct-sc', 'click', hideCorrectSCModal);
    $on('btn-reset-sc', 'click', resetSC);
    $on('correct-sc-modal', 'click', (e) => {
        if (e.target.id === 'correct-sc-modal') hideCorrectSCModal();
    });

    // 月将矫正弹窗
    $on('btn-apply-correct-yj', 'click', applyCorrectYJ);
    $on('btn-cancel-correct-yj', 'click', hideCorrectYJModal);
    $on('btn-close-correct-yj', 'click', hideCorrectYJModal);
    $on('correct-yj-modal', 'click', (e) => {
        if (e.target.id === 'correct-yj-modal') hideCorrectYJModal();
    });
    document.querySelectorAll('#correct-yj-modal .yj-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            _selectedYJ = btn.dataset.yj;
            document.querySelectorAll('#correct-yj-modal .yj-opt').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // 存储弹窗
    $on('btn-confirm-save', 'click', confirmSave);
    $on('btn-cancel-save', 'click', hideSaveModal);
    $on('btn-close-save', 'click', hideSaveModal);
    $on('btn-add-tag', 'click', () => {
        const input = document.getElementById('save-tag-input');
        if (input) addSaveTag(input.value);
    });
    $on('save-tag-input', 'keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const inp = document.getElementById('save-tag-input');
            if (inp) addSaveTag(inp.value);
        }
    });
    $on('save-modal', 'click', (e) => {
        if (e.target.id === 'save-modal') hideSaveModal();
    });

    // 笔记编辑器弹窗
    $on('btn-cancel-notes', 'click', hideNotesModal);
    $on('btn-close-notes', 'click', hideNotesModal);
    $on('btn-save-notes', 'click', savePersonalNotes);
    $on('notes-modal', 'click', (e) => {
        if (e.target.id === 'notes-modal') hideNotesModal();
    });
    $on('notes-editor', 'keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            savePersonalNotes();
        }
    });
    $on('save-name-input', 'keydown', (e) => {
        if (e.key === 'Enter') confirmSave();
    });

    // 案例库弹窗
    $on('btn-close-cases', 'click', () => {
        const el = document.getElementById('cases-modal');
        if (el) el.style.display = 'none';
    });

    // 历史记录弹窗
    $on('btn-close-history', 'click', hideHistory);
    $on('btn-clear-history', 'click', clearHistory);
    $on('btn-compare', 'click', compareCases);
    $on('btn-select-all', 'click', () => {
        const cbs = document.querySelectorAll('.case-cb');
        const all = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => cb.checked = !all);
        const selBtn = document.getElementById('btn-select-all');
        if (selBtn) selBtn.textContent = all ? '全选' : '取消';
    });

    // 分析视图
    $on('btn-analysis-save', 'click', saveAnalysis);
    document.body.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            const av = document.getElementById('analysis-view');
            if (av && av.classList.contains('active')) {
                e.preventDefault();
                saveAnalysis();
            }
        }
    });

    // 对比追问 + 个人风格
    const origSend = Chat.sendMessage.bind(Chat);
    const origSendWs = Chat._sendWs || null;
    Chat.sendMessage = async function(msg) {
        if (compareContext) {
            const done = await askCompareFollowUp(msg);
            if (done) return;
        }
        // 检查个人风格开关
        const useStyle = document.getElementById('chk-personal-style')?.checked;
        const wsOk = this.ws && this.ws.readyState === WebSocket.OPEN;
        if (wsOk) {
            this.addMessage('user', msg);
            this.ws.send(JSON.stringify({ type: 'chat', message: msg, use_personal_style: !!useStyle }));
            this.addMessage('system', useStyle ? 'AI 思考中（参考你的解读风格）...' : 'AI 思考中...');
        } else {
            origSend(msg);
        }
    };

    // 个人风格开关提示
    $on('chk-personal-style', 'change', function() {
        const hint = document.getElementById('style-hint');
        if (!hint) return;
        if (this.checked) {
            hint.style.display = '';
            fetch('/api/personal-style/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: currentPanData?.['三传']?.['方法'] || '', sanchuan: [], sike: [], max_cases: 1 }),
            }).then(r => r.json()).then(d => {
                if (d.success && d.count > 0) {
                    hint.textContent = `已找到 ${d.count} 个有笔记的类似案例可参考`;
                    hint.style.color = '#5a8a4a';
                } else {
                    hint.textContent = '暂无可参考的个人笔记（保存案例并写笔记后可用）';
                    hint.style.color = 'var(--bronze)';
                }
            }).catch(() => {});
        } else {
            hint.style.display = 'none';
        }
    });

    // 初始化各模块（各自隔离，互不影响）
    try { Chat.init(); } catch(e) { console.warn('[app] Chat.init 失败:', e); }
    try { Classics.init(); } catch(e) { console.warn('[app] Classics.init 失败:', e); }
    try { Chat.showWelcome(); } catch(e) { console.warn('[app] Chat.showWelcome 失败:', e); }
    try { connectWebSocket(); } catch(e) { console.warn('[app] WebSocket 连接失败:', e); }
    try { loadAllTags(); } catch(e) { console.warn('[app] 预加载标签失败:', e); }
    try { attachRuneEdit(); } catch(e) { console.warn('[app] rune-edit 初始化失败:', e); }
});
