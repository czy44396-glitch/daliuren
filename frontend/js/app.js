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
    'btn-export-html':     () => { if (currentLoadedCaseId) exportCaseHTML(currentLoadedCaseId); },
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
    var caseObj = _caseGet(currentLoadedCaseId);
    if (caseObj) {
        if (typeof NotesEditor !== 'undefined') NotesEditor.open(currentLoadedCaseId, caseObj);
        else openNotesEditor(currentLoadedCaseId, caseObj);
    }
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
    Chat.clear(); Chat.showWelcome();
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
// ====== 案例存储：Supabase云端 + localStorage本地缓存 ======
var _SB_URL = '', _SB_KEY = '';
const _CASE_KEY = 'liuren_case_index';
const _CASE_PFX = 'liuren_case_';

// 初始化时加载 Supabase 配置
function _initStorage() {
    fetch('/api/config').then(function(r) { return r.json(); }).then(function(cfg) {
        if (cfg.supabase_url && cfg.supabase_key) {
            _SB_URL = cfg.supabase_url;
            _SB_KEY = cfg.supabase_key;
            console.log('[storage] Supabase 已配置，启用云端同步');
            _syncFromCloud();
        }
    }).catch(function() {});
}

// 从云端拉取案例到本地
function _syncFromCloud() {
    if (!_SB_URL) return;
    fetch(_SB_URL + '/rest/v1/cases?select=*', {
        headers: { 'apikey': _SB_KEY, 'Authorization': 'Bearer ' + _SB_KEY }
    }).then(function(r) { return r.json(); }).then(function(rows) {
        if (!Array.isArray(rows)) return;
        var idx = [];
        rows.forEach(function(row) {
            var c = { id: row.id, name: row.name, tags: JSON.parse(row.tags||'[]'), created: row.created,
                pan_data: JSON.parse(row.pan_data||'{}'), personal_notes: row.personal_notes||'',
                personal_notes_updated: row.personal_notes_updated||'' };
            localStorage.setItem(_CASE_PFX + c.id, JSON.stringify(c));
            idx.unshift(_caseEntry(c));
        });
        _caseSaveIdx(idx);
        console.log('[storage] 云端同步完成: ' + rows.length + ' 条');
        loadAllTags();
        try { if (document.getElementById('cases-modal').style.display !== 'none') loadCaseList(); } catch(e) {}
    }).catch(function(e) { console.warn('[storage] 云端同步失败，使用本地缓存', e); });
}

// 云端保存单条案例
function _cloudPut(c) {
    if (!_SB_URL) return;
    var body = JSON.stringify({
        id: c.id, name: c.name, tags: JSON.stringify(c.tags||[]), created: c.created,
        pan_data: JSON.stringify(c.pan_data||{}), personal_notes: c.personal_notes||'',
        personal_notes_updated: c.personal_notes_updated||''
    });
    fetch(_SB_URL + '/rest/v1/cases?id=eq.' + encodeURIComponent(c.id), {
        method: 'PATCH', headers: { 'apikey': _SB_KEY, 'Authorization': 'Bearer ' + _SB_KEY,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: body
    }).catch(function() {}); // 失败静默，本地已保存
    // 也尝试 upsert（如果记录不存在则插入）
    fetch(_SB_URL + '/rest/v1/cases', {
        method: 'POST', headers: { 'apikey': _SB_KEY, 'Authorization': 'Bearer ' + _SB_KEY,
            'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }, body: body
    }).catch(function() {});
}

// 云端删除单条案例
function _cloudDel(id) {
    if (!_SB_URL) return;
    fetch(_SB_URL + '/rest/v1/cases?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE', headers: { 'apikey': _SB_KEY, 'Authorization': 'Bearer ' + _SB_KEY }
    }).catch(function() {});
}

// ---- 本地存储函数（本地为主，云端为辅） ----
function _caseList() { try { return JSON.parse(localStorage.getItem(_CASE_KEY) || '[]'); } catch(e) { return []; } }
function _caseSaveIdx(list) { localStorage.setItem(_CASE_KEY, JSON.stringify(list)); }
function _caseGet(id) { try { return JSON.parse(localStorage.getItem(_CASE_PFX + id)); } catch(e) { return null; } }
function _casePut(c) {
    try {
        localStorage.setItem(_CASE_PFX + c.id, JSON.stringify(c));
    } catch(e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            alert('案例库存储空间已满！请导出备份后清理旧案例。');
        }
        console.error('[case] 保存失败:', e);
        return;
    }
    var idx = _caseList(); var hit = false;
    for (var i = 0; i < idx.length; i++) { if (idx[i].id === c.id) { idx[i] = _caseEntry(c); hit = true; break; } }
    if (!hit) idx.unshift(_caseEntry(c));
    _caseSaveIdx(idx);
    _cloudPut(c);  // 后台同步到云端
}
function _caseDel(id) { localStorage.removeItem(_CASE_PFX + id); _caseSaveIdx(_caseList().filter(function(e) { return e.id !== id; })); _cloudDel(id); }
function _caseEntry(c) { return {id:c.id,name:c.name,tags:c.tags||[c.category||'其他'],created:c.created,has_notes:!!(c.personal_notes&&c.personal_notes.trim()),note_updated:c.personal_notes_updated||''}; }

let _saveTags = [];    // 当前正在编辑的标签列表
let _allTags = [];     // 所有已有标签（含使用次数）

function loadAllTags() {
    var idx = _caseList();
    var tc = {};
    idx.forEach(function(e) { var tags = e.tags || []; tags.forEach(function(t) { t = t.trim(); if (t) tc[t] = (tc[t]||0) + 1; }); });
    _allTags = Object.keys(tc).map(function(k) { return {name:k, count:tc[k]}; }).sort(function(a,b) { return b.count - a.count; });
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

function confirmSave() {
    var name = document.getElementById('save-name-input').value.trim();
    var tags = _saveTags.length > 0 ? _saveTags : ['其他'];
    hideSaveModal();
    var ts = new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
    var sz = (currentPanData['时间']||{})['四柱'] || {};
    var defName = (sz['年柱']||'')+'年'+(sz['月柱']||'')+'月'+(sz['日柱']||'')+'日'+(sz['时柱']||'')+'时';
    var caseObj = {
        id: ts, name: name || defName, tags: tags, category: tags[0],
        created: new Date().toISOString(), pan_data: currentPanData,
        personal_notes: '', personal_notes_updated: ''
    };
    _casePut(caseObj);
    currentLoadedCaseId = ts;
    Chat.addMessage('system', '案例已保存：' + caseObj.name + ' [' + tags.join('、') + ']。点击「✎ 我的解读」撰写个人笔记。');
    updateMyNotesBtn({ personal_notes: '' });
    loadAllTags();
}

function loadCaseList() {
    loadAllTags();
    var idx = _caseList();
    var list = document.getElementById('cases-list');
    var cases = idx;
    if (currentCategory) {
        cases = cases.filter(function(c) { return (c.tags || []).indexOf(currentCategory) >= 0; });
    }
    if (cases.length === 0) {
        list.innerHTML = '<div style="padding:20px;color:var(--text3)">' + (currentCategory ? '「'+currentCategory+'」暂无案例' : '暂无保存的案例') + '</div>';
        return;
    }
    list.innerHTML = '';
    cases.forEach(function(c) {
        var div = document.createElement('div');
        div.className = 'case-item';
        var tagHtml = (c.tags || []).map(function(t) { return '<span class="case-cat-tag" data-tag="'+t+'" style="cursor:pointer">'+t+'</span>'; }).join('');
        div.innerHTML = '<input type="checkbox" class="case-cb" value="'+c.id+'">' +
            '<span class="case-tags-wrap">'+tagHtml+'</span>' +
            '<span class="case-name">'+c.name+(c.has_notes?'<span class="case-has-notes" title="有个人笔记"></span>':'')+'</span>' +
            '<span class="case-date">'+(c.created||'').slice(0,16)+'</span>' +
            '<button class="btn btn-sm case-load" data-id="'+c.id+'">加载</button>' +
            '<button class="btn btn-sm case-btn-notes" data-id="'+c.id+'">笔记</button>' +
            '<button class="btn btn-sm case-rename" data-id="'+c.id+'" data-name="'+c.name.replace(/"/g,'&quot;')+'">改名</button>' +
            '<button class="btn btn-sm case-tags-edit" data-id="'+c.id+'">改标签</button>' +
            '<button class="btn btn-sm case-del" data-id="'+c.id+'">删</button>' +
            '<button class="btn btn-sm case-export-html" data-id="'+c.id+'" style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.25);color:#8b6914">导出</button>';
        list.appendChild(div);
    });

    // 标签点击筛选
    list.querySelectorAll('.case-cat-tag').forEach(function(el) {
        el.addEventListener('click', function(e) { e.stopPropagation(); setCategory(el.dataset.tag); });
    });

    // 加载案例
    list.querySelectorAll('.case-load').forEach(function(b) { b.addEventListener('click', function() {
        var caseObj = _caseGet(b.dataset.id);
        if (caseObj && caseObj.pan_data) {
            currentPanData = caseObj.pan_data;
            currentLoadedCaseId = caseObj.id;
            document.getElementById('board-container').innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
            renderBoard(currentPanData);
            Params.setInfo(currentPanData);
            var timeStr = caseObj.pan_data['时间']['公历'];
            var parts = timeStr.match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
            if (parts) Params.setDate(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]));
            document.getElementById('board-param-zhanshi').value = caseObj.pan_data['排盘参数']['占时'] || 'auto';
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
            document.getElementById('cases-modal').style.display = 'none';
            compareContext = null;
            Chat.clear(); Chat.addMessage('system', '已加载：'+caseObj.name);
            updateMyNotesBtn(caseObj);
            showCorrectSCBtn();
            resetAnalysisFields(); showViewButtons();
            loadAnalysisFromNotes(caseObj.personal_notes || '');
        }
    }); });

    // 改名
    list.querySelectorAll('.case-rename').forEach(function(b) { b.addEventListener('click', function() {
        var newName = prompt('新名称：', b.dataset.name);
        if (newName && newName !== b.dataset.name) {
            var caseObj = _caseGet(b.dataset.id);
            if (caseObj) { caseObj.name = newName; _casePut(caseObj); }
            loadCaseList();
        }
    }); });

    // 删除
    list.querySelectorAll('.case-del').forEach(function(b) { b.addEventListener('click', function() {
        if (!confirm('确认删除？')) return;
        _caseDel(b.dataset.id);
        loadCaseList();
    }); });

    // 笔记按钮
    list.querySelectorAll('.case-btn-notes').forEach(function(b) { b.addEventListener('click', function(e) {
        e.stopPropagation();
        var caseObj = _caseGet(b.dataset.id);
        if (caseObj) {
            if (typeof NotesEditor !== 'undefined') NotesEditor.open(b.dataset.id, caseObj);
            else openNotesEditor(b.dataset.id, caseObj);
        }
    }); });

    // 改标签按钮
    list.querySelectorAll('.case-tags-edit').forEach(function(b) { b.addEventListener('click', function(e) {
        e.stopPropagation();
        _showTagEditor(b.dataset.id);
    }); });

    // 导出HTML按钮
    list.querySelectorAll('.case-export-html').forEach(function(b) { b.addEventListener('click', function(e) {
        e.stopPropagation();
        exportCaseHTML(b.dataset.id);
    }); });
}

