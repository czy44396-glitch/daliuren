"""
紫微斗数 — 排盘 + 大运流年推算。

核心算法：
- 命宫：从寅起正月顺数至生月，再逆数至生时
- 身宫：从寅起正月顺数至生月，再顺数至生时
- 五行局：命宫干支纳音定局数(水2/木3/金4/土5/火6)
- 紫微星：五行局 + 农历生日 → 查表定位
- 天府星：紫微星的对宫关系
- 大运：阳男阴女顺行/阴男阳女逆行，五行局定起运岁数
"""

from datetime import datetime
from .basics import DIZHI, TIANGAN, GAN_YINYANG, GAN_WUXING, JIAZI, GANZHI_INDEX

# 农历日期推算
LUNAR_MONTH_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# ══════ 纳音五行局 ══════
# 六十甲子纳音表：每两组干支共享同一纳音
NAYIN_TABLE = {
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

# 五行局 → 局数
JU_MAP = {"水": 2, "木": 3, "金": 4, "土": 5, "火": 6}

# ══════ 紫微星定位表 ══════
# key = 局数, value = {农历日: 紫微星所在宫位地支}
# 宫位地支顺序: 寅卯辰巳午未申酉戌亥子丑 (从寅宫=0开始)
ZIWEI_TABLE = {
    2: {1:"寅",2:"卯",3:"辰",4:"巳",5:"午",6:"未",7:"申",8:"酉",9:"戌",10:"亥",11:"子",12:"丑",
        13:"寅",14:"卯",15:"辰",16:"巳",17:"午",18:"未",19:"申",20:"酉",21:"戌",22:"亥",23:"子",24:"丑",
        25:"寅",26:"卯",27:"辰",28:"巳",29:"午",30:"未"},
    3: {1:"辰",2:"丑",3:"寅",4:"巳",5:"寅",6:"卯",7:"午",8:"卯",9:"辰",10:"未",
        11:"辰",12:"巳",13:"申",14:"巳",15:"午",16:"酉",17:"午",18:"未",19:"戌",
        20:"未",21:"申",22:"亥",23:"申",24:"酉",25:"子",26:"酉",27:"戌",28:"丑",
        29:"戌",30:"亥"},
    4: {1:"亥",2:"辰",3:"丑",4:"寅",5:"子",6:"卯",7:"戌",8:"寅",9:"未",10:"寅",
        11:"巳",12:"寅",13:"丑",14:"卯",15:"午",16:"卯",17:"酉",18:"辰",19:"卯",
        20:"申",21:"辰",22:"巳",23:"未",24:"巳",25:"寅",25:"午",26:"巳",27:"亥",
        28:"午",29:"未",30:"戌"},
    5: {1:"午",2:"亥",3:"辰",4:"丑",5:"申",6:"卯",7:"子",8:"寅",9:"未",10:"寅",
        11:"戌",12:"卯",13:"辰",14:"寅",15:"巳",16:"卯",17:"丑",18:"辰",19:"寅",
        20:"子",21:"巳",22:"卯",23:"午",23:"辰",24:"巳",25:"亥",26:"午",27:"未",
        28:"卯",29:"申",30:"未"},
    6: {1:"酉",2:"午",3:"亥",4:"辰",5:"丑",6:"酉",7:"卯",8:"申",9:"寅",10:"巳",
        11:"寅",12:"未",13:"卯",14:"子",15:"辰",16:"寅",17:"卯",18:"戌",19:"巳",20:"寅",
        21:"巳",22:"丑",23:"午",24:"卯",25:"酉",26:"辰",27:"午",28:"寅",29:"未",30:"卯"},
}

# 紫微→天府映射（寅=0,...,丑=11 位置）
# 紫微在X宫 → 天府在 Y宫
ZIWEI_TIANFU_MAP = {
    "寅":"辰","卯":"卯","辰":"寅","巳":"丑","午":"子","未":"亥",
    "申":"戌","酉":"酉","戌":"申","亥":"未","子":"午","丑":"巳",
}

# 十四主星按紫微星系和天府星系的分布规则
# 紫微星系(逆行): 紫微,天机,太阳,武曲,天同,廉贞
# 天府星系(顺行): 天府,太阴,贪狼,巨门,天相,天梁,七杀,破军
ZIWEI_STARS = ["紫微","天机","","太阳","武曲","天同","","廉贞"]  # 逆行
TIANFU_STARS = ["天府","太阴","贪狼","巨门","天相","天梁","七杀","破军"]  # 顺行


def _get_lunar_date(year: int, month: int, day: int):
    """公历→农历 (简单近似，用 lunardate 库)"""
    try:
        from lunardate import LunarDate
        lunar = LunarDate.fromSolarDate(year, month, day)
        return lunar.year, lunar.month, lunar.day, lunar.isLeapMonth
    except ImportError:
        # 没有 lunardate 时用简单近似
        return year, month, day, False


def _get_ming_gong(month_zhi: str, hour_zhi: str) -> str:
    """
    安命宫：从寅起正月，顺数至生月，再逆数至生时。
    返回命宫地支。
    """
    ZI = DIZHI.index
    # 从寅起正月顺数至生月
    m_idx = (ZI("寅") + ZI(month_zhi) - ZI("寅")) % 12  # basically = month_zhi index
    # 再逆数至生时
    ming_idx = (m_idx - (ZI(hour_zhi) - ZI("寅"))) % 12
    return DIZHI[ming_idx]


def _get_shen_gong(month_zhi: str, hour_zhi: str) -> str:
    """
    安身宫：从寅起正月，顺数至生月，再顺数至生时。
    """
    ZI = DIZHI.index
    m_idx = (ZI("寅") + ZI(month_zhi) - ZI("寅")) % 12
    shen_idx = (m_idx + (ZI(hour_zhi) - ZI("寅"))) % 12
    return DIZHI[shen_idx]


def _get_wuxing_ju(ming_gz: str) -> tuple:
    """从命宫干支获取五行局。返回 (局名, 局数)。"""
    gan = ming_gz[0]
    zhi = ming_gz[1]
    key = (gan, zhi)
    if key in NAYIN_TABLE:
        wx, name = NAYIN_TABLE[key]
        return wx, JU_MAP.get(wx, 5), name
    return "土", 5, "未知"


def _get_ziwei_pos(ju_num: int, lunar_day: int) -> str:
    """根据局数和农历日获取紫微星所在宫位地支。"""
    table = ZIWEI_TABLE.get(ju_num, {})
    return table.get(lunar_day, "寅")


def _get_tianfu_pos(ziwei_zhi: str) -> str:
    """紫微→天府映射。"""
    return ZIWEI_TIANFU_MAP.get(ziwei_zhi, "辰")


def _build_12_gongs(ming_zhi: str) -> list:
    """从命宫地支起，逆排十二宫。返回 [{宫名, 地支}, ...]"""
    ZI = DIZHI.index
    gong_names = ["命宫","兄弟","夫妻","子女","财帛","疾厄","迁移","交友","官禄","田宅","福德","父母"]
    start = ZI(ming_zhi)
    gongs = []
    for i in range(12):
        zhi = DIZHI[(start - i) % 12]
        gongs.append({"宫名": gong_names[i], "地支": zhi})
    return gongs


def _get_gan_for_zhi(zhi: str, year_gan: str) -> str:
    """根据年干五虎遁，获取该地支的天干。"""
    # 五虎遁：甲己之年丙作首，乙庚之岁戊为头...
    wuhudun = {
        ("甲","寅"):"丙",("己","寅"):"丙",
        ("乙","寅"):"戊",("庚","寅"):"戊",
        ("丙","寅"):"庚",("辛","寅"):"庚",
        ("丁","寅"):"壬",("壬","寅"):"壬",
        ("戊","寅"):"甲",("癸","寅"):"甲",
    }
    ZI = DIZHI.index
    # 找到寅的干
    yin_gan = wuhudun.get((year_gan, "寅"), "甲")
    gan_idx = TIANGAN.index(yin_gan)
    zhi_idx = ZI(zhi)
    offset = (zhi_idx - ZI("寅")) % 12
    return TIANGAN[(gan_idx + offset) % 10]


def _place_main_stars(ziwei_zhi: str, tianfu_zhi: str) -> dict:
    """放置十四主星。返回 {地支: [星名, ...]}"""
    ZI = DIZHI.index
    stars = {z: [] for z in DIZHI}

    # 紫微星系（逆排）
    zw_idx = ZI(ziwei_zhi)
    zw_positions = [DIZHI[(zw_idx - i) % 12] for i in range(8)]
    for i, star in enumerate(ZIWEI_STARS):
        if star:
            stars[zw_positions[i]].append(star)

    # 天府星系（顺排）
    tf_idx = ZI(tianfu_zhi)
    tf_positions = [DIZHI[(tf_idx + i) % 12] for i in range(8)]
    for i, star in enumerate(TIANFU_STARS):
        stars[tf_positions[i]].append(star)

    return stars


def compute_ziwei(
    year: int, month: int, day: int, hour: int, minute: int = 0,
    sex: str = "男",
) -> dict:
    """
    紫微斗数排盘 + 大运流年。

    返回完整的命盘字典。
    """
    from .sizhu import get_sizhu
    sizhu = get_sizhu(year, month, day, hour)
    nian_gan = sizhu["年柱"][0]
    nian_zhi = sizhu["年柱"][1]
    yue_zhi = sizhu["月柱"][1]
    shi_zhi = sizhu["时柱"][1]

    # 农历日期
    lunar_y, lunar_m, lunar_d, is_leap = _get_lunar_date(year, month, day)

    # 1. 命宫
    ming_zhi = _get_ming_gong(yue_zhi, shi_zhi)
    ming_gan = _get_gan_for_zhi(ming_zhi, nian_gan)
    ming_gz = ming_gan + ming_zhi

    # 2. 身宫
    shen_zhi = _get_shen_gong(yue_zhi, shi_zhi)

    # 3. 五行局
    wx, ju_num, ju_name = _get_wuxing_ju(ming_gz)

    # 4. 紫微星 + 天府星
    ziwei_zhi = _get_ziwei_pos(ju_num, lunar_d)
    tianfu_zhi = _get_tianfu_pos(ziwei_zhi)

    # 5. 十二宫
    gongs = _build_12_gongs(ming_zhi)
    # 给每个宫配天干
    for g in gongs:
        g["干支"] = _get_gan_for_zhi(g["地支"], nian_gan) + g["地支"]

    # 6. 十四主星
    stars = _place_main_stars(ziwei_zhi, tianfu_zhi)

    # 7. 大运
    is_yang = GAN_YINYANG.get(nian_gan, "阳") == "阳"
    is_male = (sex == "男")
    forward = (is_yang and is_male) or (not is_yang and not is_male)  # 阳男阴女顺行

    # 起运岁数：五行局定
    qiyun_age = ju_num  # 水2局2岁起，木3局3岁起...

    dayun_list = []
    ZI = DIZHI.index
    ming_idx = ZI(ming_zhi)
    for i in range(8):  # 8步大运
        if forward:
            dy_idx = (ming_idx + i) % 12
        else:
            dy_idx = (ming_idx - i) % 12
        dy_zhi = DIZHI[dy_idx]
        dy_gan = _get_gan_for_zhi(dy_zhi, nian_gan)
        start_age = qiyun_age + i * 10
        dayun_list.append({
            "干支": dy_gan + dy_zhi,
            "地支": dy_zhi,
            "年龄": f"{start_age}-{start_age+9}岁",
            "起年": year + start_age,
            "止年": year + start_age + 9,
        })

    # 8. 流年
    now = datetime.now()
    cur_year = now.year
    cur_ganzhi_idx = (cur_year - 4) % 60
    liunian_list = []
    for offset in range(-3, 7):
        yn = cur_year + offset
        gz = JIAZI[(yn - 4) % 60]
        liunian_list.append({"年份": yn, "干支": gz})

    return {
        "命宫": {"地支": ming_zhi, "干支": ming_gz},
        "身宫": {"地支": shen_zhi},
        "五行局": {"五行": wx, "局数": ju_num, "纳音": ju_name},
        "紫微星": ziwei_zhi,
        "天府星": tianfu_zhi,
        "十二宫": gongs,
        "主星布局": {z: stars[z] for z in DIZHI if stars[z]},
        "大运": dayun_list,
        "流年": liunian_list,
        "起运岁数": qiyun_age,
        "顺逆": "顺行" if forward else "逆行",
        "年干阴阳": "阳" if is_yang else "阴",
        "性别": sex,
    }
