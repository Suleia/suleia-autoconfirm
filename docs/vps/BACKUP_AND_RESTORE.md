# Backup and restore

## Draft policy

- Daily PostgreSQL custom-format dump.
- SHA-256 checksum per archive.
- Configurable daily retention, defaulting to fourteen days, pending legal approval.
- Proposed weekly and monthly retention values are documented but are not activated until legal approval.
- Encrypted off-site copy in a separate provider/account.
- Provider snapshot before upgrades.
- Weekly isolated restore test.

The retention period is marked `PENDING_LEGAL_APPROVAL` and must be confirmed against business and privacy obligations.

## Scripts

- `infrastructure/backup/backup.sh`
- `infrastructure/backup/verify_backup.sh`
- `infrastructure/backup/restore.sh`
- `infrastructure/backup/backup_status.sh`

Restore is blocked unless `ALLOW_RESTORE=true` is explicitly set. A checksum check is not a substitute for a full restore drill.
