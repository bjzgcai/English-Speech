# Recording encryption and persistence

## Data-retention policy

Production recordings do not expire. `RECORDING_RETENTION_DAYS=0` disables
deletion of live videos and extracted evaluation artifacts. Evaluation metadata
is also retained.

Encrypted backup snapshots have an independent expiration policy.
`BACKUP_RETENTION_DAYS=30` removes backup archives older than 30 days without
deleting the live recordings they contain.

## Live-storage encryption

The production recordings directory is an 8 GB LUKS2 encrypted filesystem. It
is mounted at the application's existing private recordings path, so the Node
application does not handle encryption keys and requires no encryption-specific
code.

The encrypted filesystem uses:

- LUKS2 with the platform's standard AES-XTS data encryption.
- `nodev`, `nosuid`, and `noexec` mount options.
- Directory mode `0700` and file mode `0600`.
- A systemd `UMask=0077` for newly created videos and artifacts.
- Service mount conditions that prevent the application and maintenance job
  from starting against an unmounted plaintext directory.

The LUKS unlock key is deliberately absent from the server, repository,
environment files, documentation, and deployment artifacts. It is maintained
separately by an authorized administrator. This repository contains no key
material, key fingerprint, recipient value, passphrase, or recovery secret.

After a reboot, an administrator supplies the protected key path at runtime:

```bash
LUKS_KEY_FILE=/secure/offline/path ./ops/unlock-production-recordings.sh
```

To stop the application, unmount the filesystem, and remove the active key from
the server kernel:

```bash
./ops/lock-production-recordings.sh
```

## Encrypted backups

The daily maintenance job follows this order:

1. Stop the application to obtain a consistent filesystem view.
2. Create a compressed archive of recording data.
3. Encrypt the archive to an age public recipient.
4. Write a SHA-256 checksum beside the encrypted archive.
5. Remove encrypted archives older than `BACKUP_RETENTION_DAYS`.
6. Skip live-recording deletion because `RECORDING_RETENTION_DAYS=0`.
7. Restart the application.

Only a public encryption recipient is configured on production. The age
identity required for decryption is kept off-server and outside the repository.
Backup restoration always targets a new empty staging directory and never
overwrites live persistent data directly.

## Security boundaries

Encryption protects recordings when the LUKS volume is locked and protects
backup archives if they are copied or disclosed. It does not protect recordings
from an attacker who controls the running application or production root account
while the filesystem is unlocked.

The operating-system root filesystem is not encrypted. The active recording
filesystem and all maintained recording backup archives are encrypted. Any
hypervisor snapshots made before the encrypted migration may still contain
historical plaintext blocks and should be expired according to infrastructure
policy.

## Recovery requirements

Recovery requires both the protected LUKS key and a valid LUKS header. Maintain
offline copies under the organization's recovery controls. Do not commit,
paste, log, or transmit them through issue trackers or chat.

Periodically test both recovery paths:

- Lock and unlock the live volume, then verify application health.
- Decrypt an encrypted backup into an empty staging directory and compare file
  hashes before relying on it.
