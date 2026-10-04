export function assertAgentSecurity(agent) {
  const conversation = agent.conversation_config?.conversation;
  const settings = agent.platform_settings;
  const limits = settings?.call_limits;
  if (settings?.auth?.enable_auth !== true || settings.auth.allowlist?.length)
    throw Error(
      'The agent must require signed URL authentication without a hostname allowlist.',
    );
  if (
    !Number.isInteger(conversation?.max_duration_seconds) ||
    conversation.max_duration_seconds < 1 ||
    conversation.max_duration_seconds > 180
  )
    throw Error('The agent duration must be at most 180 seconds.');
  if (
    !Number.isInteger(limits?.agent_concurrency_limit) ||
    limits.agent_concurrency_limit < 1 ||
    limits.agent_concurrency_limit > 2 ||
    !Number.isInteger(limits?.daily_limit) ||
    limits.daily_limit < 1 ||
    limits.daily_limit > 60 ||
    limits.bursting_enabled !== false
  )
    throw Error(
      'The agent must enforce concurrency <= 2, daily calls <= 60 and bursting off.',
    );
  const overrides = settings?.overrides?.conversation_config_override ?? {};
  const allowed = new Set([
    'agent.first_message',
    'conversation.text_only',
    'tts.voice_id',
  ]);
  const walk = (object, path = '') => {
    for (const [key, value] of Object.entries(object ?? {})) {
      const next = path ? path + '.' + key : key;
      if (value === true && !allowed.has(next))
        throw Error('An unsafe agent override is enabled: ' + next);
      if (value !== null && typeof value === 'object') walk(value, next);
    }
  };
  walk(overrides);
  if (
    settings.overrides?.custom_llm_extra_body === true ||
    settings.overrides?.custom_llm_extra_headers === true
  )
    throw Error('Custom LLM overrides must be disabled.');
  if (agent.conversation_config?.tts?.model_id !== 'eleven_v4_turbo')
    throw Error('The character agent must use the configured v4 Turbo model.');
}
