import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, hash) => {
      if (err) reject(err);
      else resolve(`${salt}:${hash.toString("hex")}`);
    });
  });
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const colonIdx = stored.indexOf(":");
  if (colonIdx === -1) return false;
  const salt = stored.slice(0, colonIdx);
  const storedHash = stored.slice(colonIdx + 1);
  if (!salt || !storedHash) return false;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, derived) => {
      if (err) reject(err);
      else {
        try {
          resolve(timingSafeEqual(Buffer.from(storedHash, "hex"), derived));
        } catch {
          resolve(false);
        }
      }
    });
  });
}
