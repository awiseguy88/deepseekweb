import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'

function derive(password: string, nonce: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce, memory: 65536, passes: 3, parallelism: 1, tagLength: 32 },
      (error, hash) => error ? reject(error) : resolve(hash))
  })
}

/** Hash a new password using a fresh 128-bit salt and the versioned deployment parameters. */
export async function hashPassword(password: string): Promise<string> {
  if (!password.length || Buffer.byteLength(password) > 1024) throw new Error('Invalid password length')
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return ['wiseai-argon2id-v1', salt.toString('hex'), hash.toString('hex')].join('$')
}

/** Verify a stored digest using the hashing parameters identified by its version. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password.length || Buffer.byteLength(password) > 1024) return false
  const [version, salt, digest, ...extra] = stored.split('$')
  if (version !== 'wiseai-argon2id-v1' || extra.length || !salt || !digest
    || salt.length !== 32 || digest.length !== 64 || /[^0-9a-f]/.test(salt + digest)) return false
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), Buffer.from(digest, 'hex'))
}
