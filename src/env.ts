import { envsafe, str, bool } from "envsafe";

export const env = envsafe({
  AWS_ACCESS_KEY_ID: str(),
  AWS_SECRET_ACCESS_KEY: str(),
  AWS_S3_BUCKET: str(),
  AWS_S3_REGION: str(),
  BACKUP_DATABASE_URL: str({
    desc: 'The connection string of the database to backup.'
  }),
  BACKUP_CRON_SCHEDULE: str({
    desc: 'The cron schedule to run the backup on.',
    default: '0 5 * * *',
    allowEmpty: true
  }),
  AWS_S3_ENDPOINT: str({
    desc: 'The S3 custom endpoint you want to use.',
    default: '',
    allowEmpty: true,
  }),
  AWS_S3_FORCE_PATH_STYLE: bool({
    desc: 'Use path style for the endpoint instead of the default subdomain style, useful for MinIO',
    default: false,
    allowEmpty: true
  }),
  RUN_ON_STARTUP: bool({
    desc: 'Run a backup on startup of this application',
    default: false,
    allowEmpty: true,
  }),
  BACKUP_FILE_PREFIX: str({
    desc: 'Prefix to the file name',
    default: 'backup',
  }),
  BUCKET_SUBFOLDER: str({
    desc: 'A subfolder to place the backup files in',
    default: '',
    allowEmpty: true
  }),
  SINGLE_SHOT_MODE: bool({
    desc: 'Run a single backup on start and exit when completed',
    default: false,
    allowEmpty: true,
  }),
  // This is both time consuming and resource intensive so we leave it disabled by default
  SUPPORT_OBJECT_LOCK: bool({
    desc: 'Enables support for buckets with object lock by providing an MD5 hash with the backup file',
    default: false
  }),
  BACKUP_OPTIONS: str({
    desc: 'Any valid pg_dump option.',
    default: '',
    allowEmpty: true,
  }),
  ENABLE_ENCRYPTION: bool({
    desc: 'Enable encryption for database backups',
    default: false,
    allowEmpty: true,
  }),
  ENCRYPTION_KEY: str({
    desc: 'Encryption key for database backups (required if ENABLE_ENCRYPTION is true)',
    default: '',
    allowEmpty: true,
  }),
  BACKUP_RETENTION_DAYS: str({
    desc: 'Number of days to retain backups. Older backups will be automatically deleted. Set to 0 to disable retention by days.',
    default: '0',
    allowEmpty: true,
  }),
  BACKUP_RETENTION_COUNT: str({
    desc: 'Maximum number of backups to keep. Older backups beyond this count will be automatically deleted. Set to 0 to disable retention by count.',
    default: '0',
    allowEmpty: true,
  }),
  RESTORE_DATABASE_URL: str({
    desc: 'The connection string of the database to restore to. If not set, uses BACKUP_DATABASE_URL.',
    default: '',
    allowEmpty: true,
  }),
  RESTORE_OPTIONS: str({
    desc: 'Any valid pg_restore option. Supported pg_restore options can be found here: https://www.postgresql.org/docs/current/app-pgrestore.html',
    default: '',
    allowEmpty: true,
  }),
  RESTORE_ON_STARTUP: bool({
    desc: 'Run a restore on startup of this application and exit when completed. This will restore the latest backup from S3 to the database.',
    default: false,
    allowEmpty: true,
  }),
})
