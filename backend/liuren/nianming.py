"""
年命/行年：用户的本命年（或用占日代替）和行年推算。
"""

from .basics import DIZHI, ZHI_INDEX, GANZHI_INDEX, JIAZI, GAN_JIGONG


def get_benming(birth_year_ganzhi: str | None = None, sex: str = "男") -> dict:
    """
    推算本命（年命）。
    birth_year_ganzhi: 生年年柱干支（如 "甲子"）
    返回 {"年命": str, "年命寄宫": str, "年命阴阳": str}
    """
    if birth_year_ganzhi is None:
        return {"年命": "", "年命寄宫": ""}

    nian_gan = birth_year_ganzhi[0]
    nian_zhi = birth_year_ganzhi[1]

    # 年命五行由纳音确定（简化：用地支五行）
    from .basics import ZHI_WUXING
    return {
        "年命": birth_year_ganzhi,
        "年命天干": nian_gan,
        "年命地支": nian_zhi,
        "年命五行": ZHI_WUXING[nian_zhi],
        "年命寄宫": GAN_JIGONG.get(nian_gan, ""),
    }


def get_xingnian(birth_year: int, current_year: int, sex: str = "男") -> str:
    """
    推算行年（流年所在的十二宫位置）。

    简化算法：
    - 男：本命年起1岁（寅），逆数（顺排年龄：从寅起，每年一宫，顺行）
    - 女：本命年起1岁（申），顺数

    实际上行年推算：
    男：从寅宫起1岁，逆数（逆时针方向为增龄方向）...

    标准大六壬行年：
    男命：本命起1岁（顺行），每年逆一宫 → 这样做
    女命：本命起1岁（逆行），每年顺一宫

    行年 = 当前年龄所在的宫位。

    简化计算：age = current_year - birth_year + 1
    """
    age = current_year - birth_year + 1

    if sex == "男":
        # 从寅起1岁，顺数（顺时针）每年+1
        # 行年宫位 = 寅 + (age - 1)
        start = "寅"
        xingnian = DIZHI[(ZHI_INDEX[start] + (age - 1)) % 12]
    else:
        # 女：从申起1岁，逆数
        start = "申"
        xingnian = DIZHI[(ZHI_INDEX[start] - (age - 1)) % 12]

    return xingnian
