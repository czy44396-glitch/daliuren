/**
 * 大六壬方图盘面 — SVG只画 12宫天地盘 + 天将 + 旬遁
 * 四课、三传用 HTML 卡片展示在 SVG 下方，永不重叠
 */

const DZ = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
// 地支直配色
const DZC = {
    "子":"#1a3a5c", "亥":"#1a3a5c",                       // 水 — 深蓝
    "丑":"#7D5A3C", "未":"#7D5A3C", "辰":"#7D5A3C", "戌":"#7D5A3C",  // 土 — 赭石褐
    "巳":"#c94043", "午":"#c94043",                       // 火 — 朱砂红
    "寅":"#2d7d46", "卯":"#2d7d46",                       // 木 — 青绿
    "申":"#D4A017", "酉":"#D4A017",                       // 金 — 鎏金黄
};
const TJS = {"贵人":"贵","螣蛇":"蛇","朱雀":"朱","六合":"合","勾陈":"勾","青龙":"龙","天空":"空","白虎":"虎","太常":"常","玄武":"玄","太阴":"阴","天后":"后"};
// 天将直配色（与五行地支色一致）
const TJC = {
    "贵人":"#7D5A3C", "天空":"#7D5A3C", "勾陈":"#7D5A3C", "太常":"#7D5A3C",
    "青龙":"#2d7d46", "六合":"#2d7d46",
    "白虎":"#D4A017", "太阴":"#D4A017",
    "天后":"#1a3a5c", "玄武":"#1a3a5c",
    "螣蛇":"#c94043", "朱雀":"#c94043",
};

// 4x4 对称方图 (每边 4 地支, 四角共用)
//   巳 午 未 申
//   辰       酉
//   卯       戌
//   寅 丑 子 亥
const POS = {
    "巳":[0,0],"午":[0,1],"未":[0,2],"申":[0,3],
    "辰":[1,0],                        "酉":[1,3],
    "卯":[2,0],                        "戌":[2,3],
    "寅":[3,0],"丑":[3,1],"子":[3,2],"亥":[3,3],
};

function renderBoard(data) {
    if (!data) return;

    // === Part 1: SVG 十二宫天地盘 ===
    _renderTiandiPanSVG(data);

    // === Part 2: HTML 四课卡片 ===
    _renderSikeHTML(data);

    // === Part 3: HTML 三传卡片 ===
    _renderSanchuanHTML(data);

    // === Part 4: 底部信息栏 ===
    _renderInfoHTML(data);
}


