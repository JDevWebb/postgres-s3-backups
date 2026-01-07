#!/usr/bin/env node

/**
 * Decryption script for encrypted PostgreSQL backup files
 * 
 * Usage: node decrypt.js <encrypted-file> <output-file> <encryption-key>
 * 
 * Example:
 *   node decrypt.js backup-2024-01-01T12-00-00-000Z.tar.gz.enc backup.tar.gz "your-encryption-key"
 */

import crypto from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { existsSync } from 'fs';

function decryptFile(encryptedFilePath, outputFilePath, encryptionKey) {
  // Validate inputs
  if (!existsSync(encryptedFilePath)) {
    throw new Error(`Encrypted file not found: ${encryptedFilePath}`);
  }

  if (!encryptionKey || encryptionKey.length === 0) {
    throw new Error('Encryption key cannot be empty');
  }

  console.log(`Reading encrypted file: ${encryptedFilePath}`);
  
  // Read the encrypted file
  const encryptedData = readFileSync(encryptedFilePath);
  
  if (encryptedData.length < 32) {
    throw new Error('Encrypted file is too small. It must contain at least 32 bytes (IV + auth tag).');
  }
  
  // Extract IV (first 16 bytes)
  const iv = encryptedData.subarray(0, 16);
  
  // Extract auth tag (next 16 bytes)
  const authTag = encryptedData.subarray(16, 32);
  
  // Extract encrypted content (remaining bytes)
  const encrypted = encryptedData.subarray(32);
  
  console.log('Deriving encryption key from provided key...');
  
  // Derive the key from the encryption key using SHA-256
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  
  console.log('Decrypting file...');
  
  try {
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // Write the decrypted data to the output file
    writeFileSync(outputFilePath, decrypted);
    
    console.log(`✓ Decryption complete!`);
    console.log(`  Output written to: ${outputFilePath}`);
    console.log(`  Decrypted file size: ${decrypted.length} bytes`);
  } catch (error) {
    if (error.message.includes('Unsupported state') || error.message.includes('unable to authenticate')) {
      throw new Error('Decryption failed: Invalid encryption key or corrupted file. Please verify your encryption key matches the one used during encryption.');
    }
    throw error;
  }
}

// Main execution
try {
  const encryptedFile = process.argv[2];
  const outputFile = process.argv[3];
  const encryptionKey = process.argv[4];

  if (!encryptedFile || !outputFile || !encryptionKey) {
    console.error('Usage: node decrypt.js <encrypted-file> <output-file> <encryption-key>');
    console.error('');
    console.error('Example:');
    console.error('  node decrypt.js backup-2024-01-01T12-00-00-000Z.tar.gz.enc backup.tar.gz "your-encryption-key"');
    process.exit(1);
  }

  decryptFile(encryptedFile, outputFile, encryptionKey);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

