from agent.user_facing_brand import sanitize_user_facing_brand
from hermes_cli.config_defaults import DEFAULT_CONFIG


def test_rewrites_install_paths_and_product_phrases():
    assert sanitize_user_facing_brand("~/.hermes/profiles/default") == "~/.nia/profiles/default"
    assert (
        sanitize_user_facing_brand("The Hermes desktop app lives here")
        == "The Nia desktop app lives here"
    )
    assert sanitize_user_facing_brand("Hermes Agent can help") == "Nia can help"
    assert sanitize_user_facing_brand("Say hey hermes to wake") == "Say ok nia to wake"
    assert sanitize_user_facing_brand("Say hey nia to wake") == "Say ok nia to wake"
    assert sanitize_user_facing_brand("Ask @hermes later") == "Ask @nia later"


def test_leaves_protocol_and_sdk_identifiers():
    assert sanitize_user_facing_brand("open hermes://settings") == "open hermes://settings"
    assert (
        sanitize_user_facing_brand("import from @hermes/plugin-sdk")
        == "import from @hermes/plugin-sdk"
    )


def test_default_wake_phrase_is_ok_nia():
    wake = DEFAULT_CONFIG["wake_word"]
    assert wake["phrase"] == "ok nia"
    assert wake["provider"] == "sherpa"
    assert "aliases" not in wake
