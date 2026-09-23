import re
from urllib.parse import urlsplit


class Canceled(Exception):
    pass


class ProviderError(Exception):
    pass


class DiagnosticResponse(dict):
    """Private request context; never added to JSON response fields."""


def public_url(value):
    """Keep the endpoint, never signed queries, fragments or URL credentials."""
    try:
        url = urlsplit(str(value))
        if url.scheme not in ("http", "https") or not url.hostname:
            return ""
        return f"{url.scheme}://{url.hostname}" + (f":{url.port}" if url.port else "") + url.path
    except ValueError:
        return ""


def safe_text(value, secrets=()):
    text = str(value)
    for secret in sorted((s for s in secrets if s), key=len, reverse=True):
        text = text.replace(secret, "[redacted]")
    text = re.sub(r"https?://[^\s<>\"']+", lambda match: public_url(match[0]), text)
    # Do not render serialized request/response headers or bodies.
    text = re.sub(r"(?is)\b(headers|body|cookies|authorization)\b[\"']?\s*[:=].*", r"\1=[redacted]", text)
    text = re.sub(r"(?i)\b(UID|CID|SEID|KID|cookie|token|access_token|refresh_token|password|sign|signature)\b[\"']?\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    return text[:1000]


def response_error(result, secrets=()):
    secrets = list(secrets) + list(getattr(result, "request_secrets", ()))
    def collect(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if re.search(r"(?i)cookie|token|password|authorization|signature|^(uid|cid|seid|kid|sign)$", str(key)) and isinstance(item, str):
                    secrets.append(item)
                    secrets.extend(part.split("=", 1)[1].strip() for part in item.split(";") if "=" in part)
                elif isinstance(item, (dict, list)):
                    collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
    collect(result)
    code = result.get("errno", result.get("errNo", result.get("code", "unknown")))
    message = next((result[key] for key in ("message", "msg", "error_msg", "error", "error_message") if isinstance(result.get(key), (str, int)) and result[key]), "115接口返回失败")
    detail = f"115 API {safe_text(code, secrets)}: {safe_text(message, secrets)}"
    endpoint = getattr(result, "request_endpoint", "")
    return f"{endpoint}\n{detail}" if endpoint else detail


def describe_error(error, url="", method="", secrets=()):
    if isinstance(error, ProviderError):
        message = str(error)
        if error.__cause__ is not None:
            cause = describe_error(error.__cause__)
            if cause not in message:
                message += "\n" + cause
        return message
    url = url or getattr(error, "request_url", "")
    method = method or getattr(error, "request_method", "")
    secrets = tuple(secrets) + tuple(getattr(error, "request_secrets", ()))
    endpoint = public_url(url or getattr(error, "url", ""))
    # Static SDK login methods do not use the account's request wrapper.
    trace = error.__traceback__
    while trace:
        frame = trace.tb_frame
        if frame.f_code.co_name in ("request", "request_sync"):
            endpoint = endpoint or public_url(frame.f_locals.get("url", ""))
            method = method or str(frame.f_locals.get("method", ""))
        trace = trace.tb_next
    status = getattr(error, "code", None) or getattr(error, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        detail = f"HTTP {status} {safe_text(getattr(error, 'reason', ''), secrets)}".strip()
    else:
        payload = next((arg for arg in error.args if isinstance(arg, dict)), None)
        detail = response_error(payload, secrets) if payload else safe_text(error, secrets)
        detail = f"{type(error).__name__}: {detail}"
    return ((method.upper() + " " if method else "") + endpoint + "\n" if endpoint else "") + detail


def install_request_diagnostics(client, cookie):
    """Wrap this account's synchronous SDK requests, without global monkeypatches."""
    original = client.request
    secrets = [cookie] + [part.split("=", 1)[1].strip() for part in cookie.split(";") if "=" in part]

    def request(url, method="GET", **kwargs):
        try:
            result = original(url=url, method=method, **kwargs)
        except Exception as error:
            # Preserve exception types so SDK retries/fallbacks remain unchanged.
            error.request_url = public_url(url)
            error.request_method = method
            error.request_secrets = secrets
            raise
        if isinstance(result, dict) and result.get("state") in (False, 0):
            # Preserve SDK fallback/check_response behavior for API-level failures.
            result = DiagnosticResponse(result)
            result.request_endpoint = f"{method.upper()} {public_url(url)}"
            result.request_secrets = secrets
        return result

    client.request = request
