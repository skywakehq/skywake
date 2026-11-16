import httpx
import pytest
from skywake import Skywake

NAMES = ["SKYWAKE_API_KEY", "SKYWAKE_KEY", "SKYWAKE_URL", "SKYWAKE_ENV", "SKYWAKE_PROFILE"]


@pytest.fixture
def credentials(monkeypatch, tmp_path):
    for name in NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("APPDATA", str(tmp_path))

    def write(text):
        (tmp_path / "skywake").mkdir(exist_ok=True)
        (tmp_path / "skywake" / "credentials.toml").write_text(text)

    return write


def recorder():
    seen = {}

    def handle(request):
        seen["authorization"] = request.headers.get("authorization")
        seen["environment"] = request.headers.get("skywake-environment")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"organization": "o"})

    return seen, httpx.MockTransport(handle)


def test_with_nothing_set_the_error_says_how_to_sign_in(credentials):
    with pytest.raises(ValueError, match="skywake login"):
        Skywake()


def test_the_key_comes_from_the_environment_and_the_url_defaults_to_the_cloud(credentials, monkeypatch):
    monkeypatch.setenv("SKYWAKE_API_KEY", "sw_env")
    seen, transport = recorder()
    Skywake(transport=transport).whoami()
    assert seen["authorization"] == "Bearer sw_env"
    assert seen["url"] == "https://api.skywake.dev/v2/whoami"


def test_a_profile_is_used_when_no_key_is_given(credentials, monkeypatch):
    credentials(
        '[default]\nkey = "sw_file"\nurl = "http://local"\nenvironment = "prod"\n\n' '[staging]\nkey = "sw_staging"\n'
    )
    seen, transport = recorder()
    Skywake(transport=transport).whoami()
    assert seen == {
        "authorization": "Bearer sw_file",
        "environment": "prod",
        "url": "http://local/v2/whoami",
    }
    monkeypatch.setenv("SKYWAKE_PROFILE", "staging")
    Skywake(transport=transport).whoami()
    assert seen["authorization"] == "Bearer sw_staging"
    assert seen["environment"] is None


def test_code_beats_the_environment_which_beats_the_file(credentials, monkeypatch):
    credentials('[default]\nkey = "sw_file"\n')
    monkeypatch.setenv("SKYWAKE_API_KEY", "sw_env")
    seen, transport = recorder()
    Skywake(transport=transport, environment="staging").whoami()
    assert seen["authorization"] == "Bearer sw_env"
    assert seen["environment"] == "staging"
    with Skywake(url="http://other", key="sw_code", transport=transport) as sky:
        sky.whoami()
    assert seen["authorization"] == "Bearer sw_code"
    assert seen["url"] == "http://other/v2/whoami"
