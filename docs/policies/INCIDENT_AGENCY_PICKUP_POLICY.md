# Incident agency-pickup policy

Version: `vps-staging-v1`  
Mode: `SIMULATION`

`MARK_AGENCY_PICKUP` is proposed only when current independent carrier or
incident-history evidence explicitly confirms `AGENCY_PICKUP_CONFIRMED`.

Customer preference alone is insufficient. It produces
`VERIFY_AGENCY_PICKUP` through `HUMAN_REVIEW`.

If a later logistics event reports `RETURNED_TO_ORIGIN`, that event supersedes
the earlier pickup evidence. The result becomes `NO_ACTION` through
`HUMAN_REVIEW` with conflict reason
`AGENCY_PICKUP_SUPERSEDED_BY_RETURN`.

No proposal executes a carrier action.
