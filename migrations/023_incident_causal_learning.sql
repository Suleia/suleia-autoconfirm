BEGIN;

ALTER TABLE operations.chatby_private_message_display
  DROP CONSTRAINT IF EXISTS chatby_private_message_display_direction_check;
ALTER TABLE operations.chatby_private_message_display
  ADD CONSTRAINT chatby_private_message_display_direction_check
  CHECK (direction IN ('INBOUND','OUTBOUND'));

COMMENT ON COLUMN operations.chatby_private_message_display.direction IS
  'Authenticated Operations-only conversation context. OUTBOUND is retained so short customer replies can be interpreted against the exact preceding question.';

COMMIT;
