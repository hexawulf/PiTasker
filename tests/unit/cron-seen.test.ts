import { describe, expect, it } from "vitest";
import { parseCronJournal, redirectTarget } from "../../server/services/cronSeen";
import { scriptOf } from "../../server/services/scriptCheck";

describe("redirectTarget", () => {
  it.each([
    ["/home/zk/bin/x >> /home/zk/logs/x.log 2>&1", "/home/zk/logs/x.log"],
    ["/home/zk/bin/x > /tmp/out.txt", "/tmp/out.txt"],
    ["/home/zk/bin/x >/dev/null 2>&1", null],
    ["/home/zk/bin/x 2>> /home/zk/logs/err.log", null],
    ["/home/zk/bin/x > /home/zk/logs/r-$(date +\\%F).log", null],
    ["/home/zk/bin/x", null],
  ])("%s", (cmd, file) => expect(redirectTarget(cmd)).toBe(file));
});

describe("parseCronJournal", () => {
  it("keeps the newest start per command for this user", () => {
    const lines = [
      { MESSAGE: "(zk) CMD (/home/zk/bin/a >> /x.log 2>&1)", __REALTIME_TIMESTAMP: "1759200000000000" },
      { MESSAGE: "(zk) CMD (/home/zk/bin/a >> /x.log 2>&1)", __REALTIME_TIMESTAMP: "1759200300000000" },
      { MESSAGE: "(root) CMD (/usr/bin/other)", __REALTIME_TIMESTAMP: "1759200300000000" },
      { MESSAGE: "pam_unix(cron:session): session opened", __REALTIME_TIMESTAMP: "1" },
    ].map((x) => JSON.stringify(x)).join("\n");
    const m = parseCronJournal(lines + "\nnot json\n", "zk");
    expect([...m.entries()]).toEqual([["/home/zk/bin/a >> /x.log 2>&1", 1759200300000]]);
  });
});

describe("scriptOf", () => {
  const bin = "/home/zk/bin";
  it.each([
    ["/home/zk/bin/job --x >> /l 2>&1", "/home/zk/bin/job"],
    ["bash /home/zk/bin/job.sh", "/home/zk/bin/job.sh"],
    ["FOO=1 nice -n 10 /home/zk/bin/job", "/home/zk/bin/job"],
    ["timeout 60 /opt/x/run", "/opt/x/run"],
    ["~/bin/job", "/home/zk/bin/job"],
    ["echo hi", null],
  ])("%s → %s", (cmd, script) => expect(scriptOf(cmd, bin)).toBe(script));
});
