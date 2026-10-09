// The encrypted envelope every VeilCore-run file with secrets in it uses: a partner's
// custody vault, and the bundle handed to a partner when they leave.
// SPDX-License-Identifier: Apache-2.0
//
// scrypt (N = 2^17, r = 8, p = 1: 128 MiB and about half a second per try, OWASP's
// recommended setting) turns the password into a 256-bit key; AES-256-GCM encrypts the
// payload, authenticated together with the header (format, kind, partner, network, KDF
// settings), so a file cannot be passed off as another partner's or another kind without
// the open failing. Node's own crypto only: nothing to install, and the format is written
// out in docs/MANAGED.md so a partner's developer can open a bundle in any language.

import {
  type KeyObject,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';

export const BOX_FORMAT = 'veilcore-run/box/1';

/** What a password box holds. Part of the authenticated header. (Bundles are sealed boxes, below.) */
export type BoxKind = 'custody-vault';

export type KdfParams = { readonly name: 'scrypt'; readonly N: number; readonly r: number; readonly p: number };

/** The production setting. Files with a weaker one are refused; see openBox. */
export const KDF: KdfParams = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };
const MIN_N = 2 ** 17;
const MAX_N = 2 ** 20; // a header cannot make an open use more than 1 GiB

export type BoxHeader = {
  readonly format: typeof BOX_FORMAT;
  readonly kind: BoxKind;
  readonly partner: string;
  readonly network: string;
  readonly kdf: KdfParams & { readonly salt: string };
  readonly cipher: 'aes-256-gcm';
  readonly iv: string;
};

export type BoxFile = BoxHeader & { readonly tag: string; readonly ciphertext: string };

/** The authenticated data: the header's fields in a fixed order. */
const aadOf = (h: BoxHeader): Buffer =>
  Buffer.from(
    JSON.stringify([
      h.format,
      h.kind,
      h.partner,
      h.network,
      h.kdf.name,
      h.kdf.N,
      h.kdf.r,
      h.kdf.p,
      h.kdf.salt,
      h.cipher,
      h.iv,
    ]),
    'utf8',
  );

const derive = (password: string, salt: Buffer, k: KdfParams): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(
      password.normalize('NFC'),
      salt,
      32,
      { N: k.N, r: k.r, p: k.p, maxmem: 256 * k.N * k.r + 1024 * 1024 },
      (e, key) => (e ? reject(new Error('Could not derive the key.')) : resolve(key)),
    ),
  );

/**
 * A key derived from a password for one box's salt. Held only by an open vault, for the
 * length of one command, so saving again does not cost another derivation.
 */
