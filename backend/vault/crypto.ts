/** Server-only authenticated encryption. Keys never reach PostgreSQL. */
export interface VaultKeyring {
  active: string;
  keys: Record<string, string>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const keyId = /^[a-zA-Z0-9_-]{1,32}$/;
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (encode(bytes) !== value) throw Error('Noncanonical encoding');
  return bytes;
}
export async function makeSecretCipher(serialized: string) {
  const ring = JSON.parse(serialized) as VaultKeyring;
  if (
    !ring ||
    typeof ring.active !== 'string' ||
    !keyId.test(ring.active) ||
    !ring.keys ||
    typeof ring.keys !== 'object' ||
    Array.isArray(ring.keys) ||
    !Object.hasOwn(ring.keys, ring.active)
  )
    throw Error('Invalid keyring');
  const keys = new Map<string, CryptoKey>();
  for (const [id, value] of Object.entries(ring.keys)) {
    if (!keyId.test(id) || typeof value !== 'string') throw Error('Invalid keyring');
    const raw = decode(value);
    if (raw.length !== 32) throw Error('Invalid key length');
    keys.set(
      id,
      await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
    );
    raw.fill(0);
  }
  const aad = (id: string, context: string) =>
    encoder.encode('workstel:aesgcm:v1:' + id + ':' + context);
  return {
    async encrypt(password: string, context: string) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: aad(ring.active, context), tagLength: 128 },
          keys.get(ring.active)!,
          encoder.encode(JSON.stringify({ password })),
        ),
      );
      const payload = new Uint8Array(nonce.length + encrypted.length);
      payload.set(nonce);
      payload.set(encrypted, nonce.length);
      return 'workstel:aesgcm:v1:' + ring.active + ':' + encode(payload);
    },
    async decrypt(ciphertext: string, context: string): Promise<unknown> {
      const match = /^workstel:aesgcm:v1:([a-zA-Z0-9_-]{1,32}):([A-Za-z0-9+/=]+)$/.exec(ciphertext);
      if (!match || ciphertext.length > 65536) throw Error('Invalid ciphertext');
      const key = keys.get(match[1]);
      if (!key) throw Error('Unknown key');
      const payload = decode(match[2]);
      if (payload.length < 29) throw Error('Invalid ciphertext');
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: payload.slice(0, 12),
            additionalData: aad(match[1], context),
            tagLength: 128,
          },
          key,
          payload.slice(12),
        ),
      );
      try {
        return JSON.parse(decoder.decode(plaintext));
      } finally {
        plaintext.fill(0);
      }
    },
  };
}
