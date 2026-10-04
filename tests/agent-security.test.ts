import { describe, expect, it } from 'vitest';
import template from '../docs/character-agent.json';
import { assertAgentSecurity } from '../scripts/agent-security.mjs';
describe('provider-enforced safety configuration', () => {
  it('keeps the checked-in character agent within the production bounds', () => {
    expect(() => assertAgentSecurity(template)).not.toThrow();
  });
  it('rejects disabled authentication, excess call limits and expensive or longer overrides', () => {
    const mutations = [
      (a: typeof template) => {
        a.platform_settings.auth.enable_auth = false;
      },
      (a: typeof template) => {
        a.platform_settings.call_limits.bursting_enabled = true;
      },
      (a: typeof template) => {
        a.platform_settings.call_limits.daily_limit = 1000;
      },
      (a: typeof template) => {
        a.platform_settings.call_limits.agent_concurrency_limit = 10;
      },
      (a: typeof template) => {
        a.conversation_config.conversation.max_duration_seconds = 3600;
      },
      (a: typeof template) => {
        a.platform_settings.overrides.conversation_config_override.conversation.max_duration_seconds = true;
      },
      (a: typeof template) => {
        Object.assign(
          a.platform_settings.overrides.conversation_config_override.tts,
          { model_id: true },
        );
      },
    ];
    for (const mutate of mutations) {
      const agent = structuredClone(template);
      mutate(agent);
      expect(() => assertAgentSecurity(agent)).toThrow();
    }
  });
});
