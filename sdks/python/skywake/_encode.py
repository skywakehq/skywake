"""Shaping names and bodies for the API."""

from urllib.parse import quote


def compact(fields):
    """The fields that are set: the server uses its defaults for the rest."""
    return {name: value for name, value in fields.items() if value is not None}


def name_in_url(name):
    """Namespace and branch names may hold `/`. In a URL it must be `%2F`."""
    return quote(name, safe="")


def encryption(kms_key_id):
    return None if kms_key_id is None else {"kms_key_id": kms_key_id}


def pinned(replicas):
    return None if replicas is None else {"replicas": replicas}
