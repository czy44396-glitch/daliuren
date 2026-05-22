"""
三传推算 — 九宗门完整正确实现。

判断优先级（依《六壬大全》）：
  1. 伏吟（天地盘特殊格局）
  2. 返吟（天地盘全冲，有克则走正常克法，无克则取驿马）
  3. 贼克（重审/元首）— 贼(下克上)优先于克(上克下)
  4. 比用 — 只在同优先级贼或克中比较
  5. 涉害 — 同比时比较克数深浅，涉害同深取孟仲季
  6. 遥克（蒿矢/弹射）— 同样走比用→涉害链
  7. 昴星（虎视/冬蛇掩目）— 四课全异无克无遥
  8. 别责 — 四课三异
  9. 八专 — 八专日四课二异
"""

from .basics import (
    DIZHI, TIANGAN, ZHI_INDEX, GAN_YINYANG, ZHI_YINYANG,
    ZHI_WUXING, GAN_WUXING, GAN_JIGONG, ZHI_ZHUQI,
    get_chong, get_xing, get_tianma,
)


# ========== 工具函数 ==========

def _ke(tian: str, di: str) -> str | None:
    """判断一课的克关系。返回 'zei'(下克上), 'ke'(上克下), 或 None"""
    tw, dw = ZHI_WUXING[tian], ZHI_WUXING[di]
    ke_map = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}
    if ke_map.get(dw) == tw:
        return "zei"   # 下克上（贼）
    if ke_map.get(tw) == dw:
        return "ke"    # 上克下（克）
    return None


def _same_yinyang(zhi: str, ri_gan: str) -> bool:
    """上神地支与日干阴阳是否相同（比）"""
    return ZHI_YINYANG[zhi] == GAN_YINYANG[ri_gan]


def _tian_lin_di(tiandipan: dict, tian: str) -> str | None:
    """天盘神 → 所临地盘宫位"""
    for di, t in tiandipan.items():
        if t == tian:
            return di
    return None


# ========== 涉害深度计算 ==========

def _shehai_depth(tian: str, di: str, ke_type: str, tiandipan: dict) -> int:
    """
    涉害深度：从地盘宫位 di 顺时针巡行十二宫，
    回到天盘上神 tian 的本位（即 tian 自身在地盘的位置），
    沿途每个宫位检查对应类型的克关系并计数。

    标准涉害法：
    - 以地盘宫位为起点，顺时针逐宫巡行
    - 每到一宫，检查该宫天盘与地盘之间是否有指定类型的克
    - 巡行至天盘上神本位为止
    - 沿途克的总次数即为涉害深度
    """
    count = 0
    start_idx = ZHI_INDEX[di]
    target_idx = ZHI_INDEX[tian]  # 天盘上神本位

    for step in range(12):
        cur_idx = (start_idx + step) % 12
        cur_di = DIZHI[cur_idx]
        cur_tian = tiandipan[cur_di]

        k = _ke(cur_tian, cur_di)
        if ke_type == "zei":
            if k == "zei":
                count += 1
        else:  # ke_type == "ke"
            if k == "ke":
                count += 1

        # 到达天盘上神本位则停止
        if cur_idx == target_idx:
            break

    return count


# ========== 克选择链：贼克分离 → 比用 → 涉害 → 孟仲季 ==========

# 孟仲季分类
_MENG = {"寅", "申", "巳", "亥"}
_ZHONG = {"子", "午", "卯", "酉"}
# 季 = 辰戌丑未（不在孟/仲中的即季）


def _di_category(di: str) -> str:
    """地盘宫位的孟仲季分类"""
    if di in _MENG:
        return "meng"
    if di in _ZHONG:
        return "zhong"
    return "ji"


def _select_by_shehai_mengzhongji(
    tied_candidates: list[dict],
    ri_gan: str,
    sike: list,
) -> dict:
    """
    涉害深度相同时，用孟仲季法选初传。
    tied_candidates: 涉害深度相同的克候选 [{tian, di, type}, ...]

    优先级：孟(寅申巳亥) > 仲(子午卯酉) > 季(辰戌丑未)
    同在孟/仲/季则：阳日取干上神，阴日取支上神（缀瑕法）
    """
    meng = [k for k in tied_candidates if _di_category(k["di"]) == "meng"]
    zhong = [k for k in tied_candidates if _di_category(k["di"]) == "zhong"]

    if meng:
        return meng[0]
    if zhong:
        return zhong[0]

    # 都在季（辰戌丑未）→ 缀瑕：阳日取干上神（第一课），阴日取支上神（第三课）
    if GAN_YINYANG[ri_gan] == "阳":
        return {"tian": sike[0][0], "di": sike[0][1], "type": "ke"}
    else:
        return {"tian": sike[2][0], "di": sike[2][1], "type": "ke"}


