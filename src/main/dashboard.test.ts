import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import { isVidlift } from "./supervisor";

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function serve(type: string, body: string): Promise<string> {
  return new Promise((done) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

test("VidLift's own health route counts", async () => {
  assert.equal(await isVidlift(await serve("application/json", '{"ok":true,"data_dir":"C:/x"}')), true);
});

test("a member's own site with a catch-all page does not", async () => {
  assert.equal(await isVidlift(await serve("text/html", "<!doctype html><title>My site</title>")), false);
});

test("another program's JSON does not", async () => {
  assert.equal(await isVidlift(await serve("application/json", '{"ok":true}')), false);
});

test("nothing listening does not", async () => {
  assert.equal(await isVidlift("http://127.0.0.1:9"), false);
});
