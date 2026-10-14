import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { config } from "../config";

function key() {
  if (config.mp.tokenSecret.length < 16) {
    throw new Error("MP_TOKEN_SECRET ausente ou curto (mínimo 16 caracteres).");
  }
  return createHash("sha256").update(config.mp.tokenSecret).digest();
}

export function secretBoxConfigured() {
  return config.mp.tokenSecret.length >= 16;
}

export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function openSecret(sealed: string) {
  const [version, ivB64, tagB64, encB64] = String(sealed || "").split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !encB64) {
    throw new Error("Segredo em formato inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
