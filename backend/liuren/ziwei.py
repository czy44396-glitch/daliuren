"""
紫微斗数 — 排盘 + 大运流年推算。

算法来源：传统安星法口诀 + 紫微斗数全书

核心步骤：
1. 安命宫/身宫
2. 定十二宫天干（五虎遁）
3. 定五行局（命宫干支纳音）
4. 安紫微星（生日÷局数公式）
5. 安天府星（寅申对称）
6. 安十四主星
7. 安辅星（左辅右弼文昌文曲禄存擎羊陀罗天魁天钺火铃天马）
8. 安四化星
9. 起大运
10. 安长生十二神
"""

from datetime import datetime
from .basics import DIZHI, TIANGAN, GAN_YINYANG, GAN_WUXING, JIAZI, GANZHI_INDEX, ZHI_INDEX

# ══════ 纳音五行局 ══════
# 六十甲子纳音表
NAYIN = {
    ("甲","子"):("金","海中金"),("乙","丑"):("金","海中金"),
    ("丙","寅"):("火","炉中火"),("丁","卯"):("火","炉中火"),
    ("戊","辰"):("木","大林木"),("己","巳"):("木","大林木"),
    ("庚","午"):("土","路旁土"),("辛","未"):("土","路旁土"),
    ("壬","申"):("金","剑锋金"),("癸","酉"):("金","剑锋金"),
    ("甲","戌"):("火","山头火"),("乙","亥"):("火","山头火"),
    ("丙","子"):("水","涧下水"),("丁","丑"):("水","涧下水"),
    ("戊","寅"):("土","城头土"),("己","卯"):("土","城头土"),
    ("庚","辰"):("金","白蜡金"),("辛","巳"):("金","白蜡金"),
    ("壬","午"):("木","杨柳木"),("癸","未"):("木","杨柳木"),
    ("甲","申"):("水","泉中水"),("乙","酉"):("水","泉中水"),
    ("丙","戌"):("土","屋上土"),("丁","亥"):("土","屋上土"),
    ("戊","子"):("火","霹雳火"),("己","丑"):("火","霹雳火"),
    ("庚","寅"):("木","松柏木"),("辛","卯"):("木","松柏木"),
    ("壬","辰"):("水","长流水"),("癸","巳"):("水","长流水"),
    ("甲","午"):("金","沙中金"),("乙","未"):("金","沙中金"),
    ("丙","申"):("火","山下火"),("丁","酉"):("火","山下火"),
    ("戊","戌"):("木","平地木"),("己","亥"):("木","平地木"),
    ("庚","子"):("土","壁上土"),("辛","丑"):("土","壁上土"),
    ("壬","寅"):("金","金箔金"),("癸","卯"):("金","金箔金"),
    ("甲","辰"):("火","覆灯火"),("乙","巳"):("火","覆灯火"),
    ("丙","午"):("水","天河水"),("丁","未"):("水","天河水"),
    ("戊","申"):("土","大驿土"),("己","酉"):("土","大驿土"),
    ("庚","戌"):("金","钗钏金"),("辛","亥"):("金","钗钏金"),
    ("壬","子"):("木","桑柘木"),("癸","丑"):("木","桑柘木"),
    ("甲","寅"):("水","大溪水"),("乙","卯"):("水","大溪水"),
    ("丙","辰"):("土","沙中土"),("丁","巳"):("土","沙中土"),
    ("戊","午"):("火","天上火"),("己","未"):("火","天上火"),
    ("庚","申"):("木","石榴木"),("辛","酉"):("木","石榴木"),
    ("壬","戌"):("水","大海水"),("癸","亥"):("水","大海水"),
}
JU_NUM = {"水":2,"木":3,"金":4,"土":5,"火":6}

# 寅宫序数 (用于紫微星公式: 寅=1)
GONG_INDEX = {"寅":1,"卯":2,"辰":3,"巳":4,"午":5,"未":6,"申":7,"酉":8,"戌":9,"亥":10,"子":11,"丑":12}
INDEX_GONG = {v:k for k,v in GONG_INDEX.items()}

# 四化表
SIHUA = {
    "甲":("廉贞","破军","武曲","太阳"),
    "乙":("天机","天梁","紫微","太阴"),
    "丙":("天同","天机","文昌","廉贞"),
    "丁":("太阴","天同","天机","巨门"),
    "戊":("贪狼","太阴","右弼","天机"),
    "己":("武曲","贪狼","天梁","文曲"),
    "庚":("太阳","武曲","天同","太阴"),
    "辛":("巨门","太阳","文曲","文昌"),
    "壬":("天梁","紫微","左辅","武曲"),
    "癸":("破军","巨门","太阴","贪狼"),
}


