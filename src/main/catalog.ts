// The signed release catalog and its downloads, as the core's updater reads
// them (apps/worker/updates.py fetch_catalog / latest / download): the catalog
// is refused unless the release key signed it, and every zip is refused unless
// its SHA-256 matches the catalog's.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CATALOG, GITHUB_API, RELEASE_PUBLIC_KEY, RELEASES_REPO } from "./constants";
import { headers } from "./github";

export interface Entry {
  version: string;
  name: string;
  asset: string;
  sha256: string;
  size?: number;
  [k: string]: unknown;
}

export interface Catalog {
  channels: Record<string, Record<string, Entry>>;
  packs?: Record<string, Record<string, unknown>>;
  assets?: Record<string, Record<string, Entry>>;
  [k: string]: unknown;
}

/** Ed25519 over the exact bytes; keys are raw 32-byte, base64 (as release.py writes them). */
export function verifyEd25519(data: Buffer, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
    return edVerify(null, data, key, Buffer.from(signatureB64.trim(), "base64"));
  } catch {
    return false;
  }
}

export class NoAccess extends Error {}

export async function fetchCatalog(token: string): Promise<Catalog> {
  const base = `${GITHUB_API}/repos/${RELEASES_REPO}/contents/`;
  const [body, sig] = await Promise.all([
    fetch(base + CATALOG, { headers: headers(token, "application/vnd.github.raw") }),
    fetch(base + CATALOG + ".sig", { headers: headers(token, "application/vnd.github.raw") }),
  ]);
  if ([401, 403, 404].includes(body.status)) {
    throw new NoAccess(
      "This GitHub account can't see VidLift's releases yet. Accept the invite in your email " +
        "(or at github.com/vidlift-app/vidlift-releases/invitations), then try again.",
    );
  }
  if (!body.ok || !sig.ok) throw new Error(`GitHub did not send the release list (${body.status})`);
  const data = Buffer.from(await body.arrayBuffer());
  if (!verifyEd25519(data, await sig.text(), RELEASE_PUBLIC_KEY)) {
    throw new Error("The release list's signature does not match. Refusing it.");
  }
  return JSON.parse(data.toString("utf-8")) as Catalog;
}

export function vkey(version: string): number[] {
  return version.split(".").map((p) => Number.parseInt(p, 10) || 0);
}

export function newer(a: string, b: string): boolean {
  const x = vkey(a);
  const y = vkey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** A component's entry on a channel: Beta offers whichever of Beta's and
 * Stable's is newer (updates.latest / _newest). */
export function latest(catalog: Catalog, channel: string, component: string): Entry | null {
  const stable = catalog.channels?.stable?.[component] ?? null;
  if (channel !== "beta") return stable;
  const beta = catalog.channels?.beta?.[component] ?? null;
  if (beta && (!stable || newer(beta.version, stable.version))) return beta;
  return stable;
}

/** Download a release asset through the API with the member's token, and
 * check its SHA-256 before it is moved into place. */
export async function download(
  url: string,
  token: string | null,
  dest: string,
  sha256: string,
  progress?: (fraction: number) => void,
): Promise<string> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.${process.pid}.part`;
  const r = await fetch(url, { headers: headers(token, "application/octet-stream"), redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`download failed (${r.status}) for ${path.basename(dest)}`);
  const total = Number(r.headers.get("content-length") || 0);
  const hash = createHash("sha256");
  let got = 0;
  let last = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      got += chunk.length;
      if (progress && total && got - last > 1 << 20) {
        last = got;
        progress(got / total);
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body as never), meter, createWriteStream(part));
    if (hash.digest("hex") !== sha256.toLowerCase()) {
      throw new Error(`${path.basename(dest)} did not match its checksum; discarded`);
    }
    await fs.rename(part, dest);
  } finally {
    await fs.rm(part, { force: true });
  }
  return dest;
}
