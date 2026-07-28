# MCP no-OpenAI-API validation

The VPS safety envelope sets all of the following to `false`:

`OPENAI_API_ENABLED`, `OPENAI_API_AUTOMATION_ENABLED`,
`OPENAI_RESPONSES_API_ENABLED`, `OPENAI_ASSISTANTS_API_ENABLED`,
`OPENAI_CHAT_COMPLETIONS_ENABLED`, `EXTERNAL_LLM_CALLS_ENABLED` and
`LOCAL_LLM_ENABLED`.

The MCP refuses to start when any of those flags is enabled or when
`OPENAI_API_KEY` is present. Its container has only internal Docker networks,
so it has no general Internet egress and cannot reach `api.openai.com`.

Historical OpenAI client code exists outside the VPS platform package. It is
not imported by staging services, remains disabled and was not deleted.

Expected steady state:

- `OPENAI_API_CALLS=0`
- `OPENAI_API_COST=0_EUR`
- `EXTERNAL_LLM_CALLS=0`
- `ACTIONS_EXECUTED=0`
- `PRODUCTION_WRITES=0`

