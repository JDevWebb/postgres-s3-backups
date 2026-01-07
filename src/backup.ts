import { exec, execSync } from "child_process";
import { S3Client, S3ClientConfig, PutObjectCommandInput, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, unlink, statSync, createWriteStream, readFileSync, writeFileSync, existsSync } from "fs";
import { filesize } from "filesize";
import path from "path";
import os from "os";
import crypto from "crypto";

import { env } from "./env.js";
import { createMD5 } from "./util.js";

const getS3Client = (): S3Client => {
  const clientOptions: S3ClientConfig = {
    region: env.AWS_S3_REGION,
    forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE
  }

  if (env.AWS_S3_ENDPOINT) {
    console.log(`Using custom endpoint: ${env.AWS_S3_ENDPOINT}`);

    clientOptions.endpoint = env.AWS_S3_ENDPOINT;
  }

  return new S3Client(clientOptions);
}

const uploadToS3 = async ({ name, path }: { name: string, path: string }) => {
  console.log("Uploading backup to S3...");

  const bucket = env.AWS_S3_BUCKET;

  if (env.BUCKET_SUBFOLDER) {
    name = env.BUCKET_SUBFOLDER + "/" + name;
  }

  let params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: name,
    Body: createReadStream(path),
  }

  if (env.SUPPORT_OBJECT_LOCK) {
    console.log("MD5 hashing file...");

    const md5Hash = await createMD5(path);

    console.log("Done hashing file");

    params.ContentMD5 = Buffer.from(md5Hash, 'hex').toString('base64');
  }

  const client = getS3Client();

  await new Upload({
    client,
    params: params
  }).done();

  console.log("Backup uploaded to S3...");
}

