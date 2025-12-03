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

## Notes for Postgres 17

If backing up a Postgres 17 database imported from Postgres 16, set `PG_VERSION=17` and `NODE_VERSION=22`.
