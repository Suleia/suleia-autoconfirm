BEGIN;
-- Migration 036/read classification introduced these precise fail-closed states,
-- but the original private-display enum still rejected them. Keep a closed
-- vocabulary, encryption/PII protection and every other safety constraint.
ALTER TABLE operations.chatby_private_message_display
DROP CONSTRAINT chatby_private_message_display_incident_relevance_check;
ALTER TABLE operations.chatby_private_message_display
ADD CONSTRAINT chatby_private_message_display_incident_relevance_check CHECK(
  incident_relevance IN('BEFORE_INCIDENT','INCIDENT_RELEVANT','ORDER_LIFECYCLE_ONLY','DISCOUNT_RESPONSE',
    'NOTIFICATION_NOT_OBSERVED','BEFORE_NOTIFICATION'));
COMMIT;
