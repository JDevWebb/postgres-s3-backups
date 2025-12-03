# Postgres S3 backups

A simple NodeJS application to backup your PostgreSQL database to S3 via a cron.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/I4zGrH)

## Configuration

- `AWS_ACCESS_KEY_ID` - AWS access key ID.

- `AWS_SECRET_ACCESS_KEY` - AWS secret access key, sometimes also called an application key.

- `AWS_S3_BUCKET` - The name of the bucket that the access key ID and secret access key are authorized to access.

- `AWS_S3_REGION` - The name of the region your bucket is located in, set to `auto` if unknown.

- `BACKUP_DATABASE_URL` - The connection string of the database to backup.

- `BACKUP_CRON_SCHEDULE` - The cron schedule to run the backup on. Example: `0 5 * * *`

- `AWS_S3_ENDPOINT` - The S3 custom endpoint you want to use. Applicable for 3-rd party S3 services such as Cloudflare R2 or Backblaze R2.

- `AWS_S3_FORCE_PATH_STYLE` - Use path style for the endpoint instead of the default subdomain style, useful for MinIO. Default `false`

- `RUN_ON_STARTUP` - Run a backup on startup of this application then proceed with making backups on the set schedule.

- `BACKUP_FILE_PREFIX` - Add a prefix to the file name.

- `BUCKET_SUBFOLDER` - Define a subfolder to place the backup files in.

- `SINGLE_SHOT_MODE` - Run a single backup on start and exit when completed. Useful with the platform's native CRON schedular.

- `SUPPORT_OBJECT_LOCK` - Enables support for buckets with object lock by providing an MD5 hash with the backup file.

