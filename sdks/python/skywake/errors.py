class SkywakeError(Exception):
    """An error answer from the API.

    `code` says what kind of error it is, such as "not_found" or
    "rate_limited". Quote `request_id` when you report a bug. For an
    invalid request, `path` is the JSON path of the field that is wrong.
    For a revert that conflicts, `conflicts` lists the paths in the way.
    """

    def __init__(self, status, message, code=None, request_id=None, path=None, conflicts=None):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message
        self.code = code
        self.request_id = request_id
        self.path = path
        self.conflicts = conflicts or []
