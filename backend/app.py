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
from liuren.skill_manager import (
    load_all_skills, match_skill, get_skill_by_id,
    inject_skill_context, get_reflections_dir
)
from liuren.auth import (
    register_user, login_user, wechat_login, qq_login,
    register_email, login_email,
    verify_token, get_user_from_token,
    check_quota, consume_quota,
    admin_set_quota, admin_list_users,
    get_user_data_dir, get_shared_dir,
    hash_password,
)
from liuren.email import (
    send_verification_email, store_code, verify_code, configure_smtp
)
from liuren.db import init_db, _connect as db_connect

app = FastAPI(title="大六壬排盘解盘系统")

# 初始化数据库
init_db()

# 配置邮箱 SMTP（从环境变量读取）
_smtp_user = os.environ.get("QQMAIL_USER", "")
_smtp_pass = os.environ.get("QQMAIL_PASS", "")
if _smtp_user and _smtp_pass:
    configure_smtp(_smtp_user, _smtp_pass)

frontend_dir = Path(__file__).parent.parent / "frontend"
cases_dir = Path(__file__).parent / "cases"
cases_dir.mkdir(exist_ok=True)
history_dir = Path(__file__).parent / "history"
history_dir.mkdir(exist_ok=True)
history_archive = Path(__file__).parent / "data" / "liurenduanan.json"

app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(frontend_dir / "index.html"))


# ========== 认证辅助 ==========

