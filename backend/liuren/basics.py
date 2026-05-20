"""
大六壬基础数据：天干地支、五行、六十甲子、寄宫、生克刑冲合害关系。
"""

# ========== 天干 (10 Heavenly Stems) ==========
TIANGAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]

# 天干阴阳
GAN_YINYANG = {
    "甲": "阳", "乙": "阴", "丙": "阳", "丁": "阴", "戊": "阳",
    "己": "阴", "庚": "阳", "辛": "阴", "壬": "阳", "癸": "阴",
}

# 天干五行
GAN_WUXING = {
    "甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
    "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
}

# 天干方位
GAN_FANGWEI = {
    "甲": "东", "乙": "东", "丙": "南", "丁": "南", "戊": "中",
    "己": "中", "庚": "西", "辛": "西", "壬": "北", "癸": "北",
}

# ========== 地支 (12 Earthly Branches) ==========
DIZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

# 地支序号（用于运算）
ZHI_INDEX = {z: i for i, z in enumerate(DIZHI)}

# 地支阴阳
ZHI_YINYANG = {
    "子": "阳", "丑": "阴", "寅": "阳", "卯": "阴", "辰": "阳",
    "巳": "阴", "午": "阳", "未": "阴", "申": "阳", "酉": "阴",
    "戌": "阳", "亥": "阴",
}

# 地支五行
ZHI_WUXING = {
    "子": "水", "丑": "土", "寅": "木", "卯": "木", "辰": "土",
    "巳": "火", "午": "火", "未": "土", "申": "金", "酉": "金",
    "戌": "土", "亥": "水",
}

# 地支方位
ZHI_FANGWEI = {
    "子": "北", "丑": "东北", "寅": "东北", "卯": "东", "辰": "东南",
    "巳": "东南", "午": "南", "未": "西南", "申": "西南", "酉": "西",
    "戌": "西北", "亥": "西北",
}

# 地支时辰对应
ZHI_SHICHEN = {
    "子": "23-1", "丑": "1-3", "寅": "3-5", "卯": "5-7",
    "辰": "7-9", "巳": "9-11", "午": "11-13", "未": "13-15",
    "申": "15-17", "酉": "17-19", "戌": "19-21", "亥": "21-23",
}

# 地支生肖
ZHI_SHENGXIAO = {
    "子": "鼠", "丑": "牛", "寅": "虎", "卯": "兔", "辰": "龙", "巳": "蛇",
    "午": "马", "未": "羊", "申": "猴", "酉": "鸡", "戌": "狗", "亥": "猪",
}

# 地支月建（节气对应月份的地支）
YUEJIAN = {
    1: "寅", 2: "卯", 3: "辰", 4: "巳", 5: "午", 6: "未",
    7: "申", 8: "酉", 9: "戌", 10: "亥", 11: "子", 12: "丑",
}

# ========== 五行生克 ==========
WUXING_SHENG = {
    "木": "火", "火": "土", "土": "金", "金": "水", "水": "木",
}
WUXING_KE = {
    "木": "土", "土": "水", "水": "火", "火": "金", "金": "木",
}

def wuxing_relationship(a: str, b: str) -> str:
    """a 相对于 b 的五行关系：生我、我生、克我、我克、比和"""
    if a == b:
        return "比和"
    if WUXING_SHENG.get(a) == b:
        return "我生"
    if WUXING_SHENG.get(b) == a:
        return "生我"
    if WUXING_KE.get(a) == b:
        return "我克"
    if WUXING_KE.get(b) == a:
        return "克我"
    return "未知"


# ========== 六十甲子 (Sexagenary Cycle) ==========
def _build_jiazi() -> list[str]:
    result = []
    for i in range(60):
        result.append(TIANGAN[i % 10] + DIZHI[i % 12])
    return result

JIAZI = _build_jiazi()
GANZHI_INDEX = {gz: i for i, gz in enumerate(JIAZI)}


