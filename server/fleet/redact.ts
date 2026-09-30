// Redaction for the fleet view (docs/plans/2.1-fleet-view.md › Security).
// Copied from PiDeck (server/services/agent-logs/redact.ts, same rules and
// the same false-positive list in tests/unit/redact.test.ts), plus two
// crontab rules. Runs on the agent (and in the hub's local collector) before
// a command, line or env value leaves the host. Always on.
//
//   Authorization: <anything to end of line>    → Authorization: [REDACTED]
//   Bearer <token>                              → Bearer [REDACTED]
//   <…password|passwd|token|secret|api_key> = / : <value>   (incl. JSON "key": "value")
//                                               → key=[REDACTED]
//   scheme://user:pass@host                     → scheme://user:[REDACTED]@host
//
//   NAME_KEY=value / FOO_AUTH=value (upper-case env assignment, e.g. before a
//   command: "API_KEY=abc /home/zk/bin/x")   → NAME_KEY=[REDACTED]
//
// Deliberately *not* matched (tests/unit/redact.test.ts): "Failed password
// for root" (no value), max_tokens=512 / token_count: 3 (the key doesn't
// end in a secret word), tokenizer=…, "secret: false|true|null" style flags.
//
// Crontab env lines (redactEnv): a name ending in KEY|TOKEN|SECRET|PASS|
// PASSWORD|AUTH gets its whole value replaced; other values go through
// redactLine (e.g. a URL with credentials in PATH-like values).

export const REDACTED = "[REDACTED]";

type Rule = { name: string; re: RegExp; replace: (...m: string[]) => string };

// Values we never treat as secrets (flags and placeholders).
const HARMLESS = /^(true|false|null|none|nil|undefined|yes|no|on|off|\*+|x+|\[redacted\]|<redacted>|redacted|\$\{?[a-z_][a-z0-9_]*\}?|%s)$/i;

const RULES: Rule[] = [
  {
    // Upper-case env assignments whose name ends in a secret word (crontab
    // commands often start with them). Before key-value, which would leave
    // *_AUTH / *_KEY (without API_) alone.
    name: "env-assignment",
    re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS|PASSWORD|PASSWD|AUTH))(=)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"';&|]+)/g,
    replace: (m, key, sep, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
      const inner = quote ? value.slice(1, -1) : value;
      return inner === "" || HARMLESS.test(inner) ? m : `${key}${sep}${quote}${REDACTED}${quote}`;
    },
  },
  {
    // The whole header value (scheme + credentials), whatever the scheme.
    name: "authorization-header",
    re: /\b((?:proxy-)?authorization)(["']?\s*[:=]\s*["']?)([^\r\n"']+)/gi,
    replace: (_m, key, sep) => `${key}${sep}${REDACTED}`,
  },
  {
    name: "bearer",
    re: /\b(bearer)(\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
    replace: (_m, word, sp) => `${word}${sp}${REDACTED}`,
  },
  {
    name: "url-credentials",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`,
  },
  {
    // key (ending in a secret word) = or : value; the key may be quoted (JSON),
    // and a quoted value is redacted up to its closing quote (spaces included).
    name: "key-value",
    re: /\b([A-Za-z0-9_.-]*(?:password|passwd|passphrase|token|secret|api[_-]?key))(["']?\s*[=:]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;&}\[\]]+)/gi,
    replace: (m, key, sep, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
      const inner = quote ? value.slice(1, -1) : value;
      return inner === "" || HARMLESS.test(inner) ? m : `${key}${sep}${quote}${REDACTED}${quote}`;
    },
  },
];

export type Redacted = { text: string; count: number };

/** Redact one line. `count` = how many spans were replaced. */
export function redactLine(line: string): Redacted {
  let count = 0;
  let text = line;
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const groups = args.slice(0, -2).map(String) as string[];
      const out = rule.replace(...groups);
      if (out !== groups[0]) count++;
      return out;
    });
  }
  return { text, count };
}

export const REDACTION_RULES = RULES.map((r) => r.name);

/** An env name whose value is a secret by name alone. */
export const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASS|PASSWORD|AUTH)$/i;

/** A crontab env line's value: fully redacted for secret names, else redactLine. */
export function redactEnv(name: string, value: string): string {
  if (SECRET_ENV_NAME.test(name) && value !== "" && !HARMLESS.test(value.replace(/^(["'])(.*)\1$/, "$2"))) return REDACTED;
  return redactLine(value).text;
}

/** Shorthand: just the redacted text. */
export const redact = (s: string) => redactLine(s).text;