def _get_user_id(request: Request) -> str | None:
    """从请求头或查询参数中提取用户 ID。WebSocket 用 query param，HTTP 用 Bearer token。"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        payload = verify_token(token)
        if payload:
            return payload.get("sub")

    token = request.query_params.get("token")
    if token:
        payload = verify_token(token)
        if payload:
            return payload.get("sub")
    return None


def _get_user_or_guest(request: Request) -> str:
    """获取用户ID，未登录返回 'guest'"""
    uid = _get_user_id(request)
    return uid or "guest"


# ========== 认证 API ==========

@app.post("/api/auth/register")
async def api_register(request: Request):
    """用户注册"""
    try:
        data = await request.json()
        username = (data.get("username", "")).strip()
        password = (data.get("password", "")).strip()
        nickname = (data.get("nickname", "")).strip()

        if len(username) < 2 or len(username) > 20:
            return JSONResponse({"success": False, "message": "用户名需2-20个字符"}, status_code=400)
        if len(password) < 6:
            return JSONResponse({"success": False, "message": "密码至少6位"}, status_code=400)

        result = register_user(username, password, nickname)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=400)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/login")
async def api_login(request: Request):
    """密码登录"""
    try:
        data = await request.json()
        username = (data.get("username", "")).strip()
        password = (data.get("password", "")).strip()

        if not username or not password:
            return JSONResponse({"success": False, "message": "请输入用户名和密码"}, status_code=400)

        result = login_user(username, password)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=401)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/wechat")
async def api_wechat_login(request: Request):
    """微信 OAuth 登录"""
    try:
        data = await request.json()
        code = data.get("code", "")
        app_id = data.get("app_id", "")
        app_secret = data.get("app_secret", "")

        # 如果未提供 app_id，使用环境变量
        if not app_id:
            app_id = os.environ.get("WECHAT_APPID", "")
        if not app_secret:
            app_secret = os.environ.get("WECHAT_SECRET", "")

        if not code:
            return JSONResponse({"success": False, "message": "缺少微信授权码"}, status_code=400)
        if not app_id or not app_secret:
            return JSONResponse({"success": False, "message": "微信登录未配置（需要 AppID 和 AppSecret）"}, status_code=400)

        result = wechat_login(code, app_id, app_secret)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=401)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.get("/api/auth/email/smtp-status")
async def api_smtp_status():
    """SMTP 诊断：检查配置状态"""
    import os as _os
    from liuren.email import SMTP_USER, SMTP_PASS
    env_user = _os.environ.get("QQMAIL_USER", "")
    env_pass = _os.environ.get("QQMAIL_PASS", "")
    return {
        "success": True,
        "configured": bool(SMTP_USER and SMTP_PASS),
        "diagnostics": {
            "env_QQMAIL_USER_set": bool(env_user),
            "env_QQMAIL_PASS_set": bool(env_pass),
            "env_user_length": len(env_user),
            "env_pass_length": len(env_pass),
            "module_SMTP_USER_set": bool(SMTP_USER),
            "module_SMTP_PASS_set": bool(SMTP_PASS),
        },
        "message": ("SMTP 已配置 ✓" if (SMTP_USER and SMTP_PASS)
                    else "SMTP 未配置：请在 Render Dashboard → Environment 中设置 QQMAIL_USER 和 QQMAIL_PASS，然后 Redeploy"),
    }


@app.post("/api/auth/email/test-smtp")
async def api_test_smtp(request: Request):
    """
    测试 SMTP 连接 — 向指定邮箱发一封测试邮件。
    用于在不配置环境变量的情况下验证 SMTP 凭证是否有效。
    请求体：{"smtp_user": "xxx@qq.com", "smtp_pass": "授权码", "to_email": "接收测试邮件的邮箱"}
    """
    try:
        data = await request.json()
        smtp_user = (data.get("smtp_user", "")).strip()
        smtp_pass = (data.get("smtp_pass", "")).strip()
        to_email = (data.get("to_email", "")).strip()

        if not smtp_user or not smtp_pass:
            return JSONResponse({"success": False, "message": "请提供 smtp_user 和 smtp_pass"}, status_code=400)
        if not to_email:
            to_email = smtp_user

        # 临时配置 SMTP
        configure_smtp(smtp_user, smtp_pass)

        # 发送测试邮件
        from liuren.email import send_verification_email
        # 生成一个测试验证码
        test_code = "000000"
        ok, msg = send_verification_email(to_email, test_code)

        # 恢复原配置（从环境变量重新加载）
        _orig_user = os.environ.get("QQMAIL_USER", "")
        _orig_pass = os.environ.get("QQMAIL_PASS", "")
        if _orig_user and _orig_pass:
            configure_smtp(_orig_user, _orig_pass)
        else:
            configure_smtp("", "")

        if ok:
            return {"success": True, "message": f"SMTP 连接成功！测试邮件已发送至 {to_email}"}
        else:
            return {"success": False, "message": msg}
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/email/send-code")
async def api_send_code(request: Request):
    """发送邮箱验证码"""
    try:
        data = await request.json()
        email = (data.get("email", "")).strip().lower()
        if not email or "@" not in email:
            return JSONResponse({"success": False, "message": "请输入有效邮箱"}, status_code=400)

        code = store_code(email)
        ok, msg = send_verification_email(email, code)
        if ok:
            return {"success": True, "message": msg}
        else:
            return JSONResponse({"success": False, "message": msg}, status_code=500)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/email/verify-code")
async def api_verify_code(request: Request):
    """验证邮箱验证码 + 完成注册/登录"""
    try:
        data = await request.json()
        email = (data.get("email", "")).strip().lower()
        code = (data.get("code", "")).strip()

        ok, msg = verify_code(email, code)
        if not ok:
            return JSONResponse({"success": False, "message": msg}, status_code=400)

        # 验证通过 → 检查是注册还是登录
        conn = db_connect()
        try:
            existing = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        finally:
            conn.close()

        if existing:
            # 已注册 → 验证码登录
            user = dict(existing)
            from liuren.auth import create_token
            token = create_token(user["id"])
            return {
                "success": True, "is_new": False,
                "message": "登录成功",
                "user": {
                    "id": user["id"], "username": user["username"],
                    "email": user.get("email",""), "nickname": user["nickname"],
                    "is_admin": bool(user["is_admin"]),
                    "quota_total": user["quota_total"], "quota_used": user["quota_used"],
                    "quota_month": user["quota_month"],
                },
                "token": token,
            }
        else:
            # 新用户 → 验证码证明邮箱所有权，自动注册
            import secrets, string as _string
            auto_pw = ''.join(secrets.choice(_string.ascii_letters + _string.digits) for _ in range(12))
            from liuren.auth import register_email
            result = register_email(email, auto_pw, email.split('@')[0])
            if result["success"]:
                result["is_new"] = True
                result["message"] = "注册并登录成功"
            return result if result["success"] else JSONResponse(result, status_code=400)

    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/email/register")
async def api_email_register(request: Request):
    """邮箱注册"""
    try:
        data = await request.json()
        email = (data.get("email", "")).strip().lower()
        password = (data.get("password", "")).strip()
        nickname = (data.get("nickname", "")).strip()

        if len(password) < 6:
            return JSONResponse({"success": False, "message": "密码至少6位"}, status_code=400)

        result = register_email(email, password, nickname)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=400)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.post("/api/auth/email/login")
async def api_email_login(request: Request):
    """邮箱登录"""
    try:
        data = await request.json()
        email = (data.get("email", "")).strip().lower()
        password = (data.get("password", "")).strip()

        if not email or not password:
            return JSONResponse({"success": False, "message": "请输入邮箱和密码"}, status_code=400)

        result = login_email(email, password)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=401)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.get("/api/auth/wechat/config")
async def api_wechat_config(request: Request):
    """返回微信 OAuth 配置状态"""
    app_id = os.environ.get("WECHAT_APPID", "")
    if not app_id:
        return {"success": False, "message": "微信登录未配置"}
    redirect_uri = request.query_params.get("redirect_uri", f"{request.base_url}")
    auth_url = (
        f"https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={app_id}&redirect_uri={redirect_uri}&response_type=code&scope=snsapi_userinfo"
    )
    return {"success": True, "redirect_url": auth_url}


@app.get("/api/auth/qq/config")
async def api_qq_config(request: Request):
    """返回 QQ 互联 OAuth 配置和授权 URL"""
    app_id = os.environ.get("QQ_APP_ID", "")
    if not app_id:
        return {"success": False, "message": "QQ 登录未配置（需要在环境变量中设置 QQ_APP_ID 和 QQ_APP_KEY）"}
    redirect_uri = request.query_params.get("redirect_uri", str(request.base_url).rstrip("/") + "/")
    # QQ 互联 OAuth 2.0 授权 URL
    state = request.query_params.get("state", "qq_login")
    auth_url = (
        f"https://graph.qq.com/oauth2.0/authorize"
        f"?response_type=code"
        f"&client_id={app_id}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
        f"&scope=get_user_info"
    )
    return {"success": True, "redirect_url": auth_url, "app_id": app_id}


@app.post("/api/auth/qq/callback")
async def api_qq_callback(request: Request):
    """QQ 互联 OAuth 回调：用 code 换 token → openid → 用户信息 → 登录/注册"""
    try:
        data = await request.json()
        code = data.get("code", "")
        redirect_uri = data.get("redirect_uri", str(request.base_url).rstrip("/") + "/")

        app_id = os.environ.get("QQ_APP_ID", "")
        app_key = os.environ.get("QQ_APP_KEY", "")

        if not code:
            return JSONResponse({"success": False, "message": "缺少授权码"}, status_code=400)
        if not app_id or not app_key:
            return JSONResponse({"success": False, "message": "QQ 登录未配置（需要 QQ_APP_ID 和 QQ_APP_KEY）"}, status_code=400)

        result = qq_login(code, app_id, app_key, redirect_uri)
        if result["success"]:
            return result
        return JSONResponse(result, status_code=401)
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.get("/api/auth/me")
async def api_me(request: Request):
    """获取当前登录用户信息"""
    uid = _get_user_id(request)
    if not uid:
        return JSONResponse({"success": False, "message": "未登录"}, status_code=401)

    user = get_user_from_token(request.headers.get("Authorization", "").replace("Bearer ", ""))
    if not user:
        return JSONResponse({"success": False, "message": "用户不存在"}, status_code=404)

    quota = check_quota(uid)
    return {
        "success": True,
        "user": {
            "id": user["id"], "username": user["username"],
            "nickname": user["nickname"], "avatar_url": user.get("avatar_url",""),
            "is_admin": bool(user["is_admin"]),
            "quota_total": quota.get("quota_total", 30),
            "quota_used": quota.get("quota_used", 0),
            "quota_month": quota.get("quota_month", ""),
        }
    }


# ========== 管理员 API ==========

@app.get("/api/admin/users")
async def api_admin_users(request: Request):
    """管理员查看所有用户"""
    uid = _get_user_id(request)
    if not uid:
        return JSONResponse({"success": False, "message": "未登录"}, status_code=401)
    result = admin_list_users(uid)
    if not result["success"]:
        return JSONResponse(result, status_code=403)
    return result


@app.post("/api/admin/set-quota")
async def api_admin_set_quota(request: Request):
    """管理员设置用户配额"""
    uid = _get_user_id(request)
    if not uid:
        return JSONResponse({"success": False, "message": "未登录"}, status_code=401)
    try:
        data = await request.json()
        target = data.get("user_id", "")
        quota = int(data.get("quota_total", 30))
        result = admin_set_quota(uid, target, quota)
        if not result["success"]:
            return JSONResponse(result, status_code=403)
        return result
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.get("/api/admin/quota-check")
async def api_quota_check(request: Request):
    """检查当前用户配额"""
    uid = _get_user_id(request)
    if not uid:
        return {"quota_total": 5, "quota_used": 0, "is_guest": True}
    result = check_quota(uid)
    return result


@app.get("/manifest.json")
async def manifest():
    return FileResponse(str(frontend_dir / "manifest.json"), media_type="application/manifest+json")


@app.get("/service-worker.js")
async def service_worker():
    return FileResponse(str(frontend_dir / "service-worker.js"), media_type="text/javascript")


@app.post("/api/correct-sanchuan")
async def correct_sanchuan(request: Request):
    """
    手动矫正三传。
    接收当前盘面和修正后的三传参数，重新计算六亲、天将等依赖字段。
    """
    try:
        data = await request.json()
        pan_data = data.get("pan_data")
        new_method = data.get("method", "").strip()
        new_chuchuan = data.get("chuchuan", "").strip()
        new_zhongchuan = data.get("zhongchuan", "").strip()
        new_mochuan = data.get("mochuan", "").strip()

        if not pan_data:
            return JSONResponse({"success": False, "error": "无盘面数据"}, status_code=400)
        if not new_chuchuan or not new_zhongchuan or not new_mochuan:
            return JSONResponse({"success": False, "error": "三传不能为空"}, status_code=400)

        from liuren.basics import DIZHI, ZHI_INDEX, get_liuqin_by_zhi
        from liuren.tiandijiang import get_tianjiang_for_shen

        ri_gan = pan_data["时间"]["日干"]
        tiandipan = pan_data.get("天地盘", {})

        # 验证地支有效性
        for zhi in [new_chuchuan, new_zhongchuan, new_mochuan]:
            if zhi not in DIZHI:
                return JSONResponse({"success": False, "error": f"无效地支：{zhi}"}, status_code=400)

        # 计算地盘
        def _find_di(tian):
            for di, t in tiandipan.items():
                if t == tian:
                    return di
            return DIZHI[(ZHI_INDEX[tian] + 2) % 12]

        c_di = _find_di(new_chuchuan)
        z_di = _find_di(new_zhongchuan)
        m_di = _find_di(new_mochuan)

        # 计算六亲
        from liuren.basics import get_liuqin_by_zhi
        sanchuan_liuqin = {
            "初传": get_liuqin_by_zhi(ri_gan, new_chuchuan),
            "中传": get_liuqin_by_zhi(ri_gan, new_zhongchuan),
            "末传": get_liuqin_by_zhi(ri_gan, new_mochuan),
        }

        # 计算天将
        tianjiang = pan_data.get("十二天将", {})
        sanchuan_tianjiang = {
            "初传": get_tianjiang_for_shen(tiandipan, tianjiang, new_chuchuan),
            "中传": get_tianjiang_for_shen(tiandipan, tianjiang, new_zhongchuan),
            "末传": get_tianjiang_for_shen(tiandipan, tianjiang, new_mochuan),
        }

        # 更新盘面
        pan_data["三传"] = {
            "方法": new_method or "手动矫正",
            "初传": new_chuchuan, "中传": new_zhongchuan, "末传": new_mochuan,
            "初传地盘": c_di, "中传地盘": z_di, "末传地盘": m_di,
            "手动矫正": True,
        }
        pan_data["三传六亲"] = sanchuan_liuqin
        pan_data["三传天将"] = sanchuan_tianjiang

        return {"success": True, "data": pan_data}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/correct-yuejiang")
async def correct_yuejiang(request: Request):
    """
    手动矫正月将。重新计算天地盘、四课、三传。
    """
    try:
        data = await request.json()
        pan_data = data.get("pan_data")
        new_yuejiang = data.get("yuejiang", "").strip()

        if not pan_data:
            return JSONResponse({"success": False, "error": "无盘面数据"}, status_code=400)
        from liuren.basics import DIZHI as _DZ, ZHI_INDEX, GAN_JIGONG, get_liuqin_by_zhi, get_xun_kong, TIANGAN
        from liuren.tiandipan import build_tiandi_pan
        from liuren.sike import build_sike, sike_to_labels, get_sike_detail
        from liuren.sanchuan import get_sanchuan
        from liuren.tiandijiang import bu_tianjiang, get_tianjiang_for_shen
        from liuren.dungan import build_xundun

        if not new_yuejiang or new_yuejiang not in _DZ:
            return JSONResponse({"success": False, "error": f"无效月将：{new_yuejiang}"}, status_code=400)

        ri_gan = pan_data["时间"]["日干"]
        ri_zhi = pan_data["时间"]["日支"]
        ri_zhu = pan_data["时间"]["四柱"]["日柱"]
        zhanshi = pan_data["排盘参数"].get("占时", ri_zhu[1])
        is_day = pan_data["时间"].get("昼夜", "昼") == "昼"

        # 重建天地盘
        tiandipan = build_tiandi_pan(new_yuejiang, zhanshi)

        # 重建四课
        sike = build_sike(tiandipan, ri_gan, ri_zhi)

        # 重建三传
        sanchuan = get_sanchuan(sike, ri_gan, ri_zhi, tiandipan)

        # 重建天将
        tianjiang = bu_tianjiang(tiandipan, ri_gan, is_day)

        # 三传六亲
        sanchuan_liuqin = {
            "初传": get_liuqin_by_zhi(ri_gan, sanchuan["初传"]),
            "中传": get_liuqin_by_zhi(ri_gan, sanchuan["中传"]),
            "末传": get_liuqin_by_zhi(ri_gan, sanchuan["末传"]),
        }

        # 三传天将
        sanchuan_tianjiang = {
            "初传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["初传"]),
            "中传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["中传"]),
            "末传": get_tianjiang_for_shen(tiandipan, tianjiang, sanchuan["末传"]),
        }

        # 四课六亲
        sike_liuqin = []
        for tian, di in sike:
            sike_liuqin.append({
                "上神": tian, "地盘": di,
                "六亲": get_liuqin_by_zhi(ri_gan, tian),
            })

        # 旬空
        xunkong = get_xun_kong(ri_zhu)

        # 遁干
        dungan = build_xundun(ri_zhu)

        # 更新盘面
        pan_data["排盘参数"]["月将"] = new_yuejiang
        pan_data["天地盘"] = tiandipan
        pan_data["四课"] = sike_to_labels(sike)
        pan_data["四课详情"] = get_sike_detail(sike, ri_gan, ri_zhi)
        pan_data["四课六亲"] = sike_liuqin
        pan_data["三传"] = sanchuan
        pan_data["三传六亲"] = sanchuan_liuqin
        pan_data["三传天将"] = sanchuan_tianjiang
        pan_data["十二天将"] = tianjiang
        pan_data["旬空"] = list(xunkong)
        pan_data["遁干"] = dungan
        pan_data["月将矫正"] = True

        return {"success": True, "data": pan_data}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/calendar/month")
async def calendar_month(year: int, month: int):
    """
    返回指定月份每天的公历/农历/干支信息。
    """
    try:
        from datetime import date, timedelta
        from lunardate import LunarDate
        from liuren.sizhu import get_ri_zhu

        # 月初和月末
        first_day = date(year, month, 1)
        if month == 12:
            last_day = date(year, 12, 31)
        else:
            last_day = date(year, month + 1, 1) - timedelta(days=1)

        days = []
        d = first_day
        while d <= last_day:
            try:
                lunar = LunarDate.fromSolarDate(d.year, d.month, d.day)
                lunar_str = f"{'闰' if lunar.isLeapMonth else ''}{_LUNAR_MONTH_NAMES.get(lunar.month, str(lunar.month))}月{_LUNAR_DAY_NAMES.get(lunar.day, str(lunar.day))}"
            except Exception:
                lunar_str = ""

            ri_zhu = get_ri_zhu(d.year, d.month, d.day)

            days.append({
                "date": f"{d.year}-{d.month:02d}-{d.day:02d}",
                "year": d.year, "month": d.month, "day": d.day,
                "weekday": d.weekday(),
                "ri_zhu": ri_zhu,
                "lunar": lunar_str,
            })
            d += timedelta(days=1)

        return {"success": True, "year": year, "month": month, "days": days}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


_LUNAR_MONTH_NAMES = {
    1: "正", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六",
    7: "七", 8: "八", 9: "九", 10: "十", 11: "冬", 12: "腊",
}

_LUNAR_DAY_NAMES = {
    1: "初一", 2: "初二", 3: "初三", 4: "初四", 5: "初五",
    6: "初六", 7: "初七", 8: "初八", 9: "初九", 10: "初十",
    11: "十一", 12: "十二", 13: "十三", 14: "十四", 15: "十五",
    16: "十六", 17: "十七", 18: "十八", 19: "十九", 20: "二十",
    21: "廿一", 22: "廿二", 23: "廿三", 24: "廿四", 25: "廿五",
    26: "廿六", 27: "廿七", 28: "廿八", 29: "廿九", 30: "三十",
}


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

        # 自动记录排盘历史（去重：相同时空参数只保留最早一条）
        p_year = data.get("year")
        p_month = data.get("month")
        p_day = data.get("day")
        p_hour = data.get("hour")
        p_minute = data.get("minute", 0)

        if not _history_exists(p_year, p_month, p_day, p_hour, p_minute):
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            sc = result.get("三传", {})
            h = {
                "id": ts,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "params": {
                    "year": p_year, "month": p_month,
                    "day": p_day, "hour": p_hour,
                    "minute": p_minute, "sex": data.get("sex", "男"),
                    "birth_year": data.get("birth_year"),
                    "zhanshi": zhanshi,
                },
                "sizhu": _format_sizhu(result),
                "method": sc.get("方法", ""),
                "sanchuan": f"{sc.get('初传','')}→{sc.get('中传','')}→{sc.get('末传','')}",
                "yuejiang": result.get("排盘参数", {}).get("月将", ""),
                "pan": result,
            }
            hist_file = history_dir / f"{ts}.json"
            with open(hist_file, "w", encoding="utf-8") as fh:
                json.dump(h, fh, ensure_ascii=False, indent=2)

            # 只保留最近 200 条历史
            _cleanup_history()

        return {"success": True, "data": result}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


def _format_sizhu(result: dict) -> str:
    """从排盘结果提取四柱为格式化字符串"""
    sz = result.get("时间", {}).get("四柱", {})
    if not sz:
        return ""
    return f"{sz.get('年柱','')} {sz.get('月柱','')} {sz.get('日柱','')} {sz.get('时柱','')}"


def _history_exists(year, month, day, hour, minute) -> bool:
    """检查是否已有相同时空参数的历史记录"""
    for fp in history_dir.glob("*.json"):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                h = json.load(f)
            p = h.get("params", {})
            if (p.get("year") == year and p.get("month") == month and
                p.get("day") == day and p.get("hour") == hour and
                p.get("minute") == minute):
                return True
        except Exception:
            pass
    return False


def _cleanup_history(keep: int = 200):
    """清理旧历史，只保留最近 keep 条"""
    files = sorted(history_dir.glob("*.json"), reverse=True)
    for fp in files[keep:]:
        try:
            fp.unlink()
        except Exception:
            pass


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    """
    WebSocket 多轮对话解盘。
    客户端先通过 HTTP POST /api/paipan 排盘，
    然后通过此 WebSocket 发送解盘问题。
    支持 token 认证（query param: ?token=xxx），未登录为 guest 模式（限制 5 次/会话）。
    """
    # 从 query string 提取 token
    token = websocket.query_params.get("token", "")
    ws_user_id = "guest"
    if token:
        payload = verify_token(token)
        if payload:
            ws_user_id = payload.get("sub", "guest")

    await websocket.accept()
    current_pan = None
    history = []
    guest_quota_used = 0
    guest_quota_max = 5  # 游客最多 5 次 AI 解读

    try:
        while True:
            msg_text = await websocket.receive_text()
            msg = json.loads(msg_text)

            msg_type = msg.get("type", "chat")

            if msg_type == "set_pan":
                current_pan = msg.get("data")
                history = []
                # 也支持在 set_pan 中传递 token
                pt = msg.get("token", "")
                if pt and ws_user_id == "guest":
                    payload = verify_token(pt)
                    if payload:
                        ws_user_id = payload.get("sub", "guest")
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

                # 配额检查
                if ws_user_id == "guest":
                    if guest_quota_used >= guest_quota_max:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"游客 AI 解读次数已用完（{guest_quota_max}次/会话）。请注册登录后使用更多功能。"
                        }, ensure_ascii=False))
                        continue
                else:
                    quota = check_quota(ws_user_id)
                    if not quota.get("allowed"):
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"本月配额已用完（{quota.get('quota_total',0)}次）。请联系管理员提高额度。"
                        }, ensure_ascii=False))
                        continue

                user_msg = msg.get("message", "")
                use_personal_style = msg.get("use_personal_style", False)
                skill_id = msg.get("skill_id", "auto")  # "auto" | specific_id | null

                # Skill 路由：自动匹配或手动指定
                used_skill = None
                if skill_id and skill_id != "auto":
                    used_skill = get_skill_by_id(skill_id)
                elif skill_id == "auto":
                    used_skill = match_skill(user_msg)

                # 构建个人风格上下文
                personal_style_ctx = None
                if use_personal_style:
                    sc = current_pan.get("三传", {})
                    sike_list = [s.get("上神", "") for s in current_pan.get("四课详情", [])]
                    style_refs = _find_personal_style_refs(
                        method=sc.get("方法", ""),
                        sanchuan=[sc.get("初传", ""), sc.get("中传", ""), sc.get("末传", "")],
                        sike=sike_list,
                    )
                    if style_refs:
                        personal_style_ctx = _build_personal_style_context(style_refs)

                # 注入 skill 上下文
                effective_msg = user_msg
                if used_skill:
                    effective_msg = inject_skill_context(used_skill, current_pan, user_msg)

                response = chat_interpret(current_pan, effective_msg, history, personal_style_ctx)
                history.append({"role": "user", "content": user_msg})
                history.append({"role": "assistant", "content": response})

                # 消耗配额
                if ws_user_id == "guest":
                    guest_quota_used += 1
                else:
                    consume_quota(ws_user_id)

                resp_data = {
                    "type": "chat_response",
                    "message": response,
                }
                if used_skill:
                    resp_data["skill_id"] = used_skill.get("id", "")
                    resp_data["skill_name"] = used_skill.get("name", "")
                    resp_data["skill_matched"] = used_skill.get("_matched", [])
                if personal_style_ctx:
                    resp_data["style_used"] = True
                    resp_data["style_case_count"] = len(style_refs) if style_refs else 0
                # 返回当前配额状态
                if ws_user_id != "guest":
                    q = check_quota(ws_user_id)
                    resp_data["quota"] = {"total": q.get("quota_total",0), "used": q.get("quota_used",0)}
                else:
                    resp_data["quota"] = {"total": guest_quota_max, "used": guest_quota_used, "guest": True}
                await websocket.send_text(json.dumps(resp_data, ensure_ascii=False))

            elif msg_type == "reference_classic":
                # 引用典籍段落到当前解盘对话中
                if current_pan is None:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "请先排盘再引用典籍。"
                    }, ensure_ascii=False))
                    continue

                book_id = msg.get("book_id", "")
                section_id = msg.get("section_id", "")
                user_question = msg.get("message", "请结合此经典法则分析当前课盘")

                book = _load_classic(book_id)
                sec = _find_section(book, section_id) if book else None

                if not book or not sec:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "未找到该典籍或章节。"
                    }, ensure_ascii=False))
                    continue

                from liuren.jiepan import _build_pan_context, _call_llm

                classic_ctx = f"""## 典籍参考：《{book['title']}》— {sec['title']}

