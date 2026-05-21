"""
排盘总控：接收参数 → 输出完整课盘 dict。
整合天地盘、四课、三传、天将、六亲、旬空、遁干等全部要素。
"""

from datetime import datetime

from .basics import (
    DIZHI, TIANGAN, ZHI_INDEX, GANZHI_INDEX,
    GAN_WUXING, ZHI_WUXING, GAN_YINYANG, ZHI_YINYANG,
    GAN_JIGONG, ZHI_ZHUQI, get_xun_kong, get_liuqin,
    get_liuqin_by_zhi, get_chong, get_xing, get_liuhe,
    get_hai, get_tianma, get_taohua, LUSHEN, YANGREN,
    GUI_REN_DAY,
)
from .calendar import get_jieqi_times, JIEQI_NAMES

def _get_jieqi_info(year: int, month: int, day: int) -> dict:
    """获取当前日期前后的节气信息"""
    from datetime import datetime, timedelta, timezone
    import sys
    BJ_TZ = timezone(timedelta(hours=8))
    try:
        dt = datetime(year, month, day, 12, tzinfo=BJ_TZ)
    except:
        return {"当前": "—", "上月": "—", "下月": "—"}
    jieqi = get_jieqi_times(year)
    prev_jq = get_jieqi_times(year - 1)

    all_jq = {}
    for k, v in prev_jq.items():
        if v.month >= 11: all_jq[k] = v
    all_jq.update(jieqi)

    prev_name, next_name = "", ""
    for name in JIEQI_NAMES:
        t = all_jq.get(name)
        if t and t <= dt: prev_name = name
    for name in JIEQI_NAMES:
        t = all_jq.get(name)
        if t and t > dt: next_name = name; break

    return {
        "当前节气": prev_name,
        "下一节气": next_name,
        "月将": all_jq.get(prev_name, datetime(2000,1,1)).strftime("%m/%d") if prev_name else "—",
    }
from .sizhu import get_sizhu
from .yuejiang import get_yuejiang
from .tiandipan import build_tiandi_pan
from .sike import build_sike, sike_to_labels, get_sike_detail
from .sanchuan import get_sanchuan
from .tiandijiang import bu_tianjiang, get_tianjiang_for_shen
from .dungan import build_xundun
from .nianming import get_benming, get_xingnian


