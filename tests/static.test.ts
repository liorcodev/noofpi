import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStaticFile } from "../src/server/static";
import { precompressDir } from "../src/vite/compress";

let dir: string;
const text = "const hello = 'world';\n".repeat(200);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "noofpi-static-"));
  await mkdir(path.join(dir, "assets"));
  await writeFile(path.join(dir, "app.js"), text);
  await writeFile(path.join(dir, "tiny.js"), "x");
  await writeFile(path.join(dir, "assets", "main-abc.js"), text);
  await writeFile(path.join(dir, "data.bin"), "0123456789");
  await writeFile(path.join(dir, "index.html"), text);
  const date = new Date("2024-01-02T03:04:05Z");
  await utimes(path.join(dir, "data.bin"), date, date);
  await precompressDir(dir);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const get = (url: string, headers: Record<string, string> = {}) =>
  resolveStaticFile(dir, "GET", url, headers);

describe("precompressDir", () => {
  it("writes .br and .gz for compressible files above the size threshold only", () => {
    expect(existsSync(path.join(dir, "app.js.br"))).toBe(true);
    expect(existsSync(path.join(dir, "app.js.gz"))).toBe(true);
    expect(existsSync(path.join(dir, "assets", "main-abc.js.br"))).toBe(true);
    expect(existsSync(path.join(dir, "tiny.js.br"))).toBe(false);
    expect(existsSync(path.join(dir, "data.bin.br"))).toBe(false);
    expect(existsSync(path.join(dir, "index.html.br"))).toBe(false);
  });
});

describe("resolveStaticFile compression", () => {
  it("serves the preferred accepted variant with its encoding and a Vary header", async () => {
    const br = await get("/app.js", { "accept-encoding": "gzip, br" });
    expect(br?.body?.file).toBe(path.join(dir, "app.js.br"));
    expect(br?.headers["Content-Encoding"]).toBe("br");
    expect(br?.headers["Content-Type"]).toContain("text/javascript");
    expect(br?.headers.Vary).toBe("Accept-Encoding");

    const gz = await get("/app.js", {
      "accept-encoding": "gzip;q=0.5, deflate",
    });
    expect(gz?.body?.file).toBe(path.join(dir, "app.js.gz"));
    expect(gunzipSync(readFileSync(gz!.body!.file)).toString()).toBe(text);
    expect(gz?.headers["Content-Length"]).toBe(
      String(readFileSync(gz!.body!.file).length),
    );
  });

  it("serves the file itself without a usable Accept-Encoding", async () => {
    for (const encoding of [
      undefined,
      "identity",
      "br;q=0, gzip;q=0",
      "*;q=0",
    ]) {
      const found = await get(
        "/app.js",
        encoding ? { "accept-encoding": encoding } : {},
      );
      expect(found?.body?.file).toBe(path.join(dir, "app.js"));
      expect(found?.headers["Content-Encoding"]).toBeUndefined();
    }
    expect(
      (await get("/data.bin", { "accept-encoding": "br" }))?.headers.Vary,
    ).toBeUndefined();
  });

  it("gives each variant its own ETag", async () => {
    const plain = await get("/app.js");
    const br = await get("/app.js", { "accept-encoding": "br" });
    expect(plain?.headers.ETag).not.toBe(br?.headers.ETag);
  });
});

