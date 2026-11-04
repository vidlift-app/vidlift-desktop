// Another VidLift on the API port is not taken for this install (2026-11-04:
// the wizard's settings were saved to this install while the dashboard that
// opened was an older one left running).
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import { OtherVidLift, sameDir, userDirAt } from "./supervisor";

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function serve(body: string, status = 200): Promise<string> {
  return new Promise((done) => {
    const s = createServer((_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

test("reads the running VidLift's user folder", async () => {
  const base = await serve(JSON.stringify({ ready: true, user_dir: "C:\\Users\\a\\AppData\\Local\\VidLift\\user" }));
  assert.equal(await userDirAt(base), "C:\\Users\\a\\AppData\\Local\\VidLift\\user");
});

test("an older core that does not say, or nothing at all, is no answer", async () => {
  assert.equal(await userDirAt(await serve(JSON.stringify({ ready: true }))), null);
  assert.equal(await userDirAt(await serve("{}", 500)), null);
  assert.equal(await userDirAt("http://127.0.0.1:9"), null);
});

test("folders compare as the platform names them", () => {
  assert.equal(sameDir("C:\\Users\\A\\AppData\\Local\\VidLift\\user", "c:\\users\\a\\appdata\\local\\vidlift\\user\\", "win32"), true);
  assert.equal(sameDir("/Users/a/Library/Application Support/VidLift/user", "/Users/a/Library/Application Support/VidLift/User", "darwin"), true);
  assert.equal(sameDir("/home/a/.local/share/vidlift/user", "/home/a/.local/share/vidlift/User", "linux"), false);
  assert.equal(sameDir("/x/VidLift/user", "/y/VidLift/user", "darwin"), false);
});

test("says where the other one runs from", () => {
  assert.match(new OtherVidLift("D:\\Old\\VidLift\\user").message, /from D:\\Old\\VidLift\./);
  assert.match(new OtherVidLift("D:\\CODING\\VidLift").message, /from D:\\CODING\\VidLift\./);
});
