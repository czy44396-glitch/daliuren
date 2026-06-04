"""
解盘引擎 — AI 智能解读。

使用 Anthropic SDK（兼容 DeepSeek 等模型）。
从环境变量读取 ANTHROPIC_BASE_URL、ANTHROPIC_AUTH_TOKEN、ANTHROPIC_MODEL。
"""

import json, os, re
from .basics import (
    DIZHI, TIANGAN, ZHI_WUXING, GAN_WUXING, ZHI_YINYANG,
    get_chong, get_liuhe, get_liuqin_by_zhi,
    TIANJIANG_NAMES, TIANJIANG_WUXING,
)


def _build_system_prompt() -> str:
    return """你是一位精通大六壬的命理师，擅长根据课盘进行深入、灵活的占卜解读。

## 六壬大全·课经参考（解读时择要引用）

**元首课**：一上克下，余课无克。象天如君克臣，万事顺利。统《乾》之体，元吉第一课。断曰：天地得位，品物咸新。事用君子，忧喜俱真。
**重审课**：一下贼上，余课无克。象地事逆，以下犯上，必再三详审。统《坤》之体。事宜后起，祸从内生。先难后成。
**知一课（比用）**：二上克下或二下克上，择阴阳与日比者为用。事宜惟一，允执厥中。统《比》之体。祸从外起，事向朋谋。
**涉害课**：多克俱比俱不比，以涉害深处为用。占事艰难，历经风霜后得。统《坎》之体，苦尽甘来之象。见机格（孟上神）、察微格（仲上神）、缀瑕格（俱深取干上/支上）。
**遥克课**：课无克，取遥克为用。蒿矢（神克日）主惊恐后消；弹射（日克神）利主不利客。统《睽》之体，狐假虎威。
**昴星课**：四课无克无遥取酉位。阳日虎视格（酉上神），主惊恐自外来；阴日冬蛇掩目（酉下神），事多暗昧。统《履》之体。
**别责课**：三课无克。阳日取干合上神，阴日取支三合前辰。凡事不备，须借径而行。统《涣》之体。
**八专课**：干支同位，二课无克。阳日顺数三，阴日逆数三。专一不二。
**伏吟课**：天地同位，伏而不动。自任格（刚日）、自信格（柔日）。静中有动，守旧待新。统《艮》之体。
**返吟课**：天地对冲，往来相取。有克取克，无克井栏格（取驿马）。高岸为谷，深谷为陵。统《震》之体。事多两途，往返无常。

## 解读原则
1. 先断课式（九宗门），引《课经》原文定基调
2. 三传走势：初传发端→中传移易→末传归计
3. 六亲（父母文书/兄弟竞争/妻财财运/官鬼事业疾病/子孙娱乐解脱）配三传
4. 天将（贵人尊长/螣蛇虚惊/朱雀文书口舌/六合婚姻/勾陈争斗/青龙财喜/天空虚诈/白虎凶险/太常酒食/玄武盗贼/太阴密谋/天后婚姻）临宫论象
5. 旬空：空则不实，落空事难成
6. 日干为我，日支为事/他人；干支生克定内外亲疏
7. 下克上（贼）主内忧，上克下（克）主外患

## 回答风格
- 先给总体判断（一句话），必要时引用《六壬大全》课经原文
- 再逐层分析三传+六亲+天将+神煞
- 针对用户具体问题给出建议
- 语气温和专业，如经验丰富的命理师
- 200-600字，重要课式可延长"""


def _build_pan_context(pan: dict) -> str:
    """将课盘数据转为 AI 可读的文本上下文"""
    sizhu = pan["时间"]["四柱"]
    sc = pan["三传"]
    sc_lq = pan["三传六亲"]
    sc_tj = pan["三传天将"]

    ctx = f"""## 当前课盘

**时间**：{pan['时间']['公历']}（{pan['时间']['昼夜']}）
**四柱**：{sizhu['年柱']}年 {sizhu['月柱']}月 {sizhu['日柱']}日 {sizhu['时柱']}时
**日干**：{pan['时间']['日干']}（{GAN_WUXING[pan['时间']['日干']]}）
**日支**：{pan['时间']['日支']}（{ZHI_WUXING[pan['时间']['日支']]}）
**月将**：{pan['排盘参数']['月将']}，**占时**：{pan['排盘参数']['占时']}

**四课**：
"""
    for sk in pan["四课详情"]:
        lq = get_liuqin_by_zhi(pan['时间']['日干'], sk['上神'])
        ctx += f"  第{sk['课序']}课：{sk['上神']}临{sk['地盘']}（{lq}）\n"

    ctx += f"\n**三传**：{sc['初传']}→{sc['中传']}→{sc['末传']}（{sc['方法']}课）\n"
    ctx += f"  初传：{sc['初传']} - {sc_lq['初传']} - {sc_tj['初传']}\n"
    ctx += f"  中传：{sc['中传']} - {sc_lq['中传']} - {sc_tj['中传']}\n"
    ctx += f"  末传：{sc['末传']} - {sc_lq['末传']} - {sc_tj['末传']}\n"

    ctx += f"\n**旬空**：{', '.join(pan['旬空'])}"
    # 神煞（已改为嵌套结构）
    shensha = pan.get("神煞", {})
    if isinstance(shensha, dict):
        flat_ss = {}
        for cat_items in shensha.values():
            if isinstance(cat_items, dict):
                flat_ss.update(cat_items)
        if flat_ss:
            ctx += f"\n**神煞**：{', '.join(f'{k}={v}' for k,v in flat_ss.items())}"
    if pan.get("行年"):
        ctx += f"\n**行年**：{pan['行年']}"

    return ctx