export class BoxKey {
  readonly #key: Buffer;
  readonly salt: string;
  readonly kdf: KdfParams;
  private constructor(key: Buffer, salt: string, kdf: KdfParams) {
    this.#key = key;
    this.salt = salt;
    this.kdf = kdf;
  }
  static async fresh(password: string): Promise<BoxKey> {
    const salt = randomBytes(16);
    return new BoxKey(await derive(password, salt, KDF), salt.toString('hex'), KDF);
  }
  static async forHeader(password: string, h: BoxHeader): Promise<BoxKey> {
    return new BoxKey(await derive(password, Buffer.from(h.kdf.salt, 'hex'), h.kdf), h.kdf.salt, h.kdf);
  }
  /** @internal the raw key, for sealBox/openBox only. */
  use<T>(f: (key: Buffer) => T): T {
    return f(this.#key);
  }
  /** Overwrite the key bytes. The object is useless afterwards. */
  destroy(): void {
    this.#key.fill(0);
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'BoxKey [redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
}

/** Encrypt `payload` (any JSON value) into a box of `kind`, for `partner` on `network`. */
export const sealBox = (
  key: BoxKey,
  meta: { readonly kind: BoxKind; readonly partner: string; readonly network: string },
  payload: unknown,
): BoxFile => {
  const header: BoxHeader = {
    format: BOX_FORMAT,
    kind: meta.kind,
    partner: meta.partner,
    network: meta.network,
    kdf: { ...key.kdf, salt: key.salt },
    cipher: 'aes-256-gcm',
    iv: randomBytes(12).toString('hex'),
  };
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    return key.use((k) => {
      const c = createCipheriv('aes-256-gcm', k, Buffer.from(header.iv, 'hex'));
      c.setAAD(aadOf(header));
      const ciphertext = Buffer.concat([c.update(plain), c.final()]).toString('base64');
      return { ...header, tag: c.getAuthTag().toString('hex'), ciphertext };
    });
  } finally {
    plain.fill(0);
  }
};

const HEX = /^[0-9a-f]+$/;

/** Parse a file's text as a box, checking its shape (not yet its key). */
export const parseBox = (text: string, expect: { readonly kind: BoxKind }): BoxFile => {
  let b: Partial<BoxFile>;
  try {
    b = JSON.parse(text) as Partial<BoxFile>;
  } catch {
    throw new Error('That file is not a VeilCore-run box (it is not JSON).');
  }
  if (b.format !== BOX_FORMAT) throw new Error(`That file is not a VeilCore-run box (format ${String(b.format)}).`);
  if (b.kind !== expect.kind) throw new Error(`That file is a ${String(b.kind)}, not a ${expect.kind}.`);
  const k = b.kdf;
  if (
    k === undefined ||
    k.name !== 'scrypt' ||
    !Number.isInteger(k.N) ||
    k.N < MIN_N ||
    k.N > MAX_N ||
    (k.N & (k.N - 1)) !== 0 ||
    !Number.isInteger(k.r) ||
    k.r < 8 ||
    k.r > 32 ||
    !Number.isInteger(k.p) ||
    k.p < 1 ||
    k.p > 4 ||
    typeof k.salt !== 'string' ||
    !HEX.test(k.salt) ||
    k.salt.length < 32
  )
    throw new Error('That box names a key-derivation setting this program does not accept.');
  if (b.cipher !== 'aes-256-gcm' || typeof b.iv !== 'string' || !HEX.test(b.iv) || b.iv.length !== 24)
    throw new Error('That box names a cipher this program does not accept.');
  if (typeof b.tag !== 'string' || !HEX.test(b.tag) || b.tag.length !== 32 || typeof b.ciphertext !== 'string')
    throw new Error('That box is damaged.');
  if (typeof b.partner !== 'string' || typeof b.network !== 'string') throw new Error('That box is damaged.');
  return b as BoxFile;
};

/**
 * Decrypt a box. A wrong password and a changed file look the same (GCM): either way the
 * answer is "does not open", and nothing about the contents is said.
 */
export const openBox = (key: BoxKey, box: BoxFile): unknown => {
  if (box.kdf.salt !== key.salt) throw new Error('That key was not made for this box.');
  let plain: Buffer;
  try {
    plain = key.use((k) => {
      const d = createDecipheriv('aes-256-gcm', k, Buffer.from(box.iv, 'hex'));
      d.setAAD(aadOf(box));
      d.setAuthTag(Buffer.from(box.tag, 'hex'));
      return Buffer.concat([d.update(Buffer.from(box.ciphertext, 'base64')), d.final()]);
    });
  } catch {
    throw new WrongPasswordError();
  }
  try {
    return JSON.parse(plain.toString('utf8')) as unknown;
  } catch {
    throw new Error('The box opened but its contents are not readable.');
  } finally {
    plain.fill(0);
  }
};

/** The password does not open the box (or the box was changed). Nothing was changed. */
export class WrongPasswordError extends Error {
  constructor() {
    super('That password does not open this file (or the file was changed). Nothing was changed.');
    this.name = 'WrongPasswordError';
  }
}

/** Constant-time comparison of two strings, for passwords typed twice. */
export const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

// ─────────────────────────────────────────────────────────── sealed to a partner's key

/**
 * A box sealed to a partner's public X25519 key (ECIES): a fresh ephemeral key pair per
 * box, X25519 with the partner's key, HKDF-SHA256 (salt: ephemeral key || partner key,
 * info "veilcore-run/v1/sealed"), AES-256-GCM over the payload with the header as
 * authenticated data. The ephemeral private key exists only inside sealTo. Only the
 * holder of the partner's private key (derived from their master, on their computer)
 * can open it: nothing on VeilCore's side can, and no passphrase is typed there.
 */
export const SEALED_FORMAT = 'veilcore-run/sealed/1';

export type SealedHeader = {
  readonly format: typeof SEALED_FORMAT;
  readonly kind: 'exit-bundle';
  readonly partner: string;
  readonly network: string;
  /** The partner's public key, hex. */
  readonly recipient: string;
  /** The ephemeral public key, hex. */
  readonly ephemeral: string;
  readonly cipher: 'aes-256-gcm';
  readonly iv: string;
};
export type SealedFile = SealedHeader & { readonly tag: string; readonly ciphertext: string };

const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
const rawPublic = (k: KeyObject): Buffer => {
  const spki = k.export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32);
};
const sealedAad = (h: SealedHeader): Buffer =>
  Buffer.from(
    JSON.stringify([h.format, h.kind, h.partner, h.network, h.recipient, h.ephemeral, h.cipher, h.iv]),
    'utf8',
  );
