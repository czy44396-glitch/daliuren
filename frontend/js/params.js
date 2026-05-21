/**
 * 参数面板 — 从隐藏输入读取（值由入口页同步传入）
 */
const Params = {
    _pfx: 'board-',

    get() {
        const p = this._pfx;
        const gv = (id) => parseInt(document.getElementById(p + id)?.value) || 0;
        const gs = (id) => document.getElementById(p + id)?.value || '';
        return {
            year: gv('param-year') || 2026,
            month: gv('param-month') || 1,
            day: gv('param-day') || 1,
            hour: gv('param-hour') || 0,
            minute: gv('param-minute') || 0,
            zhanshi: null,
            yuejiang_override: null,
            sex: gs('param-sex') || '男',
            birth_year: gv('param-birth-year') || null,
            birth_ganzhi: null,
        };
    },

    setDate(y, m, d, h, mi) {
        const p = this._pfx;
        const setVal = (id, v) => { const el = document.getElementById(p + id); if (el) el.value = v; };
        setVal('param-year', y);
        setVal('param-month', m);
        setVal('param-day', d);
        setVal('param-hour', h || 0);
        setVal('param-minute', mi || 0);
    },

    setInfo(data) {
        if (!data) return;
        const pm = data["排盘参数"] || {};
        const el = document.getElementById('info-yuejiang');
        if (el) el.textContent = pm["月将"] || '--';
    },
};