### 原文
{sec.get('content', '')}

### 注疏
{sec.get('commentary', '无')}
"""
                pan_ctx = _build_pan_context(current_pan)

                system = "你是一位精通大六壬的命理师。请结合经典典籍的理论分析当前课盘。先阐述经典要义，再对照课盘分析，最后给出综合判断。"

                response = _call_llm(system, [
                    {"role": "user", "content": f"{classic_ctx}\n{pan_ctx}\n\n用户问题：{user_question}"}
                ])

                history.append({"role": "user", "content": f"[引用《{book['title']}》{sec['title']}] {user_question}"})
                history.append({"role": "assistant", "content": response})

                await websocket.send_text(json.dumps({
                    "type": "chat_response",
                    "message": response,
                    "reference": {"book_title": book["title"], "section_title": sec["title"]},
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
        tags = data.get("tags", [])  # 标签列表
        category = data.get("category", "")  # 兼容旧版单项分类

        if not pan_data:
            return JSONResponse({"success": False, "error": "无盘面数据"}, status_code=400)

        # 合并 tags 和 category
        if not tags and category:
            tags = [category]
        if not tags:
            tags = ["其他"]

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        sizhu = pan_data.get("时间", {}).get("四柱", {})
        default_name = f"{sizhu.get('年柱','')}年{sizhu.get('月柱','')}月{sizhu.get('日柱','')}日"
        filename = f"{ts}_{default_name}.json"
        filepath = cases_dir / filename

        case = {
            "id": ts,
            "name": name or default_name,
            "category": tags[0] if tags else "其他",
            "tags": tags,
            "notes": notes,
            "created": datetime.now().isoformat(),
            "pan_data": pan_data,
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(case, f, ensure_ascii=False, indent=2)

        return {"success": True, "id": ts, "name": case["name"], "tags": tags}

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
                    "tags": c.get("tags", [c.get("category", "其他")]),
                    "notes": c.get("notes", ""),
                    "has_notes": bool(c.get("personal_notes", "").strip()),
                    "created": c.get("created", ""),
                })
            except Exception:
                pass
        return {"success": True, "cases": cases}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/cases/tags")
async def list_tags():
    """列出所有已使用的标签"""
    try:
        tag_counts = {}
        for fp in cases_dir.glob("*.json"):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    c = json.load(f)
                tags = c.get("tags", [c.get("category", "其他")])
                for t in tags:
                    t = t.strip()
                    if t:
                        tag_counts[t] = tag_counts.get(t, 0) + 1
            except Exception:
                pass
        # 按使用次数降序
        sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
        return {"success": True, "tags": [{"name": t, "count": c} for t, c in sorted_tags]}
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


@app.put("/api/cases/{case_id}/personal-notes")
async def update_personal_notes(case_id: str, request: Request):
    """更新案例的个人解读笔记"""
    try:
        data = await request.json()
        notes = data.get("notes", "")
        for fp in cases_dir.glob(f"{case_id}_*.json"):
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            c["personal_notes"] = notes
            c["personal_notes_updated"] = datetime.now().isoformat()
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(c, f, ensure_ascii=False, indent=2)
            return {"success": True, "updated": c["personal_notes_updated"]}
        return JSONResponse({"success": False, "error": "案例不存在"}, status_code=404)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/cases/{case_id}/personal-notes")
async def get_personal_notes(case_id: str):
    """获取案例的个人解读笔记"""
    try:
        for fp in cases_dir.glob(f"{case_id}_*.json"):
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            return {
                "success": True,
                "notes": c.get("personal_notes", ""),
                "updated": c.get("personal_notes_updated", ""),
                "case_name": c.get("name", ""),
                "category": c.get("category", ""),
            }
        return JSONResponse({"success": False, "error": "案例不存在"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/personal-style/context")
async def get_personal_style_context(request: Request):
    """
    获取用户个人解读风格上下文。
    传入当前课盘信息，从案例库中找到有个人笔记的相似案例，
    返回用户笔记作为 AI 解读的风格参考。
    """
    try:
        data = await request.json()
        current_method = data.get("method", "")      # 九宗门方法
        current_sanchuan = data.get("sanchuan", [])  # 三传 [初传,中传,末传]
        current_sike = data.get("sike", [])          # 四课上神列表
        max_cases = data.get("max_cases", 3)

        references = []
        for fp in sorted(cases_dir.glob("*.json"), reverse=True):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    c = json.load(f)
            except Exception:
                continue

            notes = c.get("personal_notes", "").strip()
            if not notes or len(notes) < 20:
                continue

            pan = c.get("pan_data", {})
            if not pan:
                continue

            sc = pan.get("三传", {})
            case_method = sc.get("方法", "")
            case_sc = [sc.get("初传", ""), sc.get("中传", ""), sc.get("末传", "")]

            # 计算相似度
            score = 0
            if case_method == current_method:
                score += 3  # 同一课式权重最高
            for cs in case_sc:
                if cs in current_sanchuan:
                    score += 2  # 三传重合

            # 四课 overlap
            sike_list = [s.get("上神", "") for s in pan.get("四课详情", [])]
            for sk in sike_list:
                if sk in current_sike:
                    score += 1

            if score > 0:
                sz = pan.get("时间", {}).get("四柱", {})
                references.append({
                    "case_id": c.get("id", ""),
                    "case_name": c.get("name", ""),
                    "score": score,
                    "method": case_method,
                    "sizhu": f"{sz.get('年柱','')} {sz.get('月柱','')} {sz.get('日柱','')} {sz.get('时柱','')}",
                    "sanchuan": "→".join(case_sc),
                    "notes_snippet": notes[:800],
                    "full_notes": notes,
                })

        # 按相似度降序，取前 N 个
        references.sort(key=lambda r: r["score"], reverse=True)
        references = references[:max_cases]

        return {"success": True, "references": references, "count": len(references)}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/cases/upload")
async def upload_case_to_central(request: Request):
    """用户上传案例到中央共享系统（需管理员审核）"""
    uid = _get_user_id(request)
    if not uid:
        return JSONResponse({"success": False, "message": "请先登录"}, status_code=401)
    try:
        # 获取上传者用户名
        from liuren.auth import get_user_from_token
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        user = get_user_from_token(token)
        uploader_name = user["username"] if user else uid

        data = await request.json()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        case = {
            "id": ts,
            "uploaded_by": uid,
            "uploader_name": uploader_name,
            "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "name": data.get("name", ""),
            "tags": data.get("tags", []),
            "pan_data": data.get("pan_data", {}),
            "notes": data.get("notes", ""),
            "status": "pending",
        }
        shared_dir = get_shared_dir()
        filename = f"shared_{uid}_{ts}.json"
        with open(shared_dir / filename, "w", encoding="utf-8") as f:
            json.dump(case, f, ensure_ascii=False, indent=2)
        return {"success": True, "id": ts, "message": "案例已提交，等待管理员审核"}
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@app.get("/api/cases/shared")
async def list_shared_cases(request: Request):
    """列出已审核通过的共享案例（管理员可查看全部）"""
    uid = _get_user_id(request)
    shared_dir = get_shared_dir()
    files = sorted(shared_dir.glob("shared_*.json"), reverse=True)
    cases = []
    for fp in files[:50]:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            # 普通用户只看已批准的，管理员看全部
            status = c.get("status", "approved")
            if status != "approved" and not (uid and _is_admin(uid)):
                continue
            cases.append({
                "id": c.get("id",""), "name": c.get("name",""),
                "uploaded_by": c.get("uploaded_by",""),
                "uploader_name": c.get("uploader_name",""),
                "uploaded_at": c.get("uploaded_at",""),
                "tags": c.get("tags",[]),
                "status": status,
            })
        except Exception:
            pass
    return {"success": True, "cases": cases}


@app.get("/api/admin/pending-uploads")
async def list_pending_uploads(request: Request):
    """管理员查看待审核的上传"""
    uid = _get_user_id(request)
    if not uid or not _is_admin(uid):
        return JSONResponse({"success": False, "message": "无管理员权限"}, status_code=403)
    shared_dir = get_shared_dir()
    files = sorted(shared_dir.glob("shared_*.json"), reverse=True)
    items = []
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            items.append({
                "id": c.get("id",""), "name": c.get("name",""),
                "uploader_name": c.get("uploader_name",""),
                "uploaded_at": c.get("uploaded_at",""),
                "tags": c.get("tags",[]),
                "status": c.get("status","pending"),
            })
        except Exception:
            pass
    return {"success": True, "items": items}


@app.post("/api/admin/approve-upload/{case_id}")
async def approve_upload(case_id: str, request: Request):
    """管理员批准上传"""
    uid = _get_user_id(request)
    if not uid or not _is_admin(uid):
        return JSONResponse({"success": False, "message": "无管理员权限"}, status_code=403)
    shared_dir = get_shared_dir()
    for fp in shared_dir.glob(f"*{case_id}*.json"):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
            c["status"] = "approved"
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(c, f, ensure_ascii=False, indent=2)
            return {"success": True, "message": "已批准"}
        except Exception as e:
            return JSONResponse({"success": False, "message": str(e)}, status_code=500)
    return JSONResponse({"success": False, "message": "记录不存在"}, status_code=404)


@app.post("/api/admin/reject-upload/{case_id}")
async def reject_upload(case_id: str, request: Request):
    """管理员拒绝上传"""
    uid = _get_user_id(request)
    if not uid or not _is_admin(uid):
        return JSONResponse({"success": False, "message": "无管理员权限"}, status_code=403)
    shared_dir = get_shared_dir()
    for fp in shared_dir.glob(f"*{case_id}*.json"):
        try:
            fp.unlink()
            return {"success": True, "message": "已拒绝并删除"}
        except Exception as e:
            return JSONResponse({"success": False, "message": str(e)}, status_code=500)
    return JSONResponse({"success": False, "message": "记录不存在"}, status_code=404)


def _is_admin(uid: str) -> bool:
    conn = None
    try:
        from liuren.db import _connect as db_connect
        conn = db_connect()
        row = conn.execute("SELECT is_admin FROM users WHERE id=?", (uid,)).fetchone()
        return bool(row["is_admin"]) if row else False
    except:
        return False
    finally:
        if conn:
            conn.close()


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


# ========== 历史记录 API ==========

@app.get("/api/history/list")
async def list_history():
    """列出所有历史记录（摘要，不含完整盘面），合并归档 + 当前文件"""
    try:
        items = []

        # 当前文件
        files = sorted(history_dir.glob("*.json"), reverse=True)
        for fp in files:
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    h = json.load(f)
                items.append({
                    "id": h.get("id", ""),
                    "time": h.get("time", ""),
                    "params": h.get("params", {}),
                    "sizhu": h.get("sizhu", ""),
                    "method": h.get("method", ""),
                    "sanchuan": h.get("sanchuan", ""),
                    "yuejiang": h.get("yuejiang", ""),
                })
            except Exception:
                pass

        # 归档文件
        if history_archive.exists():
            try:
                with open(history_archive, "r", encoding="utf-8") as f:
                    archive = json.load(f)
                for h in archive.get("records", []):
                    items.append({
                        "id": h.get("id", ""),
                        "time": h.get("time", ""),
                        "params": h.get("params", {}),
                        "sizhu": h.get("sizhu", ""),
                        "method": h.get("method", ""),
                        "sanchuan": h.get("sanchuan", ""),
                        "yuejiang": h.get("yuejiang", ""),
                    })
            except Exception:
                pass

        items.sort(key=lambda x: x["time"], reverse=True)
        return {"success": True, "items": items}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/history/{history_id}")
async def get_history(history_id: str):
    """获取单条历史记录的完整盘面（查当前文件+归档）"""
    try:
        fp = history_dir / f"{history_id}.json"
        if fp.exists():
            with open(fp, "r", encoding="utf-8") as f:
                return {"success": True, "data": json.load(f)}

        # 查归档
        if history_archive.exists():
            with open(history_archive, "r", encoding="utf-8") as f:
                archive = json.load(f)
            for h in archive.get("records", []):
                if h.get("id") == history_id:
                    return {"success": True, "data": h}

        return JSONResponse({"success": False, "error": "记录不存在"}, status_code=404)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.delete("/api/history/{history_id}")
async def delete_history(history_id: str):
    """删除单条历史记录"""
    try:
        fp = history_dir / f"{history_id}.json"
        if fp.exists():
            fp.unlink()
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/history/clear")
async def clear_history():
    """清空所有历史记录"""
    try:
        for fp in history_dir.glob("*.json"):
            fp.unlink()
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ========== Skill 管理 API ==========

@app.get("/api/skills/list")
async def api_skills_list():
    """列出所有已加载的 skill（不含完整正文，仅摘要）"""
    try:
        skills = load_all_skills()
        summary = []
        for sk in skills:
            content = sk.pop("_content", "")
            sk.pop("_file", None)
            # 内容摘要（前200字）
            sk["preview"] = content[:200].replace("\n", " ")[:200]
            summary.append(sk)
        return {"success": True, "skills": summary}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/skills/{skill_id}")
async def api_get_skill(skill_id: str):
    """获取单个 skill 完整内容"""
    try:
        sk = get_skill_by_id(skill_id)
        if not sk:
            return JSONResponse({"success": False, "error": "Skill 不存在"}, status_code=404)
        return {"success": True, "skill": sk}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/skills/route")
async def api_route_skill(request: Request):
    """根据用户问题自动匹配 skill"""
    try:
        data = await request.json()
        question = data.get("question", "")
        sk = match_skill(question)
        if sk:
            content = sk.pop("_content", "")
            sk.pop("_file", None)
            sk["preview"] = content[:200].replace("\n", " ")[:200]
            return {"success": True, "matched": sk}
        return {"success": True, "matched": None, "message": "未匹配到专用 skill，使用默认解读"}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ========== 自反迭代 API ==========

@app.post("/api/reflections/save")
async def api_save_reflection(request: Request):
    """保存用户反馈（自反记录）"""
    try:
        data = await request.json()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        reflection = {
            "id": ts,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "skill_used": data.get("skill_id", ""),
            "question": data.get("question", ""),
            "ai_response": data.get("ai_response", ""),
            "user_feedback": data.get("feedback", ""),  # "accurate" | "inaccurate"
            "user_correction": data.get("correction", ""),
            "actual_outcome": data.get("actual_outcome", ""),
            "pan_summary": data.get("pan_summary", {}),
        }
        ref_dir = get_reflections_dir()
        ref_file = ref_dir / f"{ts}.json"
        with open(ref_file, "w", encoding="utf-8") as f:
            json.dump(reflection, f, ensure_ascii=False, indent=2)
        return {"success": True, "id": ts}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/reflections/list")
async def api_list_reflections():
    """列出所有自反记录"""
    try:
        ref_dir = get_reflections_dir()
        files = sorted(ref_dir.glob("*.json"), reverse=True)
        items = []
        for fp in files[:100]:
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    items.append(json.load(f))
            except Exception:
                pass
        return {"success": True, "items": items}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/reflections/analyze")
async def api_analyze_reflections(request: Request):
    """AI 分析自反记录，生成 skill 修正建议"""
    try:
        data = await request.json()
        skill_id = data.get("skill_id", "")
        max_items = data.get("max_items", 20)

        ref_dir = get_reflections_dir()
        files = sorted(ref_dir.glob("*.json"), reverse=True)
        relevant = []
        for fp in files:
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    r = json.load(f)
                if not skill_id or r.get("skill_used") == skill_id:
                    # 只收集"不准确"的反馈
                    if r.get("user_feedback") == "inaccurate":
                        relevant.append(r)
                if len(relevant) >= max_items:
                    break
            except Exception:
                pass

        if not relevant:
            return {"success": True, "analysis": "暂无需要分析的反馈数据。", "count": 0}

        ctx_parts = [f"# 大六壬 Skill 自反分析\n共 {len(relevant)} 条'不准确'反馈\n"]
        for i, ref in enumerate(relevant):
            ctx_parts.append(f"## 反馈 {i+1}")
            ctx_parts.append(f"- 问题：{ref.get('question','')}")
            ctx_parts.append(f"- AI 回答摘要：{ref.get('ai_response','')[:500]}")
            ctx_parts.append(f"- 用户纠错：{ref.get('correction','')}")
            ctx_parts.append(f"- 实际结果：{ref.get('actual_outcome','')}")
            ctx_parts.append("")

        full_ctx = "\n".join(ctx_parts)
        system = """你是一位大六壬专家，负责审查 AI 解盘的错误并改进 Skill 质量。

