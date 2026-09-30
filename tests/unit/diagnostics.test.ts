import { describe, expect, it } from "vitest";
import { diagnosticsLine } from "../../client/src/lib/diagnostics";

describe("diagnostics line (About)", () => {
  it("names version, host, zone, runners, journal, memory, theme and viewport", () => {
    expect(
      diagnosticsLine({
        version: "2.0.0", user: "zk", hostname: "piapps", timeZone: "Asia/Taipei",
        tasks: { total: 17, cron: 17, pitasker: 0 }, cronJournal: true, rssMb: 117,
        theme: "dark", viewport: { width: 1440, height: 900 },
      }),
    ).toBe("PiTasker v2.0.0 · zk@piapps · Asia/Taipei · tasks 17 (cron 17, PiTasker 0) · journal on · RSS 117 MB · dark · 1440×900");
  });
  it("shows ? for anything not loaded yet", () => {
    expect(diagnosticsLine({})).toBe("PiTasker v? · ?@? · ? · tasks ? · journal ? · RSS ? · ? · ?");
  });
});
