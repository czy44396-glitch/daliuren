"""
邮箱验证码模块 — 通过 QQ邮箱 SMTP 发送验证码
"""
import smtplib
import random
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# QQ邮箱 SMTP 配置（个人QQ邮箱免费，需在QQ邮箱设置中开启SMTP并获取授权码）
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 465
SMTP_USER = ""      # 你的QQ邮箱地址，如 "123456789@qq.com"
SMTP_PASS = ""      # QQ邮箱授权码（非QQ密码），在 mail.qq.com → 设置 → 账户 → POP3/SMTP 中生成
SENDER_NAME = "大六壬排盘系统"

# 内存中存储验证码（重启服务器会清空，可改用数据库）
_codes: dict[str, dict] = {}


def configure_smtp(user: str, password: str):
    """配置 SMTP（从环境变量或API设置）"""
    global SMTP_USER, SMTP_PASS
    SMTP_USER = user
    SMTP_PASS = password


def generate_code() -> str:
    """生成6位数字验证码"""
    return ''.join(str(random.randint(0, 9)) for _ in range(6))


def send_verification_email(to_email: str, code: str) -> tuple[bool, str]:
    """
    发送验证码邮件，返回 (是否成功, 消息)
    """
    if not SMTP_USER or not SMTP_PASS:
        return False, "SMTP 未配置，请在环境变量中设置 QQMAIL_USER 和 QQMAIL_PASS"

    msg = MIMEMultipart()
    msg["From"] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Subject"] = "大六壬排盘系统 — 登录验证码"

    body = f"""<!DOCTYPE html>
<html><body style="font-family:serif;background:#f5f0e6;padding:40px;text-align:center">
<div style="background:#fffef9;border:1px solid #e5dcc8;border-radius:10px;padding:30px;max-width:400px;margin:0 auto">
    <div style="font-size:24px;color:#1a1614;letter-spacing:4px;margin-bottom:20px">大 六 壬</div>
    <div style="font-size:14px;color:#6b6560;margin-bottom:24px">您的登录验证码</div>
    <div style="font-size:36px;font-weight:700;color:#b83a2e;letter-spacing:8px;margin-bottom:24px">{code}</div>
    <div style="font-size:11px;color:#9a948c">验证码 5 分钟内有效，请勿转发给他人</div>
    <div style="margin-top:24px;height:1px;background:#e5dcc8"></div>
    <div style="font-size:10px;color:#bfb8a8;margin-top:12px">大六壬 · 时空推演</div>
</div>
</body></html>"""

    msg.attach(MIMEText(body, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_email, msg.as_string())
        return True, "验证码已发送"
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP 认证失败，请检查邮箱授权码"
    except smtplib.SMTPException as e:
        return False, f"邮件发送失败：{e}"
    except Exception as e:
        return False, f"发送异常：{e}"


def store_code(email: str) -> str:
    """生成并存储验证码，返回验证码"""
    code = generate_code()
    _codes[email] = {
        "code": code,
        "expires_at": time.time() + 300,  # 5分钟有效
        "attempts": 0,
    }
    return code


def verify_code(email: str, code: str) -> tuple[bool, str]:
    """验证验证码，返回 (是否有效, 消息)"""
    record = _codes.get(email)
    if not record:
        return False, "请先获取验证码"

    if time.time() > record["expires_at"]:
        _codes.pop(email, None)
        return False, "验证码已过期，请重新获取"

    record["attempts"] += 1
    if record["attempts"] > 5:
        _codes.pop(email, None)
        return False, "验证次数过多，请重新获取验证码"

    if record["code"] != code:
        return False, "验证码错误"

    # 验证成功，删除记录
    _codes.pop(email, None)
    return True, "验证成功"