// 案例标签编辑弹窗
function _showTagEditor(caseId) {
    var caseObj = _caseGet(caseId);
    if (!caseObj) return;
    var curTags = caseObj.tags || [];

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,20,0.8);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var box = document.createElement('div');
    box.style.cssText = 'background:#fefcf7;border-radius:12px;padding:18px;max-width:400px;width:90vw';
    box.onclick = function(e) { e.stopPropagation(); };

    var title = document.createElement('div');
    title.textContent = '修改标签 — ' + caseObj.name;
    title.style.cssText = 'font-size:15px;color:#1a1614;margin-bottom:12px;font-family:"Noto Serif SC",serif;letter-spacing:1px';
    box.appendChild(title);

    // 当前标签
    var curDiv = document.createElement('div');
    curDiv.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;min-height:24px';
    curDiv.id = 'tag-editor-current';
    box.appendChild(curDiv);

    // 自定义输入
    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;margin-bottom:12px';
    var input = document.createElement('input');
    input.type = 'text'; input.placeholder = '输入新标签...';
    input.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #e0d5c1;border-radius:6px;font-size:13px;font-family:inherit;color:#3a3632';
    var addBtn = document.createElement('button');
    addBtn.textContent = '添加';
    addBtn.style.cssText = 'padding:6px 12px;background:rgba(58,54,50,0.06);border:1px solid rgba(58,54,50,0.15);border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;color:#3a3632';
    inputRow.appendChild(input); inputRow.appendChild(addBtn);
    box.appendChild(inputRow);

    // 已有标签建议
    loadAllTags();
    var sugDiv = document.createElement('div');
    sugDiv.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;max-height:80px;overflow-y:auto';
    _allTags.forEach(function(t) { if (curTags.indexOf(t.name) < 0) {
        var tb = document.createElement('span');
        tb.textContent = t.name; tb.style.cssText = 'padding:2px 8px;background:rgba(58,54,50,0.04);border:1px solid rgba(58,54,50,0.1);border-radius:10px;cursor:pointer;font-size:11px;color:#6b6560;white-space:nowrap';
        tb.onclick = function() { if (curTags.indexOf(t.name) < 0) { curTags.push(t.name); renderCurTags(); } };
        sugDiv.appendChild(tb);
    }});
    box.appendChild(sugDiv);

    function renderCurTags() {
        curDiv.innerHTML = curTags.map(function(t) {
            return '<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 10px;background:rgba(199,62,58,0.1);border:1px solid rgba(199,62,58,0.3);border-radius:12px;font-size:12px;color:#C73E3A;white-space:nowrap">'+t+'<span style="cursor:pointer;font-weight:bold;margin-left:3px" data-tag="'+t+'" class="tag-editor-remove">&times;</span></span>';
        }).join('');
        curDiv.querySelectorAll('.tag-editor-remove').forEach(function(s) {
            s.onclick = function() { curTags = curTags.filter(function(x) { return x !== s.dataset.tag; }); renderCurTags(); };
        });
    }
    renderCurTags();

    addBtn.onclick = function() {
        var t = input.value.trim(); if (!t || curTags.indexOf(t) >= 0) return;
        curTags.push(t); renderCurTags(); input.value = '';
    };
    input.onkeydown = function(e) { if (e.key === 'Enter') { addBtn.click(); } };

    // 按钮行
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消'; cancelBtn.style.cssText = 'padding:6px 16px;background:rgba(58,54,50,0.04);border:1px solid rgba(58,54,50,0.12);border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;color:#6b6560';
    cancelBtn.onclick = function() { overlay.remove(); };
    var saveBtn = document.createElement('button');
    saveBtn.textContent = '保存'; saveBtn.style.cssText = 'padding:6px 20px;background:#b83a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600';
    saveBtn.onclick = function() {
        var finalTags = curTags.length > 0 ? curTags : ['其他'];
        caseObj.tags = finalTags; caseObj.category = finalTags[0];
        _casePut(caseObj);
        loadAllTags();
        buildFilterBar();
        loadCaseList();
        overlay.remove();
    };
    btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(function() { input.focus(); }, 100);
}

