"""
天地盘：月将加占时 → 天盘十二宫。
"""

from .basics import DIZHI, ZHI_INDEX


def build_tiandi_pan(yuejiang: str, zhanshi: str) -> dict[str, str]:
    """
    构建天地盘。
    - 地盘：固定十二地支位置（子丑寅卯辰巳午未申酉戌亥）
    - 天盘：月将加占时之上，顺布十二神

    yuejiang: 月将地支（如 "亥"）
    zhanshi: 占时地支（如 "巳"）

    返回 {"地盘→天盘": ...}
    即 key=地盘宫位, value=天盘所乘之神
    """
    # 月将在天盘的起始位置对应占时在地盘的位置
    tian_offset = ZHI_INDEX[zhanshi]  # 占时在地盘的位置

    tianpan = {}
    for i, di_zhi in enumerate(DIZHI):
        # 天盘在地盘每个宫位上的神
        tian_zhi = DIZHI[(ZHI_INDEX[yuejiang] - tian_offset + i) % 12]
        tianpan[di_zhi] = tian_zhi

    return tianpan


def get_tianshang_shen(tiandipan: dict[str, str], dipan_gong: str) -> str:
    """
    某地盘宫位所乘的天盘神。
    dipan_gong: 地盘宫位（地支）
    返回天盘所乘之神（地支）
    """
    return tiandipan[dipan_gong]


def get_dipan_under(tiandipan: dict[str, str], tian_shen: str) -> str:
    """
    某天盘神所临的地盘宫位。
    即找到天盘某神落在地盘的哪个宫上。
    """
    for di_gong, tian in tiandipan.items():
        if tian == tian_shen:
            return di_gong
    return ""  # 不应发生


def get_sixiang(tiandipan: dict[str, str]) -> dict[str, str]:
    """
    四象位置：
    - 太阳（月将所在）之宫
    - 太阴、少阳、少阴（占时对应的四方）
    这里简化返回重点宫位。
    """
    return {
        "太阳": [k for k, v in tiandipan.items() if v == list(tiandipan.values())[0]][0],
        "地盘": str(tiandipan),
    }
