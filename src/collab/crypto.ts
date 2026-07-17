/**
 * End-to-end encryption for room traffic.
 *
 * The room key lives in the URL fragment (#room=id,key). Fragments are never
 * transmitted to a server, so the relay only ever sees ciphertext — that is the
 * entire basis of the guarantee, and it is why the key must not migrate into a
 * query string or a header.
 */
const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;

export async function generateRoomKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: 128 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64Url(new Uint8Array(raw));
}

export const importRoomKey = (encoded: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', base64UrlToBytes(encoded), ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ]);

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  // A fresh IV per message: reusing one under AES-GCM is catastrophic.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext),
  );

  const envelope = new Uint8Array(iv.length + ciphertext.length);
  envelope.set(iv, 0);
  envelope.set(ciphertext, iv.length);
  return bytesToBase64Url(envelope);
}

export async function decryptJson<T>(key: CryptoKey, encoded: string): Promise<T | null> {
  try {
    const envelope = base64UrlToBytes(encoded);
    const iv = envelope.subarray(0, IV_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES);
    const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // Wrong key, or a corrupted/hostile message. Drop it silently — a peer with
    // the wrong key must not be able to spam the console.
    return null;
  }
}

// -------------------------------------------------------------- base64url

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // URL-safe: the key rides in a fragment, where + / = are awkward.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Returns Uint8Array<ArrayBuffer> rather than the default Uint8Array
 * <ArrayBufferLike>: WebCrypto's BufferSource excludes SharedArrayBuffer, so
 * the buffer type has to be pinned here or every call site needs a cast.
 */
function base64UrlToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