async function compareCases() {
    var checked = document.querySelectorAll('.case-cb:checked');
    var ids = Array.from(checked).map(function(cb) { return cb.value; });
    if (ids.length < 2) {
        var h = document.getElementById('compare-hint');
        h.textContent = '请至少勾选2个案例'; h.style.color = 'var(--red)';
        setTimeout(function() { h.textContent = '勾选2+案例后点击对比'; h.style.color = 'var(--text3)'; }, 2000);
        return;
    }
    var question = '请找出这些案例的共同特征和关键规律，特别注意三传、六亲、天将的重复模式';
    document.getElementById('cases-modal').style.display = 'none';
    Chat.clear(); Chat.addMessage('system', '正在对比 ' + ids.length + ' 个案例...');
    try {
        var resp = await fetch('/api/cases/compare', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids:ids, question:question}),
        });
        var r = await resp.json();
        if (r.success) {
            compareContext = {ids:ids, analysis: r.analysis};
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

function showCases() {
    document.getElementById('cases-modal').style.display = 'flex';
    loadAllTags();
    buildFilterBar();
    loadCaseList();
}

function buildFilterBar() {
    _mergeCustomTags();
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
    var cat = prompt('新建子库标签名称：', '');
    if (!cat || !cat.trim()) return;
    var tag = cat.trim();

    // 添加到本地标签列表
    if (!_allTags.find(function(t) { return t.name === tag; })) {
        _allTags.push({ name: tag, count: 0 });
    }

    // 持久化到 localStorage（跨会话保留）
    var savedTags = [];
    try {
        savedTags = JSON.parse(localStorage.getItem('liuren_custom_tags') || '[]');
    } catch(e) { savedTags = []; }
    if (savedTags.indexOf(tag) === -1) {
        savedTags.push(tag);
        localStorage.setItem('liuren_custom_tags', JSON.stringify(savedTags));
    }

    currentCategory = tag;
    buildFilterBar();
    loadCaseList();
}

// 在 buildFilterBar 中合并 localStorage 持久化标签
function _mergeCustomTags() {
    try {
        var saved = JSON.parse(localStorage.getItem('liuren_custom_tags') || '[]');
        saved.forEach(function(t) {
            if (!_allTags.find(function(x) { return x.name === t; })) {
                _allTags.push({ name: t, count: 0 });
            }
        });
    } catch(e) {}
}

// ====== 个人解读笔记 ======
let _notesCaseId = null;
let _notesCaseName = '';
let _notesDomain = 'general';

function openNotesEditor(caseId, caseData) {
    _notesCaseId = caseId;
    _notesCaseName = caseData.name || '';

    // 检测领域：推命 vs 占卜
    var tags = caseData.tags || [];
    var domain = 'general';
    var domainLabel = '';
    var domainTag = document.getElementById('notes-domain-tag');
    var destinyKW = ['推命','命理','命盘','命运','八字','出生','本命','大运','流年'];
    var divKW = ['占卜','占问','事占','占验','事件','预测','吉凶','卜问'];
    for (var i = 0; i < tags.length; i++) {
        var t = tags[i];
        for (var j = 0; j < destinyKW.length; j++) { if (t.indexOf(destinyKW[j]) >= 0) { domain = 'destiny'; break; } }
        if (domain === 'destiny') break;
        for (var k = 0; k < divKW.length; k++) { if (t.indexOf(divKW[k]) >= 0) { domain = 'divination'; break; } }
        if (domain === 'divination') break;
    }
    if (domain === 'destiny') {
        domainLabel = '推命';
        if (domainTag) { domainTag.style.display = ''; domainTag.textContent = '🔮 推命'; domainTag.style.background = 'rgba(184,58,46,0.08)'; domainTag.style.color = '#b83a2e'; }
    } else if (domain === 'divination') {
        domainLabel = '占卜';
        if (domainTag) { domainTag.style.display = ''; domainTag.textContent = '🔯 占卜'; domainTag.style.background = 'rgba(45,138,86,0.08)'; domainTag.style.color = '#2d8a56'; }
    } else {
        if (domainTag) domainTag.style.display = 'none';
    }
    _notesDomain = domain;

    document.getElementById('notes-case-label').textContent = '✎ 个人解读笔记 — ' + _notesCaseName;

    var editor = document.getElementById('notes-editor');
    var outcomeEl = document.getElementById('notes-outcome');
    // 根据领域调整实际结果占位符
    if (domain === 'destiny') {
        outcomeEl.placeholder = '【推命反推】已知的实际人生轨迹：此命主后来...（用于校验命盘解读）';
    } else if (domain === 'divination') {
        outcomeEl.placeholder = '【占卜反推】已知的实际发展结果：此事后来...（用于校验占断准确度）';
    } else {
        outcomeEl.placeholder = '已知的实际结果（反推用）：后来实际发生了什么？...';
    }
    var statusEl = document.getElementById('notes-status');
    statusEl.textContent = '';
    statusEl.className = '';
    editor.value = caseData.personal_notes || '';
    outcomeEl.value = caseData.actual_outcome || '';

    // 在左面板渲染完整盘面（天地盘 + 四课 + 三传）
    var panData = caseData.pan_data;
    var previewEl = document.getElementById('notes-pan-preview');
    if (panData && previewEl) {
        var savedPan = currentPanData;
        currentPanData = panData;

        var html = '<svg id="notes-preview-svg" viewBox="0 0 660 600" style="width:100%;height:auto"></svg>';

        // 四课 mini 卡片
        var sike = panData['四课详情'] || [];
        var dgAll = panData['遁干'] || {};
        var tjAll = panData['十二天将'] || {};
        var xk = panData['旬空'] || [];
        var DZC_m = {'子':'#1a3a5c','亥':'#1a3a5c','丑':'#7D5A3C','未':'#7D5A3C','辰':'#7D5A3C','戌':'#7D5A3C','巳':'#c94043','午':'#c94043','寅':'#2d7d46','卯':'#2d7d46','申':'#D4A017','酉':'#D4A017'};
        var TJS_m = {'贵人':'贵','螣蛇':'蛇','朱雀':'朱','六合':'合','勾陈':'勾','青龙':'龙','天空':'空','白虎':'虎','太常':'常','玄武':'玄','太阴':'阴','天后':'后'};

        if (sike.length) {
            html += '<div style="display:flex;gap:6px;margin-top:8px">';
            for (var si = 0; si < sike.length; si++) {
                var sk = sike[si];
                var sn = sk['上神'], dp = sk['地盘'];
                var snK = xk.indexOf(sn) >= 0;
                var dg = dgAll[sn] || '';
                var tjF = tjAll[sk['地盘地支']||sk['地盘']] || '';
                html += '<div style="flex:1;text-align:center;padding:6px 4px;background:#fefcf7;border:1px solid #e0d5c1;border-radius:6px">';
                html += '<div style="font-size:10px;color:#9c8b72">'+dg+' '+ (TJS_m[tjF]||'') +'</div>';
                html += '<div style="font-size:28px;font-weight:700;color:'+(snK?'#bbb':(DZC_m[sn]||'#2c2416'))+'">'+sn+'</div>';
                html += '<div style="font-size:18px;font-weight:700;color:'+(DZC_m[dp]||'#2c2416')+'">'+dp+'</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        // 三传 mini
        var sanc = panData['三传'] || {};
        if (sanc['初传']) {
            var scZ = [sanc['初传'],sanc['中传'],sanc['末传']];
            html += '<div style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:6px;font-family:serif">';
            for (var ii = 0; ii < 3; ii++) {
                var zclr = DZC_m[scZ[ii]] || '#2c2416';
                html += '<span style="display:inline-block;width:36px;height:36px;line-height:36px;border-radius:50%;border:2px solid '+zclr+';color:'+zclr+';font-size:22px;font-weight:700;text-align:center;background:#fff">'+scZ[ii]+'</span>';
                if (ii < 2) html += '<span style="color:#b83a2e;font-weight:bold">→</span>';
            }
            html += '<span style="font-size:11px;color:#6b5e4a;margin-left:4px">'+ (sanc['方法']||'') +'课</span>';
            html += '</div>';
        }

        previewEl.innerHTML = html;

        // 渲染天地盘 SVG
        _renderTiandiPanSVG_to(panData, 'notes-preview-svg');

        currentPanData = savedPan;
    } else if (previewEl) {
        previewEl.innerHTML = '<div class="notes-pan-placeholder">无盘面数据</div>';
    }

    // 自动保存：停止输入2秒后自动保存
    var autoSaveTimer = null;
    editor.addEventListener('input', function() {
        if (!_notesCaseId) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(function() {
            savePersonalNotes(true);
        }, 2000);
    });

    document.getElementById('notes-modal').style.display = 'flex';

    if (caseData.personal_notes && caseData.personal_notes.trim()) {
        statusEl.textContent = '上次更新：' + ((caseData.personal_notes_updated || '').slice(0, 16));
    }
    setTimeout(function() { editor.focus(); }, 200);
}

// 辅助：渲染天地盘到指定 SVG 元素（含四柱居中显示）
// 辅助：渲染天地盘到指定 SVG 元素（使用全局常量，消除重复代码）
function _renderTiandiPanSVG_to(data, svgId) {
    var svg = document.getElementById(svgId);
    if (!svg || !data) return;

    var _LR = window._LR || {};
    var DZ = _LR.DZ || ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    var DZC = _LR.DZC || {};
    var TJS = _LR.TJS || {};
    var TJC = _LR.TJC || {};
    var POS = _LR.POS || {};

    var td = data['天地盘'] || {};
    var tj = data['十二天将'] || {};
    var dg = data['遁干'] || {};
    var xk = data['旬空'] || [];
    var sizhu = (data['时间'] || {})['四柱'] || {};

    var W = 660, H = 600;
    var ox = 38, oy = 28;
    var cw = 140, ch = 128, gap = 12;

    var h = '<defs><marker id="ah3" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#8b1a2b"/></marker></defs>';
    h += '<rect width="'+W+'" height="'+H+'" fill="#fdfaf3" rx="4"/>';

    for (var i = 0; i < DZ.length; i++) {
        var di = DZ[i];
        var pos = POS[di];
        var tian = td[di] || '';
        var jiang = tj[di] || '';
        var dun = dg[tian] || '';
        var clrDi = DZC[di] || '#2c2416';
        var clrTian = DZC[tian] || '#2c2416';
        var tianK = xk.indexOf(tian) >= 0;
        var diK = xk.indexOf(di) >= 0;
        var cx = ox + pos[1]*(cw+gap);
        var cy = oy + pos[0]*(ch+gap);

        h += '<rect x="'+cx+'" y="'+cy+'" width="'+cw+'" height="'+ch+'" rx="5" fill="#fefcf7" stroke="'+clrDi+'" stroke-width="2"/>';
        var tjS = TJS[jiang] || '';
        var tjClr = TJC[jiang] || '#8b1a2b';
        h += '<text x="'+(cx+cw/2)+'" y="'+(cy+ch/2-38)+'" font-size="11" fill="#6b5e4a" font-family="serif" text-anchor="middle">'+dun+'</text>';
        h += '<text x="'+(cx+cw/2)+'" y="'+(cy+ch/2-20)+'" font-size="18" fill="'+tjClr+'" font-family="sans-serif" font-weight="600" text-anchor="middle">'+tjS+'</text>';
        if (tianK) h += '<circle cx="'+(cx+cw/2)+'" cy="'+(cy+ch/2+7)+'" r="22" fill="none" stroke="'+clrTian+'" stroke-width="1.5" stroke-dasharray="4 3"/>';
        h += '<text x="'+(cx+cw/2)+'" y="'+(cy+ch/2+16)+'" font-size="28" font-weight="700" fill="'+(tianK?'#bbb':clrTian)+'" font-family="serif" text-anchor="middle">'+tian+'</text>';
        if (diK) h += '<rect x="'+(cx+cw-29)+'" y="'+(cy+ch-23)+'" width="16" height="16" rx="2" fill="none" stroke="'+clrDi+'" stroke-width="1.5" stroke-dasharray="3 3"/>';
        h += '<text x="'+(cx+cw-14)+'" y="'+(cy+ch-10)+'" font-size="14" font-weight="600" fill="'+(diK?'#bbb':clrDi)+'" font-family="serif" text-anchor="end">'+di+'</text>';
    }

    h += '<text x="'+(ox+1*(cw+gap)+cw/2)+'" y="'+(oy-10)+'" font-size="12" fill="#c4b393" font-family="serif" text-anchor="middle">南 (午)</text>';
    h += '<text x="'+(ox+2*(cw+gap)+cw/2)+'" y="'+(oy+3*(ch+gap)+ch+14)+'" font-size="12" fill="#c4b393" font-family="serif" text-anchor="middle">北 (子)</text>';

    var cxB = ox + 1.5*(cw+gap) + cw/2;
    var cyB = oy + 1.5*(ch+gap) + ch/2;
    var pillars = ['年柱','月柱','日柱','时柱'];
    var szTexts = [];
    for (var pi = 0; pi < pillars.length; pi++) { szTexts.push(sizhu[pillars[pi]] || '--'); }
    h += '<text x="'+cxB+'" y="'+(cyB-15)+'" font-size="13" fill="#8b1a2b" font-family="serif" font-weight="600" text-anchor="middle">'+szTexts[0]+' '+szTexts[1]+'</text>';
    h += '<text x="'+cxB+'" y="'+(cyB+8)+'" font-size="13" fill="#8b1a2b" font-family="serif" font-weight="600" text-anchor="middle">'+szTexts[2]+' '+szTexts[3]+'</text>';
    h += '<text x="'+cxB+'" y="'+(cyB+24)+'" font-size="9" fill="#9c8b72" font-family="sans-serif" text-anchor="middle">四柱</text>';

    svg.innerHTML = h;
}

function hideNotesModal() {
    document.getElementById('notes-modal').style.display = 'none';
    _notesCaseId = null;
}

function savePersonalNotes(silent) {
    if (!_notesCaseId) return;
    var notes = document.getElementById('notes-editor').value;
    var outcome = document.getElementById('notes-outcome')?.value || '';
    var statusEl = document.getElementById('notes-status');
    if (!silent) { statusEl.textContent = '保存中...'; statusEl.className = ''; }
    var caseObj = _caseGet(_notesCaseId);
    if (!caseObj) { statusEl.textContent = '保存失败：案例不存在'; return; }
    caseObj.personal_notes = notes;
    caseObj.actual_outcome = outcome;
    caseObj.personal_notes_updated = new Date().toISOString();
    _casePut(caseObj);
    if (silent) {
        statusEl.textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
        statusEl.className = 'saved';
    } else {
        statusEl.textContent = '已保存 ✓';
        statusEl.className = 'saved';
        setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
    }
}

function updateMyNotesBtn(caseData) {
    const btn = document.getElementById('btn-my-notes');
    if (!btn) return;
    const btnExp = document.getElementById('btn-export-html');
    if (currentLoadedCaseId) {
        btn.style.display = '';
        const hasNotes = caseData && caseData.personal_notes && caseData.personal_notes.trim();
        btn.classList.toggle('has-notes', !!hasNotes);
        btn.title = hasNotes ? '编辑个人解读笔记（已有内容）' : '撰写个人解读笔记';
        if (btnExp) btnExp.style.display = '';
    } else {
        btn.style.display = 'none';
        btn.classList.remove('has-notes');
        if (btnExp) btnExp.style.display = 'none';
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
    document.getElementById('btn-export-html').style.display = '';
    switchToBoardView();
}

function hideViewButtons() {
    document.getElementById('btn-view-board').style.display = 'none';
    document.getElementById('btn-view-analysis').style.display = 'none';
    document.getElementById('btn-export-html').style.display = 'none';
}

function resetAnalysisFields() {
    ['af-keshi','af-sanchuan','af-sike','af-shensha','af-zonghe'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

// ====== 分析笔记面板 ======

function saveAnalysis() {
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

    var caseObj = _caseGet(currentLoadedCaseId);
    if (!caseObj) { statusEl.textContent = '保存失败：案例数据丢失'; return; }
    caseObj.personal_notes = md;
    caseObj.personal_notes_updated = new Date().toISOString();
    _casePut(caseObj);
    statusEl.textContent = '已保存 ✓';
    statusEl.className = 'saved';
    var myNotesBtn = document.getElementById('btn-my-notes');
    if (myNotesBtn) myNotesBtn.classList.add('has-notes');
    setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
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

        // 满幅纵向 2x 视网膜高清
        var W = 1200, H = 1220, DPR = 2;
        var canvas = document.createElement('canvas');
        canvas.width = W * DPR; canvas.height = H * DPR;
        var ctx = canvas.getContext('2d');
        ctx.scale(DPR, DPR);
        // 启用高质量文本渲染
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#f7f3eb';
        ctx.fillRect(0, 0, W, H);

        var DZC_map = {'子':'#1a3a5c','亥':'#1a3a5c','丑':'#7D5A3C','未':'#7D5A3C','辰':'#7D5A3C','戌':'#7D5A3C','巳':'#c94043','午':'#c94043','寅':'#2d7d46','卯':'#2d7d46','申':'#D4A017','酉':'#D4A017'};
        var TJS_map = {'贵人':'贵','螣蛇':'蛇','朱雀':'朱','六合':'合','勾陈':'勾','青龙':'龙','天空':'空','白虎':'虎','太常':'常','玄武':'玄','太阴':'阴','天后':'后'};
        var TJC_map = {'贵人':'#7D5A3C','天空':'#7D5A3C','勾陈':'#7D5A3C','太常':'#7D5A3C','青龙':'#2d7d46','六合':'#2d7d46','白虎':'#D4A017','太阴':'#D4A017','天后':'#1a3a5c','玄武':'#1a3a5c','螣蛇':'#c94043','朱雀':'#c94043'};
        var DZ_list = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
        var POS_map = {'巳':[0,0],'午':[0,1],'未':[0,2],'申':[0,3],'辰':[1,0],'酉':[1,3],'卯':[2,0],'戌':[2,3],'寅':[3,0],'丑':[3,1],'子':[3,2],'亥':[3,3]};

        // 六亲计算辅助
        var GAN_WX = {'甲':'木','乙':'木','丙':'火','丁':'火','戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水'};
        var ZHI_ZQ = {'子':'癸','丑':'己','寅':'甲','卯':'乙','辰':'戊','巳':'丙','午':'丁','未':'己','申':'庚','酉':'辛','戌':'戊','亥':'壬'};
        var WX_LQ = {'生我':'父母','比和':'兄弟','我克':'妻财','克我':'官鬼','我生':'子孙'};
        var WX_KE = {'木':'土','土':'水','水':'火','火':'金','金':'木'};
        var WX_SHENG = {'木':'火','火':'土','土':'金','金':'水','水':'木'};
        function _lq(riGan, zhi) {
            var w = GAN_WX[riGan]||'', t = GAN_WX[ZHI_ZQ[zhi]]||'';
            if (!w||!t||w===t) return w===t?'兄弟':'';
            if (WX_SHENG[w]===t) return '子孙';
            if (WX_SHENG[t]===w) return '父母';
            if (WX_KE[w]===t) return '妻财';
            if (WX_KE[t]===w) return '官鬼';
            return '';
        }

        // ===== 顶部信息栏：四柱 + 公历时间 =====
        var infoX = 20, infoY = 14;
        var pillars = ['年柱','月柱','日柱','时柱'];
        pillars.forEach(function(k, i) {
            var gz = sz[k] || '--';
            var x = infoX + i * 90;
            ctx.textAlign = 'center';
            ctx.font = 'bold 18px "Noto Serif SC",serif';
            ctx.fillStyle = '#b8860b';
            ctx.fillText(gz[0]||'', x, infoY + 16);
            ctx.fillStyle = '#8b1a2b';
            ctx.fillText(gz[1]||'', x, infoY + 38);
            ctx.fillStyle = '#9c8b72';
            ctx.font = '10px "Noto Sans SC",sans-serif';
            ctx.fillText(k[0], x, infoY + 52);
        });

        // 时间/节气/课式/公历（四柱下方一行）
        ctx.textAlign = 'left';
        ctx.fillStyle = '#6b6560';
        ctx.font = 'bold 13px "Noto Serif SC",serif';
        ctx.fillText(pm['月将']+'将  ·  '+jq['当前节气']+'→'+jq['下一节气']+'  ·  '+sj['昼夜']+'  ·  '+sc['方法']+'课  ·  '+sj['公历'], infoX, infoY + 78);

        // ===== 天地盘（最大化，156×130格） =====
        var cw = 160, ch = 130, cgap = 5;
        var boardW = 4*cw + 3*cgap;
        var boardH = 4*ch + 3*cgap;
        var boardX = Math.floor((W - boardW) / 2);
        var boardY = 98;

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
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, 5); ctx.stroke();

            // 遁干（顶部居中）
            ctx.fillStyle = '#6b5e4a';
            ctx.font = 'bold 13px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(dun, midX, midY - 29);

            // 神将
            var tjS = TJS_map[jiang] || '';
            ctx.fillStyle = TJC_map[jiang] || '#8b1a2b';
            ctx.font = 'bold 18px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(tjS, midX, midY - 7);

            // 天盘地支
            if (tianK) {
                ctx.beginPath(); ctx.arc(midX, midY+22, 21, 0, Math.PI*2);
                ctx.strokeStyle = clrTian; ctx.lineWidth = 1.5;
                ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.fillStyle = tianK ? '#bbb' : clrTian;
            ctx.font = 'bold 28px "Noto Serif SC",serif';
            ctx.fillText(tian, midX, midY + 30);

            // 地盘地支
            if (diK) {
                ctx.beginPath(); ctx.roundRect(cx+cw-27, cy+ch-21, 15, 15, 2);
                ctx.strokeStyle = clrDi; ctx.lineWidth = 1.5;
                ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.fillStyle = diK ? '#bbb' : clrDi;
            ctx.font = 'bold 14px "Noto Serif SC",serif';
            ctx.textAlign = 'end';
            ctx.fillText(di, cx+cw-14, cy+ch-7);
            ctx.textAlign = 'center';
        }

        ctx.fillStyle = '#c4b393';
        ctx.font = '11px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText('南（午）', boardX + 1*(cw+cgap) + cw/2, boardY - 8);
        ctx.fillText('北（子）', boardX + 2*(cw+cgap) + cw/2, boardY + boardH + 16);

        // ===== 四课（反序：与排盘页一致，日干侧在右） =====
        var sikeY = boardY + boardH + 28;
        var cellW = 245, cellH = 170, cellGap = 8;
        var sikeTotalW = 4*cellW + 3*cellGap;
        var sikeX = Math.floor((W - sikeTotalW) / 2);

        // 反序遍历：si=3(第四课最左) → 0(第一课最右)
        for (var si = 3; si >= 0; si--) {
            var sk = sike[si];
            var sn = sk['上神'];
            var dp = sk['地盘'];
            var snKong = xk.indexOf(sn) >= 0;
            var clrSn = snKong ? '#bbb' : (DZC_map[sn] || '#2c2416');
            var clrDp = DZC_map[dp] || '#2c2416';
            var dg = dgAll[sn] || '';
            var tjFull = tjAll[sk['地盘地支']||sk['地盘']] || '';
            var tj = TJS_map[tjFull] || '';
            // 渲染位置按反序计算：si=3→pos0, si=2→pos1, si=1→pos2, si=0→pos3
            var renderPos = 3 - si;
            var sx = sikeX + renderPos*(cellW+cellGap);
            var scx = sx + cellW/2;
            var pad = (cellH - 136) / 2;

            ctx.fillStyle = '#fefcf7';
            ctx.fillRect(sx, sikeY, cellW, cellH);
            ctx.strokeStyle = '#e0d5c1';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx, sikeY, cellW, cellH);

            ctx.fillStyle = '#9c8b72';
            ctx.font = 'bold 13px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(dg, scx, sikeY + pad + 16);

            ctx.fillStyle = '#8b1a2b';
            ctx.font = 'bold 15px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(tj, scx, sikeY + pad + 34);

            ctx.fillStyle = clrSn;
            ctx.font = 'bold 40px "Noto Serif SC",serif';
            ctx.fillText(sn, scx, sikeY + pad + 82);

            ctx.fillStyle = clrDp;
            ctx.font = 'bold 34px "Noto Serif SC",serif';
            ctx.fillText(dp, scx, sikeY + pad + 130);
        }

        // ===== 三传（纵排：含六亲·神将·遁干） =====
        var sanTop = sikeY + cellH + 24;
        var scR = 30;
        var sanCX = W/2;  // 居中
        var sanGap = 82;  // 圆心间距
        var sanCY_start = sanTop + scR + 4;

        var scLQ = data['三传六亲'] || {};
        var scTJ = data['三传天将'] || {};
        var sanItems = [
            {z:sc['初传'],l:'初传',q:scLQ['初传']||'',j:scTJ['初传']||'',d:dgAll[sc['初传']]||''},
            {z:sc['中传'],l:'中传',q:scLQ['中传']||'',j:scTJ['中传']||'',d:dgAll[sc['中传']]||''},
            {z:sc['末传'],l:'末传',q:scLQ['末传']||'',j:scTJ['末传']||'',d:dgAll[sc['末传']]||''}
        ];

        for (var ii = 0; ii < 3; ii++) {
            var sit = sanItems[ii];
            var scy = sanCY_start + ii * sanGap;
            var clr = DZC_map[sit.z] || '#2c2416';
            if (xk.indexOf(sit.z) >= 0) clr = '#bbb';

            // 箭头（圆之间）
            if (ii > 0) {
                ctx.fillStyle = '#b83a2e';
                ctx.font = 'bold 20px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('↓', sanCX, scy - scR - 14);
            }

            // 左侧：遁干
            ctx.fillStyle = '#9c8b72';
            ctx.font = 'bold 13px "Noto Serif SC",serif';
            ctx.textAlign = 'right';
            ctx.fillText(sit.d, sanCX - scR - 16, scy + 6);

            // 圆 + 地支
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(sanCX, scy, scR, 0, Math.PI*2);
            ctx.fill();
            ctx.strokeStyle = clr;
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = clr;
            ctx.font = 'bold 32px "Noto Serif SC",serif';
            ctx.textAlign = 'center';
            ctx.fillText(sit.z, sanCX, scy + 13);

            // 右侧：六亲 · 神将
            var jShort = TJS_map[sit.j] || sit.j;
            var jClr = TJC_map[sit.j] || '#8b1a2b';
            ctx.fillStyle = clr;
            ctx.font = 'bold 13px "Noto Serif SC",serif';
            ctx.textAlign = 'left';
            ctx.fillText(sit.q, sanCX + scR + 16, scy);
            ctx.fillStyle = jClr;
            ctx.font = 'bold 13px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.fillText(jShort, sanCX + scR + 16, scy + 18);

            // 标签
            ctx.fillStyle = '#6b5e4a';
            ctx.font = 'bold 11px "Noto Sans SC","Microsoft YaHei",sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(sit.l, sanCX, scy + scR + 16);
        }

        // ===== 导出分发：全分辨率PNG，桌面下载，移动端弹窗预览 =====
        var filename = '大六壬_'+(sz['年柱']||'')+(sz['月柱']||'')+(sz['日柱']||'')+'.png';
        var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        // 全分辨率 PNG（无损高清）
        var dataUrl = canvas.toDataURL('image/png');

        if (isMobile) {
            _showImageModal(dataUrl, filename);
        } else {
            _triggerDownload(dataUrl, filename);
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
            var old = document.querySelector('.export-img-modal');
            if (old) old.remove();

            // 显示加载中
            var loading = document.createElement('div');
            loading.id = 'export-loading';
            loading.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,20,0.9);z-index:9998;display:flex;align-items:center;justify-content:center;color:#c4b393;font-size:16px;font-family:"Noto Serif SC",serif';
            loading.textContent = '正在生成图片...';
            document.body.appendChild(loading);

            // 预加载图片
            var img = new Image();
            img.onload = function() {
                loading.remove();
                _showModal(img);
            };
            img.onerror = function() {
                loading.remove();
                alert('导出失败：图片生成出错，请重试');
            };
            // 延迟设置 src，让 loading 先渲染
            setTimeout(function() { img.src = dataUrl; }, 100);

            function _showModal(imgEl) {
                var modal = document.createElement('div');
                modal.className = 'export-img-modal';
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,20,0.96);z-index:9999;padding:12px;overflow:auto;display:flex;flex-direction:column;align-items:center;-webkit-overflow-scrolling:touch';

                var bar = document.createElement('div');
                bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;max-width:600px;padding:8px 0;flex-shrink:0';
                var title = document.createElement('span');
                title.textContent = fname;
                title.style.cssText = 'color:#9a948c;font-size:13px;font-family:inherit';
                var closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = 'width:40px;height:40px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#c4b393;border-radius:50%;font-size:20px;cursor:pointer;flex-shrink:0;margin-left:12px';
                closeBtn.onclick = function() { modal.remove(); };
                bar.appendChild(title);
                bar.appendChild(closeBtn);

                var imgWrap = document.createElement('div');
                imgWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;width:100%;max-width:600px;min-height:0';
                imgEl.style.cssText = 'max-width:100%;max-height:75vh;border-radius:8px;border:2px solid rgba(255,255,255,0.12);object-fit:contain';
                imgEl.onclick = function(e) { e.stopPropagation(); };
                imgWrap.appendChild(imgEl);

                var tip = document.createElement('p');
                tip.textContent = '长按图片 → 保存到相册';
                tip.style.cssText = 'color:#c4b393;margin:14px 0 6px;font-size:15px;font-family:"Noto Serif SC",serif;text-align:center;flex-shrink:0';

                modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
                modal.appendChild(bar);
                modal.appendChild(imgWrap);
                modal.appendChild(tip);
                document.body.appendChild(modal);
            }
        }
    } catch(e) {
        console.error('[export] error:', e);
        alert('导出失败：'+e.message+'\n请尝试使用截图工具保存。');
    }
}

// ====== 排盘页出生年份修改（联动行年） ======
function editBirthYearOnBoard() {
    var curVal = document.getElementById('board-param-birth-year')?.value || '';
    var newYear = prompt('请输入出生年份（公历）：', curVal || '1990');
    if (!newYear) return;
    var y = parseInt(newYear);
    if (isNaN(y) || y < 1 || y > 2100) { alert('请输入有效年份（1-2100）'); return; }

    // 更新隐藏输入
    var inpEl = document.getElementById('board-param-birth-year');
    if (inpEl) inpEl.value = y;
    // 同步入口页
    var portalEl = document.getElementById('param-birth-year');
    if (portalEl) portalEl.value = y;
    var birthDisp = document.getElementById('info-birth-val');
    if (birthDisp) birthDisp.textContent = y;

    // 更新显示
    var byEl = document.getElementById('info-birth-year');
    if (byEl) { byEl.textContent = y; byEl.style.cursor = 'pointer'; }

    if (!currentPanData) return;
    // 重新计算行年
    var now = new Date();
    var curYear = parseInt(currentPanData['时间']['公历']?.split('-')[0]) || now.getFullYear();
    var sex = document.getElementById('board-param-sex')?.value || document.getElementById('param-sex')?.value || '男';
    var age = curYear - y + 1;
    if (age < 1) age = 1;
    var DZ = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    var start = sex === '男' ? '寅' : '申';
    var startIdx = DZ.indexOf(start);
    var newXN = DZ[((startIdx + (age - 1) * (sex === '男' ? 1 : -1)) % 12 + 12) % 12];
    // 更新 pan 数据
    currentPanData['行年'] = newXN;
    currentPanData['行年详情'] = { '行年地支': newXN, '年龄': age, '起算': start };
    // 更新行年上神
    var td = currentPanData['天地盘'] || {};
    currentPanData['行年详情']['行年上神'] = td[newXN] || '';
    // 重新同步入口页
    document.getElementById('param-birth-year').value = y;
    // 更新显示
    _renderInfoHTML(currentPanData);
    Chat.addMessage('system', '出生年份已改为 ' + y + '，行年更新为 ' + newXN + '（' + age + '岁）');
}

// ====== 行年手动修改 ======
function editXingnian(currentZhi, xnInfo) {
    var DZ = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,20,0.85);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var box = document.createElement('div');
    box.style.cssText = 'background:#fefcf7;border-radius:12px;padding:16px;max-width:320px;width:90vw;text-align:center';
    box.onclick = function(e) { e.stopPropagation(); };

    var title = document.createElement('div');
    title.textContent = '修改行年地支';
    title.style.cssText = 'font-size:16px;color:#1a1614;margin-bottom:4px;font-family:"Noto Serif SC",serif;letter-spacing:2px';
    box.appendChild(title);

    var ageInfo = document.createElement('div');
    ageInfo.textContent = '当前：' + (currentZhi || '--') + '（' + ((xnInfo||{}).年龄||'') + '岁）';
    ageInfo.style.cssText = 'font-size:12px;color:#9c8b72;margin-bottom:12px';
    box.appendChild(ageInfo);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px';
    DZ.forEach(function(z) {
        var btn = document.createElement('button');
        btn.textContent = z;
        var isCurrent = z === currentZhi;
        btn.style.cssText = 'padding:10px;font-size:20px;font-weight:700;border-radius:8px;cursor:pointer;font-family:"Noto Serif SC",serif;border:2px solid ' +
            (isCurrent ? '#b83a2e' : '#e0d5c1') + ';background:' + (isCurrent ? 'rgba(184,58,46,0.08)' : '#fff') +
            ';color:' + (isCurrent ? '#b83a2e' : '#3a3632');
        btn.onclick = function() {
            if (!currentPanData) return;
            currentPanData['行年'] = z;
            // 更新行年详情
            var xnD = currentPanData['行年详情'] || {};
            xnD['行年地支'] = z;
            currentPanData['行年详情'] = xnD;
            // 重新渲染信息栏
            var xnEl = document.getElementById('info-xingnian');
            if (xnEl) {
                xnEl.textContent = z + '（' + (xnD['年龄']||'') + '岁）';
                xnEl.style.cursor = 'pointer';
                xnEl.title = '点击修改行年地支';
                xnEl.onclick = function() { editXingnian(z, xnD); };
            }
            // 更新行年上神
            var td = currentPanData['天地盘'] || {};
            if (xnD) xnD['行年上神'] = td[z] || '';
            overlay.remove();
        };
        grid.appendChild(btn);
    });
    box.appendChild(grid);

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'margin-top:10px;padding:6px 24px;background:rgba(58,54,50,0.04);border:1px solid rgba(58,54,50,0.12);color:#6b6560;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit';
    cancelBtn.onclick = function() { overlay.remove(); };
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
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
                const mn = parseInt(hiddenInp?.min) || (param === 'year' ? 1 : param === 'hour' ? 0 : 1);
                const mx = parseInt(hiddenInp?.max) || (param === 'year' ? 2100 : param === 'hour' ? 23 : 12);
                let v = parseInt(input.value) || 0;
                v = Math.max(mn, Math.min(mx, v + delta));
                input.value = v;
                if (hiddenInp) hiddenInp.value = v;
            }

            function finishEdit() {
                const hiddenInp = document.getElementById('param-' + param);
                let v = parseInt(input.value);
                const mn = parseInt(hiddenInp?.min) || (param === 'year' ? 1 : param === 'hour' ? 0 : 1);
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

    // 反推分析按钮（兼容新旧笔记编辑器）
    $on('btn-iterate-case', 'click', async function() {
        // 优先使用新编辑器
        var caseId = (typeof NotesEditor !== 'undefined' && NotesEditor._caseId) ? NotesEditor._caseId : _notesCaseId;
        if (!caseId) return;
        var caseObj = _caseGet(caseId);
        if (!caseObj) { alert('案例数据丢失'); return; }
        var outcome = document.getElementById('notes-v2-outcome')?.value?.trim() || document.getElementById('notes-outcome')?.value?.trim();
        if (!outcome) { alert('请先在「实际结果」框中填写已知发生的事实'); return; }
        // 先保存（新编辑器优先）
        if (typeof NotesEditor !== 'undefined' && NotesEditor._caseId === caseId) { NotesEditor.save(); }
        else { savePersonalNotes(true); }
        // 关闭笔记弹窗
        if (typeof NotesEditor !== 'undefined' && NotesEditor._caseId === caseId) { NotesEditor.close(); }
        else { hideNotesModal(); }

        var domain = (typeof NotesEditor !== 'undefined' && NotesEditor._caseId === caseId) ? (NotesEditor._domain || 'general') : (_notesDomain || 'general');
        var domainLabel = domain === 'destiny' ? '推命' : (domain === 'divination' ? '占卜' : '通用');
        var targetSkill = domain === 'destiny' ? 'mingli' : (domain === 'divination' ? 'shaoyanhe' : 'auto');

        // 在聊天中显示反推分析
        Chat.addMessage('system', '正在进行【' + domainLabel + '】反推分析...（对比原始解读与实际结果，提取教训）');
        try {
            var resp = await fetch('/api/reflections/iterate', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({
                    pan_data: caseObj.pan_data,
                    question: '请分析此课盘',
                    ai_response: caseObj.personal_notes || '',
                    actual_outcome: outcome,
                    user_notes: caseObj.personal_notes || '',
                    domain: domain,
                    skill_id: targetSkill,
                })
            });
            var r = await resp.json();
            if (r.success) {
                Chat.onChatResponse(r.analysis, {skill_id:'iterate_' + domain, skill_name:'自反迭代反推【' + domainLabel + '】'});
                // 自动将反推教训保存到案例笔记
                if (r.lessons) {
                    var updatedCase = _caseGet(caseId);
                    if (updatedCase) {
                        var existing = updatedCase.personal_notes || '';
                        var ts = new Date().toISOString().replace('T',' ').slice(0,16);
                        updatedCase.personal_notes = existing + '\n\n---\n\n## 反推教训 (' + ts + ', ' + domainLabel + ')\n\n' + r.lessons;
                        updatedCase.personal_notes_updated = ts;
                        _casePut(updatedCase);
                    }
                }
                Chat.addMessage('system', '【' + domainLabel + '】反推分析完成。教训已自动保存到案例笔记，并将用于优化 ' + targetSkill + ' Skill。');
            } else {
                Chat.onError(r.error || '反推分析失败');
            }
        } catch(e) { Chat.onError(e.message); }
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

    // 案例库导出导入
    $on('btn-export-cases', 'click', function() {
        var allCases = [];
        var idx = _caseList();
        for (var i = 0; i < idx.length; i++) {
            var c = _caseGet(idx[i].id);
            if (c) allCases.push(c);
        }
        if (allCases.length === 0) { alert('案例库为空，无需导出'); return; }
        var blob = new Blob([JSON.stringify(allCases, null, 2)], {type: 'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '大六壬案例备份_' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(url); }, 500);
    });

    $on('btn-import-cases', 'click', function() {
        document.getElementById('import-file-input').click();
    });

    $on('import-file-input', 'change', function() {
        var file = this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var cases = JSON.parse(e.target.result);
                if (!Array.isArray(cases)) { alert('文件格式错误：需要JSON数组'); return; }
                var imported = 0;
                cases.forEach(function(c) {
                    if (c.id && c.pan_data) {
                        _casePut(c);
                        imported++;
                    }
                });
                alert('成功导入 ' + imported + ' 个案例（共 ' + cases.length + ' 条数据）');
                loadAllTags();
                if (document.getElementById('cases-modal').style.display !== 'none') loadCaseList();
            } catch(err) {
                alert('文件解析失败：' + err.message);
            }
        };
        reader.readAsText(file);
        this.value = '';
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
            this.ws.send(JSON.stringify({
                type: 'chat',
                message: msg,
                skill_id: this._currentSkillId || 'auto',
                use_personal_style: !!useStyle
            }));
            this.addMessage('system', useStyle ? 'AI 思考中（参考你的解读风格）...' : 'AI 思考中...');
        } else {
            origSend(msg);
        }
    };

    // 个人风格开关提示
    // AI 学习我的风格按钮 → 打开案例库，由用户勾选要学习的案例
    $on('btn-skill-learn', 'click', function() {
        showCases();
        // 更新案例库提示文字
        var hint = document.getElementById('compare-hint');
        if (hint) {
            hint.textContent = '勾选带笔记的案例后点「AI学习选中」开始学习';
            hint.style.color = 'var(--text3)';
        }
    });

    // AI学习选中 — 只学习用户勾选的案例笔记
    $on('btn-skill-learn-selected', 'click', async function() {
        var checked = document.querySelectorAll('.case-cb:checked');
        var ids = Array.from(checked).map(function(cb) { return cb.value; });
        if (ids.length === 0) {
            var hint = document.getElementById('compare-hint');
            hint.textContent = '请至少勾选1个带笔记的案例';
            hint.style.color = 'var(--red)';
            setTimeout(function() { hint.textContent = '勾选带笔记的案例后点「AI学习选中」开始学习'; hint.style.color = 'var(--text3)'; }, 2500);
            return;
        }
        // 只收集勾选且有笔记的案例
        var richCases = [];
        for (var i = 0; i < ids.length; i++) {
            var c = _caseGet(ids[i]);
            if (c && (c.personal_notes || c.actual_outcome)) {
                richCases.push({
                    name: c.name, tags: c.tags, personal_notes: c.personal_notes || '',
                    actual_outcome: c.actual_outcome || '', pan_data: c.pan_data
                });
            }
        }
        if (richCases.length === 0) {
            var hint2 = document.getElementById('compare-hint');
            hint2.textContent = '勾选的案例都没有个人笔记，请撰写笔记后再学习';
            hint2.style.color = 'var(--red)';
            setTimeout(function() { hint2.textContent = '勾选带笔记的案例后点「AI学习选中」开始学习'; hint2.style.color = 'var(--text3)'; }, 2500);
            return;
        }
        var skillId = Chat._currentSkillId || 'mingli';
        document.getElementById('cases-modal').style.display = 'none';
        Chat.addMessage('system', '正在从你选中的 ' + richCases.length + ' 个案例笔记中学习你的解课逻辑...');
        try {
            var resp = await fetch('/api/skills/learn', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ skill_id: skillId, cases: richCases })
            });
            var r = await resp.json();
            if (r.success) {
                // 从生成的 markdown 中提取 skill ID（用于编辑按钮关联）
                var fmMatch = r.skill_markdown.match(/^---\s*\n(?:.*\n)*?id:\s*(\S+)/m);
                var learnedSkillId = fmMatch ? fmMatch[1] : (skillId + '_learned');
                Chat.onChatResponse('## 学习完成！\n\n从你选中的 **' + r.case_count + '** 个案例笔记中提取了你的思维模式。\n\n优化版 Skill 已保存为 `' + r.saved_as + '`。\n\n---\n' + r.skill_markdown.substring(0, 3000) + '\n\n---\n\n> 完整 Skill 已保存。在 Skill 下拉菜单中选择「已学习」版本即可使用。', { skill_id: learnedSkillId, skill_name: '已学习: ' + r.saved_as });
                // 刷新 skill 列表
                Chat.init();
            } else {
                Chat.onError(r.error || '学习失败');
            }
        } catch(e) { Chat.onError(e.message); }
    });

    // ====== Skill 编辑功能 ======
    var _skillEditFile = '';
    var _skillEditId = '';

    // 学习完成后，在聊天响应中显示编辑按钮
    var _origChatOnChatResponse = Chat.onChatResponse;
    Chat.onChatResponse = function(text, meta) {
        _origChatOnChatResponse.call(this, text, meta);
        // 如果回复中包含学习完成，添加编辑按钮
        if (text && text.indexOf('学习完成') >= 0 && (meta && meta.skill_id)) {
            var msgs = document.getElementById('chat-messages');
            var lastMsg = msgs.lastElementChild;
            if (lastMsg) {
                var editBtn = document.createElement('button');
                editBtn.textContent = '编辑优化 Skill';
                editBtn.style.cssText = 'margin-top:8px;padding:6px 14px;background:rgba(184,58,46,0.06);border:1px solid rgba(184,58,46,0.25);border-radius:6px;color:#b83a2e;cursor:pointer;font-family:inherit;font-size:12px';
                editBtn.onclick = function() { openSkillEditor(meta.skill_id); };
                lastMsg.appendChild(editBtn);
            }
        }
    };

    // 编辑当前选中的 Skill
    $on('btn-skill-edit', 'click', function() {
        var skillId = Chat._currentSkillId;
        if (!skillId || skillId === 'auto') {
            // 列出可编辑的 learned skills
            fetch('/api/skills/list').then(function(r) { return r.json(); }).then(function(data) {
                if (!data.success || !data.skills) return;
                var learned = data.skills.filter(function(s) { return s.id && s.id.indexOf('_learned') >= 0; });
                if (learned.length === 0) {
                    Chat.addMessage('system', '还没有已学习的 Skill。请先在案例库中勾选带笔记的案例，点击「学习我的风格」。');
                    return;
                }
                openSkillEditor(learned[0].id);
            }).catch(function() {});
            return;
        }
        openSkillEditor(skillId);
    });

    function openSkillEditor(skillId) {
        _skillEditId = skillId;
        document.getElementById('skill-edit-modal').style.display = 'flex';
        document.getElementById('skill-edit-textarea').value = '加载中...';
        document.getElementById('skill-edit-status').textContent = '';

        fetch('/api/skills/' + encodeURIComponent(skillId) + '/raw').then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) {
                _skillEditFile = data.file_name;
                document.getElementById('skill-edit-title').textContent = '编辑 Skill';
                document.getElementById('skill-edit-file').textContent = data.file_name;
                document.getElementById('skill-edit-textarea').value = data.raw_markdown;
                document.getElementById('skill-edit-status').textContent = '已加载';
                document.getElementById('skill-edit-status').style.color = '#2d8a56';
            } else {
                document.getElementById('skill-edit-textarea').value = '加载失败：' + (data.error || '');
                document.getElementById('skill-edit-status').textContent = '加载失败';
                document.getElementById('skill-edit-status').style.color = '#b83a2e';
            }
        }).catch(function(e) {
            document.getElementById('skill-edit-textarea').value = '网络错误：' + e.message;
            document.getElementById('skill-edit-status').textContent = '网络错误';
            document.getElementById('skill-edit-status').style.color = '#b83a2e';
        });
    }

    function saveSkillEdit() {
        var content = document.getElementById('skill-edit-textarea').value.trim();
        if (!content) { alert('内容不能为空'); return; }
        var statusEl = document.getElementById('skill-edit-status');
        statusEl.textContent = '保存中...';
        statusEl.style.color = 'var(--bronze)';

        fetch('/api/skills/' + encodeURIComponent(_skillEditId) + '/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.success) {
                statusEl.textContent = '已保存';
                statusEl.style.color = '#2d8a56';
                // 刷新 skill 列表
                Chat.init();
                setTimeout(function() {
                    statusEl.textContent = '';
                }, 2000);
            } else {
                statusEl.textContent = '保存失败：' + (data.error || '');
                statusEl.style.color = '#b83a2e';
            }
        }).catch(function(e) {
            statusEl.textContent = '网络错误：' + e.message;
            statusEl.style.color = '#b83a2e';
        });
    }

    $on('btn-skill-edit-save', 'click', saveSkillEdit);
    $on('btn-skill-edit-close', 'click', function() {
        document.getElementById('skill-edit-modal').style.display = 'none';
    });

    // Ctrl+S 在编辑器中保存
    document.getElementById('skill-edit-textarea')?.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveSkillEdit();
        }
    });

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

    // ====== 导出课例为优雅 HTML 讲解页 ======
    function exportCaseHTML(caseId) {
        var caseObj = _caseGet(caseId);
        if (!caseObj || !caseObj.pan_data) { alert('案例数据缺失'); return; }
        var d = caseObj.pan_data;
        var sz = d['时间']?.['四柱'] || {};
        var sc = d['三传'] || {};
        var pm = d['排盘参数'] || {};
        var jq = d['节气'] || {};
        var sj = d['时间'] || {};
        var xk = d['旬空'] || [];
        var sike = d['四课详情'] || [];
        var sikeLQ = d['四课六亲'] || [];
        var scLQ = d['三传六亲'] || {};
        var scTJ = d['三传天将'] || {};
        var tjAll = d['十二天将'] || {};
        var dgAll = d['遁干'] || {};
        var ss = d['神煞'] || {};
        var td = d['天地盘'] || {};
        var xn = d['行年详情'] || {};

        var DZC = {'子':'#1a3a5c','亥':'#1a3a5c','丑':'#7D5A3C','未':'#7D5A3C','辰':'#7D5A3C','戌':'#7D5A3C','巳':'#c94043','午':'#c94043','寅':'#2d7d46','卯':'#2d7d46','申':'#D4A017','酉':'#D4A017'};
        var TJS = {'贵人':'贵','螣蛇':'蛇','朱雀':'朱','六合':'合','勾陈':'勾','青龙':'龙','天空':'空','白虎':'虎','太常':'常','玄武':'玄','太阴':'阴','天后':'后'};
        var DZ = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
        var POS = {'巳':[0,0],'午':[0,1],'未':[0,2],'申':[0,3],'辰':[1,0],'酉':[1,3],'卯':[2,0],'戌':[2,3],'寅':[3,0],'丑':[3,1],'子':[3,2],'亥':[3,3]};

        // Build 天地盘 SVG
        var svgWH = 440, cell = 100, gap = 8, pad = 40;
        var panSVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+svgWH+' '+svgWH+'" style="width:100%;max-width:440px">';
        panSVG += '<rect width="'+svgWH+'" height="'+svgWH+'" fill="#fefcf7" rx="12"/>';
        // Title
        panSVG += '<text x="'+svgWH/2+'" y="24" text-anchor="middle" fill="#9c8b72" font-size="11" font-family="serif">天地盘</text>';
        // Grid lines
        for (var row = 0; row < 4; row++) {
            for (var col = 0; col < 4; col++) {
                var cx = pad + col*(cell+gap), cy = pad + row*(cell+gap);
                panSVG += '<rect x="'+cx+'" y="'+cy+'" width="'+cell+'" height="'+cell+'" fill="none" stroke="rgba(107,101,96,0.12)" stroke-width="0.5" rx="4"/>';
            }
        }
        // Cells
        for (var i = 0; i < DZ.length; i++) {
            var zhi = DZ[i];
            var pos = POS[zhi];
            if (!pos) continue;
            var gx = pad + pos[1]*(cell+gap), gy = pad + pos[0]*(cell+gap);
            var tz = td[zhi] || zhi;
            var clr = DZC[tz] || '#2c2416';
            var isKong = xk.indexOf(zhi) >= 0 || xk.indexOf(tz) >= 0;
            // Cell bg
            panSVG += '<rect x="'+gx+'" y="'+gy+'" width="'+cell+'" height="'+cell+'" fill="rgba(254,252,247,0.9)" rx="6"/>';
            // 地盘 (bottom)
            panSVG += '<text x="'+(gx+cell/2)+'" y="'+(gy+cell*0.7)+'" text-anchor="middle" fill="'+(isKong?'#d0c8b0':DZC[zhi]||'#2c2416')+'" font-size="30" font-weight="700" font-family="serif">'+zhi+'</text>';
            // 天盘 (top right)
            panSVG += '<text x="'+(gx+cell*0.78)+'" y="'+(gy+cell*0.28)+'" text-anchor="middle" fill="'+(isKong?'#d0c8b0':clr)+'" font-size="16" font-weight="600" font-family="serif">'+tz+'</text>';
            // 遁干
            var dgVal = dgAll[zhi] || '';
            if (dgVal) {
                panSVG += '<text x="'+(gx+cell*0.22)+'" y="'+(gy+cell*0.28)+'" text-anchor="middle" fill="#9c8b72" font-size="10" font-family="serif">'+dgVal+'</text>';
            }
            // 天将
            var tjVal = tjAll[zhi] || '';
            if (tjVal && TJS[tjVal]) {
                panSVG += '<text x="'+(gx+cell/2)+'" y="'+(gy+cell*0.88)+'" text-anchor="middle" fill="rgba(107,101,96,0.5)" font-size="8" font-family="sans-serif">'+TJS[tjVal]+'</text>';
            }
        }
        panSVG += '</svg>';

        // Build 四课 cards
        var sikeHTML = '';
        for (var si = 0; si < sike.length; si++) {
            var sk = sike[si];
            var sn = sk['上神'], dp = sk['地盘地支'] || sk['地盘'];
            var snK = xk.indexOf(sn) >= 0;
            var lq = sikeLQ[si] ? sikeLQ[si]['六亲'] : '';
            sikeHTML += '<div class="sk-card"><div class="sk-label">第'+(si+1)+'课'+(lq?' · '+lq:'')+'</div>';
            sikeHTML += '<div class="sk-shang" style="color:'+(snK?'#d0c8b0':DZC[sn]||'#2c2416')+'">'+sn+'</div>';
            sikeHTML += '<div class="sk-di" style="color:'+(DZC[dp]||'#2c2416')+'">'+dp+'</div></div>';
        }

        // Build 三传
        var scHTML = '';
        var scNames = ['初传','中传','末传'];
        for (var sci = 0; sci < 3; sci++) {
            var scZhi = sc[scNames[sci]] || '';
            scHTML += '<div class="sc-node" style="border-color:'+(DZC[scZhi]||'#2c2416')+';color:'+(DZC[scZhi]||'#2c2416')+'">'+scZhi+'</div>';
            if (sci < 2) scHTML += '<span class="sc-arrow">→</span>';
        }

        // Build 神煞
        var ssCat = {'干煞':'日干取','支煞':'日支取','岁煞':'岁煞','月煞':'月煞'};
        var ssHTML = '';
        for (var cat in ssCat) {
            var items = ss[cat] || {};
            if (!items || Object.keys(items).length === 0) continue;
            ssHTML += '<div class="ss-group"><div class="ss-cat-name">'+ssCat[cat]+'</div>';
            for (var nm in items) {
                var val = items[nm];
                if (!val) continue;
                ssHTML += '<span class="ss-item"><b>'+nm+'</b> <span style="color:'+(DZC[val]||'#9c8b72')+'">'+val+'</span></span>';
            }
            ssHTML += '</div>';
        }

        // Build notes section
        var rawNotes = (caseObj.personal_notes || caseObj.notes || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var notesFormatted = rawNotes
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/__(.+?)__/g, '<u>$1</u>')
            .replace(/\*(.+?)\*/g, '<i>$1</i>')
            .replace(/^[-*]\s(.+)$/gm, '<li>$1</li>')
            .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        var now = new Date().toLocaleString('zh-CN');

        var html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1.0">\n<title>大六壬课例 · '+(caseObj.name||'无题')+'</title>\n<style>\n' +
'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n' +
':root{--bg:#fefcf7;--card:#faf7f0;--text:#2c2416;--text2:#6b6560;--text3:#9c8b72;--red:#b83a2e;--gold:#8b6914;--border:rgba(107,101,96,0.12);--font-serif:"Noto Serif SC","Songti SC",serif;--font-sans:"Noto Sans SC","PingFang SC",sans-serif}\n' +
'body{background:var(--bg);color:var(--text);font-family:var(--font-serif);line-height:1.8;padding:0;min-height:100vh}\n' +
'.container{max-width:800px;margin:0 auto;padding:48px 32px 80px}\n' +
'header{text-align:center;padding:48px 0 36px;border-bottom:1px solid var(--border);margin-bottom:40px}\n' +
'header h1{font-size:2rem;font-weight:700;letter-spacing:6px;color:var(--text);margin-bottom:10px}\n' +
'header .meta{font-size:0.8rem;color:var(--text3);letter-spacing:2px}\n' +
'section{margin:40px 0}\n' +
'section h2{font-size:0.75rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:4px;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border)}\n' +
'.pan-wrap{display:flex;justify-content:center;padding:20px 0}\n' +
'.info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}\n' +
'.info-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-align:center}\n' +
'.info-card .ic-label{font-size:0.65rem;color:var(--text3);letter-spacing:2px;margin-bottom:4px}\n' +
'.info-card .ic-value{font-size:1.1rem;font-weight:700;color:var(--text)}\n' +
'.sike-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}\n' +
'.sk-card{flex:1;min-width:100px;max-width:140px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 8px;text-align:center}\n' +
'.sk-label{font-size:0.6rem;color:var(--text3);margin-bottom:6px}\n' +
'.sk-shang{font-size:1.6rem;font-weight:700;line-height:1.3}\n' +
'.sk-di{font-size:1.1rem;font-weight:600}\n' +
'.sc-row{display:flex;align-items:center;justify-content:center;gap:14px;padding:16px 0}\n' +
'.sc-node{width:48px;height:48px;border-radius:50%;border:2.5px solid;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;background:#fff}\n' +
'.sc-arrow{font-size:1.2rem;color:var(--red);font-weight:700}\n' +
'.ss-group{display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:10px 14px;background:var(--card);border-radius:8px;border:1px solid var(--border)}\n' +
'.ss-cat-name{width:100%;font-size:0.65rem;color:var(--text3);letter-spacing:2px;margin-bottom:2px}\n' +
'.ss-item{font-size:0.8rem;color:var(--text2)}\n' +
'.ss-item b{font-weight:500;color:var(--text)}\n' +
'.notes-section{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px 28px;min-height:120px}\n' +
'.notes-section h2{margin-top:0}\n' +
'.notes-body{font-size:0.9rem;line-height:1.9;color:var(--text);outline:none;min-height:80px}\n' +
'.notes-body h3{font-size:1.1rem;color:var(--red);margin:20px 0 8px;font-weight:700}\n' +
'.notes-body h4{font-size:0.95rem;color:var(--text2);margin:14px 0 6px}\n' +
'.notes-body p{margin:6px 0}\n' +
'.notes-body li{margin-left:20px}\n' +
'.notes-body blockquote{border-left:2px solid var(--red);padding:4px 14px;margin:8px 0;color:var(--text2);font-style:italic}\n' +
'.edit-toolbar{display:flex;gap:4px;padding:8px 0;margin-bottom:12px;border-bottom:1px solid var(--border);flex-wrap:wrap}\n' +
'.edit-toolbar button{width:30px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer;font-size:12px;color:var(--text2);font-family:inherit;transition:all 0.15s}\n' +
'.edit-toolbar button:hover{background:rgba(184,58,46,0.06);border-color:rgba(184,58,46,0.25);color:var(--red)}\n' +
'.edit-toolbar .tb-sep{width:1px;height:20px;background:var(--border);margin:0 4px;align-self:center}\n' +
'footer{text-align:center;padding:40px 0 20px;color:var(--text3);font-size:0.65rem;letter-spacing:2px;border-top:1px solid var(--border);margin-top:40px}\n' +
'.btn-print{position:fixed;bottom:24px;right:24px;width:44px;height:44px;border-radius:50%;border:1px solid var(--border);background:var(--card);cursor:pointer;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:all 0.2s;z-index:100}\n' +
'.btn-print:hover{box-shadow:0 4px 16px rgba(0,0,0,0.12)}\n' +
'@media print{body{background:#fff}.container{max-width:100%;padding:20px}.btn-print,.edit-toolbar{display:none}.notes-body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}\n' +
'@media(max-width:640px){.container{padding:24px 16px 40px}header h1{font-size:1.4rem}.sk-card{min-width:70px}.sc-node{width:38px;height:38px;font-size:1rem}}\n' +
'</style>\n</head>\n<body>\n<div class="container">\n' +
'<header>\n<h1>'+(caseObj.name||'无题')+'</h1>\n'+
'<div class="meta">'+(sj['公历']||'')+' · '+(pm['占时']||'')+'占 · '+(pm['月将']||'')+'将 · '+(jq['当前节气']||'')+' · '+(sc['方法']||'')+'课 · '+(sj['昼夜']||'')+'</div>\n'+
'</header>\n'+
'<section><h2>天地盘</h2><div class="pan-wrap">'+panSVG+'</div></section>\n'+
'<section>\n<h2>基本信息</h2>\n<div class="info-grid">\n'+
'<div class="info-card"><div class="ic-label">年柱</div><div class="ic-value">'+(sz['年柱']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">月柱</div><div class="ic-value">'+(sz['月柱']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">日柱</div><div class="ic-value">'+(sz['日柱']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">时柱</div><div class="ic-value">'+(sz['时柱']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">日干</div><div class="ic-value">'+(sj['日干']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">日支</div><div class="ic-value">'+(sj['日支']||'--')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">行年</div><div class="ic-value">'+(xn['行年地支']||d['行年']||'')+'</div></div>\n'+
'<div class="info-card"><div class="ic-label">旬空</div><div class="ic-value" style="font-size:0.9rem">'+(xk.join(' '))+'</div></div>\n'+
'</div></section>\n'+
'<section><h2>四课</h2><div class="sike-row">'+sikeHTML+'</div></section>\n'+
'<section><h2>三传</h2><div class="sc-row">'+scHTML+'</div>\n'+
'<div style="text-align:center;font-size:0.7rem;color:var(--text3);margin-top:4px">'+(sc['方法']||'')+'课 · 初'+(scLQ['初传']||'')+'('+(scTJ['初传']||'')+') → 中'+(scLQ['中传']||'')+'('+(scTJ['中传']||'')+') → 末'+(scLQ['末传']||'')+'('+(scTJ['末传']||'')+')</div>\n'+
'</section>\n'+
'<section><h2>神煞</h2>'+ssHTML+'</section>\n'+
'<section><h2>解读笔记 <span style="font-weight:400;font-size:0.7rem;color:var(--text3)">（点击文字直接编辑）</span></h2>\n'+
'<div class="notes-section">\n<div class="edit-toolbar" id="etb">\n'+
'<button onclick="document.execCommand(\'bold\')" title="加粗"><b>B</b></button>\n'+
'<button onclick="document.execCommand(\'italic\')" title="斜体"><i>I</i></button>\n'+
'<button onclick="document.execCommand(\'underline\')" title="下划线"><u>U</u></button>\n'+
'<span class="tb-sep"></span>\n'+
'<button onclick="document.execCommand(\'formatBlock\',false,\'h3\')" title="标题">H</button>\n'+
'<button onclick="document.execCommand(\'insertUnorderedList\')" title="列表">•</button>\n'+
'<button onclick="document.execCommand(\'formatBlock\',false,\'blockquote\')" title="引用">❝</button>\n'+
'</div>\n'+
'<div class="notes-body" contenteditable="true" id="notes-body">'+(notesFormatted||'<p style="color:var(--text3)">在此撰写解读笔记…</p>')+'</div>\n</div>\n</section>\n'+
'<footer><p>大六壬课例导出 · '+now+'</p></footer>\n'+
'</div>\n'+
'<button class="btn-print" onclick="window.print()" title="打印">🖨</button>\n'+
'<script>\n'+
'document.getElementById("notes-body").addEventListener("input",function(){this.style.color="#2c2416"});\n'+
'</'+'script>\n</body>\n</html>';

        var blob = new Blob(['﻿' + html], {type: 'text/html;charset=UTF-8'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (caseObj.name || '课例') + '_大六壬讲解.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 初始化各模块（各自隔离，互不影响）
    try { Chat.init(); } catch(e) { console.warn('[app] Chat.init 失败:', e); }
    try { Classics.init(); } catch(e) { console.warn('[app] Classics.init 失败:', e); }
    try { Chat.showWelcome(); } catch(e) { console.warn('[app] Chat.showWelcome 失败:', e); }
    try { connectWebSocket(); } catch(e) { console.warn('[app] WebSocket 连接失败:', e); }
    try { loadAllTags(); } catch(e) { console.warn('[app] 预加载标签失败:', e); }
    try { attachRuneEdit(); } catch(e) { console.warn('[app] rune-edit 初始化失败:', e); }
    try { _initStorage(); } catch(e) { console.warn('[app] 云端存储初始化失败:', e); }
});