# ========== 旬空 (Xun Kong — empty branches in each 10-day cycle) ==========
def get_xun_kong(ganzhi: str) -> tuple[str, str]:
    """
    返回某个干支所在旬的空亡二支。
    旬空 = 旬首地支的前两位（逆推二支）。
    例如：甲申旬，旬首申，空亡午未。
    """
    idx = GANZHI_INDEX[ganzhi]
    xun_start = (idx // 10) * 10
    xun_shou = JIAZI[xun_start]  # 旬首干支（甲X）
    xun_shou_zhi = xun_shou[1]   # 旬首地支

    # 空亡从旬首地支逆数两位
    kong1_idx = (ZHI_INDEX[xun_shou_zhi] - 2) % 12
    kong2_idx = (kong1_idx + 1) % 12
    return DIZHI[kong1_idx], DIZHI[kong2_idx]


# ========== 寄宫 (Gan Lodging) ==========
# 十干寄宫：天干寄在地支宫位（用于取第一课）
GAN_JIGONG = {
    "甲": "寅", "乙": "辰", "丙": "巳", "丁": "未", "戊": "巳",
    "己": "未", "庚": "申", "辛": "戌", "壬": "亥", "癸": "丑",
}


# ========== 三合局 ==========
SANHE = [
    ("申", "子", "辰"),  # 水局
    ("亥", "卯", "未"),  # 木局
    ("寅", "午", "戌"),  # 火局
    ("巳", "酉", "丑"),  # 金局
]

def get_sanhe(zhi: str) -> list[str] | None:
    for group in SANHE:
        if zhi in group:
            return list(group)
    return None


# ========== 六合 ==========
LIUHE_PAIRS = [
    ("子", "丑"), ("寅", "亥"), ("卯", "戌"),
    ("辰", "酉"), ("巳", "申"), ("午", "未"),
]

def get_liuhe(zhi: str) -> str | None:
    for a, b in LIUHE_PAIRS:
        if zhi == a: return b
        if zhi == b: return a
    return None


# ========== 六冲 ==========
def get_chong(zhi: str) -> str:
    return DIZHI[(ZHI_INDEX[zhi] + 6) % 12]


# ========== 六害 ==========
LIUHAI_PAIRS = [
    ("子", "未"), ("丑", "午"), ("寅", "巳"),
    ("卯", "辰"), ("申", "亥"), ("酉", "戌"),
]

def get_hai(zhi: str) -> str | None:
    for a, b in LIUHAI_PAIRS:
        if zhi == a: return b
        if zhi == b: return a
    return None


# ========== 相刑 ==========
XING = {
    "寅": "巳", "巳": "申", "申": "寅",  # 恃势之刑（无恩之刑）
    "丑": "戌", "戌": "未", "未": "丑",  # 无礼之刑
    "子": "卯", "卯": "子",              # 无礼之刑（互刑）
    "辰": "辰", "午": "午", "酉": "酉", "亥": "亥",  # 自刑
}

def get_xing(zhi: str) -> str:
    return XING.get(zhi)


# ========== 相破 ==========
PO = {
    "子": "酉", "酉": "子",
    "寅": "亥", "亥": "寅",
    "辰": "丑", "丑": "辰",
    "午": "卯", "卯": "午",
    "申": "巳", "巳": "申",
    "戌": "未", "未": "戌",
}

def get_po(zhi: str) -> str | None:
    return PO.get(zhi)


# ========== 地支藏干 (Hidden Stems in each Branch) ==========
ZHI_CANGGAN = {
    "子": ["癸"],
    "丑": ["己", "癸", "辛"],
    "寅": ["甲", "丙", "戊"],
    "卯": ["乙"],
    "辰": ["戊", "乙", "癸"],
    "巳": ["丙", "戊", "庚"],
    "午": ["丁", "己"],
    "未": ["己", "丁", "乙"],
    "申": ["庚", "壬", "戊"],
    "酉": ["辛"],
    "戌": ["戊", "辛", "丁"],
    "亥": ["壬", "甲"],
}

# 藏干主气
ZHI_ZHUQI = {
    "子": "癸", "丑": "己", "寅": "甲", "卯": "乙",
    "辰": "戊", "巳": "丙", "午": "丁", "未": "己",
    "申": "庚", "酉": "辛", "戌": "戊", "亥": "壬",
}


# ========== 贵人诀 天乙贵人 ==========
# 甲戊庚昼丑夜未，乙己昼子夜申，丙丁昼亥夜酉，辛昼午夜寅，壬癸昼巳夜卯
GUI_REN_DAY = {
    "甲": "丑", "戊": "丑", "庚": "丑",
    "乙": "子", "己": "子",
    "丙": "亥", "丁": "亥",
    "辛": "午",
    "壬": "巳", "癸": "巳",
}
GUI_REN_NIGHT = {
    "甲": "未", "戊": "未", "庚": "未",
    "乙": "申", "己": "申",
    "丙": "酉", "丁": "酉",
    "辛": "寅",
    "壬": "卯", "癸": "卯",
}

# 十二天将顺序（贵人起，顺布为：贵人 螣蛇 朱雀 六合 勾陈 青龙 天空 白虎 太常 玄武 太阴 天后）
TIANJIANG_NAMES = [
    "贵人", "螣蛇", "朱雀", "六合", "勾陈",
    "青龙", "天空", "白虎", "太常", "玄武", "太阴", "天后",
]

TIANJIANG_WUXING = {
    "贵人": "土", "螣蛇": "火", "朱雀": "火", "六合": "木",
    "勾陈": "土", "青龙": "木", "天空": "土", "白虎": "金",
    "太常": "土", "玄武": "水", "太阴": "金", "天后": "水",
}


# ========== 神煞 (常用) ==========
# 天马（驿马）：寅午戌马在申，申子辰马在寅，巳酉丑马在亥，亥卯未马在巳
TIANMA = {
    ("寅", "午", "戌"): "申",
    ("申", "子", "辰"): "寅",
    ("巳", "酉", "丑"): "亥",
    ("亥", "卯", "未"): "巳",
}

def get_tianma(ri_zhi: str) -> str:
    for key, val in TIANMA.items():
        if ri_zhi in key:
            return val
    return ""


# 桃花（咸池）：寅午戌在卯，申子辰在酉，巳酉丑在午，亥卯未在子
TAOHUA = {
    ("寅", "午", "戌"): "卯",
    ("申", "子", "辰"): "酉",
    ("巳", "酉", "丑"): "午",
    ("亥", "卯", "未"): "子",
}

def get_taohua(ri_zhi: str) -> str:
    for key, val in TAOHUA.items():
        if ri_zhi in key:
            return val
    return ""


# 禄神：甲寅 乙卯 丙戊巳 丁己午 庚申 辛酉 壬亥 癸子
LUSHEN = {
    "甲": "寅", "乙": "卯", "丙": "巳", "丁": "午", "戊": "巳",
    "己": "午", "庚": "申", "辛": "酉", "壬": "亥", "癸": "子",
}

# 羊刃：甲卯 乙寅 丙午 丁巳 戊午 己巳 庚酉 辛申 壬子 癸亥
YANGREN = {
    "甲": "卯", "乙": "寅", "丙": "午", "丁": "巳", "戊": "午",
    "己": "巳", "庚": "酉", "辛": "申", "壬": "子", "癸": "亥",
}

# 日德
RIDE = {"甲":"寅","己":"寅","乙":"申","庚":"申","丙":"巳","辛":"巳","丁":"亥","壬":"亥","戊":"巳","癸":"巳"}

# 华盖 (三合墓)：寅午戌在戌，申子辰在辰，巳酉丑在丑，亥卯未在未
def get_huagai(ri_zhi: str) -> str:
    m = {("寅","午","戌"):"戌",("申","子","辰"):"辰",("巳","酉","丑"):"丑",("亥","卯","未"):"未"}
    for k,v in m.items():
        if ri_zhi in k: return v
    return ""

# 劫煞 (三合墓前一位)
def get_jiesha(ri_zhi: str) -> str:
    m = {("寅","午","戌"):"亥",("申","子","辰"):"巳",("巳","酉","丑"):"寅",("亥","卯","未"):"申"}
    for k,v in m.items():
        if ri_zhi in k: return v
    return ""

# 灾煞 (三合旺冲)
def get_zaisha(ri_zhi: str) -> str:
    m = {("寅","午","戌"):"子",("申","子","辰"):"午",("巳","酉","丑"):"卯",("亥","卯","未"):"酉"}
    for k,v in m.items():
        if ri_zhi in k: return v
    return ""

# 将星 (三合旺)：寅午戌在午，申子辰在子，巳酉丑在酉，亥卯未在卯
def get_jiangxing(ri_zhi: str) -> str:
    m = {("寅","午","戌"):"午",("申","子","辰"):"子",("巳","酉","丑"):"酉",("亥","卯","未"):"卯"}
    for k,v in m.items():
        if ri_zhi in k: return v
    return ""

# 亡神 (将星后一辰)
def get_wangshen(ri_zhi: str) -> str:
    jx = get_jiangxing(ri_zhi)
    return DIZHI[(ZHI_INDEX[jx] - 1) % 12] if jx else ""

# 破碎 (孟酉仲巳季丑)
def get_posui(ri_zhi: str) -> str:
    m = {"子":"酉","卯":"酉","午":"酉","酉":"酉",
         "寅":"巳","申":"巳","巳":"巳","亥":"巳",
         "丑":"丑","辰":"丑","未":"丑","戌":"丑"}
    return m.get(ri_zhi, "")

# 天喜 (春戌夏丑秋辰冬未)
def get_tianxi(yue_zhi: str) -> str:
    m = {"寅":"戌","卯":"戌","辰":"戌","巳":"丑","午":"丑","未":"丑",
         "申":"辰","酉":"辰","戌":"辰","亥":"未","子":"未","丑":"未"}
    return m.get(yue_zhi, "")

# 血支
def get_xuezhi(yue_zhi: str) -> str:
    m = {"寅":"丑","卯":"未","辰":"寅","巳":"申","午":"卯","未":"酉",
         "申":"辰","酉":"戌","戌":"巳","亥":"亥","子":"午","丑":"子"}
    return m.get(yue_zhi, "")

# 丧门(岁前二辰)
def get_sangmen(taisui_zhi: str) -> str:
    return DIZHI[(ZHI_INDEX[taisui_zhi] + 2) % 12]

# 吊客(岁后二辰)
def get_diaoke(taisui_zhi: str) -> str:
    return DIZHI[(ZHI_INDEX[taisui_zhi] - 2) % 12]


# ========== 六亲（以日干为我） ==========
# 五行对应六亲
def get_liuqin(ri_gan: str, target_gan: str) -> str:
    """
    以日干为"我"，判断 target_gan 与我之六亲关系。
    返回：父母(生我)、兄弟(比和)、妻财(我克)、官鬼(克我)、子孙(我生)
    """
    wo = GAN_WUXING[ri_gan]
    ta = GAN_WUXING[target_gan]
    rel = wuxing_relationship(wo, ta)
    mapping = {
        "生我": "父母",
        "比和": "兄弟",
        "我克": "妻财",
        "克我": "官鬼",
        "我生": "子孙",
    }
    return mapping.get(rel, "未知")

def get_liuqin_by_zhi(ri_gan: str, zhi: str) -> str:
    """根据地支藏干主气定六亲"""
    return get_liuqin(ri_gan, ZHI_ZHUQI[zhi])


# ========== 辅助函数 ==========
def zhi_forward(start: str, n: int) -> str:
    """从 start 地支顺行 n 步"""
    return DIZHI[(ZHI_INDEX[start] + n) % 12]

def zhi_backward(start: str, n: int) -> str:
    """从 start 地支逆行 n 步"""
    return DIZHI[(ZHI_INDEX[start] - n) % 12]

def add_ganzhi(ganzhi: str, n: int) -> str:
    """干支序数加 n"""
    idx = GANZHI_INDEX[ganzhi]
    return JIAZI[(idx + n) % 60]
