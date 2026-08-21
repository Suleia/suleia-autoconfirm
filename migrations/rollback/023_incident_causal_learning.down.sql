BEGIN;

DELETE FROM operations.chatby_private_message_display WHERE direction='OUTBOUND';
ALTER TABLE operations.chatby_private_message_display
  DROP CONSTRAINT IF EXISTS chatby_private_message_display_direction_check;
ALTER TABLE operations.chatby_private_message_display
  ADD CONSTRAINT chatby_private_message_display_direction_check CHECK (direction='INBOUND');

COMMIT;
