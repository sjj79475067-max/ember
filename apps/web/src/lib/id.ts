import { randomBytes, randomUUID } from "node:crypto";
export const newId = (prefix = "") => (prefix ? `${prefix}_` : "") + randomUUID().replace(/-/g, "").slice(0, 20);
export const nowSec = () => Math.floor(Date.now() / 1000);
export const newSecret = (bytes = 24) => randomBytes(bytes).toString("base64url");