def _select_from_candidates(
    candidates: list[dict],
    ri_gan: str,
    sike: list,
    tiandipan: dict,
) -> dict | None:
    """
    从一组克候选（已按贼优先筛选过的）中选出初传。

    选择链：1个→直接返回; 多个→比用; 同比1个→返回;
    同比多个→涉害; 涉害独深→返回; 同深→孟仲季。

    返回选中的克候选 dict {tian, di, type}，或 None。
    """
    if not candidates:
        return None

    if len(candidates) == 1:
        return candidates[0]

    # --- 比用：取与日干同阴阳者 ---
    same = [k for k in candidates if _same_yinyang(k["tian"], ri_gan)]

    if len(same) == 1:
        return same[0]

    # --- 涉害：计算深度 ---
    # 确定用哪些候选做涉害比较
    compare = same if same else candidates  # 俱不比则全部参与涉害

    depths = []
    for k in compare:
        d = _shehai_depth(k["tian"], k["di"], k["type"], tiandipan)
        depths.append((d, k))

    # 按深度降序排列（克数多者优先）
    depths.sort(key=lambda x: -x[0])
    max_d = depths[0][0]

    tie = [item[1] for item in depths if item[0] == max_d]

    if len(tie) == 1:
        return tie[0]

    # --- 孟仲季法 ---
    return _select_by_shehai_mengzhongji(tie, ri_gan, sike)


# ========== 1. 伏吟/返吟检测 ==========

def _check_fuyin(tiandipan: dict) -> bool:
    """判断是否伏吟：每宫天盘 == 地盘"""
    for di in DIZHI:
        if tiandipan[di] != di:
            return False
    return True


def _check_fanyin(tiandipan: dict) -> bool:
    """判断是否返吟：每宫天盘都是地盘对冲位"""
    for di in DIZHI:
        if tiandipan[di] != get_chong(di):
            return False
    return True


# ========== 2. 八专检测 ==========

def _is_bazhuan(ri_gan: str, ri_zhi: str) -> bool:
    """判断是否八专日：日干寄宫 == 日支（干支同位）"""
    return GAN_JIGONG.get(ri_gan) == ri_zhi


# ========== 主入口 ==========