function _renderTiandiPanSVG(data) {
    const svg = document.getElementById('board-svg');
    const W = 660, H = 600;
    const ox = 38, oy = 28;
    const cw = 140, ch = 128, gap = 12;

    let h = '<defs><marker id="ah" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#8b1a2b"/></marker></defs>';
    h += `<rect width="${W}" height="${H}" fill="#fdfaf3" rx="4"/>`;

    const td = data["天地盘"] || {};
    const tj = data["十二天将"] || {};
    const dg = data["遁干"] || {};
    const xk = data["旬空"] || [];

    for (const di of DZ) {
        const [r, c] = POS[di];
        const tian = td[di] || "";
        const jiang = tj[di] || "";
        const dun = dg[tian] || "";  // 遁干随天盘
        const clrDi = DZC[di] || "#2c2416";      // 地盘颜色（宫格边框、地盘字）
        const clrTian = DZC[tian] || "#2c2416";  // 天盘颜色（天盘字、空亡圈）
        const tianK = xk.includes(tian); // 天盘地支是否空亡
        const diK = xk.includes(di);     // 地盘地支是否空亡
        const cx = ox + c * (cw + gap);
        const cy = oy + r * (ch + gap);

        // 宫格外框（地盘色）
        h += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="5"
            fill="#fefcf7" stroke="${clrDi}" stroke-width="2"/>`;

        // 遁干 — 最顶部
        const tjS = TJS[jiang] || "";
        const tjClr = TJC[jiang] || "#8b1a2b";
        h += `<text x="${cx+cw/2}" y="${cy+ch/2-38}" font-size="11" fill="#6b5e4a"
            font-family="var(--font-serif)" text-anchor="middle">${dun}</text>`;

        // 天将简称
        h += `<text x="${cx+cw/2}" y="${cy+ch/2-20}" font-size="18" fill="${tjClr}"
            font-family="var(--font-sans)" font-weight="600" text-anchor="middle">${tjS}</text>`;

        // 天盘地支 — 大字居中（空亡加虚线圆圈，天盘色）
        if (tianK) {
            h += `<circle cx="${cx+cw/2}" cy="${cy+ch/2+7}" r="22" fill="none" stroke="${clrTian}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
        }
        h += `<text x="${cx+cw/2}" y="${cy+ch/2+16}" font-size="28" font-weight="700"
            fill="${tianK ? '#bbb' : clrTian}" font-family="var(--font-serif)" text-anchor="middle">${tian}</text>`;

        // 地盘地支 — 右下角（地盘色）
        if (diK) {
            h += `<rect x="${cx+cw-29}" y="${cy+ch-23}" width="16" height="16" rx="2" fill="none" stroke="${clrDi}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
        }
        h += `<text x="${cx+cw-14}" y="${cy+ch-10}" font-size="14" font-weight="600"
            fill="${diK ? '#bbb' : clrDi}" font-family="var(--font-serif)" text-anchor="end">${di}</text>`;
    }

    // 方位标注 — 午(0,1)北, 子(3,2)南
    const wuX = ox + 1*(cw+gap) + cw/2;  // 午 at col=1
    const ziX = ox + 2*(cw+gap) + cw/2;  // 子 at col=2
    h += `<text x="${wuX}" y="${oy - 10}" font-size="12" fill="#c4b393" font-family="var(--font-serif)" text-anchor="middle">南 (午)</text>`;
    h += `<text x="${ziX}" y="${oy + 3*(ch+gap) + ch + 14}" font-size="12" fill="#c4b393" font-family="var(--font-serif)" text-anchor="middle">北 (子)</text>`;

    svg.innerHTML = h;
}


function _renderSikeHTML(data) {
    const container = document.getElementById('sike-container');
    if (!container) return;

    const sike = data["四课详情"];
    const slq = data["四课六亲"];
    const tjAll = data["十二天将"] || {};
    const dgAll = data["遁干"] || {};
    const xk = data["旬空"] || [];
    if (!sike || !slq) { container.innerHTML = ''; return; }

    // 为四课上神找对应天将：上神坐在地盘X, 查X的天将
    const tjFullForSike = sike.map(sk => tjAll[sk["地盘地支"] || sk["地盘"]] || "");
    const tjForSike = tjFullForSike.map(tj => TJS[tj] || "");
    const tjClrForSike = tjFullForSike.map(tj => TJC[tj] || "#8b1a2b");
    // 为四课上神找遁干
    const dgForSike = sike.map(sk => dgAll[sk["上神"]] || "");

    let h = '<div class="section-title">四 课</div><div class="sike-grid">';
    for (let i = 0; i < sike.length; i++) {
        const sn = sike[i]["上神"];
        const dp = sike[i]["地盘"];
        const lq = slq[i] ? slq[i]["六亲"] : "";
        const snKong = xk.includes(sn);  // 上神空亡
        const clrSn = snKong ? '#bbb' : (DZC[sn] || "#2c2416");
        const clrDp = DZC[dp] || "#2c2416";
        const tj = tjForSike[i];
        const tjClr = tjClrForSike[i];
        const dg = dgForSike[i];

        h += `<div class="sike-cell${snKong ? ' sike-kong' : ''}">
            <div class="sike-dungan">${dg}</div>
            <div class="sike-jiang" style="color:${tjClr}">${tj}</div>
            <div class="sike-shang" style="color:${clrSn}">${sn}</div>
            <div class="sike-di" style="color:${clrDp}">${dp}</div>
        </div>`;
    }
    h += '</div>';
    container.innerHTML = h;
}


function _renderSanchuanHTML(data) {
    const container = document.getElementById('sanchuan-container');
    if (!container) return;

    const sc = data["三传"];
    const sl = data["三传六亲"] || {};
    const st = data["三传天将"] || {};
    const dgAll = data["遁干"] || {};
    const xk = data["旬空"] || [];
    if (!sc) { container.innerHTML = ''; return; }

    const its = [
        {z:sc["初传"],q:sl["初传"]||"",j:st["初传"]||"",d:dgAll[sc["初传"]]||""},
        {z:sc["中传"],q:sl["中传"]||"",j:st["中传"]||"",d:dgAll[sc["中传"]]||""},
        {z:sc["末传"],q:sl["末传"]||"",j:st["末传"]||"",d:dgAll[sc["末传"]]||""},
    ];

    let h = `<div class="section-title">三 传</div>`;
    h += '<div class="sanchuan-col">';
    for (let i = 0; i < its.length; i++) {
        const kong = xk.includes(its[i].z);
        const clrRaw = DZC[its[i].z] || "#2c2416";
        const clr = kong ? '#bbb' : clrRaw;
        const tjShort = TJS[its[i].j] || its[i].j;
        const tjClr = TJC[its[i].j] || "#8b1a2b";
        h += `<div class="sc-cell-h${kong ? ' sc-kong' : ''}">
            <span class="sc-liuqin" style="color:${clrRaw}">${its[i].q}</span>
            <span class="sc-zhi-col">
                <span class="sc-zhi" style="border-color:${clr};color:${clr}">${its[i].z}</span>`;
        if (i < 2) h += '<span class="sc-arrow-dn">↓</span>';
        h += `</span>
            <span class="sc-jiang" style="color:${tjClr}">${tjShort}</span>
            <span class="sc-dungan">${its[i].d}</span>
        </div>`;
    }
    h += '</div>';
    container.innerHTML = h;
}


function _renderShashenHTML(data) {
    const container = document.getElementById('shashen-container');
    if (!container) return;
    const ss = data["神煞"] || {};
    if (!ss || Object.keys(ss).length === 0) { container.innerHTML = ''; return; }

    const catNames = {"干煞":"日干煞","支煞":"日支煞","岁煞":"岁煞","月煞":"月煞"};
    let h = '<div class="section-title">神 煞</div>';
    for (const [cat, items] of Object.entries(ss)) {
        if (!items || Object.keys(items).length === 0) continue;
        h += `<div class="ss-cat">${catNames[cat] || cat}</div>`;
        for (const [name, zhi] of Object.entries(items)) {
            const clr = zhi && DZC[zhi] ? DZC[zhi] : '#9c8b72';
            h += `<div class="ss-row">
                <span class="ss-name">${name}</span>
                <span class="ss-zhi" style="color:${clr}">${zhi || '—'}</span>
            </div>`;
        }
    }
    container.innerHTML = h;
}

function _renderInfoHTML(data) {
    const sz = (data["时间"]||{})["四柱"] || {};
    const sc = data["三传"] || {};
    const pm = data["排盘参数"] || {};
    const sj = data["时间"] || {};

    // 四柱纵向
    const sizhuV = (gz) => gz ? `<span class="sz-gan">${gz[0]}</span><span class="sz-zhi">${gz[1]}</span>` : '--';
    const e = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };

    e('sizhu-display', `<div class="info-tag-v">
        <span class="label">年</span>${sizhuV(sz["年柱"])}
        <span class="label">月</span>${sizhuV(sz["月柱"])}
        <span class="label">日</span>${sizhuV(sz["日柱"])}
        <span class="label">时</span>${sizhuV(sz["时柱"])}
    </div>`);
    e('sanchuan-display', `<span class="label">三传</span><span class="value red">${sc["初传"]||''} → ${sc["中传"]||''} → ${sc["末传"]||''}</span>`);
    e('method-display', `<span class="label">课式</span><span class="value red">${sc["方法"]||''}课</span>`);

    // 节气详情
    const jqData = data["节气"] || {};
    const yjEl = document.getElementById('info-yuejiang');
    if (yjEl) yjEl.textContent = pm["月将"] || '--';
    const jqEl = document.getElementById('info-jieqi');
    if (jqEl) {
        jqEl.innerHTML = `${jqData["当前节气"]||'—'} → ${jqData["下一节气"]||'—'} · ${sj["昼夜"]||''}`;
    }
    // 行年（可点击修改）
    const xnEl = document.getElementById('info-xingnian');
    if (xnEl) {
        const xn = data["行年"] || '';
        const xnInfo = data["行年详情"] || {};
        xnEl.textContent = xn ? xn + '（' + (xnInfo['年龄']||'') + '岁）' : '--';
        xnEl.style.cursor = 'pointer';
        xnEl.title = '点击修改行年地支';
        xnEl.onclick = function() { editXingnian(xn, xnInfo); };
    }
}
