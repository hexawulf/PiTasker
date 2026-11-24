// /robots.txt and /sitemap.xml must be real files in the built client.
// Vite copies client/public into dist/public as-is; Express serves that
// directory before the SPA fallback, so a missing file used to return
// index.html with 200.
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

const ROBOTS = "User-agent: *\nAllow: /\n\nSitemap: https://pitasker.piapps.dev/sitemap.xml\n";
const SITEMAP_LOC = "https://pitasker.piapps.dev/";
const DESCRIPTION =
  "A web UI for the crontab on a Raspberry Pi or Linux server: see, edit and run jobs with a diff before every write, run history, and a fleet view.";

describe("client crawl files", () => {
  it("robots.txt allows crawling and names the sitemap", () => {
    const text = fs.readFileSync(path.resolve("client/public/robots.txt"), "utf8");
    expect(text).toBe(ROBOTS);
    expect(text).not.toMatch(/Disallow:\s*\//);
  });

  it("sitemap.xml is a urlset for the public homepage", () => {
    const xml = fs.readFileSync(path.resolve("client/public/sitemap.xml"), "utf8");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain(`<loc>${SITEMAP_LOC}</loc>`);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("index.html has a canonical URL and a description", () => {
    const html = fs.readFileSync(path.resolve("client/index.html"), "utf8");
    expect(html).toContain('<link rel="canonical" href="https://pitasker.piapps.dev/" />');
    expect(html).toContain(`<meta name="description" content="${DESCRIPTION}" />`);
  });
});

describe("static crawl files are not the SPA", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-seo-"));
  let server: Server;
  let base = "";

  beforeAll(() => {
    fs.copyFileSync(path.resolve("client/public/robots.txt"), path.join(tmp, "robots.txt"));
    fs.copyFileSync(path.resolve("client/public/sitemap.xml"), path.join(tmp, "sitemap.xml"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html><title>SPA</title>");
    const app = createApp({ sessionSecret: "seo-files-test-secret-0123456789", staticDir: tmp });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("serves /robots.txt as plain text", async () => {
    const res = await fetch(`${base}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain\b/);
    const body = await res.text();
    expect(body).toBe(ROBOTS);
    expect(body).not.toContain("<!doctype");
  });

  it("serves /sitemap.xml as XML", async () => {
    const res = await fetch(`${base}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/xml/);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain(`<loc>${SITEMAP_LOC}</loc>`);
    expect(body).not.toContain("<!doctype");
  });

  it("still sends index.html for an unknown path", async () => {
    const res = await fetch(`${base}/tasks`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("<title>SPA</title>");
  });
});
