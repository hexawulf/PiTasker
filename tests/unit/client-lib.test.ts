import { describe, expect, it } from "vitest";
import { diffLines, hunks } from "@/lib/diff";
import { formatDuration, relativeTime } from "@/lib/format";
import { resolveKey, SHORTCUTS } from "@/shortcuts/shortcuts";

describe("diffLines", () => {
  it("marks added and removed lines", () => {
    const d = diffLines("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(d.map((x) => `${x.kind}:${x.text}`)).toEqual(["same:a", "del:b", "add:B", "same:c", "add:d"]);
  });
  it("identical text has no changes", () => {
    expect(diffLines("x\ny\n", "x\ny\n").every((l) => l.kind === "same")).toBe(true);
  });
  it("hunks keep context and collapse the rest", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n") + "\n";
    const after = before.replace("l10\n", "L10\n");
    const h = hunks(diffLines(before, after), 2);
    expect(h[0]).toBeNull();
    expect(h.filter(Boolean).map((x) => x!.text)).toEqual(["l8", "l9", "l10", "L10", "l11", "l12"]);
    expect(h[h.length - 1]).toBeNull();
  });
});

describe("format", () => {
  it.each([
    [null, "—"],
    [5, "5 ms"],
    [1500, "1.5 s"],
    [42_000, "42 s"],
    [125_000, "2 min 5 s"],
    [3_720_000, "1 h 2 min"],
  ])("formatDuration(%s) = %s", (ms, text) => expect(formatDuration(ms)).toBe(text));

  it("relativeTime", () => {
    const now = Date.parse("2026-09-30T10:00:00Z");
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("2026-09-30T10:00:10Z", now)).toBe("just now");
    expect(relativeTime("2026-09-30T09:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-09-30T13:00:00Z", now)).toBe("in 3 hours");
  });
});

describe("shortcuts", () => {
  const k = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
  const ctx = { typing: false, dialogOpen: false };
  it("g-sequences go to tabs", () => {
    expect(resolveKey(k("g"), null, ctx)).toEqual({ action: null, pending: "g" });
    expect(resolveKey(k("c"), "g", ctx).action).toBe("go-crontab");
    expect(resolveKey(k("t"), "g", ctx).action).toBe("go-tasks");
  });
  it("single keys, help, and nothing while typing or in a dialog", () => {
    expect(resolveKey(k("n"), null, ctx).action).toBe("new-task");
    expect(resolveKey(k("/"), null, ctx).action).toBe("search");
    expect(resolveKey(k("?", { shiftKey: true }), null, ctx).action).toBe("help");
    expect(resolveKey(k("n"), null, { typing: true, dialogOpen: false }).action).toBeNull();
    expect(resolveKey(k("n"), null, { typing: false, dialogOpen: true }).action).toBeNull();
    expect(resolveKey(k("r", { ctrlKey: true }), null, ctx).action).toBeNull();
  });
  it("every shortcut id is unique", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });
});
