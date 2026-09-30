import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const PASSWORD_MIN = 12;
/** bcrypt uses only the first 72 bytes; longer passwords would silently be cut. */
export const PASSWORD_MAX_BYTES = 72;

/** The rules for a new password; null when it is acceptable. */
export function passwordProblem(next: string, opts: { current?: string; username?: string } = {}): string | null {
  if (typeof next !== "string" || next.length < PASSWORD_MIN) return `The new password must be at least ${PASSWORD_MIN} characters long.`;
  if (Buffer.byteLength(next, "utf8") > PASSWORD_MAX_BYTES) return `The new password must be at most ${PASSWORD_MAX_BYTES} bytes long.`;
  if (/^\s|\s$/.test(next)) return "The new password must not start or end with a space.";
  if (opts.current !== undefined && next === opts.current) return "The new password must differ from the current one.";
  if (opts.username && next.toLowerCase().includes(opts.username.toLowerCase())) return "The new password must not contain the username.";
  if (new Set(next).size < 5) return "The new password is too repetitive.";
  return null;
}
