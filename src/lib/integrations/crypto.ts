import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes hex (openssl rand -hex 32)");
  return Buffer.from(hex, "hex");
}

export function encryptJson(value: unknown): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function decryptJson<T = unknown>(blob: { iv: string; tag: string; data: string }): T {
  const decipher = createDecipheriv(ALG, key(), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}
