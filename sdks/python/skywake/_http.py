"""Sending requests to the API: retries, errors and streamed answers."""

import random
import time

import httpx

from .errors import SkywakeError

# Sending these again has the same effect as sending them once.
IDEMPOTENT = {"GET", "HEAD", "PUT", "DELETE", "OPTIONS"}
# The server asks for at most 60 seconds; waiting less would only be refused again.
MAX_WAIT = 60.0


def check(response):
    """Returns the response, or raises its error."""
    if response.is_success:
        return response
    response.read()
    try:
        body = response.json()
        message = body["error"]
    except (ValueError, KeyError, TypeError):
        body, message = {}, response.text
    raise SkywakeError(
        response.status_code,
        message,
        code=body.get("code"),
        request_id=body.get("request_id") or response.headers.get("x-request-id"),
        path=body.get("path"),
        conflicts=body.get("conflicts"),
    )


def check_or_close(response):
    """Like `check`, for a streamed response: it is closed if it is an error."""
    try:
        return check(response)
    except BaseException:
        response.close()
        raise


def iter_closing(response, pieces):
    """Yields `pieces` of a streamed response, then closes it, even when the
    reader stops early."""
    try:
        yield from pieces
    finally:
        response.close()


def send_with_retries(http, method, path, retries, backoff, stream=False, **kwargs):
    """Sends a request, again after network errors and 5xx answers when that
    is safe, and after 429 always: the server refuses those before doing
    anything.

    A DELETE that failed that way may still have landed, so if a retry of it
    then finds nothing (404), it answers 204: what it deleted is gone either
    way."""
    method = method.upper()
    idempotent = method in IDEMPOTENT
    may_have_landed = False
    for attempt in range(retries + 1):
        last = attempt == retries
        try:
            response = http.send(http.build_request(method, path, **kwargs), stream=stream)
        except httpx.TransportError:
            if last or not idempotent:
                raise
            may_have_landed = True
            time.sleep(_backoff(attempt, backoff))
            continue
        if may_have_landed and method == "DELETE" and response.status_code == 404:
            response.close()
            return httpx.Response(204, request=response.request)
        again = response.status_code == 429 or (idempotent and response.status_code >= 500)
        if last or not again:
            return response
        may_have_landed = may_have_landed or response.status_code >= 500
        response.close()
        time.sleep(min(_retry_after(response) or _backoff(attempt, backoff), MAX_WAIT))
    raise AssertionError("unreachable")


def _backoff(attempt, base):
    # Full jitter, so many clients that failed together do not retry together.
    return random.uniform(0, min(MAX_WAIT, base * 2**attempt))


def _retry_after(response):
    try:
        seconds = float(response.headers.get("retry-after", ""))
    except ValueError:
        return None
    return seconds if seconds > 0 else None
