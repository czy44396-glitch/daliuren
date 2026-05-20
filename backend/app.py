"""
大六壬排盘解盘系统 — FastAPI 后端
"""

import json
import traceback
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from liuren.paipan import paipan
from liuren.jiepan import chat_interpret

app = FastAPI(title="大六壬排盘解盘系统")

frontend_dir = Path(__file__).parent.parent / "frontend"
cases_dir = Path(__file__).parent / "cases"
cases_dir.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(frontend_dir / "index.html"))


@app.post("/api/paipan")
async def api_paipan(request: Request):
    """
    排盘接口。接收 JSON 参数，返回完整课盘。
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "无效的 JSON 数据"}, status_code=400)

    try:
        zhanshi = data.get("zhanshi")
        if zhanshi == "auto" or zhanshi == "":
            zhanshi = None

        yuejiang_override = data.get("yuejiang_override")
        if yuejiang_override == "auto" or yuejiang_override == "":
            yuejiang_override = None

        birth_ganzhi = data.get("birth_ganzhi")
        if birth_ganzhi == "":
            birth_ganzhi = None

        result = paipan(
            year=data.get("year"),
            month=data.get("month"),
            day=data.get("day"),
            hour=data.get("hour"),
            minute=data.get("minute", 0),
            zhanshi=zhanshi,
            yuejiang_override=yuejiang_override,
            birth_year=data.get("birth_year"),
            birth_ganzhi=birth_ganzhi,
            sex=data.get("sex", "男"),
        )
        return {"success": True, "data": result}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    """
    WebSocket 多轮对话解盘。
    客户端先通过 HTTP POST /api/paipan 排盘，
    然后通过此 WebSocket 发送解盘问题。
    """
    await websocket.accept()
    current_pan = None
    history = []

    try:
        while True:
            msg_text = await websocket.receive_text()
            msg = json.loads(msg_text)

            msg_type = msg.get("type", "chat")

            if msg_type == "set_pan":
                current_pan = msg.get("data")
                history = []
                await websocket.send_text(json.dumps({
                    "type": "pan_ready",
                    "message": "盘面已就绪，可以开始解读。"
                }, ensure_ascii=False))

            elif msg_type == "chat":
                if current_pan is None:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "请先排盘再提问。"
                    }, ensure_ascii=False))
                    continue

                user_msg = msg.get("message", "")
                response = chat_interpret(current_pan, user_msg, history)
                history.append({"role": "user", "content": user_msg})
                history.append({"role": "assistant", "content": response})

                await websocket.send_text(json.dumps({
                    "type": "chat_response",
                    "message": response,
                }, ensure_ascii=False))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e),
            }, ensure_ascii=False))
        except Exception:
            pass


# ========== 案例数据库 API ==========

@app.post("/api/cases/save")
async def save_case(request: Request):
    """保存一个盘式案例"""
    try:
        data = await request.json()
        pan_data = data.get("pan_data")
        name = data.get("name", "").strip()
        notes = data.get("notes", "").strip()

        if not pan_data:
            return JSONResponse({"success": False, "error": "无盘面数据"}, status_code=400)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        sizhu = pan_data.get("时间", {}).get("四柱", {})
        default_name = f"{sizhu.get('年柱','')}年{sizhu.get('月柱','')}月{sizhu.get('日柱','')}日"
        filename = f"{ts}_{default_name}.json"
        filepath = cases_dir / filename

        case = {
            "id": ts,
            "name": name or default_name,
            "category": data.get("category", "其他"),
            "notes": notes,
            "created": datetime.now().isoformat(),
            "pan_data": pan_data,
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(case, f, ensure_ascii=False, indent=2)

        return {"success": True, "id": ts, "name": case["name"]}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/cases/list")
async def list_cases():
    """列出所有已保存的案例"""
    try:
        files = sorted(cases_dir.glob("*.json"), reverse=True)
        cases = []
        for fp in files[:50]:  # 最多50条
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    c = json.load(f)
                cases.append({
                    "id": c.get("id", ""),
                    "name": c.get("name", ""),
                    "category": c.get("category", "其他"),
                    "notes": c.get("notes", ""),
                    "created": c.get("created", ""),
                })
            except Exception:
                pass
        return {"success": True, "cases": cases}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/cases/{case_id}")
async def get_case(case_id: str):
    """获取单个案例的完整盘面数据"""
    try:
        for fp in cases_dir.glob(f"{case_id}_*.json"):
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            return {"success": True, "case": c}
        return JSONResponse({"success": False, "error": "案例不存在"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/cases/{case_id}/rename")
async def rename_case(case_id: str, request: Request):
    """重命名案例"""
    try:
        data = await request.json()
        new_name = data.get("name", "").strip()
        if not new_name:
            return JSONResponse({"success": False, "error": "名称不能为空"}, status_code=400)
        for fp in cases_dir.glob(f"{case_id}_*.json"):
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            c["name"] = new_name
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(c, f, ensure_ascii=False, indent=2)
            return {"success": True}
        return JSONResponse({"success": False, "error": "案例不存在"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.delete("/api/cases/{case_id}")
async def delete_case(case_id: str):
    """删除一个案例"""
    try:
        for fp in cases_dir.glob(f"{case_id}_*.json"):
            fp.unlink()
            return {"success": True}
        return JSONResponse({"success": False, "error": "案例不存在"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/cases/compare")
async def compare_cases(request: Request):
    """
    多案例对比分析。传入案例 ID 列表，AI 分析共同点/规律。
    """
    try:
        data = await request.json()
        case_ids = data.get("ids", [])
        question = data.get("question", "请分析这些案例的共同特征和规律")
        previous = data.get("previous_analysis", "")

        if not case_ids or len(case_ids) < 2:
            return JSONResponse({"success": False, "error": "至少需要2个案例进行对比"}, status_code=400)

        # 加载案例
        cases = []
        for cid in case_ids:
            found = None
            for fp in cases_dir.glob(f"{cid}_*.json"):
                with open(fp, "r", encoding="utf-8") as f:
                    found = json.load(f)
                break
            if found:
                cases.append(found)

        if len(cases) < 2:
            return JSONResponse({"success": False, "error": f"只找到{len(cases)}个案例"}, status_code=400)

        # 构建对比上下文
        from liuren.jiepan import _build_pan_context, _call_llm

        ctx_parts = [f"## 对比分析：{len(cases)} 个案例\n"]
        for idx, c in enumerate(cases):
            pan = c.get("pan_data", {})
            sizhu = pan.get("时间", {}).get("四柱", {})
            sc = pan.get("三传", {})
            ctx_parts.append(f"### 案例{idx+1}：{c.get('name','')}")
            ctx_parts.append(f"四柱：{sizhu.get('年柱','')} {sizhu.get('月柱','')} {sizhu.get('日柱','')} {sizhu.get('时柱','')}")
            ctx_parts.append(f"三传：{sc.get('方法','')}课 {sc.get('初传','')}→{sc.get('中传','')}→{sc.get('末传','')}")
            ctx_parts.append(f"四课：{pan.get('四课',{})}")
            ctx_parts.append(f"旬空：{pan.get('旬空',[])}")
            ctx_parts.append(f"六亲：{pan.get('三传六亲',{})}")
            ctx_parts.append(f"天将：{pan.get('三传天将',{})}")
            ctx_parts.append(f"月将：{pan.get('排盘参数',{}).get('月将','')}")
            shensha = pan.get("神煞", {})
            ctx_parts.append(f"神煞：禄={shensha.get('禄神','')} 天马={shensha.get('天马','')} 桃花={shensha.get('桃花','')}")
            ctx_parts.append("")

        full_ctx = "\n".join(ctx_parts)

        system = """你是一位精通大六壬的命理分析师，擅长从多个课盘中寻找共同规律和关键信号。

## 对比分析原则
1. 先逐案简述各课式的核心特点
2. 寻找共同出现的六亲（如官鬼多发主灾祸、疾病、官非）、天将（如白虎多现主血光凶险）、地支（如某支反复出现）
3. 关注三传中的共同走向——是否有相同的初传/中传/末传？
4. 关注旬空——共同的空亡支可能指向时间的虚无或事态的空洞
5. 课式类型（九宗门）是否有共性——涉害多主艰难，返吟多主反复
6. 月将和占时是否呈现规律性
7. 最后给出综合判断：这些案例反映的共同趋势、高危信号、以及应对建议

## 回答格式
- 先总述共同发现
- 再逐案简析
- 最后给出综合结论和建议
- 如有"灾祸"相关信号，务必明确指出关键的地支/六亲/天将组合
- 语气专业、冷静，富有洞察力"""

        msgs = [{"role": "user", "content": f"{full_ctx}\n用户问题：{question}"}]
        if previous:
            msgs.insert(0, {"role": "assistant", "content": previous[:2000]})
            msgs.insert(0, {"role": "user", "content": "请对以上案例进行对比分析"})
        response = _call_llm(system, msgs)

        return {"success": True, "analysis": response, "case_count": len(cases)}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
