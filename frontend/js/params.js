/**
 * 参数面板 — 直接数字输入
 */
const Params = {
    get() {
        return {
            year: parseInt(document.getElementById('param-year').value) || 2026,
            month: parseInt(document.getElementById('param-month').value) || 1,
            day: parseInt(document.getElementById('param-day').value) || 1,
            hour: parseInt(document.getElementById('param-hour').value) || 0,
            minute: parseInt(document.getElementById('param-minute')?.value) || 0,
            zhanshi: null,
            yuejiang_override: null,
            sex: document.getElementById('param-sex').value || '男',
            birth_year: parseInt(document.getElementById('param-birth-year').value) || null,
            birth_ganzhi: document.getElementById('param-birth-ganzhi').value.trim() || null,
        };
    },

    setNow() {
        const n = new Date();
        document.getElementById('param-year').value = n.getFullYear();
        document.getElementById('param-month').value = n.getMonth() + 1;
        document.getElementById('param-day').value = n.getDate();
        document.getElementById('param-hour').value = n.getHours();
        document.getElementById('param-minute').value = n.getMinutes();
        this._syncDisplay();
        this._fixDayMax();
    },

    setDate(y, m, d, h, mi) {
        document.getElementById('param-year').value = y;
        document.getElementById('param-month').value = m;
        document.getElementById('param-day').value = d;
        document.getElementById('param-hour').value = h || 0;
        document.getElementById('param-minute').value = mi || 0;
        this._fixDayMax();
        this._syncDisplay();
    },

    setInfo(data) {
        if (!data) return;
        const pm = data["排盘参数"] || {};
        const sz = (data["时间"] || {})["四柱"] || {};
        document.getElementById('info-yuejiang').textContent = pm["月将"] || '--';
        document.getElementById('info-jieqi').textContent = `${sz["月柱"]||''}月 · ${(data["时间"]||{})["昼夜"]||''}`;
    },

    init() {
        const sync = () => this._syncDisplay();
        ['param-year','param-month','param-day','param-hour','param-minute'].forEach(id => {
            document.getElementById(id).addEventListener('input', sync);
        });
        this._fixDayMax();
    },

    _syncDisplay() {
        const y = document.getElementById('param-year').value;
        const m = String(document.getElementById('param-month').value).padStart(2,'0');
        const d = String(document.getElementById('param-day').value).padStart(2,'0');
        const h = String(document.getElementById('param-hour').value).padStart(2,'0');
        const mi = String(document.getElementById('param-minute').value).padStart(2,'0');
        const el = document.getElementById('disp-full');
        if (el) el.textContent = `${y}年${m}月${d}日 ${h}:${mi}`;
    },

    _fixDayMax() {
        const y = parseInt(document.getElementById('param-year').value) || 2026;
        const m = parseInt(document.getElementById('param-month').value) || 1;
        const maxDay = new Date(y, m, 0).getDate();
        const dayInp = document.getElementById('param-day');
        dayInp.max = maxDay;
        if (parseInt(dayInp.value) > maxDay) dayInp.value = maxDay;
    }
};
