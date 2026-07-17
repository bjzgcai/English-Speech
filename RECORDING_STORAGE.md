# Recording storage and backups

## Live storage

Production stores recordings as raw files under
`/opt/englisheval/shared/recordings`. The directory persists across versioned
deployments and application restarts.

The production service uses a `0077` umask. Persistent directories use mode
`0700`, and files use mode `0600`. Live files are not encrypted at rest, so
production host and storage access must remain restricted to authorized
administrators.

Application startup never deletes or migrates recordings. Any data migration
must be run explicitly after a verified backup.

## Encrypted backups

The daily maintenance job briefly stops the application, creates a compressed
archive of the live recording directory, encrypts it to the configured age
public recipient, and restarts the application. Only the public recipient is
stored on production; keep the corresponding age identity offline.

`RECORDING_RETENTION_DAYS=0` disables deletion of live recordings.
`BACKUP_RETENTION_DAYS` controls the independent expiration policy for encrypted
backup archives.

Restore backups only into a new empty staging directory:

```bash
./scripts/restore-recordings-backup.sh \
  recordings-YYYYMMDDTHHMMSSZ.tar.gz.age \
  /secure/offline/englisheval-backup-identity.txt \
  /tmp/englisheval-restore-test
```

Verify restored metadata and videos before any manual recovery operation.
