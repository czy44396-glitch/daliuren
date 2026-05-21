"""
大六壬 Skill 管理系统
- 加载/解析 skill markdown 文件
- 关键词匹配自动路由
- 热重载
"""
import re
import json
from pathlib import Path
from typing import Optional

SKILLS_DIR = Path(__file__).parent.parent / "skills"


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 YAML 风格元数据头，返回 (meta, body)"""
    meta = {}
    body = text
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if m:
        for line in m.group(1).split('\n'):
            line = line.strip()
            if ':' in line:
                key, _, val = line.partition(':')
                key = key.strip()
                val = val.strip()
                if key == 'trigger':
                    # 解析数组: [占, 问, ...]
                    val = [v.strip().strip("'\"") for v in val.strip('[]').split(',') if v.strip()]
                meta[key] = val
        body = text[m.end():]
    return meta, body


def load_all_skills() -> list[dict]:
    """加载所有 skill 文件"""
    skills = []
    if not SKILLS_DIR.exists():
        return skills
    for fp in sorted(SKILLS_DIR.glob("*.md")):
        meta, body = _parse_frontmatter(fp.read_text(encoding="utf-8"))
        meta["_file"] = str(fp.name)
        meta["_content"] = body
        skills.append(meta)
    return skills


def match_skill(question: str) -> Optional[dict]:
    """
    根据用户问题中的关键词自动匹配 skill。
    返回匹配度最高的 skill，未匹配返回 None（前端用默认）。
    """
    skills = load_all_skills()
    if not skills:
        return None

    q = question.lower()
    best = None
    best_score = 0

    for sk in skills:
        triggers = sk.get("trigger", [])
        if isinstance(triggers, str):
            triggers = [triggers]
        score = 0
        matched = []
        for t in triggers:
            if t.lower() in q:
                score += len(t)  # 更长的匹配权重更高
                matched.append(t)
        if score > best_score:
            best_score = score
            best = sk
            best["_matched"] = matched
            best["_score"] = score

    return best


def get_skill_by_id(skill_id: str) -> Optional[dict]:
    """根据 ID 获取指定 skill"""
    for sk in load_all_skills():
        if sk.get("id") == skill_id:
            return sk
    return None


def inject_skill_context(skill: dict, current_pan: dict, user_msg: str) -> str:
    """
    将 skill 的指令注入到对话上下文中。
    构建一个包含 skill 规则的 system prompt 前缀。
    """
    if not skill:
        return user_msg

    sizhu = current_pan.get("时间", {}).get("四柱", {})
    sizhu_str = f"{sizhu.get('年柱','')} {sizhu.get('月柱','')} {sizhu.get('日柱','')} {sizhu.get('时柱','')}"
    sc = current_pan.get("三传", {})

    pan_summary = f"""## 当前课盘
四柱：{sizhu_str}
日干：{current_pan.get('时间',{}).get('日干','')}  日支：{current_pan.get('时间',{}).get('日支','')}
月将：{current_pan.get('排盘参数',{}).get('月将','')}  占时：{current_pan.get('排盘参数',{}).get('占时','')}
课式：{sc.get('方法','')}课
三传：{sc.get('初传','')}→{sc.get('中传','')}→{sc.get('末传','')}
三传天将：{current_pan.get('三传天将',{}).get('初传','')}→{current_pan.get('三传天将',{}).get('中传','')}→{current_pan.get('三传天将',{}).get('末传','')}
三传六亲：{current_pan.get('三传六亲',{}).get('初传','')}→{current_pan.get('三传六亲',{}).get('中传','')}→{current_pan.get('三传六亲',{}).get('末传','')}
旬空：{' '.join(current_pan.get('旬空',[]))}
行年：{current_pan.get('行年','')}
行年上神：{_get_xingnian_shangshen(current_pan)}
四课：{current_pan.get('四课',{})}
十二天将：{json.dumps(current_pan.get('十二天将',{}), ensure_ascii=False)}
遁干：{json.dumps(current_pan.get('遁干',{}), ensure_ascii=False)}
神煞：{json.dumps(current_pan.get('神煞',{}), ensure_ascii=False)}
"""

    skill_content = skill.get("_content", "")
    skill_name = skill.get("name", "")

    # 构建注入消息：skill 规则 + 盘面数据 + 用户问题
    injected = f"""[系统指令]
你正在使用「{skill_name}」Skill 进行大六壬解读。请严格遵循以下 Skill 规则进行解盘：

{skill_content}

---
{pan_summary}
---
[用户问题] {user_msg}

请严格按照上述 Skill 规定的格式、步骤、风格和语言宪章进行解读。"""
    return injected


def _get_xingnian_shangshen(pan: dict) -> str:
    """获取行年上神"""
    xn = pan.get("行年", "")
    if xn:
        tiandi = pan.get("天地盘", {})
        return tiandi.get(xn, "")
    return ""


def get_reflections_dir() -> Path:
    """获取自反记录目录"""
    d = Path(__file__).parent.parent / "reflections"
    d.mkdir(exist_ok=True)
    return d