- `BACKUP_OPTIONS` - Add any valid pg_dump option, supported pg_dump options can be found [here](https://www.postgresql.org/docs/current/app-pgdump.html). Example: `--exclude-table=pattern`

- `ENABLE_ENCRYPTION` - Enable encryption for database backups. Default `false`. When enabled, backup files will be encrypted using AES-256-GCM before upload to S3.

- `ENCRYPTION_KEY` - Encryption key for database backups. Required when `ENABLE_ENCRYPTION` is `true`. The key is hashed using SHA-256 to derive the encryption key.

- `BACKUP_RETENTION_DAYS` - Number of days to retain backups. Backups older than this will be automatically deleted. Set to `0` to disable retention by days. Default `0`.

- `BACKUP_RETENTION_COUNT` - Maximum number of backups to keep. When this limit is exceeded, the oldest backups will be automatically deleted. Set to `0` to disable retention by count. Default `0`.

- `RESTORE_DATABASE_URL` - The connection string of the database to restore to. If not set, uses `BACKUP_DATABASE_URL`. Only needed when using the restore functionality.

- `RESTORE_OPTIONS` - Any valid pg_restore option. Supported pg_restore options can be found [here](https://www.postgresql.org/docs/current/app-pgrestore.html). Example: `--clean --if-exists`

- `RESTORE_ON_STARTUP` - Run a restore on startup and exit when completed. This will restore the latest backup from S3 to the database. Default `false`.

- `NODE_VERSION` - Specify a custom Node.js version to override the default version set in the Dockerfile.

- `PG_VERSION` - Specify a custom PostgreSQL version to override the default version set in the Dockerfile.

## Encryption

When `ENABLE_ENCRYPTION` is set to `true`, backup files are encrypted using **AES-256-GCM** before being uploaded to S3. Encrypted files have a `.enc` extension appended to the filename (e.g., `backup-2024-01-01T12-00-00-000Z.tar.gz.enc`).

### Encryption Format

The encrypted file format is:
- **IV (Initialization Vector)**: 16 bytes at the beginning
- **Authentication Tag**: 16 bytes following the IV
- **Encrypted Data**: The rest of the file contains the encrypted backup data

The encryption key is derived from the `ENCRYPTION_KEY` environment variable using SHA-256 hashing.

### Decryption

To decrypt a backup file, you'll need:
1. The encrypted backup file (downloaded from S3)
2. The same `ENCRYPTION_KEY` that was used to encrypt the file

See [DECRYPTION.md](./DECRYPTION.md) for detailed decryption instructions and example code.

## Backup Retention

The application supports automatic cleanup of old backups based on two retention policies:

### Retention by Days

Set `BACKUP_RETENTION_DAYS` to automatically delete backups older than the specified number of days. For example:
- `BACKUP_RETENTION_DAYS=30` - Keeps backups for 30 days
- `BACKUP_RETENTION_DAYS=0` - Disables retention by days (default)

### Retention by Count

Set `BACKUP_RETENTION_COUNT` to limit the total number of backups kept. When this limit is exceeded, the oldest backups are deleted first. For example:
- `BACKUP_RETENTION_COUNT=10` - Keeps only the 10 most recent backups
- `BACKUP_RETENTION_COUNT=0` - Disables retention by count (default)

### Combined Retention Policies

Both retention policies can be used together. The cleanup process will delete backups that violate either policy:
- If a backup is older than `BACKUP_RETENTION_DAYS`, it will be deleted
- If the total number of backups exceeds `BACKUP_RETENTION_COUNT`, the oldest backups will be deleted until the count is satisfied

**Note**: Retention cleanup runs automatically after each backup is uploaded to S3. The cleanup process only affects backups that match your `BACKUP_FILE_PREFIX` and `BUCKET_SUBFOLDER` settings.

### Examples

```bash
# Keep backups for 30 days
BACKUP_RETENTION_DAYS=30

# Keep only the last 10 backups
BACKUP_RETENTION_COUNT=10

# Keep backups for 30 days AND limit to 10 backups (whichever is more restrictive)
BACKUP_RETENTION_DAYS=30
BACKUP_RETENTION_COUNT=10
```

## Database Restore

The application includes a restore function that can automatically:
1. Scan S3 for available backups
2. Find and download the latest backup
3. Auto-decrypt if the backup is encrypted
4. Restore the database using `pg_restore`

### Using the Restore Function

#### Option 1: Environment Variable (Recommended)

Set `RESTORE_ON_STARTUP=true` to automatically restore the latest backup on application startup. The application will exit after the restore completes:

```bash
RESTORE_ON_STARTUP=true
RESTORE_DATABASE_URL=postgresql://user:password@host:5432/dbname
ENCRYPTION_KEY=your-key-here  # Required if restoring encrypted backups
```

#### Option 2: Programmatic Usage

The restore function is exported from the backup module and can be called programmatically:

```javascript
import { restore } from './backup.js';

await restore();
```

### Restore Configuration

- **`RESTORE_DATABASE_URL`**: The connection string of the target database. If not set, it defaults to `BACKUP_DATABASE_URL`.
- **`RESTORE_OPTIONS`**: Additional options to pass to `pg_restore`. Common options:
  - `--clean` - Clean (drop) database objects before recreating them
  - `--if-exists` - Use IF EXISTS when dropping objects
  - `--no-owner` - Skip restoration of object ownership
  - `--no-privileges` - Skip restoration of access privileges

### How It Works

1. **Scan S3**: The function scans your S3 bucket (respecting `BACKUP_FILE_PREFIX` and `BUCKET_SUBFOLDER` settings) to find all available backups.

2. **Find Latest**: It identifies the most recent backup based on the `LastModified` timestamp in S3.

3. **Download**: The latest backup is downloaded to a temporary location.

4. **Auto-Decrypt**: If the backup file has a `.enc` extension, it's automatically decrypted using the `ENCRYPTION_KEY` environment variable. The encrypted file is deleted after decryption.

5. **Restore**: The backup is restored to the database using `pg_restore` with the configured options.

6. **Cleanup**: Temporary files are automatically deleted after restoration.

### Example Usage

```javascript
// In your code
import { restore } from './backup.js';

try {
  await restore();
  console.log('Database restored successfully!');
} catch (error) {
  console.error('Restore failed:', error);
}
```

### Environment Variables for Restore

```bash
# Required: Same as backup
BACKUP_DATABASE_URL=postgresql://user:password@host:5432/dbname
ENCRYPTION_KEY=your-key-here  # Required if restoring encrypted backups

# Enable restore on startup (exits after restore completes)
RESTORE_ON_STARTUP=true

# Optional: Different database for restore
RESTORE_DATABASE_URL=postgresql://user:password@host:5432/restore_db

# Optional: Additional restore options
RESTORE_OPTIONS=--clean --if-exists --no-owner
```

### Restore on Startup Mode

When `RESTORE_ON_STARTUP=true` is set:
- The application will scan S3 for the latest backup on startup
- Download and decrypt (if needed) the backup automatically
- Restore it to the specified database
- Exit the application when complete

This is useful for:
- One-time database restores
- Disaster recovery scenarios
- Automated restore workflows
- CI/CD pipelines that need to restore test data

**Note**: When `RESTORE_ON_STARTUP` is enabled, the application will not run backup schedules or other backup operations. It will only perform the restore and exit.

### Important Notes

- **Encryption**: If you're restoring an encrypted backup, make sure `ENCRYPTION_KEY` is set to the same key used during encryption.
- **Database Connection**: Ensure the target database is accessible and the connection string is correct.
- **Permissions**: The restore process requires appropriate database permissions to create/drop objects.
- **Backup Format**: The restore function works with tar format backups (the default format used by this tool).

## Notes for Postgres 17

If backing up a Postgres 17 database imported from Postgres 16, set `PG_VERSION=17` and `NODE_VERSION=22`.