describe("resolveStaticFile validators", () => {
  it("sends ETag and Last-Modified, and keeps the cache policies", async () => {
    const page = await get("/data.bin");
    expect(page?.headers.ETag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(page?.headers["Last-Modified"]).toBe(
      "Tue, 02 Jan 2024 03:04:05 GMT",
    );
    expect(page?.headers["Cache-Control"]).toBe("no-cache");
    expect((await get("/assets/main-abc.js"))?.headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("answers 304 on a matching If-None-Match, weak or in a list, and on *", async () => {
    const { ETag } = (await get("/data.bin"))!.headers;
    for (const value of [ETag!, `W/${ETag}`, `"other", ${ETag}`, "*"]) {
      const found = await get("/data.bin", { "if-none-match": value });
      expect(found?.status).toBe(304);
      expect(found?.body).toBeNull();
      expect(found?.headers.ETag).toBe(ETag);
    }
    expect(
      (await get("/data.bin", { "if-none-match": '"nope"' }))?.status,
    ).toBe(200);
  });

  it("answers 304 on If-Modified-Since, unless If-None-Match is present and differs", async () => {
    const since = "Tue, 02 Jan 2024 03:04:05 GMT";
    expect(
      (await get("/data.bin", { "if-modified-since": since }))?.status,
    ).toBe(304);
    expect(
      (
        await get("/data.bin", {
          "if-modified-since": "Mon, 01 Jan 2024 00:00:00 GMT",
        })
      )?.status,
    ).toBe(200);
    expect(
      (
        await get("/data.bin", {
          "if-modified-since": since,
          "if-none-match": '"nope"',
        })
      )?.status,
    ).toBe(200);
  });
});

describe("resolveStaticFile ranges", () => {
  const range = async (value: string, extra: Record<string, string> = {}) =>
    get("/data.bin", { range: value, ...extra });

  it("advertises byte ranges", async () => {
    expect((await get("/data.bin"))?.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("answers a single range with 206 and Content-Range", async () => {
    const found = await range("bytes=2-5");
    expect(found?.status).toBe(206);
    expect(found?.body).toMatchObject({ start: 2, end: 5 });
    expect(found?.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(found?.headers["Content-Length"]).toBe("4");
  });

  it("handles open-ended, suffix and over-long ranges", async () => {
    expect((await range("bytes=7-"))?.body).toMatchObject({ start: 7, end: 9 });
    expect((await range("bytes=-3"))?.body).toMatchObject({ start: 7, end: 9 });
    expect((await range("bytes=-99"))?.body).toMatchObject({
      start: 0,
      end: 9,
    });
    expect((await range("bytes=5-99"))?.headers["Content-Range"]).toBe(
      "bytes 5-9/10",
    );
  });

  it("answers 416 for a range beyond the file", async () => {
    for (const value of ["bytes=10-", "bytes=20-30", "bytes=-0"]) {
      const found = await range(value);
      expect(found?.status).toBe(416);
      expect(found?.headers["Content-Range"]).toBe("bytes */10");
    }
  });

  it("serves the whole file for malformed, reversed and multiple ranges", async () => {
    for (const value of [
      "bytes=abc",
      "bytes=5-2",
      "bytes=0-1,3-4",
      "items=0-1",
      "bytes=-",
    ])
      expect((await range(value))?.status).toBe(200);
  });

  it("honours If-Range only while the validator matches", async () => {
    const { ETag } = (await get("/data.bin"))!.headers;
    expect((await range("bytes=0-1", { "if-range": ETag! }))?.status).toBe(206);
    expect((await range("bytes=0-1", { "if-range": '"stale"' }))?.status).toBe(
      200,
    );
    expect(
      (
        await range("bytes=0-1", {
          "if-range": "Tue, 02 Jan 2024 03:04:05 GMT",
        })
      )?.status,
    ).toBe(206);
    expect(
      (
        await range("bytes=0-1", {
          "if-range": "Mon, 01 Jan 2024 00:00:00 GMT",
        })
      )?.status,
    ).toBe(200);
  });

  it("never combines a range with a compressed variant", async () => {
    const found = await get("/app.js", {
      range: "bytes=0-9",
      "accept-encoding": "br",
    });
    expect(found?.status).toBe(206);
    expect(found?.body?.file).toBe(path.join(dir, "app.js"));
    expect(found?.headers["Content-Encoding"]).toBeUndefined();
  });
});

describe("resolveStaticFile scope", () => {
  it("ignores other methods, index.html, directories, missing files and traversal", async () => {
    expect(await resolveStaticFile(dir, "POST", "/app.js")).toBeNull();
    expect(await get("/index.html")).toBeNull();
    expect(await get("/assets")).toBeNull();
    expect(await get("/missing.js")).toBeNull();
    expect(await get("/..%2f..%2fetc/passwd")).toBeNull();
  });
});
