"""
大运流年推算模块。

算法：
- 阳年男/阴年女 → 顺排（月柱向后顺推）
- 阴年男/阳年女 → 逆排（月柱向前逆推）
- 起运岁数：距上/下一节气的天数 ÷ 3（3天=1岁）
- 每大运管10年
- 流年 = 当前年份的干支
"""

from datetime import datetime, timedelta
from .basics import DIZHI, TIANGAN, GAN_YINYANG, JIAZI, GANZHI_INDEX
from .calendar import get_jieqi_times


def _get_prev_next_jieqi(year: int, month: int, day: int):
    """获取出生日期前后的节气时间"""
    jieqi = get_jieqi_times(year)
    birth_dt = datetime(year, month, day, 12, 0, 0)

    prev_jq = None
    next_jq = None

    # jieqi 返回 {节气名: datetime}，直接比较
    sorted_jq = sorted(jieqi.items(), key=lambda x: x[1])

    for name, dt in sorted_jq:
        if dt is None:
            continue
        dt = dt.replace(tzinfo=None)
        if dt <= birth_dt:
            prev_jq = (name, dt)
        if dt > birth_dt and next_jq is None:
            next_jq = (name, dt)

    return prev_jq, next_jq


def _get_ganzhi_index(ganzhi: str) -> int:
    """干支 → JIAZI 序数 (0-59)"""
    return GANZHI_INDEX.get(ganzhi, 0)


def compute_dayun(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int = 0,
    sex: str = "男",
    birth_year: int | None = None,
) -> dict:
    """
    推算大运和流年。

    返回:
      {
        "起运岁数": float,
        "起运年份": int,
        "顺逆": "顺排" | "逆排",
        "大运": [{"干支": str, "起年": int, "止年": int, "年龄": str}, ...],
        "当前大运": dict | None,
        "流年": [{"年份": int, "干支": str}, ...],   (当前大运对应的10个流年)
      }
    """
    # 获取出生日期时间
    birth_dt = datetime(year, month, day, hour, minute)

    # 年干阴阳
    from .sizhu import get_sizhu
    sizhu = get_sizhu(year, month, day, hour)
    nian_gan = sizhu["年柱"][0]
    yue_zhu = sizhu["月柱"]
    ri_zhu = sizhu["日柱"]

    is_yang_nian = GAN_YINYANG.get(nian_gan, "阳") == "阳"

    # 顺逆判断：阳年男/阴年女 = 顺排，阴年男/阳年女 = 逆排
    is_male = (sex == "男")
    forward = (is_yang_nian and is_male) or (not is_yang_nian and not is_male)

    # 起运岁数：距节气的天数 ÷ 3
    prev_jq, next_jq = _get_prev_next_jieqi(year, month, day)

    if forward:
        # 顺排：数到下一个节气的天数
        if next_jq:
            days_diff = (next_jq[1] - birth_dt).total_seconds() / 86400
        else:
            days_diff = 30  # 兜底
    else:
        # 逆排：数到上一个节气的天数
        if prev_jq:
            days_diff = (birth_dt - prev_jq[1]).total_seconds() / 86400
        else:
            days_diff = 30  # 兜底

    qiyun_age = round(days_diff / 3, 1)  # 3天=1岁
    qiyun_year = year + int(qiyun_age)

    # 生成大运（共8柱，每柱10年）
    yue_idx = _get_ganzhi_index(yue_zhu)
    dayun_list = []
    current_age = qiyun_age

    for i in range(8):
        if forward:
            dy_idx = (yue_idx + i + 1) % 60
        else:
            dy_idx = (yue_idx - i - 1) % 60

        dy_gz = JIAZI[dy_idx]
        start_age = int(qiyun_age) + i * 10
        end_age = start_age + 9
        start_year_val = year + start_age
        end_year_val = year + end_age

        dayun_list.append({
            "干支": dy_gz,
            "起年": start_year_val,
            "止年": end_year_val,
            "年龄": f"{start_age}-{end_age}岁",
        })

    # 当前大运
    now = datetime.now()
    current_year = now.year
    current_dayun = None
    for dy in dayun_list:
        if dy["起年"] <= current_year <= dy["止年"]:
            current_dayun = dy
            break

    # 流年：当前大运对应的年份干支
    liunian_list = []
    if current_dayun:
        for offset in range(-2, 8):  # 前后2年+当前6年=10年
            yn = current_year + offset
            gz_idx = yn % 60  # 年份干支简算（以立春为界，此处近似）
            # 更精确：用立春后的年份干支
            # 简化：用 (yn - 4) % 60 近似公元→干支
            ln_idx = (yn - 4) % 60
            liunian_list.append({
                "年份": yn,
                "干支": JIAZI[ln_idx],
            })

    return {
        "起运岁数": qiyun_age,
        "起运年份": qiyun_year,
        "顺逆": "顺排" if forward else "逆排",
        "年干": nian_gan,
        "年干阴阳": "阳" if is_yang_nian else "阴",
        "性别": sex,
        "大运": dayun_list,
        "当前大运": current_dayun,
        "流年": liunian_list,
    }
