"""
旬遁（遁干）：以日柱所在旬的旬首天干，顺布十二地支宫位。
旬空二支无遁干，标记为"空"。

算法：
1. 找到日柱所在旬的旬首（甲X）
2. 旬首天干=甲，从旬首地支开始，顺布甲乙丙丁...至十二宫
3. 旬空二支 = 空亡
"""

from .basics import TIANGAN, DIZHI, ZHI_INDEX, JIAZI, GANZHI_INDEX, get_xun_kong


def build_xundun(ri_ganzhi: str) -> dict[str, str]:
    """
    旬遁推算。
    ri_ganzhi: 日柱干支（如"癸巳"）

    返回 {"子": "甲", "丑": "乙", ..., "午": "（空）", ...}
    """
    idx = GANZHI_INDEX[ri_ganzhi]
    xun_start = (idx // 10) * 10
    xun_shou = JIAZI[xun_start]  # 旬首干支（甲X）
    xun_shou_gan = xun_shou[0]   # "甲"（永远是甲）
    xun_shou_zhi = xun_shou[1]   # 旬首地支

    xunkong = set(get_xun_kong(ri_ganzhi))
    start_idx = ZHI_INDEX[xun_shou_zhi]
    gan_start_idx = TIANGAN.index(xun_shou_gan)  # 0 (甲)

    result = {}
    for i in range(12):
        zhi = DIZHI[(start_idx + i) % 12]
        if zhi in xunkong:
            result[zhi] = "（空）"
        else:
            gan = TIANGAN[(gan_start_idx + i) % 10]
            result[zhi] = gan

    return result
