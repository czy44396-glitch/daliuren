"""
十二天将：根据贵人诀布列十二天将于天盘各宫。
"""

from .basics import (
    DIZHI, ZHI_INDEX, GUI_REN_DAY, GUI_REN_NIGHT,
    TIANJIANG_NAMES, TIANJIANG_WUXING,
)


def get_gui_ren_zhi(ri_gan: str, is_day: bool = True) -> str:
    """
    获取天乙贵人所临之地支。
    ri_gan: 日干
    is_day: True=昼, False=夜。昼用阳贵, 夜用阴贵。
    """
    if is_day:
        return GUI_REN_DAY.get(ri_gan, "未")
    return GUI_REN_NIGHT.get(ri_gan, "丑")


def bu_tianjiang(tiandipan: dict[str, str], ri_gan: str, is_day: bool = True) -> dict[str, str]:
    """
    布十二天将于天盘十二宫。
    返回 {"地盘宫位": "天将名", ...}

    规则：
    1. 贵人加于天盘贵人支所临地盘宫位
    2. 顺布：贵人→螣蛇→朱雀→六合→勾陈→青龙→天空→白虎→太常→玄武→太阴→天后
    3. 若贵人在辰戌（土）→ 贵人逆行（丑→子→亥...）
    （但顺逆取决于昼夜：贵人顺则顺布天将，逆则逆布天将）
    """
    gui_zhi = get_gui_ren_zhi(ri_gan, is_day)

    # 找到贵人在地盘的宫位
    gui_di_gong = None
    for di_gong, tian_shen in tiandipan.items():
        if tian_shen == gui_zhi:
            gui_di_gong = di_gong
            break

    if gui_di_gong is None:
        gui_di_gong = "子"  # fallback

    # 贵人顺逆规则：
    # 贵人在亥、子、丑、寅、卯、辰 → 顺排（顺时针）
    # 贵人在巳、午、未、申、酉、戌 → 逆排（逆时针）
    shun_gr = {"亥", "子", "丑", "寅", "卯", "辰"}
    shun = gui_di_gong in shun_gr
    gui_idx = ZHI_INDEX[gui_di_gong]

    result = {}
    for i, jiang_name in enumerate(TIANJIANG_NAMES):
        if shun:
            offset = i  # 顺
        else:
            offset = -i  # 逆
        target_di = DIZHI[(gui_idx + offset) % 12]
        result[target_di] = jiang_name

    return result


def get_tianjiang_at(tianjiang: dict[str, str], dipan_gong: str) -> str:
    """获取某地盘宫位上的天将"""
    return tianjiang.get(dipan_gong, "")


def get_tianjiang_for_shen(tiandipan: dict[str, str], tianjiang: dict[str, str], shen_zhi: str) -> str:
    """获取某个天盘神（地支）所对应的天将"""
    # 找到该天盘神落在哪个地盘宫位
    for di_gong, tian in tiandipan.items():
        if tian == shen_zhi:
            return tianjiang.get(di_gong, "")
    return ""
