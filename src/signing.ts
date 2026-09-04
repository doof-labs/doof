import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { config } from './config.js';
import { sha256Hex, type Signer } from './ledger.js';

/** Ed25519 signing key for the ledger. Private key: base64 PKCS8 DER. Public key: base64 SPKI DER. */

function toSigner(priv: KeyObject): Signer {
  const pub = createPublicKey(priv);
  const spki = pub.export({ type: 'spki', format: 'der' }) as Buffer;
  const publicKey = spki.toString('base64');
  const kid = sha256Hex(spki).slice(0, 16);
  return {
    kid,
    publicKey,
    sign: (hashHex) => edSign(null, Buffer.from(hashHex, 'hex'), priv).toString('base64'),
  };
}

export function signerFromPrivateKey(pkcs8Base64: string): Signer {
  const priv = createPrivateKey({ key: Buffer.from(pkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error(`DOOF_SIGNING_KEY must be an Ed25519 key, got ${priv.asymmetricKeyType}`);
  return toSigner(priv);
}

/** A fresh key. Returns the signer and the base64 PKCS8 private key so it can be pinned. */
export function generateSigner(): { signer: Signer; privateKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  return { signer: toSigner(privateKey), privateKey: pkcs8.toString('base64') };
}

/** From DOOF_SIGNING_KEY, or a generated key with a loud warning so it can be pinned. */
export function loadSigner(): Signer {
  if (config.signingKey) return signerFromPrivateKey(config.signingKey);
  const { signer } = generateSigner();
  console.warn(
    [
      'WARNING: DOOF_SIGNING_KEY is not set. Generated a throwaway Ed25519 key for this process.',
      'Entries signed now will not verify after a restart. Generate and store a key before using persistent data.',
      `(kid ${signer.kid})`,
    ].join('\n'),
  );
  return signer;
}