def _lunar_date(year: int, month: int, day: int):
    """公历→农历"""
    try:
        from lunardate import LunarDate
        l = LunarDate.fromSolarDate(year, month, day)
        return l.year, l.month, l.day, l.isLeapMonth
    except ImportError:
        return year, month, day, False


def _wu_hu_dun(year_gan: str, zhi: str) -> str:
    """五虎遁：年干→寅宫天干→任意地支天干"""
    yin_gan_map = {"甲":"丙","己":"丙","乙":"戊","庚":"戊","丙":"庚","辛":"庚","丁":"壬","壬":"壬","戊":"甲","癸":"甲"}
    yin_gan = yin_gan_map.get(year_gan, "甲")
    offset = (ZHI_INDEX[zhi] - ZHI_INDEX["寅"]) % 12
    return TIANGAN[(TIANGAN.index(yin_gan) + offset) % 10]


def _get_ming_gong(yue_zhi: str, shi_zhi: str) -> str:
    """安命宫：寅起正月顺数至生月，从该宫起子时逆数至生时"""
    # 寅起正月 → 顺数
    m_pos = (ZHI_INDEX["寅"] + ZHI_INDEX[yue_zhi] - ZHI_INDEX["寅"]) % 12  # = yue_zhi index
    # 从 m_pos 起子时，逆数至生时
    shi_idx = ZHI_INDEX[shi_zhi]
    ming = (m_pos - (shi_idx - ZHI_INDEX["子"])) % 12
    return DIZHI[ming]


def _get_shen_gong(yue_zhi: str, shi_zhi: str) -> str:
    """安身宫：寅起正月顺数至生月，从该宫起子时顺数至生时"""
    m_pos = (ZHI_INDEX["寅"] + ZHI_INDEX[yue_zhi] - ZHI_INDEX["寅"]) % 12
    shi_idx = ZHI_INDEX[shi_zhi]
    shen = (m_pos + (shi_idx - ZHI_INDEX["子"])) % 12
    return DIZHI[shen]


def _get_ziwei_pos(lunar_day: int, ju_num: int) -> str:
    """
    安紫微星 — 正确公式：
    1. 生日÷局数 → 商(d)和余数
    2. 若整除: 寅起1顺数至d → 紫微
    3. 若不整除: (生日+X)÷局数→商, 寅起1顺数至商→基础宫
       X奇→逆退X格, X偶→顺进X格
    """
    d = lunar_day // ju_num
    r = lunar_day % ju_num

    if r == 0:
        # 整除：寅1→顺数至商
        return INDEX_GONG.get(d, "寅")

    # 不整除：找最小X使得整除
    X = ju_num - r  # (生日+X) / 局数 = d+1
    shang = (lunar_day + X) // ju_num

    # 寅起1顺数至商 → 基础宫
    base_idx = shang  # 寅=1
    base_gong = INDEX_GONG.get(base_idx, "寅")

    # X奇→逆退，X偶→顺进
    if X % 2 == 1:  # 阳(奇)
        ziwei_idx = (GONG_INDEX[base_gong] - X - 1) % 12 + 1
    else:  # 阴(偶)
        ziwei_idx = (GONG_INDEX[base_gong] + X - 1) % 12 + 1

    return INDEX_GONG.get(ziwei_idx, "寅")


def _get_tianfu_pos(ziwei_zhi: str) -> str:
    """安天府星：紫微天府以寅申为轴对称"""
    ziwei_num = GONG_INDEX[ziwei_zhi]
    if ziwei_num < 7:   # 寅→未 (1-6)
        tianfu_num = 6 - ziwei_num
    else:                # 申→丑 (7-12)
        tianfu_num = 18 - ziwei_num
    if tianfu_num <= 0:
        tianfu_num += 12
    return INDEX_GONG.get(tianfu_num, "辰")


def _place_14_stars(ziwei_zhi: str, tianfu_zhi: str) -> dict:
    """安十四主星"""
    stars = {z: [] for z in DIZHI}
    ZI = ZHI_INDEX

    # 紫微星系（逆行）: 紫微→天机→空1→太阳→武曲→天同→空2→廉贞
    zw_idx = ZI[ziwei_zhi]
    # 紫微
    stars[ziwei_zhi].append("紫微")
    # 天机: 逆1
    stars[DIZHI[(zw_idx - 1) % 12]].append("天机")
    # 空1格，太阳: 逆3
    stars[DIZHI[(zw_idx - 3) % 12]].append("太阳")
    # 武曲: 逆4
    stars[DIZHI[(zw_idx - 4) % 12]].append("武曲")
    # 天同: 逆5
    stars[DIZHI[(zw_idx - 5) % 12]].append("天同")
    # 空2格，廉贞: 逆8
    stars[DIZHI[(zw_idx - 8) % 12]].append("廉贞")

    # 天府星系（顺行）: 天府→太阴→贪狼→巨门→天相→天梁→七杀→空3→破军
    tf_idx = ZI[tianfu_zhi]
    stars[tianfu_zhi].append("天府")
    stars[DIZHI[(tf_idx + 1) % 12]].append("太阴")
    stars[DIZHI[(tf_idx + 2) % 12]].append("贪狼")
    stars[DIZHI[(tf_idx + 3) % 12]].append("巨门")
    stars[DIZHI[(tf_idx + 4) % 12]].append("天相")
    stars[DIZHI[(tf_idx + 5) % 12]].append("天梁")
    stars[DIZHI[(tf_idx + 6) % 12]].append("七杀")
    stars[DIZHI[(tf_idx + 10) % 12]].append("破军")

    return stars


