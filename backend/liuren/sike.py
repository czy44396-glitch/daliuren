"""
四课排布：从天地盘和日干支推导四课。
"""

from .basics import DIZHI, ZHI_INDEX, GAN_JIGONG
from .tiandipan import build_tiandi_pan, get_tianshang_shen


def build_sike(tiandipan: dict[str, str], ri_gan: str, ri_zhi: str) -> list[tuple[str, str]]:
    """
    排布四课。
    返回 [(天上神, 本宫), (天上神, 本宫), (天上神, 本宫), (天上神, 本宫)]
    分别对应第一、二、三、四课。

    第一课：日干寄宫 → 看其天盘所乘之神（第一个上神）
    第二课：第一课上神 → 看其天盘所乘之神
    第三课：日支宫 → 看其天盘所乘之神
    第四课：第三课上神 → 看其天盘所乘之神
    """
    # 第一课：日干寄宫
    gan_jigong = GAN_JIGONG[ri_gan]  # 日干寄在地盘哪一宫
    shang_1 = get_tianshang_shen(tiandipan, gan_jigong)  # 第一课上神
    ke_1 = (shang_1, gan_jigong)

    # 第二课：第一课上神所临地盘宫位的天盘上神
    shang_2 = get_tianshang_shen(tiandipan, shang_1)
    ke_2 = (shang_2, shang_1)

    # 第三课：日支宫
    shang_3 = get_tianshang_shen(tiandipan, ri_zhi)  # 第三课上神
    ke_3 = (shang_3, ri_zhi)

    # 第四课：第三课上神所临地盘宫位的天盘上神
    shang_4 = get_tianshang_shen(tiandipan, shang_3)
    ke_4 = (shang_4, shang_3)

    return [ke_1, ke_2, ke_3, ke_4]


def sike_to_labels(sike: list[tuple[str, str]]) -> dict:
    """将四课转换为有标签的字典"""
    return {
        "第一课": f"{sike[0][0]}{sike[0][1]}",
        "第二课": f"{sike[1][0]}{sike[1][1]}",
        "第三课": f"{sike[2][0]}{sike[2][1]}",
        "第四课": f"{sike[3][0]}{sike[3][1]}",
    }


def get_sike_detail(sike: list[tuple[str, str]], ri_gan: str = "", ri_zhi: str = "") -> list[dict]:
    """
    返回四课详细信息。
    第1课地盘显示日干，但天将查找用地支(寄宫)。
    第3课地盘显示日支。
    """
    from .basics import GAN_JIGONG
    return [
        {
            "课序": 1,
            "上神": sike[0][0], "地盘": ri_gan,           # 显示用日干
            "地盘地支": GAN_JIGONG.get(ri_gan, sike[0][1]), # 天将查找用寄宫
        },
        {
            "课序": 2,
            "上神": sike[1][0], "地盘": sike[1][1],
            "地盘地支": sike[1][1],
        },
        {
            "课序": 3,
            "上神": sike[2][0], "地盘": ri_zhi,           # 显示用日支
            "地盘地支": ri_zhi,                             # 天将查找用日支
        },
        {
            "课序": 4,
            "上神": sike[3][0], "地盘": sike[3][1],
            "地盘地支": sike[3][1],
        },
    ]