const dumpToFile = async (filePath: string) => {
  console.log("Dumping DB to file...");

  await new Promise((resolve, reject) => {
    exec(`pg_dump --dbname=${env.BACKUP_DATABASE_URL} --format=tar ${env.BACKUP_OPTIONS} | gzip > ${filePath}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      // check if archive is valid and contains data
      const isValidArchive = (execSync(`gzip -cd ${filePath} | head -c1`).length == 1) ? true : false;
      if (isValidArchive == false) {
        reject({ error: "Backup archive file is invalid or empty; check for errors above" });
        return;
      }

      // not all text in stderr will be a critical error, print the error / warning
      if (stderr != "") {
        console.log({ stderr: stderr.trimEnd() });
      }

      console.log("Backup archive file is valid");
      console.log("Backup filesize:", filesize(statSync(filePath).size));

      // if stderr contains text, let the user know that it was potently just a warning message
      if (stderr != "") {
        console.log(`Potential warnings detected; Please ensure the backup file "${path.basename(filePath)}" contains all needed data`);
      }

      resolve(undefined);
    });
  });

  console.log("DB dumped to file...");
}

const deleteFile = async (path: string) => {
  console.log("Deleting file...");
  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      reject({ error: err });
      return;
    });
    resolve(undefined);
  });
}

const encryptFile = async (inputPath: string, outputPath: string): Promise<void> => {
  console.log("Encrypting backup file...");

  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is required when encryption is enabled");
  }

  // Derive a 32-byte key from the encryption key using SHA-256
  const key = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();

  // Generate a random 16-byte IV for AES-256-GCM
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Read the input file
  const inputData = readFileSync(inputPath);

  // Encrypt the data
  let encrypted = cipher.update(inputData);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // Get the authentication tag
  const authTag = cipher.getAuthTag();

  // Write IV (16 bytes) + authTag (16 bytes) + encrypted data to output file
  const output = createWriteStream(outputPath);
  output.write(iv);
  output.write(authTag);
  output.write(encrypted);
  output.end();

  await new Promise((resolve, reject) => {
    output.on('finish', () => {
      console.log("Backup file encrypted");
      resolve(undefined);
    });
    output.on('error', reject);
  });
}

const cleanupOldBackups = async () => {
  const retentionDays = parseInt(env.BACKUP_RETENTION_DAYS || '0', 10);
  const retentionCount = parseInt(env.BACKUP_RETENTION_COUNT || '0', 10);

  if (retentionDays === 0 && retentionCount === 0) {
    return; // Retention disabled
  }

  console.log("Checking backup retention policies...");

  const bucket = env.AWS_S3_BUCKET;
  const prefix = env.BUCKET_SUBFOLDER 
    ? `${env.BUCKET_SUBFOLDER}/${env.BACKUP_FILE_PREFIX}-`
    : `${env.BACKUP_FILE_PREFIX}-`;

  const client = getS3Client();
  const backups: Array<{ Key: string; LastModified: Date }> = [];

  // List all backups
  let continuationToken: string | undefined;
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.LastModified) {
          // Only include files that match our backup pattern (tar.gz or tar.gz.enc)
          if (object.Key.endsWith('.tar.gz') || object.Key.endsWith('.tar.gz.enc')) {
            backups.push({
              Key: object.Key,
              LastModified: object.LastModified,
            });
          }
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  if (backups.length === 0) {
    console.log("No backups found for retention cleanup.");
    return;
  }

  // Sort by LastModified (newest first)
  backups.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());

  const now = new Date();
  const backupsToDelete: string[] = [];

  // Apply retention by count
  if (retentionCount > 0 && backups.length > retentionCount) {
    const excessBackups = backups.slice(retentionCount);
    backupsToDelete.push(...excessBackups.map(b => b.Key));
    console.log(`Retention by count: Keeping ${retentionCount} backups, ${excessBackups.length} will be deleted.`);
  }

  // Apply retention by days
  if (retentionDays > 0) {
    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const oldBackups = backups.filter(b => b.LastModified < cutoffDate);
    
    // Only delete backups that aren't already marked for deletion by count retention
    const oldBackupsToDelete = oldBackups
      .filter(b => !backupsToDelete.includes(b.Key))
      .map(b => b.Key);
    
    backupsToDelete.push(...oldBackupsToDelete);
    
    if (oldBackupsToDelete.length > 0) {
      console.log(`Retention by days: ${oldBackupsToDelete.length} backups older than ${retentionDays} days will be deleted.`);
    }
  }

  // Remove duplicates
  const uniqueBackupsToDelete = [...new Set(backupsToDelete)];

  if (uniqueBackupsToDelete.length === 0) {
    console.log("No backups need to be deleted based on retention policies.");
    return;
  }

  // Delete old backups
  console.log(`Deleting ${uniqueBackupsToDelete.length} old backup(s)...`);
  
  for (const key of uniqueBackupsToDelete) {
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      console.log(`Deleted: ${key}`);
    } catch (error) {
      console.error(`Failed to delete ${key}:`, error);
    }
  }

  console.log(`Retention cleanup complete. Deleted ${uniqueBackupsToDelete.length} backup(s).`);
}

const findLatestBackup = async (): Promise<{ Key: string; LastModified: Date } | null> => {
  console.log("Scanning S3 for backups...");

  const bucket = env.AWS_S3_BUCKET;
  const prefix = env.BUCKET_SUBFOLDER 
    ? `${env.BUCKET_SUBFOLDER}/${env.BACKUP_FILE_PREFIX}-`
    : `${env.BACKUP_FILE_PREFIX}-`;

  const client = getS3Client();
  const backups: Array<{ Key: string; LastModified: Date }> = [];

  // List all backups
  let continuationToken: string | undefined;
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.LastModified) {
          // Only include files that match our backup pattern (tar.gz or tar.gz.enc)
          if (object.Key.endsWith('.tar.gz') || object.Key.endsWith('.tar.gz.enc')) {
            backups.push({
              Key: object.Key,
              LastModified: object.LastModified,
            });
          }
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  if (backups.length === 0) {
    throw new Error("No backups found in S3");
  }

  // Sort by LastModified (newest first)
  backups.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());

  const latest = backups[0];
  console.log(`Found latest backup: ${latest.Key} (${latest.LastModified.toISOString()})`);
  
  return latest;
}

const downloadFromS3 = async (key: string, outputPath: string): Promise<void> => {
  console.log(`Downloading backup from S3: ${key}...`);

  const bucket = env.AWS_S3_BUCKET;
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error("Failed to download backup: No body in response");
  }

  // Convert stream to buffer and write to file
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  writeFileSync(outputPath, buffer);
  console.log(`Downloaded backup to: ${outputPath}`);
  console.log(`Backup filesize: ${filesize(buffer.length)}`);
}

const decryptFile = async (encryptedPath: string, decryptedPath: string): Promise<void> => {
  console.log("Decrypting backup file...");

  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is required to decrypt encrypted backups");
  }

  if (!existsSync(encryptedPath)) {
    throw new Error(`Encrypted file not found: ${encryptedPath}`);
  }

  // Read the encrypted file
  const encryptedData = readFileSync(encryptedPath);

  if (encryptedData.length < 32) {
    throw new Error('Encrypted file is too small. It must contain at least 32 bytes (IV + auth tag).');
  }

  // Extract IV (first 16 bytes)
  const iv = encryptedData.subarray(0, 16);

  // Extract auth tag (next 16 bytes)
  const authTag = encryptedData.subarray(16, 32);

  // Extract encrypted content (remaining bytes)
  const encrypted = encryptedData.subarray(32);

  // Derive the key from the encryption key using SHA-256
  const key = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();

  try {
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt the data
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Write the decrypted data to the output file
    writeFileSync(decryptedPath, decrypted);

    console.log("Backup file decrypted successfully");
    console.log(`Decrypted file size: ${filesize(decrypted.length)}`);
  } catch (error: any) {
    let errorMessage = 'Decryption failed';
    
    if (error.message) {
      if (error.message.includes('Unsupported state') || error.message.includes('unable to authenticate')) {
        errorMessage = 'Decryption failed: Invalid encryption key or corrupted file. Please verify your encryption key matches the one used during encryption.';
      } else {
        errorMessage = `Decryption failed: ${error.message}`;
      }
    }
    
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

const restoreDatabase = async (backupPath: string): Promise<void> => {
  console.log("Restoring database from backup...");

  const databaseUrl = env.RESTORE_DATABASE_URL || env.BACKUP_DATABASE_URL;
  const restoreOptions = env.RESTORE_OPTIONS || '';

  // Use gunzip to decompress and pipe to pg_restore
  const command = `gunzip < ${backupPath} | pg_restore --dbname=${databaseUrl} ${restoreOptions}`;

  await new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      // Print any warnings or info
      if (stderr != "") {
        console.log({ stderr: stderr.trimEnd() });
      }

      if (stdout != "") {
        console.log({ stdout: stdout.trimEnd() });
      }

      resolve(undefined);
    });
  });

  console.log("Database restored successfully");
}

export const restore = async () => {
  console.log("Initiating database restore...");

  try {
    // Find the latest backup
    const latestBackup = await findLatestBackup();
    if (!latestBackup) {
      throw new Error("No backup found to restore");
    }

    const isEncrypted = latestBackup.Key.endsWith('.enc');
    const tempDir = os.tmpdir();
    const downloadedPath = path.join(tempDir, path.basename(latestBackup.Key));
    let finalBackupPath = downloadedPath;

    // Download the backup
    await downloadFromS3(latestBackup.Key, downloadedPath);

    // Decrypt if needed
    if (isEncrypted) {
      const decryptedPath = downloadedPath.replace(/\.enc$/, '');
      try {
        await decryptFile(downloadedPath, decryptedPath);
        await deleteFile(downloadedPath); // Delete encrypted file
        finalBackupPath = decryptedPath;
      } catch (error: any) {
        // Clean up downloaded file on decryption failure
        try {
          await deleteFile(downloadedPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        // Re-throw to ensure process exits
        throw error;
      }
    }

    // Restore the database
    await restoreDatabase(finalBackupPath);

    // Clean up
    await deleteFile(finalBackupPath);

    console.log("Database restore complete!");
  } catch (error: any) {
    console.error("Error during restore:", error);
    throw error;
  }
}

export const backup = async () => {
  console.log("Initiating DB backup...");

  const date = new Date().toISOString();
  const timestamp = date.replace(/[:.]+/g, '-');
  const baseFilename = `${env.BACKUP_FILE_PREFIX}-${timestamp}.tar.gz`;
  const filename = env.ENABLE_ENCRYPTION ? `${baseFilename}.enc` : baseFilename;
  const filepath = path.join(os.tmpdir(), baseFilename);
  const finalFilepath = env.ENABLE_ENCRYPTION ? path.join(os.tmpdir(), filename) : filepath;

  await dumpToFile(filepath);

  if (env.ENABLE_ENCRYPTION) {
    if (!env.ENCRYPTION_KEY) {
      throw new Error("ENCRYPTION_KEY is required when ENABLE_ENCRYPTION is true");
    }
    await encryptFile(filepath, finalFilepath);
    await deleteFile(filepath); // Delete the unencrypted file
  }

  await uploadToS3({ name: filename, path: finalFilepath });
  await deleteFile(finalFilepath);

  // Clean up old backups based on retention settings
  await cleanupOldBackups();

  console.log("DB backup complete...");
}

