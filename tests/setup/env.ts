// Per test file: a fake crontab first on PATH and scratch state/log dirs.
import fs from "fs";
import os from "os";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-unit-"));
const bin = path.join(scratch, "bin");
fs.mkdirSync(bin);
fs.symlinkSync(path.join(root, "tests", "fake-crontab.sh"), path.join(bin, "crontab"));

process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.PITASKER_CRONTAB_BIN = path.join(bin, "crontab");
process.env.FAKE_CRONTAB_FILE = path.join(scratch, "crontab");
process.env.PITASKER_STATE_DIR = path.join(scratch, "state");
process.env.LOG_DIR = path.join(scratch, "logs");
process.env.SESSION_SECRET = "unit-test-session-secret-0123456789abcdef";
process.env.PITASKER_TZ = "Asia/Taipei";
// A db test sets DATABASE_URL from global-db; everything else gets a URL that
// can never connect (pg is lazy: nothing connects until a query runs).
process.env.DATABASE_URL = process.env.PITASKER_TEST_DATABASE_URL || "postgres://nobody@127.0.0.1:1/pitasker_test_none";
