"""
月将推算：太阳所躔之宫（中气后换将）。
使用 JD 比较，精确处理跨年边界。

月将顺序（中气 → 月将）：
冬至→丑, 大寒→子, 雨水→亥, 春分→戌,
谷雨→酉, 小满→申, 夏至→未, 大暑→午,
处暑→巳, 秋分→辰, 霜降→卯, 小雪→寅
"""

from datetime import datetime, timedelta, timezone
from .calendar import get_jieqi_times, jd_from_datetime, _gregorian_to_jd

BJ_TZ = timezone(timedelta(hours=8))

ZHONGQI_YUEJIANG = [
    ("冬至","丑"),("大寒","子"),("雨水","亥"),("春分","戌"),
    ("谷雨","酉"),("小满","申"),("夏至","未"),("大暑","午"),
    ("处暑","巳"),("秋分","辰"),("霜降","卯"),("小雪","寅"),
]


def get_yuejiang(dt: datetime) -> str:
    """
    获取月将。用 JD 直接比较，取当前时刻之前最近的一个中气对应的月将。

    算法：取前后三年的中气JD，找到 ≤ 当前JD 的最大中气。
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BJ_TZ)

    jd_now = jd_from_datetime(dt)

    # 收集前后三年的所有中气 JD
    all_zq = []  # [(jd, 中气名), ...]
    for yr_offset in [-1, 0, 1]:
        year = dt.year + yr_offset
        jieqi = get_jieqi_times(year)
        for name, _ in ZHONGQI_YUEJIANG:
            if name in jieqi:
                jd = jd_from_datetime(jieqi[name])
                all_zq.append((jd, name))

    # 找 ≤ jd_now 的最大中气
    best_jd = -1e30
    best_name = "冬至"
    for jd, name in all_zq:
        if jd <= jd_now and jd > best_jd:
            best_jd = jd
            best_name = name

    # 映射到月将
    for name, yuejiang in ZHONGQI_YUEJIANG:
        if name == best_name:
            return yuejiang

    return "丑"  # fallback
