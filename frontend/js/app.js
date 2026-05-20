/**
 * 大六壬排盘解盘 — 主应用
 */
let ws = null;
let currentPanData = null;
let compareContext = null; // 对比上下文，用于追问
let currentCategory = '';   // 当前案例分类筛选

function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/chat`;
    try {
        ws = new WebSocket(url);
        ws.onopen = () => {
            Chat.setWebSocket(ws);
            if (currentPanData) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
        };
        ws.onmessage = (e) => {
            try {
                const m = JSON.parse(e.data);
                if (m.type === 'chat_response') Chat.onChatResponse(m.message);
                else if (m.type === 'error') Chat.onError(m.message);
                else if (m.type === 'pan_ready') console.log('[WS] synced');
            } catch (err) { console.error('[WS] parse:', err); }
        };
        ws.onclose = () => { Chat.setWebSocket(null); setTimeout(connectWebSocket, 3000); };
        ws.onerror = () => {};
    } catch (e) { setTimeout(connectWebSocket, 3000); }
}

async function doPaipan() {
    const params = Params.get();
    const container = document.getElementById('board-container');
    container.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>排盘中...</span></div>';
    currentPanData = null; compareContext = null;
    try {
        const resp = await fetch('/api/paipan', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});
        const result = await resp.json();
        if (!result.success) { container.innerHTML = `<div class="error-banner">排盘失败：${result.error||''}</div>`; return; }
        currentPanData = result.data;
        container.innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
        renderBoard(currentPanData);
        Params.setInfo(currentPanData);
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
    } catch (err) { container.innerHTML = `<div class="error-banner">网络错误：${err.message}</div>`; }
}

async function doUpdatePan() { await doPaipan(); }

// ====== 案例管理 ======
async function saveCase() {
    if (!currentPanData) { alert('请先排盘'); return; }
    const category = prompt('案例分类（地震/事业/财运/感情/健康/其他）：', '其他') || '其他';
    const name = prompt('案例名称（可选，留空自动生成）：', '') || '';
    try {
        const resp = await fetch('/api/cases/save', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({pan_data:currentPanData, name, category}),
        });
        const r = await resp.json();
        if (r.success) {
            // 保存后再给一次改名机会
            const newName = prompt('已保存！输入新名称可重命名（取消保留原名）：', r.name);
            if (newName && newName !== r.name) {
                await fetch(`/api/cases/${r.id}/rename`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName})});
                Chat.addMessage('system', `案例已保存：${newName} [${category}]`);
            } else {
                Chat.addMessage('system', `案例已保存：${r.name} [${category}]`);
            }
        } else { Chat.addMessage('system', `保存失败：${r.error}`); }
    } catch(e) { Chat.addMessage('system', `保存出错: ${e.message}`); }
}

async function loadCaseList() {
    try {
        const resp = await fetch('/api/cases/list');
        const r = await resp.json();
        if (!r.success) return;
        const list = document.getElementById('cases-list');
        let cases = r.cases;
        // 分类筛选
        if (currentCategory) cases = cases.filter(c => (c.category||'其他') === currentCategory);
        if (cases.length === 0) {
            list.innerHTML = `<div style="padding:20px;color:var(--text3)">${currentCategory ? '该分类下暂无案例' : '暂无保存的案例'}</div>`;
            return;
        }
        list.innerHTML = '';
        cases.forEach(c => {
            const div = document.createElement('div');
            div.className = 'case-item';
            div.innerHTML = `
                <input type="checkbox" class="case-cb" value="${c.id}">
                <span class="case-cat-tag">${c.category||'其他'}</span>
                <span class="case-name">${c.name}</span>
                <span class="case-date">${c.created?.slice(0,16)||''}</span>
                <button class="btn btn-sm case-load" data-id="${c.id}">加载</button>
                <button class="btn btn-sm case-rename" data-id="${c.id}" data-name="${c.name.replace(/"/g,'&quot;')}">改名</button>
                <button class="btn btn-sm case-del" data-id="${c.id}">删</button>`;
            list.appendChild(div);
        });
        // 加载
        list.querySelectorAll('.case-load').forEach(b => b.addEventListener('click', async () => {
            const resp = await fetch(`/api/cases/${b.dataset.id}`);
            const r = await resp.json();
            if (r.success && r.case.pan_data) {
                currentPanData = r.case.pan_data;
                document.getElementById('board-container').innerHTML = '<svg id="board-svg" viewBox="0 0 660 600"></svg>';
                renderBoard(currentPanData);
                Params.setInfo(currentPanData);
                // 同步时间参数
                const pd = r.case.pan_data;
                const timeStr = pd["时间"]["公历"];
                const parts = timeStr.match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
                if (parts) Params.setDate(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]));
                document.getElementById('param-zhanshi').value = pd["排盘参数"]["占时"] || 'auto';
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'set_pan',data:currentPanData}));
                document.getElementById('cases-modal').style.display = 'none';
                compareContext = null;
                Chat.clear(); Chat.addMessage('system', `已加载：${r.case.name}`);
            }
        }));
        // 改名
        list.querySelectorAll('.case-rename').forEach(b => b.addEventListener('click', async () => {
            const newName = prompt('新名称：', b.dataset.name);
            if (newName && newName !== b.dataset.name) {
                await fetch(`/api/cases/${b.dataset.id}/rename`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName})});
                loadCaseList();
            }
        }));
        // 删除
        list.querySelectorAll('.case-del').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确认删除？')) return;
            await fetch(`/api/cases/${b.dataset.id}`, {method:'DELETE'});
            loadCaseList();
        }));
    } catch(e) { console.error(e); }
}

async function compareCases() {
    const checked = document.querySelectorAll('.case-cb:checked');
    const ids = Array.from(checked).map(cb => cb.value);
    if (ids.length < 2) {
        document.getElementById('compare-hint').textContent = '⚠ 请至少勾选2个案例';
        document.getElementById('compare-hint').style.color = 'var(--red)';
        setTimeout(() => {
            const h = document.getElementById('compare-hint');
            h.textContent = '勾选2+案例后点击对比';
            h.style.color = 'var(--text3)';
        }, 2000);
        return;
    }
    const question = `请找出这些案例的共同特征和关键规律，特别注意三传、六亲、天将的重复模式`;
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
            Chat.addMessage('system', '对比完成。你可以在下方继续追问，如"三传的共同规律是什么？"');
        } else { Chat.onError(r.error || '对比失败'); }
    } catch(e) { Chat.onError(e.message); }
}

// 对比追问（走 WebSocket）
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

function showCases() {
    document.getElementById('cases-modal').style.display = 'flex';
    loadCaseList();
}

// ====== 分类筛选 ======
function setCategory(cat) {
    currentCategory = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    loadCaseList();
}

function addCategory() {
    const cat = prompt('新建子库名称：', '');
    if (!cat) return;
    // 动态添加分类按钮
    const filter = document.getElementById('cases-filter');
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm cat-btn';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    btn.addEventListener('click', () => setCategory(cat));
    filter.insertBefore(btn, document.getElementById('btn-new-cat'));
    setCategory(cat);
}

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', () => {
    Params.setNow();
    Params.init();

    document.getElementById('btn-paipan').addEventListener('click', doPaipan);
    document.getElementById('btn-current-time').addEventListener('click', () => { Params.setNow(); doPaipan(); });
    document.getElementById('btn-update').addEventListener('click', doUpdatePan);
    document.getElementById('btn-save-case').addEventListener('click', saveCase);
    document.getElementById('btn-cases').addEventListener('click', showCases);
    document.getElementById('btn-close-cases').addEventListener('click', () => {
        document.getElementById('cases-modal').style.display = 'none';
    });

    // 分类按钮
    document.querySelectorAll('.cat-btn').forEach(b => {
        b.addEventListener('click', () => setCategory(b.dataset.cat));
    });
    document.getElementById('btn-new-cat').addEventListener('click', addCategory);
    document.getElementById('btn-compare').addEventListener('click', compareCases);
    document.getElementById('btn-select-all').addEventListener('click', () => {
        const cbs = document.querySelectorAll('.case-cb');
        const all = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => cb.checked = !all);
        document.getElementById('btn-select-all').textContent = all ? '全选' : '取消';
    });

    // 对比追问拦截
    const origSend = Chat.sendMessage.bind(Chat);
    Chat._origSend = origSend;
    Chat.sendMessage = async function(msg) {
        if (compareContext) {
            const done = await askCompareFollowUp(msg);
            if (done) return;
        }
        origSend(msg);
    };

    Chat.init();
    Chat.showWelcome();
    connectWebSocket();
    setTimeout(doPaipan, 800);
});