def _place_fu_stars(year_gan: str, year_zhi: str, lunar_month: int, shi_zhi: str) -> dict:
    """安辅星"""
    ZI = ZHI_INDEX
    fu = {z: [] for z in DIZHI}

    # 左辅: 辰起正月顺数至生月
    zuo = DIZHI[(ZI["辰"] + lunar_month - 1) % 12]
    fu[zuo].append("左辅")

    # 右弼: 戌起正月逆数至生月
    you = DIZHI[(ZI["戌"] - (lunar_month - 1)) % 12]
    fu[you].append("右弼")

    # 文昌: 戌起子时逆数至生时
    wenchang = DIZHI[(ZI["戌"] - (ZI[shi_zhi] - ZI["子"])) % 12]
    fu[wenchang].append("文昌")

    # 文曲: 辰起子时顺数至生时
    wenqu = DIZHI[(ZI["辰"] + ZI[shi_zhi] - ZI["子"]) % 12]
    fu[wenqu].append("文曲")

    # 禄存: 年干定
    lucun_map = {"甲":"寅","乙":"卯","丙":"巳","丁":"午","戊":"巳","己":"午","庚":"申","辛":"酉","壬":"亥","癸":"子"}
    lucun_zhi = lucun_map.get(year_gan, "寅")
    fu[lucun_zhi].append("禄存")

    # 擎羊: 禄存前一宫(顺)
    qingyang = DIZHI[(ZI[lucun_zhi] + 1) % 12]
    fu[qingyang].append("擎羊")

    # 陀罗: 禄存后一宫(逆)
    tuoluo = DIZHI[(ZI[lucun_zhi] - 1) % 12]
    fu[tuoluo].append("陀罗")

    # 天魁/天钺: 年干定
    tiankui_map = {"甲":"丑","戊":"丑","庚":"丑","乙":"子","己":"子","丙":"亥","丁":"酉","辛":"午","壬":"卯","癸":"巳"}
    tianyue_map = {"甲":"未","戊":"未","庚":"未","乙":"申","己":"申","丙":"酉","丁":"亥","辛":"寅","壬":"巳","癸":"卯"}
    fu[tiankui_map.get(year_gan,"丑")].append("天魁")
    fu[tianyue_map.get(year_gan,"未")].append("天钺")

    # 火星/铃星: 年支+时支
    huo_start = {"寅":"丑","午":"丑","戌":"丑","申":"寅","子":"寅","辰":"寅","巳":"卯","酉":"卯","丑":"卯","亥":"酉","卯":"酉","未":"酉"}
    ling_start = {"寅":"卯","午":"卯","戌":"卯","申":"戌","子":"戌","辰":"戌","巳":"戌","酉":"戌","丑":"戌","亥":"戌","卯":"戌","未":"戌"}
    huo_s = huo_start.get(year_zhi, "丑")
    ling_s = ling_start.get(year_zhi, "卯")
    huo = DIZHI[(ZI[huo_s] + ZI[shi_zhi] - ZI["子"]) % 12]
    ling = DIZHI[(ZI[ling_s] + ZI[shi_zhi] - ZI["子"]) % 12]
    fu[huo].append("火星")
    fu[ling].append("铃星")

    # 天马: 年支三合
    tianma_map = {("寅","午","戌"):"申",("申","子","辰"):"寅",("巳","酉","丑"):"亥",("亥","卯","未"):"巳"}
    for k, v in tianma_map.items():
        if year_zhi in k:
            fu[v].append("天马")
            break

    return fu


def _place_sihua(year_gan: str, stars: dict) -> dict:
    """安四化星。返回 {星名: 化X}"""
    hua_lu, hua_quan, hua_ke, hua_ji = SIHUA.get(year_gan, ("","","",""))
    return {
        hua_lu: "化禄", hua_quan: "化权", hua_ke: "化科", hua_ji: "化忌",
    }


