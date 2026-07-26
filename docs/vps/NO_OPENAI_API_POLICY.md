# No OpenAI API policy

The new platform must function without OpenAI API or another paid LLM API.

Mandatory flags:

```text
OPENAI_API_ENABLED=false
OPENAI_API_AUTOMATION_ENABLED=false
EXTERNAL_LLM_CALLS_ENABLED=false
```

The deterministic engine handles clear cases. Ambiguous decisions are queued for interactive review or human review. The queue may be inspected through MCP, but the platform itself does not call ChatGPT.

Any future external model integration requires:

- a separate architecture decision;
- budget approval;
- privacy assessment;
- explicit credentials;
- failure isolation;
- non-blocking fallback;
- a new authorization.
