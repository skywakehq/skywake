import os
import time

import pytest
from skywake import Conflict, NotFound, PermissionError, Skywake

URL = os.environ.get("SKYWAKE_SCENARIO_URL")
ADMIN = os.environ.get("SKYWAKE_SCENARIO_KEY")

pytestmark = pytest.mark.skipif(not (URL and ADMIN), reason="needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY")


@pytest.fixture(scope="module")
def keys():
    org = Skywake(url=URL, key=ADMIN)
    for name in ("prod", "staging"):
        try:
            org.create_environment(name)
        except Conflict:
            pass
    return {
        "prod": org.create_key("prod", "admin", environment="prod")["key"],
        "staging": org.create_key("staging", "admin", environment="staging")["key"],
        "read": org.create_key("reader", "read", environment="prod")["key"],
    }


@pytest.fixture(scope="module")
def sky(keys):
    saved = {name: os.environ.pop(name, None) for name in ("SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE")}
    os.environ["SKYWAKE_URL"] = URL
    os.environ["SKYWAKE_API_KEY"] = keys["prod"]
    yield Skywake()
    for name, value in saved.items():
        if value is not None:
            os.environ[name] = value


def eventually(check):
    for _ in range(100):
        found = check()
        if found is not None:
            return found
        time.sleep(0.2)
    return None


def test_01_with_only_the_key_set_whoami_shows_the_environment(sky):
    me = sky.whoami()
    assert me["environment"] == "prod"
    assert me["role"] == "admin"


def test_02_one_row_upserted_to_a_new_index_is_found_by_query(sky):
    sky.index("products").upsert({"id": "mug", "text": "a blue coffee mug", "price": 12, "tags": ["kitchen"]})
    hits = sky.index("products").query("coffee mug")
    assert hits[0]["id"] == "mug"
    assert hits[0]["price"] == 12


def test_03_ten_thousand_rows_upserted_in_one_call_are_all_counted(sky):
    rows = [
        {
            "id": f"row-{i}",
            "text": f"running shoe number {i}" if i % 2 else f"invoice {i}",
            "price": i % 100,
            "tags": ["shoes" if i % 2 else "billing"],
        }
        for i in range(10_000)
    ]
    assert sky.index("bulk").upsert(rows)["count"] == 10_000
    assert sky.index("bulk").count() == 10_000
    assert sky.index("bulk").count({"tags": {"contains": "shoes"}}) == 5_000


def test_04_a_query_takes_a_filter_a_limit_and_keywords_mode(sky):
    hits = sky.index("bulk").query("shoe", mode="keywords", filter={"price": {"lt": 10}}, limit=3)
    assert len(hits) == 3
    assert all(hit["price"] < 10 and "shoe" in hit["text"] for hit in hits)


def test_05_update_shows_in_get_and_delete_makes_get_none(sky):
    products = sky.index("products")
    assert products.update("mug", {"price": 9}) == 1
    assert products.get("mug")["price"] == 9
    assert products.delete("mug") == 1
    assert products.get("mug") is None


def test_06_a_fork_changes_apart_from_main_and_merging_brings_the_change(sky):
    products = sky.index("products")
    products.upsert({"id": "cup", "text": "a white coffee cup", "price": 5})
    draft = products.fork("draft")
    draft.update("cup", {"price": 7})
    assert draft.query("coffee cup")[0]["price"] == 7
    assert products.query("coffee cup")[0]["price"] == 5
    draft.merge_into("main")
    assert products.get("cup")["price"] == 7


def test_12_keys_stay_in_their_environment_and_their_role(keys):
    staging = Skywake(url=URL, key=keys["staging"], environment="prod")
    with pytest.raises(PermissionError):
        staging.index("products").query("coffee")
    reader = Skywake(url=URL, key=keys["read"])
    assert reader.index("products").get("cup")["price"] == 7
    with pytest.raises(PermissionError):
        reader.index("products").upsert({"id": "x", "text": "nope"})


def test_13_a_wrong_name_is_not_found_with_a_suggestion(sky):
    with pytest.raises(NotFound) as raised:
        sky.index("prodcts").query("coffee")
    assert "products" in raised.value.hint


def test_14_destroying_a_branch_then_the_indexes_empties_the_list(sky):
    products = sky.index("products")
    products.on("draft").destroy()
    assert [b["name"] for b in products.branches()] == ["main"]
    for name in ("products", "bulk"):
        sky.index(name).destroy()
    assert list(sky.list_indexes()) == []
