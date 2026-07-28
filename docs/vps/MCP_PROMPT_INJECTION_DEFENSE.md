# MCP prompt-injection defense

Customer, carrier and connector content is data, never an instruction.

Controls:

- tool descriptions state read-only, simulation-only and no external actions;
- schemas are strict and reject unknown fields;
- free-text filters accept only bounded uppercase reason codes;
- no tool accepts URLs, commands, code, SQL, paths or generic bodies;
- response metadata marks external content as untrusted and requires human
  review for any action;
- raw payloads, conversations and messages are dropped by the masking layer;
- HTML, Markdown or embedded instructions are never evaluated by the MCP;
- final responses are masked and scanned before release;
- timeout and size limits fail closed;
- rejected auth, scopes, oversized requests and rate limits are auditable.

The MCP has no action executor, connector client or OpenAI client. Therefore an
embedded prompt cannot acquire a path to messages, order updates, discounts,
credentials or tools outside the fixed eight-tool surface.