def _call_llm(system_prompt: str, messages: list[dict]) -> str:
    """调用 LLM API — Anthropic-compatible 格式，通过 HTTP 直连"""
    import httpx

    api_key = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
    if not api_key:
        return _fallback_interpretation(messages[-1]["content"] if messages else "")

    model = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
    api_url = base_url.rstrip("/") + "/v1/messages"

    # Anthropic Messages API 格式
    msgs = []
    for m in messages:
        msgs.append({"role": "user", "content": m["content"]})

    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": msgs,
    }

    try:
        resp = httpx.post(
            api_url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            timeout=60,
        )
        data = resp.json()

        # 提取文本内容（跳过 thinking 块）
        for block in data.get("content", []):
            if block.get("type") == "text":
                return block["text"]

        # 如果只有 thinking 没 text，返回 thinking 摘要
        for block in data.get("content", []):
            if block.get("type") == "thinking":
                return "[模型已思考，但回答被截断。请增大 max_tokens。]"

        return str(data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return _fallback_interpretation(messages[-1]["content"] if messages else "")


def _fallback_interpretation(user_msg: str) -> str:
    """当 API 不可用时的规则型回退解读"""
    return f"""## 离线解读模式

AI 服务当前不可用。建议检查 API 密钥配置。

关于你提到的「{user_msg[:20]}...」，建议参考课盘的三传与六亲自行分析，或稍后再试。

快捷参考：
- 初传为事发之始，看六亲和天将可知事由
- 中传为事之中期发展
- 末传为最终结果
- 官鬼主事业/疾病/官非，妻财主财运/感情
- 日干为我，日支为对方/环境"""


# ===== 公开接口 =====

def chat_interpret(pan: dict, user_message: str, context: list[dict] | None = None, personal_style_ctx: str | None = None) -> str:
    """
    AI 智能解盘。支持多轮对话，可注入用户个人解读风格。

    Args:
        pan: 完整课盘 dict
        user_message: 用户当前问题
        context: 之前的对话历史 [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]
        personal_style_ctx: 用户个人解读风格参考文本（来自类似案例的笔记）

    Returns:
        AI 解读结果（Markdown 格式）
    """
    system_prompt = _build_system_prompt()

    # 注入个人风格参考
    if personal_style_ctx:
        system_prompt += f"\n\n{personal_style_ctx}"

    pan_context = _build_pan_context(pan)

    # 构造消息
    messages = []

    # 课盘信息作为第一条 user 消息
    pan_intro = f"{pan_context}\n\n---\n用户当前问题：{user_message}"

    # 如果有历史上下文，加入最近几轮
    if context:
        for m in context[-6:]:  # 保留最近 3 轮
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "user":
                messages.append({"role": "user", "content": content})
            else:
                messages.append({"role": "assistant", "content": content[:500]})

    messages.append({"role": "user", "content": pan_intro})

    return _call_llm(system_prompt, messages)


# 保留旧的分类函数作为离线后备
def generate_overview(pan: dict) -> str:
    return chat_interpret(pan, "请对这个课盘做一个总览分析，包括课式解读、三传要点、整体吉凶。", None)

def analyze_career(pan: dict) -> str:
    return chat_interpret(pan, "请分析这个课盘的事业/官运方面。", None)

def analyze_wealth(pan: dict) -> str:
    return chat_interpret(pan, "请分析这个课盘的财运方面。", None)

def analyze_relationships(pan: dict) -> str:
    return chat_interpret(pan, "请分析这个课盘的感情/婚姻/人际关系方面。", None)

def analyze_health(pan: dict) -> str:
    return chat_interpret(pan, "请分析这个课盘的健康方面。", None)