def paipan(
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    hour: int | None = None,
    minute: int | None = None,
    zhanshi: str | None = None,          # 占时（月将加此），如 "子"
    yuejiang_override: str | None = None,  # 手动指定月将
    birth_year: int | None = None,         # 本命年
    birth_ganzhi: str | None = None,       # 本命干支
    sex: str = "男",
    is_day: bool | None = None,            # 昼夜（自动判断）
) -> dict:
    """
    大六壬完整排盘。

    参数：
    - year/month/day/hour: 公历时间，默认为当前时间
    - zhanshi: 占时（地支），如不指定则用时支
    - yuejiang_override: 手动覆盖月将（地支），默认自动推算
    - birth_year: 出生年（公历），用于行年推算
    - birth_ganzhi: 本命干支（如 "甲子"）
    - sex: 性别
    - is_day: 昼夜（True=昼 False=夜），默认为自动（6-18点为昼）

    返回完整课盘 dict。
    """
    # 默认值
    now = datetime.now()
    if year is None: year = now.year
    if month is None: month = now.month
    if day is None: day = now.day
    if hour is None: hour = now.hour
    if minute is None: minute = now.minute

    if is_day is None:
        # 大六壬昼夜：卯辰巳午未申为昼(5-16h)，酉戌亥子丑寅为夜(17-4h)
        is_day = 5 <= hour < 17

    # 1. 四柱
    sizhu = get_sizhu(year, month, day, hour)  # 子时(23h)换日
    nian_zhu = sizhu["年柱"]
    yue_zhu = sizhu["月柱"]
    ri_zhu = sizhu["日柱"]
    shi_zhu = sizhu["时柱"]

    ri_gan = ri_zhu[0]  # 日干
    ri_zhi = ri_zhu[1]  # 日支

    # 2. 月将
    if yuejiang_override:
        yuejiang = yuejiang_override
    else:
        dt = datetime(year, month, day, hour)
        yuejiang = get_yuejiang(dt)

    # 3. 占时
    if zhanshi is None:
        zhanshi = shi_zhu[1]  # 用时支
    if zhanshi not in DIZHI:
        raise ValueError(f"无效占时：{zhanshi}，必须为十二地支之一")

    # 4. 天地盘
    tiandipan = build_tiandi_pan(yuejiang, zhanshi)

    # 5. 四课
    sike = build_sike(tiandipan, ri_gan, ri_zhi)

    # 6. 三传
    sanchuan = get_sanchuan(sike, ri_gan, ri_zhi, tiandipan)

    # 7. 十二天将
    tianjiang = bu_tianjiang(tiandipan, ri_gan, is_day)

    # 8. 六亲（三传的六亲）
    sanchuan_liuqin = {
        "初传": get_liuqin_by_zhi(ri_gan, sanchuan["初传"]),
        "中传": get_liuqin_by_zhi(ri_gan, sanchuan["中传"]),
        "末传": get_liuqin_by_zhi(ri_gan, sanchuan["末传"]),
    }

    # 四课六亲
    sike_liuqin = []
    for tian, di in sike:
        sike_liuqin.append({
            "上神": tian, "地盘": di,
            "六亲": get_liuqin_by_zhi(ri_gan, tian),
        })

    # 9. 旬空
    xunkong = get_xun_kong(ri_zhu)

    # 10. 旬遁（旬首天干顺布十二宫，旬空标记空亡）
    dungan = build_xundun(ri_zhu)

    # 11. 年命/行年
    benming = get_benming(birth_ganzhi, sex)
    if birth_year:
        xn_info = get_xingnian(birth_year, year, sex)
        xingnian = xn_info.get("行年地支", "")
    else:
        xingnian = ""
        xn_info = {}

    # 12. 神煞
    tianma = get_tianma(ri_zhi)
    taohua = get_taohua(ri_zhi)
    lushen = LUSHEN.get(ri_gan, "")
    yangren = YANGREN.get(ri_gan, "")

    from .basics import get_jiesha, get_zaisha, get_tianxi, get_xuezhi, get_sangmen, get_diaoke, RIDE, get_huagai, get_jiangxing, get_wangshen, get_posui
    nian_zhi = nian_zhu[1]
    yue_zhi_cur = yue_zhu[1]
    shensha = {
        "干煞": {
            "天乙昼贵": GUI_REN_DAY.get(ri_gan, ""),
            "禄神": lushen,
            "羊刃": yangren,
            "日德": RIDE.get(ri_gan, ""),
        },
        "支煞": {
            "驿马": tianma,
            "桃花": taohua,
            "劫煞": get_jiesha(ri_zhi),
            "灾煞": get_zaisha(ri_zhi),
            "华盖": get_huagai(ri_zhi),
            "将星": get_jiangxing(ri_zhi),
            "亡神": get_wangshen(ri_zhi),
            "破碎": get_posui(ri_zhi),
        },
        "岁煞": {
            "丧门": get_sangmen(nian_zhi),
            "吊客": get_diaoke(nian_zhi),
        },
        "月煞": {
            "天喜": get_tianxi(yue_zhi_cur),
            "血支": get_xuezhi(yue_zhi_cur),
        },
    }

    # 13. 天将配三传
    sanchuan_tianjiang = {
        "初传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["初传"]),
        "中传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["中传"]),
        "末传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["末传"]),
    }

    # 汇总
    return {
        "时间": {
            "公历": f"{year}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}",
            "四柱": sizhu,
            "日干": ri_gan,
            "日支": ri_zhi,
            "昼夜": "昼" if is_day else "夜",
        },
        "排盘参数": {
            "月将": yuejiang,
            "占时": zhanshi,
            "日干": ri_gan,
            "日支": ri_zhi,
        },
        "节气": _get_jieqi_info(year, month, day),
        "天地盘": tiandipan,
        "四课": sike_to_labels(sike),
        "四课详情": get_sike_detail(sike, ri_gan, ri_zhi),
        "四课六亲": sike_liuqin,
        "三传": sanchuan,
        "三传六亲": sanchuan_liuqin,
        "三传天将": sanchuan_tianjiang,
        "十二天将": tianjiang,
        "旬空": list(xunkong),
        "遁干": dungan,
        "年命": benming,
        "行年": xingnian,
        "行年详情": xn_info,
        "神煞": shensha,
    }