请分析以上反馈，找出：
1. **模式性错误**：哪些神将/六亲/课式被反复误判？
2. **语言问题**：AI 的输出风格是否符合 Skill 的语言宪章？
3. **结构缺陷**：Skill 的哪个步骤描述不够清晰？
4. **修正建议**：给出 3-5 条具体的 Skill 规则修正建议，每条用一句话。

格式：先概述问题模式，再逐条列修正建议。建议写在 ```suggestions 代码块中。"""

        msgs = [{"role": "user", "content": full_ctx}]
        response = _call_llm(system, msgs)

        return {"success": True, "analysis": response, "count": len(relevant)}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/ganzhi-search")
async def search_by_ganzhi(request: Request):
    """根据四柱干支反查公历日期。支持年/月/日/时柱逐级筛选。"""
    try:
        data = await request.json()
        nian_zhu = data.get("nian_zhu", "").strip()   # 年柱 如"癸未"
        yue_zhu = data.get("yue_zhu", "").strip()     # 月柱 如"乙丑"
        ri_zhu = data.get("ri_zhu", "").strip()       # 日柱 如"丁未"
        shi_zhu = data.get("shi_zhu", "").strip()     # 时柱 如"己酉"

        # 至少需要一个柱
        if not any([nian_zhu, yue_zhu, ri_zhu, shi_zhu]):
            return JSONResponse({"success": False, "error": "至少需要输入一个柱"}, status_code=400)

        from liuren.sizhu import (get_sizhu, get_nian_zhu, get_yue_zhu,
                                   get_ri_zhu, get_shi_zhu, JIAZI, TIANGAN,
                                   DIZHI, ZHI_INDEX, WUHU_DUN, WUSHU_DUN)
        from datetime import datetime, timedelta, timezone
        import calendar as cal_mod

        BJ_TZ = timezone(timedelta(hours=8))
        now = datetime.now(BJ_TZ)
        cur_year = now.year

        # --- 1. 确定候选年份 ---
        if len(nian_zhu) == 2:
            try:
                base_idx = JIAZI.index(nian_zhu)
            except ValueError:
                return {"success": True, "matches": [], "hint": f"无效的干支: {nian_zhu}"}
            # 1984=甲子, so year = base_idx + 1984 + 60*k
            ref_year = 1984 + base_idx
            # 收集 ±80 年内的候选年
            cand_years = []
            for k in range(-5, 6):
                y = ref_year + 60 * k
                if 1900 <= y <= 2100:
                    cand_years.append(y)
        else:
            # 未提供年柱 → 搜索当前年份 ±1 年
            cand_years = list(range(cur_year - 1, cur_year + 2))

        # --- 2. 确定各年内的候选月份 ---
        if len(yue_zhu) == 2:
            target_yue_gan = yue_zhu[0]
            target_yue_zhi = yue_zhu[1]
            try:
                target_yue_zhi_idx = ZHI_INDEX[target_yue_zhi]
            except KeyError:
                return {"success": True, "matches": [], "hint": f"无效的地支: {target_yue_zhi}"}
            # 月支对应寅=2月 … 丑=1月
            # yue_zhi_idx: 寅=2(month_idx=2), 卯=3,..., 丑=1
            # Actually ZHI_INDEX: 子=0,丑=1,寅=2,卯=3,...
            # 寅=2 → 2月, 卯=3 → 3月 … 丑=1 → 1月, 子=0 → 12月? No, 子月=大雪后(12月), 丑月=小寒后(1月)
            # So month number = (zhi_idx + 1) % 12 + 1  ... let me think
            # 寅(2)→2, 卯(3)→3, 辰(4)→4, 巳(5)→5, 午(6)→6, 未(7)→7, 申(8)→8, 酉(9)→9, 戌(10)→10, 亥(11)→11, 子(0)→12, 丑(1)→1
            month_num = (target_yue_zhi_idx - 1) % 12 + 1  # 寅(2)→2, 子(0)→12, 丑(1)→1
        else:
            month_num = None

        # --- 3. 分级搜索 ---
        results = []
        MAX_RESULTS = 20
        has_ri = len(ri_zhu) == 2
        has_shi = len(shi_zhu) == 2
        has_nian = len(nian_zhu) == 2
        has_yue = len(yue_zhu) == 2

        # 由于立春在2月初，年柱会跨年：Y年的年柱实际覆盖[Y年立春后, Y+1年立春前]
        # 所以对每个候选年 y，也需检查 y+1 的1-2月
        def _iter_years_and_months(cand_years, has_yue, month_num):
            for y in cand_years:
                # 检查该年 + 次年的1-2月（立春前仍属上年年柱）
                for check_y, month_range in [(y, range(1, 13)), (y + 1, range(1, 3))]:
                    if has_yue:
                        if month_num in month_range:
                            yield check_y, month_num
                    else:
                        for m in month_range:
                            yield check_y, m

        seen = set()
        for y, m in _iter_years_and_months(cand_years, has_yue, month_num if has_yue else None):
            if len(results) >= MAX_RESULTS:
                break

            # 用真实 sizhu 验证年柱（处理立春边界）
            sample_sz = get_sizhu(y, m, min(15, cal_mod.monthrange(y, m)[1]), 12)
            if has_nian and sample_sz["年柱"] != nian_zhu:
                continue

            # 月柱验证
            if has_yue:
                nian_gan = sample_sz["年柱"][0]
                yue_gan_start_idx = TIANGAN.index(WUHU_DUN[nian_gan])
                month_offset = (ZHI_INDEX[target_yue_zhi] - ZHI_INDEX["寅"]) % 12
                actual_yue_gan = TIANGAN[(yue_gan_start_idx + month_offset) % 10]
                if actual_yue_gan != target_yue_gan:
                    continue

            _, max_day = cal_mod.monthrange(y, m)

            if has_ri:
                # 有日柱 → 逐日匹配
                for d in range(1, max_day + 1):
                    if len(results) >= MAX_RESULTS:
                        break
                    day_ri_zhu = get_ri_zhu(y, m, d, 12)
                    if day_ri_zhu != ri_zhu:
                        continue

                    if has_shi:
                        ri_gan = get_ri_zhu(y, m, d, 12)[0]
                        target_shi_zhi_idx = ZHI_INDEX[shi_zhu[1]]
                        shi_gan_start = WUSHU_DUN[ri_gan]
                        shi_gan_start_idx = TIANGAN.index(shi_gan_start)
                        expected_gan = TIANGAN[(shi_gan_start_idx + target_shi_zhi_idx) % 10]
                        if expected_gan != shi_zhu[0]:
                            continue
                        match_hour = ((target_shi_zhi_idx * 2 + 23) % 24)
                    else:
                        match_hour = 12

                    sz = get_sizhu(y, m, d, match_hour)
                    key = f"{y}-{m:02d}-{d:02d}"
                    if key not in seen:
                        seen.add(key)
                        results.append({
                            "date": key,
                            "hour": match_hour,
                            "sizhu": sz,
                        })
            else:
                sample_d = min(15, max_day)
                match_hour = 12
                sz = get_sizhu(y, m, sample_d, match_hour)
                key = f"{y}-{m:02d}"
                if key not in seen:
                    seen.add(key)
                    results.append({
                        "date": f"{y}-{m:02d}-{sample_d:02d}",
                        "hour": match_hour,
                        "sizhu": sz,
                        "_representative": True,
                    })

        # 按距今年份排序
        results.sort(key=lambda r: abs(int(r["date"][:4]) - cur_year))
        results = results[:MAX_RESULTS]

        return {"success": True, "matches": results, "total": len(results)}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ========== 典籍 API ==========

classics_dir = Path(__file__).parent / "classics"


def _load_classic(book_id: str) -> dict | None:
    """加载典籍 JSON 文件"""
    fp = classics_dir / f"{book_id}.json"
    if not fp.exists():
        return None
    with open(fp, "r", encoding="utf-8") as f:
        return json.load(f)


def _find_section(book: dict, section_id: str) -> dict | None:
    """递归查找章节"""
    for s in book.get("sections", []):
        if s["id"] == section_id:
            return s
        for sub in s.get("subsections", []):
            if sub["id"] == section_id:
                return sub
    return None


def _find_personal_style_refs(method: str, sanchuan: list[str], sike: list[str], max_cases: int = 3) -> list[dict]:
    """从案例库中找到有个人笔记的相似案例"""
    refs = []
    for fp in sorted(cases_dir.glob("*.json"), reverse=True):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                c = json.load(f)
        except Exception:
            continue
        notes = c.get("personal_notes", "").strip()
        if not notes or len(notes) < 20:
            continue
        pan = c.get("pan_data", {})
        if not pan:
            continue
        sc = pan.get("三传", {})
        case_method = sc.get("方法", "")
        case_sc = [sc.get("初传", ""), sc.get("中传", ""), sc.get("末传", "")]
        score = 0
        if case_method == method:
            score += 3
        for cs in case_sc:
            if cs in sanchuan:
                score += 2
        case_sike = [s.get("上神", "") for s in pan.get("四课详情", [])]
        for sk in case_sike:
            if sk in sike:
                score += 1
        if score > 0:
            sz = pan.get("时间", {}).get("四柱", {})
            refs.append({
                "case_id": c.get("id", ""),
                "case_name": c.get("name", ""),
                "score": score,
                "method": case_method,
                "sizhu": f"{sz.get('年柱','')} {sz.get('月柱','')} {sz.get('日柱','')} {sz.get('时柱','')}",
                "sanchuan": "→".join(case_sc),
                "notes": notes,
            })
    refs.sort(key=lambda r: r["score"], reverse=True)
    return refs[:max_cases]


def _build_personal_style_context(refs: list[dict]) -> str:
    """构建个人解读风格上下文"""
    parts = ["## 用户个人解读风格参考\n"]
    parts.append("以下是你过去对类似课盘的解读笔记，请参考其中的分析框架、用词风格和判断逻辑来解读当前课盘：\n")
    for i, ref in enumerate(refs):
        parts.append(f"### 参考案例{i+1}：《{ref['case_name']}》")
        parts.append(f"课式：{ref['method']}，三传：{ref['sanchuan']}")
        parts.append(f"四柱：{ref['sizhu']}")
        parts.append(f"**用户笔记：**\n{ref['notes'][:1200]}")
        parts.append("")
    parts.append("请在解读时借鉴上述笔记的分析路径和判断风格，但不要生搬硬套——要根据当前课盘的实际格局灵活运用。")
    return "\n".join(parts)


@app.get("/api/classics/catalog")
async def get_catalog():
    """获取典籍目录"""
    try:
        idx_path = classics_dir / "index.json"
        if not idx_path.exists():
            return JSONResponse({"success": False, "error": "目录文件不存在"}, status_code=404)
        with open(idx_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        return {"success": True, "catalog": catalog["books"]}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/classics/{book_id}")
async def get_book(book_id: str):
    """获取典籍全文（含目录结构，不含详细正文）"""
    try:
        book = _load_classic(book_id)
        if not book:
            return JSONResponse({"success": False, "error": "典籍不存在"}, status_code=404)
        # 返回不含完整 content 的结构（减轻传输量）
        slim = {
            "id": book["id"],
            "title": book["title"],
            "author": book["author"],
            "dynasty": book["dynasty"],
            "description": book["description"],
            "sections": [],
            "tags": book.get("tags", []),
        }
        for s in book.get("sections", []):
            sec = {"id": s["id"], "title": s["title"], "tags": s.get("tags", []),
                   "has_content": bool(s.get("content")),
                   "subsections": []}
            for sub in s.get("subsections", []):
                sec["subsections"].append({
                    "id": sub["id"], "title": sub["title"], "tags": sub.get("tags", []),
                    "has_content": bool(sub.get("content")),
                })
            slim["sections"].append(sec)
        return {"success": True, "book": slim}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/classics/{book_id}/section/{section_id}")
async def get_section(book_id: str, section_id: str):
    """获取典籍中某个章节的详细内容"""
    try:
        book = _load_classic(book_id)
        if not book:
            return JSONResponse({"success": False, "error": "典籍不存在"}, status_code=404)
        sec = _find_section(book, section_id)
        if not sec:
            return JSONResponse({"success": False, "error": "章节不存在"}, status_code=404)

        # 返回章节（含正文），并附上所属典籍信息
        return {
            "success": True,
            "section": sec,
            "book_title": book["title"],
            "book_author": book.get("author", ""),
            "book_id": book_id,
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/classics/search")
async def search_classics(request: Request):
    """在典籍中搜索关键词"""
    try:
        data = await request.json()
        keyword = data.get("keyword", "").strip()
        if not keyword or len(keyword) < 1:
            return JSONResponse({"success": False, "error": "请输入搜索关键词"}, status_code=400)

        results = []
        for fp in sorted(classics_dir.glob("*.json")):
            if fp.name == "index.json":
                continue
            with open(fp, "r", encoding="utf-8") as f:
                book = json.load(f)

            for s in book.get("sections", []):
                # 搜索标题和正文
                if keyword in s.get("title", "") or keyword in s.get("content", ""):
                    results.append({
                        "book_id": book["id"],
                        "book_title": book["title"],
                        "section_id": s["id"],
                        "section_title": s["title"],
                        "match_type": "section",
                        "snippet": _extract_snippet(s.get("content", ""), keyword),
                    })
                for sub in s.get("subsections", []):
                    if keyword in sub.get("title", "") or keyword in sub.get("content", ""):
                        results.append({
                            "book_id": book["id"],
                            "book_title": book["title"],
                            "section_id": sub["id"],
                            "section_title": f"{s['title']} > {sub['title']}",
                            "match_type": "subsection",
                            "snippet": _extract_snippet(sub.get("content", ""), keyword),
                        })

        return {"success": True, "results": results[:30], "keyword": keyword}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


def _extract_snippet(text: str, keyword: str, context: int = 40) -> str:
    """提取关键词周围的文本片段"""
    if not text:
        return ""
    idx = text.find(keyword)
    if idx == -1:
        return text[:80]
    start = max(0, idx - context)
    end = min(len(text), idx + len(keyword) + context)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet += "..."
    return snippet


@app.post("/api/classics/interpret")
async def interpret_classic(request: Request):
    """AI 解读典籍段落"""
    try:
        data = await request.json()
        book_id = data.get("book_id", "")
        section_id = data.get("section_id", "")
        user_question = data.get("question", "请解读此段内容")

        book = _load_classic(book_id)
        if not book:
            return JSONResponse({"success": False, "error": "典籍不存在"}, status_code=404)

        sec = _find_section(book, section_id)
        if not sec:
            return JSONResponse({"success": False, "error": "章节不存在"}, status_code=404)

        from liuren.jiepan import _call_llm

        context = f"""## 典籍原文

来源：《{book['title']}》（{book.get('dynasty','')} · {book.get('author','')}）
章节：{sec['title']}

### 正文
{sec.get('content', '无正文')}

### 注疏
{sec.get('commentary', '无注疏')}

### 标签
{', '.join(sec.get('tags', []))}
"""
        system = """你是一位精通大六壬的古典文献学者兼命理专家。你可以帮助用户：
1. 解读大六壬经典文献的含义和深层道理
2. 将古文翻译成通俗易懂的现代中文
3. 结合课式实例讲解经典法则的应用
4. 辨析经典中易于混淆的概念
5. 引申经典法则在现代生活中的实际运用

请用专业但通俗易懂的语言回答。先总结核心要义，再逐层解析。
如果用户的问题涉及具体课式，请举例说明如何运用此法则判断。"""

        response = _call_llm(system, [{"role": "user", "content": f"{context}\n\n用户问题：{user_question}"}])

        return {
            "success": True,
            "interpretation": response,
            "book_title": book["title"],
            "section_title": sec["title"],
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/classics/reference")
async def reference_classic_to_chat(request: Request):
    """
    将典籍段落作为上下文，结合当前盘面进行 AI 解读。
    用于用户在浏览典籍时点击"引用到当前解盘"。
    """
    try:
        data = await request.json()
        book_id = data.get("book_id", "")
        section_id = data.get("section_id", "")
        pan_data = data.get("pan_data")  # 可选的当前盘面数据
        question = data.get("question", "请结合此经典法则分析当前课盘")

        book = _load_classic(book_id)
        if not book:
            return JSONResponse({"success": False, "error": "典籍不存在"}, status_code=404)

        sec = _find_section(book, section_id)
        if not sec:
            return JSONResponse({"success": False, "error": "章节不存在"}, status_code=404)

        from liuren.jiepan import _call_llm

        context_parts = [f"""## 典籍参考

**《{book['title']}》** — {sec['title']}

### 经典原文
{sec.get('content', '无正文')}

### 注疏
{sec.get('commentary', '无注疏')}
"""]

        if pan_data:
            from liuren.jiepan import _build_pan_context
            pan_ctx = _build_pan_context(pan_data)
            context_parts.append(f"\n## 当前课盘\n{pan_ctx}")

        full_ctx = "\n".join(context_parts)

        system = """你是一位精通大六壬的命理师。你需要结合经典典籍的理论，来分析用户当前的课盘。
1. 先简要说明所引经典的核心理念
2. 再将经典法则与当前课盘的具体情况进行对照分析
3. 给出综合判断与建议
4. 语言专业但不晦涩，方便用户学习理解"""

        response = _call_llm(system, [{"role": "user", "content": f"{full_ctx}\n\n用户问题：{question}"}])

        return {
            "success": True,
            "analysis": response,
            "book_title": book["title"],
            "section_title": sec["title"],
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ========== /典籍 API ==========

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
