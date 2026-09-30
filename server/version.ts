import { createRequire } from "module";

// package.json's version (read at runtime: dist/ and server/ are both one level below the root).
const require = createRequire(import.meta.url);
export const version: string = (() => {
  try {
    return require("../package.json").version;
  } catch {
    return "unknown";
  }
})();
