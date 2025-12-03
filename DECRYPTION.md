# Backup Decryption Guide

This guide explains how to decrypt backup files that were encrypted using the `ENABLE_ENCRYPTION` feature.

## Overview

Encrypted backups use **AES-256-GCM** encryption with the following structure:
- **IV (Initialization Vector)**: First 16 bytes
- **Authentication Tag**: Next 16 bytes  
- **Encrypted Data**: Remaining bytes

The encryption key is derived from your `ENCRYPTION_KEY` environment variable using SHA-256.

## Prerequisites

- Node.js installed (for the Node.js decryption script)
- The encrypted backup file downloaded from S3
- The same `ENCRYPTION_KEY` that was used during encryption

## Decryption Methods

### Method 1: Node.js Script

Use the provided Node.js decryption script:

```bash
node decrypt.js <encrypted-file> <output-file> <encryption-key>
```

Example:
```bash
node decrypt.js backup-2024-01-01T12-00-00-000Z.tar.gz.enc backup-2024-01-01T12-00-00-000Z.tar.gz "your-encryption-key-here"
```

### Method 2: Programmatic Decryption (Node.js)

Here's a complete example you can use in your own code:

```javascript
import crypto from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

function decryptFile(encryptedFilePath, outputFilePath, encryptionKey) {
  // Read the encrypted file
  const encryptedData = readFileSync(encryptedFilePath);
  
  // Extract IV (first 16 bytes)
  const iv = encryptedData.subarray(0, 16);
  
  // Extract auth tag (next 16 bytes)
  const authTag = encryptedData.subarray(16, 32);
  
  // Extract encrypted content (remaining bytes)
  const encrypted = encryptedData.subarray(32);
  
  // Derive the key from the encryption key using SHA-256
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  
  // Create decipher
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt the data
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  // Write the decrypted data to the output file
  writeFileSync(outputFilePath, decrypted);
  
  console.log(`Decryption complete. Output written to: ${outputFilePath}`);
}

// Usage
const encryptedFile = process.argv[2];
const outputFile = process.argv[3];
const encryptionKey = process.argv[4];

if (!encryptedFile || !outputFile || !encryptionKey) {
  console.error('Usage: node decrypt.js <encrypted-file> <output-file> <encryption-key>');
  process.exit(1);
}

decryptFile(encryptedFile, outputFile, encryptionKey);
```

### Method 3: Using OpenSSL (Command Line)

You can also decrypt using OpenSSL, though it requires extracting the components manually:

```bash
# Extract IV, auth tag, and encrypted data
dd if=backup.enc of=iv.bin bs=1 count=16
dd if=backup.enc of=auth_tag.bin bs=1 skip=16 count=16
dd if=backup.enc of=encrypted.bin bs=1 skip=32

# Derive key (requires the encryption key)
echo -n "your-encryption-key" | openssl dgst -sha256 -binary > key.bin

# Decrypt (Note: OpenSSL GCM decryption is more complex and may require additional steps)
# This is a simplified example - you may need to adjust based on your OpenSSL version
openssl enc -d -aes-256-gcm -iv $(xxd -p -c 256 iv.bin) -K $(xxd -p -c 256 key.bin) -in encrypted.bin -out decrypted.tar.gz
```

**Note**: OpenSSL GCM decryption can be complex. The Node.js method is recommended.

## Restoring the Database

After decrypting the backup file, you can restore it to your PostgreSQL database:

```bash
# For tar format backups (default)
gunzip < backup-2024-01-01T12-00-00-000Z.tar.gz | pg_restore -d your_database_name

# Or if the file is already unzipped
pg_restore -d your_database_name backup-2024-01-01T12-00-00-000Z.tar
```

## Security Notes

1. **Key Management**: Store your `ENCRYPTION_KEY` securely. If lost, encrypted backups cannot be recovered.
2. **Key Rotation**: If you need to rotate keys, decrypt old backups and re-encrypt with the new key.
3. **File Permissions**: Ensure decrypted backup files have appropriate permissions and are deleted after restoration.
4. **Transport**: When downloading encrypted backups, use secure channels (HTTPS, SFTP, etc.).

## Troubleshooting

### Error: "Unsupported state or unable to authenticate data"

This usually means:
- The encryption key is incorrect
- The file is corrupted
- The file format doesn't match (not encrypted with this tool)

### Error: "Invalid authentication tag"

This indicates:
- The file may have been tampered with
- The encryption key is incorrect
- The file structure is invalid

### File size seems wrong

Encrypted files will be slightly larger than the original due to the IV and authentication tag (32 bytes total overhead).

## Example: Complete Restore Workflow

```bash
# 1. Download encrypted backup from S3
aws s3 cp s3://your-bucket/backups/backup-2024-01-01T12-00-00-000Z.tar.gz.enc ./

# 2. Decrypt the backup
node decrypt.js backup-2024-01-01T12-00-00-000Z.tar.gz.enc backup-2024-01-01T12-00-00-000Z.tar.gz "$ENCRYPTION_KEY"

# 3. Restore to database
gunzip < backup-2024-01-01T12-00-00-000Z.tar.gz | pg_restore -d my_database

# 4. Clean up
rm backup-2024-01-01T12-00-00-000Z.tar.gz.enc backup-2024-01-01T12-00-00-000Z.tar.gz
```

