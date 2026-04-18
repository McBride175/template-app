import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const TOKEN_ENCRYPTION_SCHEME = 'v1'
const IV_LENGTH_BYTES = 12
const AUTH_TAG_LENGTH_BYTES = 16

function getXeroTokenEncryptionKey() {
  const keyRaw = process.env.XERO_TOKEN_ENCRYPTION_KEY
  if (!keyRaw) {
    throw new Error('Missing XERO_TOKEN_ENCRYPTION_KEY')
  }

  const key = /^[0-9a-fA-F]{64}$/.test(keyRaw)
    ? Buffer.from(keyRaw, 'hex')
    : Buffer.from(keyRaw, 'base64')

  if (key.length !== 32) {
    throw new Error('XERO_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }

  return key
}

function decodeBase64Url(value: string, label: string) {
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    throw new Error(`Invalid ${label} encoding`)
  }
}

export function encryptXeroToken(value: string) {
  const key = getXeroTokenEncryptionKey()
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    TOKEN_ENCRYPTION_SCHEME,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptXeroToken(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== TOKEN_ENCRYPTION_SCHEME) {
    throw new Error('Invalid token encryption payload format')
  }

  const [, ivPart, authTagPart, ciphertextPart] = parts
  const iv = decodeBase64Url(ivPart, 'iv')
  const authTag = decodeBase64Url(authTagPart, 'auth tag')
  const ciphertext = decodeBase64Url(ciphertextPart, 'ciphertext')

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('Invalid token encryption iv length')
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid token encryption auth tag length')
  }

  const key = getXeroTokenEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Failed to decrypt token payload')
  }
}
