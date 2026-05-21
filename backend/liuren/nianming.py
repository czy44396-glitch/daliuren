"""
年命/行年：本命年干支 + 行年推算。
"""

from .basics import DIZHI, ZHI_INDEX


def get_benming(birth_year_ganzhi: str | None = None, sex: str = "男") -> dict:
    """推算本命（年命）"""
    if birth_year_ganzhi is None:
        return {"年命": "", "年命寄宫": ""}
    from .basics import ZHI_WUXING
    return {
        "年命": birth_year_ganzhi,
        "年命天干": birth_year_ganzhi[0],
        "年命地支": birth_year_ganzhi[1],
        "年命五行": ZHI_WUXING[birth_year_ganzhi[1]],
        "年命寄宫": "",
    }


def get_xingnian(birth_year: int, current_year: int, sex: str = "男") -> dict:
    """
    推算行年所在的十二宫位置。

    算法：
    - 男命：从寅宫起1岁，顺行（寅=1岁,卯=2岁,...）
    - 女命：从申宫起1岁，逆行（申=1岁,未=2岁,...）
    """
    age = current_year - birth_year + 1
    if age < 1:
        age = 1

    if sex == "男":
        start = "寅"
        xingnian = DIZHI[(ZHI_INDEX[start] + (age - 1)) % 12]
    else:
        start = "申"
        xingnian = DIZHI[(ZHI_INDEX[start] - (age - 1)) % 12]

    return {
        "行年地支": xingnian,
        "年龄": age,
        "起算": "寅" if sex == "男" else "申",
    }
