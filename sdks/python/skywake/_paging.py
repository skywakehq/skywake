"""Lists the API gives a page at a time."""

from ._encode import compact

# The most items one page holds.
PAGE = 1000


def page(limit=None, after=None):
    """The query of one page of a list: at most `limit` items (1000 at most),
    after the key `after`."""
    return compact({"limit": limit, "after": after})


def every(get_page, key):
    """Yields every item of a list, asking for one page at a time until a
    short one. `get_page(limit, after)` gives one page."""
    after = None
    while True:
        items = get_page(PAGE, after)
        yield from items
        if len(items) < PAGE:
            return
        after = key(items[-1])