const sealedKey = (shared: Buffer, ephemeral: string, recipient: string): Buffer =>
  Buffer.from(
    hkdfSync('sha256', shared, Buffer.from(ephemeral + recipient, 'hex'), Buffer.from('veilcore-run/v1/sealed'), 32),
  );

export const sealTo = (
  recipientHex: string,
  meta: { readonly partner: string; readonly network: string },
  payload: unknown,
): SealedFile => {
  if (!/^[0-9a-f]{64}$/.test(recipientHex)) throw new Error('A bundle key is 64 hex characters.');
  const recipient = createPublicKey({
    key: Buffer.concat([SPKI_X25519, Buffer.from(recipientHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  const eph = generateKeyPairSync('x25519');
  const ephemeral = rawPublic(eph.publicKey).toString('hex');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = sealedKey(shared, ephemeral, recipientHex);
  shared.fill(0);
  const header: SealedHeader = {
    format: SEALED_FORMAT,
    kind: 'exit-bundle',
    partner: meta.partner,
    network: meta.network,
    recipient: recipientHex,
    ephemeral,
    cipher: 'aes-256-gcm',
    iv: randomBytes(12).toString('hex'),
  };
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    const c = createCipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'));
    c.setAAD(sealedAad(header));
    const ciphertext = Buffer.concat([c.update(plain), c.final()]).toString('base64');
    return { ...header, tag: c.getAuthTag().toString('hex'), ciphertext };
  } finally {
    plain.fill(0);
    key.fill(0);
  }
};

export const parseSealed = (text: string): SealedFile => {
  let b: Partial<SealedFile>;
  try {
    b = JSON.parse(text) as Partial<SealedFile>;
  } catch {
    throw new Error('That file is not a VeilCore-run bundle (it is not JSON).');
  }
  if (b.format !== SEALED_FORMAT || b.kind !== 'exit-bundle')
    throw new Error('That file is not a VeilCore-run bundle.');
  for (const [k, n] of [
    ['recipient', 64],
    ['ephemeral', 64],
    ['iv', 24],
    ['tag', 32],
  ] as const) {
    const v = b[k];
    if (typeof v !== 'string' || !HEX.test(v) || v.length !== n) throw new Error('That bundle is damaged.');
  }
  if (
    b.cipher !== 'aes-256-gcm' ||
    typeof b.ciphertext !== 'string' ||
    typeof b.partner !== 'string' ||
    typeof b.network !== 'string'
  )
    throw new Error('That bundle is damaged.');
  return b as SealedFile;
};

/** Open a sealed box with the partner's private key. A wrong key and a changed file look the same. */
export const openSealed = (privateKey: KeyObject, box: SealedFile): unknown => {
  const ephemeral = createPublicKey({
    key: Buffer.concat([SPKI_X25519, Buffer.from(box.ephemeral, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });
  const key = sealedKey(shared, box.ephemeral, box.recipient);
  shared.fill(0);
  let plain: Buffer;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'hex'));
    d.setAAD(sealedAad(box));
    d.setAuthTag(Buffer.from(box.tag, 'hex'));
    plain = Buffer.concat([d.update(Buffer.from(box.ciphertext, 'base64')), d.final()]);
  } catch {
    throw new Error('That master secret does not open this bundle (or the bundle was changed).');
  } finally {
    key.fill(0);
  }
  try {
    return JSON.parse(plain.toString('utf8')) as unknown;
  } finally {
    plain.fill(0);
  }
};
