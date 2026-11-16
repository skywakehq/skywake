import json


class SkywakeError(Exception):
    def __init__(self, status, message, code=None, hint=None, request_id=None, path=None):
        super().__init__(f"{message}; {hint}" if hint else message)
        self.status = status
        self.message = message
        self.code = code
        self.hint = hint
        self.request_id = request_id
        self.path = path


class AuthError(SkywakeError):
    pass


class PermissionError(SkywakeError):
    pass


class NotFound(SkywakeError):
    pass


class Conflict(SkywakeError):
    pass


class InvalidRequest(SkywakeError):
    pass


class ServerError(SkywakeError):
    pass


class MergeConflict(Conflict):
    def __init__(self, *args, conflicts=(), **kwargs):
        super().__init__(*args, **kwargs)
        self.conflicts = list(conflicts)


class RateLimited(SkywakeError):
    def __init__(self, *args, retry_after=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.retry_after = retry_after


def _retry_after(headers):
    try:
        seconds = float(headers.get("retry-after", ""))
    except ValueError:
        return None
    return seconds if seconds > 0 else None


def error_of(status, headers, content):
    try:
        body = json.loads(content)
    except ValueError:
        body = {}
    raw = body.get("error") if isinstance(body, dict) else None
    error = raw if isinstance(raw, dict) else {"message": raw, "code": body.get("code")}
    fields = dict(
        message=error.get("message") or f"HTTP {status}",
        code=error.get("code"),
        hint=error.get("hint"),
        request_id=error.get("request_id") or headers.get("x-request-id"),
        path=error.get("path"),
    )
    if status == 401:
        return AuthError(status, **fields)
    if status == 403:
        return PermissionError(status, **fields)
    if status == 404:
        return NotFound(status, **fields)
    if status == 409 and error.get("conflicts"):
        return MergeConflict(status, conflicts=error["conflicts"], **fields)
    if status == 409:
        return Conflict(status, **fields)
    if status == 429:
        return RateLimited(status, retry_after=_retry_after(headers), **fields)
    if status >= 500:
        return ServerError(status, **fields)
    return InvalidRequest(status, **fields)
