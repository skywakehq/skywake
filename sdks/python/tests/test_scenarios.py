import os
import time

import pytest
from skywake import Conflict, MergeConflict, NotFound, PermissionError, Skywake

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


def test_02_a_file_written_to_a_new_disk_reads_back_and_is_listed(sky):
    app = sky.disk("app")
    app.write("README.md", "# App\n")
    assert app.read("README.md") == "# App\n"
    assert [(e["path"], e["kind"]) for e in app.list()] == [("README.md", "file")]


def test_03_many_files_written_together_are_one_commit(sky):
    app = sky.disk("app")
    before = len(list(app.log()))
    files = {"src/a.py": "a = 1\n", "src/b.py": "b = 2\n", "notes.txt": "hi"}
    app.write(files, message="three files")
    log = list(app.log())
    assert len(log) == before + 1
    assert log[0]["message"] == "three files"


def test_04_both_sides_changing_one_file_make_the_merge_a_merge_conflict(sky):
    app = sky.disk("app")
    work = app.fork("agent-1")
    work.write("notes.txt", "from the agent")
    app.write("notes.txt", "from main")
    with pytest.raises(MergeConflict) as raised:
        work.merge_into("main")
    assert raised.value.conflicts == ["notes.txt"]
    assert work.merge_into("main", prefer="theirs")["commit"]
    assert app.read("notes.txt") == "from the agent"


def test_05_grep_find_and_query_on_a_disk_find_a_file(sky):
    app = sky.disk("app")
    app.write("docs/coffee.md", "How to brew coffee at home.\n")
    assert [(m["path"], m["line"]) for m in app.grep("brew")] == [("docs/coffee.md", 1)]
    assert [f["path"] for f in app.find("*.md", path="docs")] == ["docs/coffee.md"]

    def synced():
        hits = app.query("coffee")
        return hits if any(hit["path"] == "docs/coffee.md" for hit in hits) else None

    assert eventually(synced)[0]["path"] == "docs/coffee.md"


def test_06_read_at_an_old_commit_returns_the_old_content(sky):
    app = sky.disk("app")
    old = app.head()
    app.write("README.md", "# App, changed\n")
    assert app.read("README.md", at=old) == "# App\n"
    assert app.read("README.md") == "# App, changed\n"


def test_07_keys_stay_in_their_environment_and_their_role(keys):
    staging = Skywake(url=URL, key=keys["staging"], environment="prod")
    with pytest.raises(PermissionError):
        staging.disk("app").read("README.md")
    reader = Skywake(url=URL, key=keys["read"])
    assert reader.disk("app").read("README.md") == "# App, changed\n"
    with pytest.raises(PermissionError):
        reader.disk("app").write("x.md", "nope")


def test_08_a_wrong_name_is_not_found_with_a_suggestion(sky):
    with pytest.raises(NotFound) as raised:
        sky.disk("ap").read("README.md")
    assert "`app`" in raised.value.hint


def test_09_destroying_a_branch_then_the_disk_empties_the_list(sky):
    app = sky.disk("app")
    app.on("agent-1").destroy()
    assert [b["name"] for b in app.branches()] == ["main"]
    app.destroy()
    assert list(sky.list_disks()) == []


def test_a_folder_goes_up_as_one_commit_and_comes_back_the_same(sky, tmp_path):
    source = tmp_path / "up"
    source.mkdir()
    (source / "a.txt").write_text("alpha")
    (source / "b.bin").write_bytes(bytes([0, 1, 2, 255]))
    site = sky.disk("site")
    site.upload(source, message="site")
    back = tmp_path / "down"
    site.download(back)
    assert (back / "a.txt").read_text() == "alpha"
    assert (back / "b.bin").read_bytes() == bytes([0, 1, 2, 255])
    site.destroy()
