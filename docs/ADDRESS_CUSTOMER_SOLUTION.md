# Customer-provided address solution

Keep the native Chatby direction template as the single initial sender. The response policy requires a street, numeric street number, valid Spanish postcode and locality; it must not invent missing customer fields. `s/n` does not satisfy the numeric-number requirement.

When the current issue allows PROVIDE_SOLUTION, prefer that action so the note carries the validated address, supplied floor/door/province/country/reference fields and the current order's phone with an explicit instruction to call before delivery. Structured-only address capabilities retain their separate guarded stage; this change does not activate them.

Each capability may use `ADDRESS_<STAGE>_REGRESSION_GATE_REVISION` to pin its tested release. This permits validation of INTERPRETATION, DETAILS and SOLUTION without opening unrelated offer, return, pickup or structured-change stages. The general release gate remains the fallback. The existing canary must succeed on a real eligible case before automatic promotion; never manufacture a promotion record or claim carrier execution from a note submission.

Validation: 268 workflow/provider tests, including numeric-number validation, full address and call instruction in the actual provider plan, unrelated-stage isolation, current-order correlation, duplicate claims and late responses. Deployment and runtime verification must be recorded privately, not in this public document.