def _place_changsheng(ju_wx: str, forward: bool) -> dict:
    """安长生十二神"""
    cs_start = {"水":"申","木":"亥","金":"巳","土":"申","火":"寅"}
    start = cs_start.get(ju_wx, "申")
    cs_names = ["长生","沐浴","冠带","临官","帝旺","衰","病","死","墓","绝","胎","养"]
    cs = {}
    si = ZHI_INDEX[start]
    for i, name in enumerate(cs_names):
        idx = (si + i) % 12 if forward else (si - i) % 12
        cs[DIZHI[idx]] = name
    return cs


def compute_ziwei(
    year: int, month: int, day: int, hour: int, minute: int = 0,
    sex: str = "男",
) -> dict:
    """紫微斗数完整排盘"""
    from .sizhu import get_sizhu

    sizhu = get_sizhu(year, month, day, hour)
    nian_gan = sizhu["年柱"][0]
    nian_zhi = sizhu["年柱"][1]
    yue_zhi = sizhu["月柱"][1]
    shi_zhi = sizhu["时柱"][1]

    lunar_y, lunar_m, lunar_d, is_leap = _lunar_date(year, month, day)

    # 1. 命宫/身宫
    ming_zhi = _get_ming_gong(yue_zhi, shi_zhi)
    ming_gan = _wu_hu_dun(nian_gan, ming_zhi)
    shen_zhi = _get_shen_gong(yue_zhi, shi_zhi)

    # 2. 五行局
    wx, wx_name = NAYIN.get((ming_gan, ming_zhi), ("土", "未知"))
    ju_num = JU_NUM.get(wx, 5)

    # 3. 紫微+天府
    ziwei_zhi = _get_ziwei_pos(lunar_d, ju_num)
    tianfu_zhi = _get_tianfu_pos(ziwei_zhi)

    # 4. 十二宫
    gong_names = ["命宫","兄弟","夫妻","子女","财帛","疾厄","迁移","交友","官禄","田宅","福德","父母"]
    gongs = []
    for i in range(12):
        zhi = DIZHI[(ZHI_INDEX[ming_zhi] - i) % 12]
        gan = _wu_hu_dun(nian_gan, zhi)
        gongs.append({"宫名": gong_names[i], "地支": zhi, "干支": gan + zhi})

    # 5. 十四主星
    main_stars = _place_14_stars(ziwei_zhi, tianfu_zhi)

    # 6. 辅星
    fu_stars = _place_fu_stars(nian_gan, nian_zhi, lunar_m, shi_zhi)

    # 7. 四化
    sihua = _place_sihua(nian_gan, main_stars)

    # 8. 合并星曜（主星+辅星+四化标注）
    all_stars = {z: [] for z in DIZHI}
    for z in DIZHI:
        all_stars[z].extend(main_stars.get(z, []))
        all_stars[z].extend(fu_stars.get(z, []))
        # 四化标注在主星上
        for star_name, hua_name in sihua.items():
            if star_name in all_stars[z]:
                idx = all_stars[z].index(star_name)
                all_stars[z][idx] = star_name + hua_name[1:]  # "紫微"→"紫微权"

    # 9. 大运
    is_yang = GAN_YINYANG.get(nian_gan, "阳") == "阳"
    is_male = (sex == "男")
    forward = (is_yang and is_male) or (not is_yang and not is_male)
    qiyun_age = ju_num

    dayun = []
    mi = ZHI_INDEX[ming_zhi]
    for i in range(9):
        dy_idx = (mi + i) % 12 if forward else (mi - i) % 12
        dy_zhi = DIZHI[dy_idx]
        dy_gan = _wu_hu_dun(nian_gan, dy_zhi)
        sa = qiyun_age + i * 10
        dayun.append({"干支": dy_gan + dy_zhi, "地支": dy_zhi,
                       "年龄": f"{sa}-{sa+9}岁", "起年": year+sa, "止年": year+sa+9})

    # 10. 长生十二神
    changsheng = _place_changsheng(wx, forward)

    # 11. 流年
    now = datetime.now()
    cy = now.year
    liunian = [{"年份": cy+o, "干支": JIAZI[(cy+o-4)%60]} for o in range(-3, 7)]

    return {
        "命宫": {"地支": ming_zhi, "干支": ming_gan + ming_zhi},
        "身宫": {"地支": shen_zhi},
        "五行局": {"五行": wx, "局数": ju_num, "纳音": wx_name},
        "紫微星": ziwei_zhi,
        "天府星": tianfu_zhi,
        "十二宫": gongs,
        "星曜": {z: all_stars[z] for z in DIZHI if all_stars[z]},
        "四化": sihua,
        "长生十二神": changsheng,
        "大运": dayun,
        "流年": liunian,
        "起运岁数": qiyun_age,
        "顺逆": "顺行" if forward else "逆行",
        "年干阴阳": "阳" if is_yang else "阴",
        "性别": sex,
    }
