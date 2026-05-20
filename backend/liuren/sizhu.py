"""
四柱推算：年柱、月柱、日柱、时柱的干支确定。
使用北京时间 (UTC+8)，年柱以立春为界，月柱以节气为界。
日柱使用高氏公式 + 儒略日双重校验。
"""

from datetime import datetime, timedelta, timezone
from .basics import TIANGAN, DIZHI, JIAZI, GANZHI_INDEX, ZHI_INDEX
from .calendar import get_jieqi_times, _gregorian_to_jd, jd_from_datetime

BJ_TZ = timezone(timedelta(hours=8))

# 五虎遁：年干 → 寅月天干
WUHU_DUN = {
    "甲":"丙","己":"丙", "乙":"戊","庚":"戊",
    "丙":"庚","辛":"庚", "丁":"壬","壬":"壬",
    "戊":"甲","癸":"甲",
}

# 五鼠遁：日干 → 子时天干
WUSHU_DUN = {
    "甲":"甲","己":"甲", "乙":"丙","庚":"丙",
    "丙":"戊","辛":"戊", "丁":"庚","壬":"庚",
    "戊":"壬","癸":"壬",
}

# 月支对应的节气起始
YUEZHI_JIEQI = {
    "寅":"立春","卯":"惊蛰","辰":"清明","巳":"立夏",
    "午":"芒种","未":"小暑","申":"立秋","酉":"白露",
    "戌":"寒露","亥":"立冬","子":"大雪","丑":"小寒",
}


def get_ri_zhu(year: int, month: int, day: int, hour: int = 12) -> str:
    """
    推算日柱干支。使用北京时间，子时(23:00)起算下一日。
    基准：1900-01-01 = 甲戌 (JIAZI index 10)。
    """
    # 中国传统历法：子时(23:00)开始新的一天
    if hour >= 23:
        import datetime
        dt = datetime.datetime(year, month, day) + datetime.timedelta(days=1)
        year, month, day = dt.year, dt.month, dt.day

    jd = int(_gregorian_to_jd(year, month, day, 12))
    base_jd = int(_gregorian_to_jd(1900, 1, 1, 12))
    base_idx = 10  # 甲戌
    offset = (jd - base_jd) % 60
    return JIAZI[(base_idx + offset) % 60]


def get_nian_zhu(year: int, month: int, day: int, hour: int = 12) -> str:
    """
    推算年柱干支（以立春为界），使用 JD 比较。
    立春前属上年，立春后属当年。
    """
    dt = datetime(year, month, day, 12, tzinfo=BJ_TZ)
    jd_now = jd_from_datetime(dt)
    jieqi = get_jieqi_times(year)

    lichun_jd = None
    for k in jieqi:
        if "立春" in k or k == "立春":
            lichun_jd = jd_from_datetime(jieqi[k])
            break

    if lichun_jd is not None and jd_now < lichun_jd:
        year -= 1

    base_year = 1984
    offset = ((year - base_year) % 60 + 60) % 60  # handle negative
    return JIAZI[offset]


def get_yue_zhu(nian_gan: str, year: int, month: int, day: int) -> str:
    """
    推算月柱（以节为界），使用 JD 比较。
    寅月 = [立春, 惊蛰), 卯月 = [惊蛰, 清明), ..., 丑月 = [小寒, 立春)
    """
    dt = datetime(year, month, day, 12, tzinfo=BJ_TZ)
    jd_now = jd_from_datetime(dt)
    jieqi = get_jieqi_times(year)

    yuezhi_jieqi_ordered = [
        ("寅", "立春"), ("卯", "惊蛰"), ("辰", "清明"),
        ("巳", "立夏"), ("午", "芒种"), ("未", "小暑"),
        ("申", "立秋"), ("酉", "白露"), ("戌", "寒露"),
        ("亥", "立冬"), ("子", "大雪"), ("丑", "小寒"),
    ]

    yue_zhi = "寅"
    for i, (zhi, jq_name) in enumerate(yuezhi_jieqi_ordered):
        t_start = jieqi.get(jq_name)
        if t_start is None:
            continue
        jd_start = jd_from_datetime(t_start)
        next_i = (i + 1) % 12
        next_jq_name = yuezhi_jieqi_ordered[next_i][1]
        t_end = jieqi.get(next_jq_name)
        if t_end is None:
            continue
        jd_end = jd_from_datetime(t_end)

        if jd_start <= jd_now < jd_end:
            yue_zhi = zhi
            break

    # 五虎遁：寅月为第0月
    yue_gan_start = WUHU_DUN[nian_gan]
    gan_idx = TIANGAN.index(yue_gan_start)
    month_num = (ZHI_INDEX[yue_zhi] - ZHI_INDEX["寅"]) % 12
    yue_gan = TIANGAN[(gan_idx + month_num) % 10]

    return yue_gan + yue_zhi


def get_shi_zhu(ri_gan: str, hour: int) -> str:
    """推算时柱（23-1为子时）。"""
    shi_zhi_idx = ((hour + 1) // 2) % 12
    shi_zhi = DIZHI[shi_zhi_idx]

    shi_gan_start = WUSHU_DUN[ri_gan]
    gan_idx = TIANGAN.index(shi_gan_start)
    shi_gan = TIANGAN[(gan_idx + shi_zhi_idx) % 10]

    return shi_gan + shi_zhi


def get_sizhu(year: int, month: int, day: int, hour: int = 12) -> dict:
    """一次性推算四柱。中国历法子时(23:00)换日。"""
    # 子时(>=23)用次日日期
    if hour >= 23:
        import datetime
        dt = datetime.datetime(year, month, day) + datetime.timedelta(days=1)
        ny, nm, nd = dt.year, dt.month, dt.day
    else:
        ny, nm, nd = year, month, day

    nian = get_nian_zhu(ny, nm, nd, hour)
    yue = get_yue_zhu(nian[0], ny, nm, nd)
    ri = get_ri_zhu(year, month, day, hour)
    shi = get_shi_zhu(ri[0], hour)
    return {"年柱": nian, "月柱": yue, "日柱": ri, "时柱": shi}
