"""
月将推算：根据节气确定当前所用月将。
月将 = 太阳所躔之宫（中气后用该将）。
使用 JD 比较，不受 datetime 年份限制。
"""

from datetime import datetime
from .calendar import get_jieqi_times, jd_from_datetime, _gregorian_to_jd, _jd_to_gregorian

ZHONGQI_YUEJIANG = {
    "冬至":"丑","大寒":"子","雨水":"亥","春分":"戌",
    "谷雨":"酉","小满":"申","夏至":"未","大暑":"午",
    "处暑":"巳","秋分":"辰","霜降":"卯","小雪":"寅",
}
ZHONGQI_ORDER = [
    "冬至","大寒","雨水","春分","谷雨","小满",
    "夏至","大暑","处暑","秋分","霜降","小雪",
]


def get_yuejiang(dt: datetime) -> str:
    """
    获取月将（自动推算）。使用 JD 比较，支持任意年份。
    """
    jd_now = jd_from_datetime(dt)
    year = dt.year

    # 获取当年+去年的节气 JD
    def _get_jieqi_jds(y: int) -> dict:
        jieqi = get_jieqi_times(y)
        return {name: jd_from_datetime(t) for name, t in jieqi.items()}

    jieqi_jds = _get_jieqi_jds(year)
    last_jds = _get_jieqi_jds(year - 1)

    latest = None
    for name in ZHONGQI_ORDER:
        jd = jieqi_jds.get(name)
        if jd is None: jd = last_jds.get(name)
        if jd is not None and jd <= jd_now:
            latest = name

    if latest is None:
        return "丑"
    return ZHONGQI_YUEJIANG[latest]
