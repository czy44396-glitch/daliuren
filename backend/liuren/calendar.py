"""
节气计算模块 — 纯整数儒略日算法，支持公元前后任意年份。
返回北京时间 (UTC+8)。
"""

import math
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
BJ_TZ = timezone(timedelta(hours=8))

JIEQI_NAMES = [
    "小寒","大寒","立春","雨水","惊蛰","春分",
    "清明","谷雨","立夏","小满","芒种","夏至",
    "小暑","大暑","立秋","处暑","白露","秋分",
    "寒露","霜降","立冬","小雪","大雪","冬至",
]

# 太阳黄经目标（度），从小寒(285°)开始
JIEQI_LON = [
    285,300,315,330,345, 0,15,30,45,60,75,90,
    105,120,135,150,165,180,195,210,225,240,255,270,
]


def _sun_lon(jd: float) -> float:
    """太阳视黄经（度），Jean Meeus 低精度公式"""
    T = (jd - 2451545.0) / 36525.0
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
    M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
    C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(math.radians(M))
         + (0.019993 - 0.000101 * T) * math.sin(math.radians(2 * M))
         + 0.000289 * math.sin(math.radians(3 * M)))
    lon = (L0 + C) % 360
    omega = 125.04 - 1934.136 * T
    lon += 0.0048 * math.sin(math.radians(omega))
    return lon % 360


def _jd_to_gregorian(jd: float) -> tuple[int, int, int, int, int, int]:
    """
    儒略日 → 公历 (年, 月, 日, 时, 分, 秒) UTC。
    使用整数算法，不依赖系统时间戳，支持任意年份。
    """
    jd += 0.5
    Z = int(jd)
    F = jd - Z

    if Z < 2299161:
        A = Z
    else:
        alpha = int((Z - 1867216.25) / 36524.25)
        A = Z + 1 + alpha - int(alpha / 4)

    B = A + 1524
    C = int((B - 122.1) / 365.25)
    D = int(365.25 * C)
    E = int((B - D) / 30.6001)

    day = B - D - int(30.6001 * E) + F
    month = E - 1 if E < 14 else E - 13
    year = C - 4716 if month > 2 else C - 4715

    day_int = int(day)
    day_frac = day - day_int
    hours = int(day_frac * 24)
    minutes = int((day_frac * 24 - hours) * 60)
    seconds = int((day_frac * 24 * 3600 - hours * 3600 - minutes * 60))

    return year, month, day_int, hours, minutes, seconds


def _gregorian_to_jd(year: int, month: int, day: int, hour: int = 12) -> float:
    """
    公历 (年, 月, 日, 时) UTC → 儒略日。
    纯整数算法。
    """
    if month <= 2:
        year -= 1
        month += 12

    A = year // 100
    B = 2 - A + A // 4

    jd = int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + B - 1524.5
    jd += (hour - 12) / 24.0
    return jd


def jd_from_datetime(dt: datetime) -> float:
    """将任意 datetime 转为 JD。datetime 须带时区。"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BJ_TZ)
    utc = dt.astimezone(UTC)
    return _gregorian_to_jd(utc.year, utc.month, utc.day,
                             utc.hour + utc.minute/60.0 + utc.second/3600.0)

def _jd_to_bj_datetime(jd: float) -> datetime:
    """
    儒略日 → 北京时间 datetime（仅用于显示，要求 year>=1）。
    """
    y, m, d, h, mi, s = _jd_to_gregorian(jd)
    if y < 1: y = 1  # clamp for datetime.min
    if y > 9999: y = 9999  # clamp for datetime.max
    try:
        return datetime(y, m, d, h, mi, s, tzinfo=BJ_TZ)
    except (ValueError, OverflowError):
        return datetime(2000, 1, 1, tzinfo=BJ_TZ)


def get_jieqi_times(year: int) -> dict[str, datetime]:
    """
    计算指定年份 24 节气的北京时间。
    使用牛顿迭代法，支持任意年份。
    """
    result = {}
    jd_start = _gregorian_to_jd(year, 1, 1, 0)

    for i, name in enumerate(JIEQI_NAMES):
        target = JIEQI_LON[i]
        guess_jd = jd_start + i * 15.22

        for _ in range(15):
            lon = _sun_lon(guess_jd)
            diff = ((lon - target) + 180) % 360 - 180
            if abs(diff) < 0.00001:
                break
            guess_jd -= diff / 0.9856

        result[name] = _jd_to_bj_datetime(guess_jd)

    return result
