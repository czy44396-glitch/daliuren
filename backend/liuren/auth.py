"""
认证模块 — JWT + 微信OAuth + 密码登录
"""
import hashlib
import time
import uuid
import json
import urllib.request
from pathlib import Path
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.hash import bcrypt
from liuren.db import _connect

# JWT 密钥（生产环境应使用环境变量）
JWT_SECRET = "dal-liuren-jwt-secret-key-2026"
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 720  # token 有效期 30 天


def hash_password(password: str) -> str:
    return bcrypt.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.verify(password, password_hash)


def create_token(user_id: str) -> str:
    """生成 JWT token"""
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict | None:
    """验证 JWT token，返回 payload 或 None"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def get_user_from_token(token: str) -> dict | None:
    """从 token 获取用户信息"""
    payload = verify_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def register_user(username: str, password: str, nickname: str = "") -> dict:
    """注册新用户（用户名方式），返回 {success, message, user}"""
    conn = _connect()
    try:
        existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if existing:
            return {"success": False, "message": "用户名已存在"}

        user_id = str(uuid.uuid4())[:8]
        pw_hash = hash_password(password)
        now = datetime.now().strftime("%Y-%m")
        conn.execute(
            "INSERT INTO users (id, username, password_hash, nickname, quota_month) VALUES (?,?,?,?,?)",
            (user_id, username, pw_hash, nickname or username, now)
        )
        conn.commit()
        token = create_token(user_id)
        return {
            "success": True,
            "message": "注册成功",
            "user": {"id": user_id, "username": username, "nickname": nickname or username},
            "token": token,
        }
    finally:
        conn.close()


def register_email(email: str, password: str, nickname: str = "") -> dict:
    """邮箱注册，返回 {success, message, user}"""
    import re
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return {"success": False, "message": "邮箱格式不正确"}

    conn = _connect()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            return {"success": False, "message": "该邮箱已注册，请直接登录"}

        user_id = str(uuid.uuid4())[:8]
        username = email.split('@')[0]
        # 确保 username 唯一
        base = username
        counter = 1
        while conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
            username = f"{base}{counter}"
            counter += 1

        pw_hash = hash_password(password)
        now = datetime.now().strftime("%Y-%m")
        conn.execute(
            "INSERT INTO users (id, username, email, password_hash, nickname, quota_month) VALUES (?,?,?,?,?,?)",
            (user_id, username, email, pw_hash, nickname or username, now)
        )
        conn.commit()
        token = create_token(user_id)
        return {
            "success": True,
            "message": "注册成功",
            "user": {"id": user_id, "username": username, "nickname": nickname or username, "email": email},
            "token": token,
        }
    finally:
        conn.close()


def login_email(email: str, password: str) -> dict:
    """邮箱登录"""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not row:
            return {"success": False, "message": "该邮箱未注册，请先注册"}

        user = dict(row)
        if not verify_password(password, user["password_hash"] or ""):
            return {"success": False, "message": "密码错误"}

        token = create_token(user["id"])
        return {
            "success": True,
            "message": "登录成功",
            "user": {
                "id": user["id"], "username": user["username"],
                "email": user.get("email",""),
                "nickname": user["nickname"], "avatar_url": user.get("avatar_url",""),
                "is_admin": bool(user["is_admin"]),
                "quota_total": user["quota_total"], "quota_used": user["quota_used"],
                "quota_month": user["quota_month"],
            },
            "token": token,
        }
    finally:
        conn.close()


def login_user(username: str, password: str) -> dict:
    """密码登录"""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            return {"success": False, "message": "用户名不存在"}

        user = dict(row)
        if not verify_password(password, user["password_hash"]):
            return {"success": False, "message": "密码错误"}

        token = create_token(user["id"])
        return {
            "success": True,
            "message": "登录成功",
            "user": {
                "id": user["id"], "username": user["username"],
                "nickname": user["nickname"], "avatar_url": user["avatar_url"],
                "is_admin": bool(user["is_admin"]),
                "quota_total": user["quota_total"], "quota_used": user["quota_used"],
                "quota_month": user["quota_month"],
            },
            "token": token,
        }
    finally:
        conn.close()


def wechat_login(code: str, app_id: str, app_secret: str) -> dict:
    """
    微信 OAuth 登录。
    需要用户已在微信开放平台注册应用并配置回调域名。
    """
    # 1. 用 code 换取 access_token 和 openid
    token_url = (
        f"https://api.weixin.qq.com/sns/oauth2/access_token"
        f"?appid={app_id}&secret={app_secret}&code={code}&grant_type=authorization_code"
    )
    try:
        with urllib.request.urlopen(token_url, timeout=10) as resp:
            token_data = json.loads(resp.read())
    except Exception as e:
        return {"success": False, "message": f"微信接口请求失败：{e}"}

    if "errcode" in token_data:
        return {"success": False, "message": f"微信登录失败：{token_data.get('errmsg','')}"}

    openid = token_data.get("openid")
    unionid = token_data.get("unionid", "")
    access_token = token_data.get("access_token")

    # 2. 获取用户信息
    user_info = {}
    if access_token and openid:
        info_url = (
            f"https://api.weixin.qq.com/sns/userinfo"
            f"?access_token={access_token}&openid={openid}&lang=zh_CN"
        )
        try:
            with urllib.request.urlopen(info_url, timeout=10) as resp:
                user_info = json.loads(resp.read())
        except Exception:
            pass  # 用户信息获取失败不影响登录

    nickname = user_info.get("nickname", f"微信用户{openid[:6]}")
    avatar_url = user_info.get("headimgurl", "")

    # 3. 查找或创建用户
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE wechat_openid=?", (openid,)).fetchone()
        if row:
            user = dict(row)
            # 更新昵称头像
            conn.execute(
                "UPDATE users SET nickname=?, avatar_url=?, wechat_unionid=? WHERE id=?",
                (nickname, avatar_url, unionid, user["id"])
            )
            conn.commit()
            user["nickname"] = nickname
        else:
            user_id = str(uuid.uuid4())[:8]
            now = datetime.now().strftime("%Y-%m")
            conn.execute(
                "INSERT INTO users (id, username, wechat_openid, wechat_unionid, nickname, avatar_url, quota_month) "
                "VALUES (?,?,?,?,?,?,?)",
                (user_id, f"wx_{openid[:8]}", openid, unionid, nickname, avatar_url, now)
            )
            conn.commit()
            user = {
                "id": user_id, "username": f"wx_{openid[:8]}",
                "nickname": nickname, "avatar_url": avatar_url,
                "is_admin": False, "quota_total": 30, "quota_used": 0,
                "quota_month": now,
            }

        token = create_token(user["id"])
        return {
            "success": True,
            "message": "微信登录成功",
            "user": {
                "id": user["id"], "username": user.get("username",""),
                "nickname": user.get("nickname", nickname),
                "avatar_url": user.get("avatar_url",""),
                "is_admin": bool(user.get("is_admin", 0)),
                "quota_total": user.get("quota_total", 30),
                "quota_used": user.get("quota_used", 0),
                "quota_month": user.get("quota_month", ""),
            },
            "token": token,
        }
    finally:
        conn.close()


# ====== 配额管理 ======

def check_quota(user_id: str) -> dict:
    """检查用户配额，返回 {allowed, quota_total, quota_used, quota_month}"""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return {"allowed": False, "reason": "用户不存在"}

        user = dict(row)
        now_month = datetime.now().strftime("%Y-%m")

        # 跨月重置
        if user["quota_month"] != now_month:
            conn.execute(
                "UPDATE users SET quota_used=0, quota_month=? WHERE id=?",
                (now_month, user_id)
            )
            conn.commit()
            user["quota_used"] = 0
            user["quota_month"] = now_month

        if user["is_admin"]:
            return {"allowed": True, "quota_total": 9999, "quota_used": user["quota_used"], "quota_month": now_month}

        if user["quota_used"] >= user["quota_total"]:
            return {"allowed": False, "reason": "本月配额已用完", "quota_total": user["quota_total"], "quota_used": user["quota_used"]}

        return {"allowed": True, "quota_total": user["quota_total"], "quota_used": user["quota_used"], "quota_month": now_month}
    finally:
        conn.close()


def consume_quota(user_id: str) -> bool:
    """消耗一次配额，返回是否成功"""
    conn = _connect()
    try:
        check = check_quota(user_id)
        if not check["allowed"]:
            return False
        conn.execute("UPDATE users SET quota_used = quota_used + 1 WHERE id=?", (user_id,))
        conn.commit()
        return True
    finally:
        conn.close()


def admin_set_quota(admin_user_id: str, target_user_id: str, quota_total: int) -> dict:
    """管理员设置用户配额"""
    conn = _connect()
    try:
        admin = conn.execute("SELECT is_admin FROM users WHERE id=?", (admin_user_id,)).fetchone()
        if not admin or not admin["is_admin"]:
            return {"success": False, "message": "无管理员权限"}

        conn.execute("UPDATE users SET quota_total=? WHERE id=?", (quota_total, target_user_id))
        conn.commit()
        return {"success": True, "message": f"已将用户 {target_user_id} 配额设置为 {quota_total}"}
    finally:
        conn.close()


def admin_list_users(admin_user_id: str) -> dict:
    """管理员列出所有用户"""
    conn = _connect()
    try:
        admin = conn.execute("SELECT is_admin FROM users WHERE id=?", (admin_user_id,)).fetchone()
        if not admin or not admin["is_admin"]:
            return {"success": False, "message": "无管理员权限"}

        rows = conn.execute(
            "SELECT id, username, nickname, created_at, quota_total, quota_used, quota_month, is_admin "
            "FROM users ORDER BY created_at DESC"
        ).fetchall()
        return {"success": True, "users": [dict(r) for r in rows]}
    finally:
        conn.close()


def get_user_data_dir(user_id: str) -> Path:
    """获取用户数据目录"""
    user_dir = Path(__file__).parent.parent / "data" / "user_data" / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "cases").mkdir(exist_ok=True)
    (user_dir / "history").mkdir(exist_ok=True)
    (user_dir / "reflections").mkdir(exist_ok=True)
    return user_dir


def get_shared_dir() -> Path:
    """获取中心共享数据目录"""
    shared_dir = Path(__file__).parent.parent / "data" / "shared"
    shared_dir.mkdir(parents=True, exist_ok=True)
    return shared_dir