def get_sanchuan(
    sike: list,
    ri_gan: str,
    ri_zhi: str,
    tiandipan: dict,
) -> dict:
    """
    推算三传。

    输入:
      sike: [(上神, 地盘), ...] 四课
      ri_gan: 日干
      ri_zhi: 日支
      tiandipan: {地盘: 天盘神}

    返回:
      {"方法": str, "初传": str, "中传": str, "末传": str,
       "初传地盘": str, "中传地盘": str, "末传地盘": str}
    """
    # --- 判断特殊格局 ---
    is_fuyin = _check_fuyin(tiandipan)
    is_fanyin = _check_fanyin(tiandipan)
    is_bazhuan = _is_bazhuan(ri_gan, ri_zhi) and not is_fuyin and not is_fanyin

    # --- 找出所有克 ---
    ke_list = []
    for i, (tian, di) in enumerate(sike):
        kt = _ke(tian, di)
        if kt:
            ke_list.append({"idx": i, "tian": tian, "di": di, "type": kt})

    # 区分贼和克（贼优先）
    zei_list = [k for k in ke_list if k["type"] == "zei"]
    ke_only_list = [k for k in ke_list if k["type"] == "ke"]

    chuchuan = None
    zhongchuan = None
    mochuan = None
    method = ""

    # ============ 伏吟 ============
    if is_fuyin:
        method = "伏吟"
        is_yang = GAN_YINYANG[ri_gan] == "阳"
        gan_shang = GAN_JIGONG[ri_gan]   # 干上神（伏吟即寄宫）
        zhi_shang = ri_zhi                # 支上神（伏吟即日支）
        ZIXING = {"辰", "午", "酉", "亥"}

        if ke_list:
            # ====== 规则 A：有克 ======
            # 伏吟有克：直接用克选择链（伏吟中所有课地盘=上神，但有克关系时正常取）
            selected = _select_from_candidates(ke_list, ri_gan, sike, tiandipan)
            if selected:
                chuchuan = selected["tian"]

            # 中传 = 初传所刑（伏吟特例）
            zhongchuan = get_xing(chuchuan)
            if chuchuan in ZIXING:
                zhongchuan = zhi_shang if is_yang else gan_shang

            # 末传 = 中传所刑；若中传自刑 → 末传 = 中传之冲
            mochuan = get_xing(zhongchuan)
            if zhongchuan in ZIXING:
                mochuan = get_chong(zhongchuan)
        else:
            # ====== 规则 B：无克（自任/自信格） ======
            if is_yang:
                chuchuan = gan_shang  # 阳日自任格
            else:
                chuchuan = zhi_shang  # 阴日自信格

            # 杜传格
            if chuchuan in ZIXING:
                zhongchuan = zhi_shang if is_yang else gan_shang
            else:
                zhongchuan = get_xing(chuchuan)

            mochuan = get_xing(zhongchuan)
            if zhongchuan in ZIXING:
                mochuan = get_chong(zhongchuan)

    # ============ 返吟 ============
    elif is_fanyin:
        method = "返吟"
        if ke_list:
            # ====== 返吟有克：走正常克选择链 ======
            candidates = zei_list if zei_list else ke_only_list
            selected = _select_from_candidates(candidates, ri_gan, sike, tiandipan)
            if selected:
                chuchuan = selected["tian"]
        else:
            # ====== 返吟无克：取驿马 ======
            tianma = get_tianma(ri_zhi)
            chuchuan = tiandipan.get(tianma, sike[0][0])

    # ============ 正常克（非伏吟非返吟） ============
    elif ke_list:
        # 贼优先：有贼只取贼，无贼才取克
        candidates = zei_list if zei_list else ke_only_list

        selected = _select_from_candidates(candidates, ri_gan, sike, tiandipan)
        if selected:
            chuchuan = selected["tian"]
            # 确定方法名
            if zei_list:
                method = "重审" if len(zei_list) == 1 else "涉害"
                # 如果经过了比用
                same_count = len([k for k in zei_list if _same_yinyang(k["tian"], ri_gan)])
                if same_count == 1 and len(zei_list) >= 2:
                    method = "比用"
            else:
                method = "元首" if len(ke_only_list) == 1 else "涉害"
                same_count = len([k for k in ke_only_list if _same_yinyang(k["tian"], ri_gan)])
                if same_count == 1 and len(ke_only_list) >= 2:
                    method = "比用"

    # ============ 无克 → 遥克 ============
    if chuchuan is None and not is_fuyin and not is_fanyin:
        ri_wx = GAN_WUXING[ri_gan]
        ke_map = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}

        haoshi = []   # 上神遥克日干 → 蒿矢（日被克，主他人主动）
        tanshe = []   # 日干遥克上神 → 弹射（日克他，主我主动）

        for i, (tian, di) in enumerate(sike):
            tw = ZHI_WUXING[tian]
            if ke_map.get(tw) == ri_wx:
                # 上神五行克日干五行 → 蒿矢
                haoshi.append({"idx": i, "tian": tian, "di": di, "type": "ke"})
            if ke_map.get(ri_wx) == tw:
                # 日干五行克上神五行 → 弹射
                tanshe.append({"idx": i, "tian": tian, "di": di, "type": "ke"})

        if haoshi:
            # 蒿矢优先
            method = "蒿矢"
            selected = _select_from_candidates(haoshi, ri_gan, sike, tiandipan)
            if selected:
                chuchuan = selected["tian"]
        elif tanshe:
            method = "弹射"
            selected = _select_from_candidates(tanshe, ri_gan, sike, tiandipan)
            if selected:
                chuchuan = selected["tian"]

    # ============ 无克无遥 → 昴星 / 别责 / 八专 ============
    if chuchuan is None and not is_fuyin and not is_fanyin:
        unique_pairs = list(set(sike))
        n_unique = len(unique_pairs)

        if is_bazhuan and n_unique == 2:
            # 八专课
            method = "八专"
            if GAN_YINYANG[ri_gan] == "阳":
                # 阳日：干上神顺数第三位（从干上神地盘起，天盘顺三位）
                gan_shang_shen = sike[0][0]
                chuchuan = DIZHI[(ZHI_INDEX[gan_shang_shen] + 2) % 12]
            else:
                # 阴日：第四课上神逆数第三位
                si_shang_shen = sike[3][0]
                chuchuan = DIZHI[(ZHI_INDEX[si_shang_shen] - 2) % 12]

        elif n_unique == 3:
            # 别责课
            method = "别责"
            if GAN_YINYANG[ri_gan] == "阳":
                # 阳日别责：取日干合干之寄宫上神
                he_map = {
                    "甲": "己", "己": "甲", "乙": "庚", "庚": "乙",
                    "丙": "辛", "辛": "丙", "丁": "壬", "壬": "丁",
                    "戊": "癸", "癸": "戊",
                }
                he_gan = he_map.get(ri_gan, ri_gan)
                he_jigong = GAN_JIGONG[he_gan]
                chuchuan = tiandipan[he_jigong]
            else:
                # 阴日别责：取日支三合局的前位之上神
                sanhe_front = {
                    "子": "辰", "丑": "巳", "寅": "午", "卯": "未",
                    "辰": "申", "巳": "酉", "午": "戌", "未": "亥",
                    "申": "子", "酉": "丑", "戌": "寅", "亥": "卯",
                }
                front_zhi = sanhe_front.get(ri_zhi, ri_zhi)
                chuchuan = tiandipan[front_zhi]

        elif n_unique == 4:
            # 昴星课（《六壬大全》：刚日仰视地盘酉上神，柔日伏视天盘酉下神）
            method = "昴星"
            if GAN_YINYANG[ri_gan] == "阳":
                # 虎视课：仰视地盘酉之上神为初传
                chuchuan = tiandipan["酉"]
            else:
                # 冬蛇掩目课：伏视天盘酉所临地盘之支为初传
                # 《六壬大全》原文："柔日伏视天盘，酉下神为用"
                chuchuan = _tian_lin_di(tiandipan, "酉")
                if not chuchuan:
                    chuchuan = tiandipan["酉"]  # 兜底

    # ============ 兜底 ============
    if chuchuan is None:
        chuchuan = sike[0][0]
        if not method:
            method = "未知"

    # ============ 中传/末传 ============

    # 伏吟已设中末传，跳过通用规则
    if method == "伏吟":
        pass  # zhongchuan, mochuan already set

    # 昴星中末传
    elif method == "昴星":
        if GAN_YINYANG[ri_gan] == "阳":
            # 阳日：中传 = 支上神, 末传 = 干上神
            zhongchuan = tiandipan[ri_zhi]
            mochuan = sike[0][0]
        else:
            # 阴日：中传 = 干上神, 末传 = 支上神
            zhongchuan = sike[0][0]
            mochuan = tiandipan[ri_zhi]

    # 别责/八专：中末传都取干上神（三传同宫）
    elif method in ("别责", "八专"):
        zhongchuan = sike[0][0]
        mochuan = sike[0][0]

    # 返吟无克的中末传
    elif method == "返吟" and not ke_list:
        zhongchuan = tiandipan[ri_zhi]   # 支上神
        mochuan = sike[0][0]              # 干上神

    # 通用规则：中传 = 初传地盘之上神，末传 = 中传地盘之上神
    if zhongchuan is None:
        zhongchuan = tiandipan[chuchuan]

    if mochuan is None:
        mochuan = tiandipan[zhongchuan]

    # --- 确定各传所临地盘 ---
    def _find_di(shen: str) -> str:
        """天盘神 → 所临地盘（遍历天地盘获取）"""
        d = _tian_lin_di(tiandipan, shen)
        if d:
            return d
        # 兜底：根据地支自身位置推算
        return DIZHI[(ZHI_INDEX[shen] + 2) % 12]

    c_di = _find_di(chuchuan)
    z_di = _find_di(zhongchuan)
    m_di = _find_di(mochuan)

    return {
        "方法": method,
        "初传": chuchuan, "中传": zhongchuan, "末传": mochuan,
        "初传地盘": c_di, "中传地盘": z_di, "末传地盘": m_di,
    }
