"""Regression: switch_model must not AttributeError when api_key is unset.

init_agent never set api_key on bedrock_converse. A later live switch to a
chat_completions model then crashed on `api_key or agent.api_key` and the
gateway stayed on the previous model.
"""

from unittest.mock import MagicMock, patch

from run_agent import AIAgent


def _bare_bedrock_agent() -> AIAgent:
    """Live-shaped agent that skipped api_key (pre-fix bedrock_converse init)."""
    agent = AIAgent.__new__(AIAgent)

    agent.model = "anthropic.claude-sonnet-4-5"
    agent.provider = "bedrock"
    agent.base_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    agent.api_mode = "bedrock_converse"
    agent.client = None
    agent._client_kwargs = {}
    agent.context_compressor = None
    agent._anthropic_api_key = ""
    agent._anthropic_base_url = None
    agent._anthropic_client = None
    agent._is_anthropic_oauth = False
    agent._cached_system_prompt = "cached"
    agent._primary_runtime = {}
    agent._fallback_activated = False
    agent._fallback_index = 0
    agent._fallback_chain = []
    agent._fallback_model = None
    agent._config_context_length = None
    agent.runtime_capabilities = {"native_compaction": False}
    agent.quiet_mode = True

    return agent


def test_switch_model_bare_agent_without_api_key_does_not_raise():
    """Empty incoming key + missing agent.api_key → chat_completions, no raise."""
    agent = _bare_bedrock_agent()
    assert not hasattr(agent, "api_key")

    new_client = MagicMock(name="OpenRouterClient")
    agent._create_openai_client = lambda *_a, **_kw: new_client

    with patch("hermes_cli.timeouts.get_provider_request_timeout", return_value=None):
        agent.switch_model(
            new_model="openai/gpt-4o",
            new_provider="openrouter",
            api_key="",
            base_url="https://openrouter.ai/api/v1",
            api_mode="chat_completions",
        )

    assert agent.model == "openai/gpt-4o"
    assert agent.provider == "openrouter"
    assert agent.api_mode == "chat_completions"
    assert agent.client is new_client
