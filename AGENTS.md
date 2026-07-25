# Suleia agent instructions

This repository is the shared technical source of truth for the Suleia
logistics automation.

## Agents

- Codex implements, tests, publishes and verifies repository changes.
- The ChatGPT confirmation agent analyzes business cases, reviews decisions
  and proposes work using this repository and the GitHub coordination issue.
- Sharing the same OpenAI email does not create a direct session or memory
  link. GitHub is the explicit shared channel between agents.

## Required context

Before proposing or changing anything, read:

1. `AGENTS.md`
2. `docs/AGENT_HANDOFF.md`
3. The open GitHub issue titled
   `[AGENT HUB] Suleia confirmation-agent coordination`
4. The files directly involved in the requested change

## Safety rules

- Never commit, print or request plaintext credentials.
- Secrets belong only in trusted local secret storage, Render environment
  variables or another approved secret manager.
- Do not commit `.env`, tokens, API keys, passwords, customer conversations,
  phone numbers or personal data.
- Do not make the repository public as an access workaround. Repository
  visibility is an owner decision.
- Do not change Chatby templates, Chatby flows, Shopify themes, Meta
  configuration or Dropea actions unless the user explicitly requests that
  exact scope.
- Production actions with financial or customer impact require explicit user
  authorization and a post-action verification.
- Preserve existing user changes and never revert unrelated work.

## Logistic-agent invariants

- Confirmation detection uses the existing production logic unless the user
  explicitly requests a logic change.
- A valid confirmation must belong to the current order. Stale Chatby fields,
  labels or tags from older orders are not valid evidence.
- Real confirmation waits one hour, then re-reads the conversation before
  acting.
- A later cancellation, correction or change of mind blocks confirmation.
- A requested address change is not automatically confirmed until the
  applicable business rule is satisfied.
- Every real Dropea action must be logged with order id, reason, timestamp and
  result.
- Message and template delivery must be idempotent: never send the same
  lifecycle template twice for the same order.

## Collaboration protocol

Use the Agent Hub issue as the shared mailbox.

For each handoff, add a comment with:

- `FROM`: Codex or ChatGPT confirmation agent
- `STATUS`: analysis, proposed, implemented, verified or blocked
- `SCOPE`: exact files, order ids or subsystem
- `EVIDENCE`: logs, tests or repository links without secrets or personal data
- `NEXT`: one concrete next action

Do not claim a change is deployed or verified without evidence. If GitHub
write access is unavailable, produce the same handoff block for the user to
paste into the Agent Hub issue.

## Change workflow

1. Read the current Agent Hub issue and repository instructions.
2. Confirm the requested scope and identify risk.
3. Make the smallest safe change.
4. Run focused tests.
5. Publish through GitHub using an intentional commit.
6. Verify Render or the target service when deployment is part of the request.
7. Post a concise handoff in the Agent Hub issue.
