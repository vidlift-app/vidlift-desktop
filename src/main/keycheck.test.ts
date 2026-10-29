import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKED, testKey, type FetchLike } from "./keycheck";

const KEY = "sk-test-0123456789abcdef";

function reply(status: number, body: unknown = {}): FetchLike {
  return async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const offline: FetchLike = async () => {
  throw new TypeError("fetch failed");
};

/** Per provider: an answer that means the key works, and one that refuses it. */
const CASES: Record<string, { ok: FetchLike; bad: FetchLike }> = {
  GEMINI_API_KEY: { ok: reply(200, { models: [] }), bad: reply(400, { error: { message: "API key not valid. Please pass a valid API key." } }) },
  ANTHROPIC_API_KEY: { ok: reply(200, { data: [] }), bad: reply(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }) },
  YOUTUBE_API_KEY: { ok: reply(200, { items: [] }), bad: reply(400, { error: { errors: [{ reason: "keyInvalid" }], message: "API key not valid." } }) },
  KIE_API_KEY: { ok: reply(200, { data: [] }), bad: reply(401, { msg: "Unauthorized" }) },
  MODELFLARE_API_KEY: { ok: reply(200, { data: [] }), bad: reply(403, { error: "forbidden" }) },
  PORTIX_API_KEY: { ok: reply(200, { data: [] }), bad: reply(401, { error: { message: "invalid token" } }) },
  AI33_API_KEY: { ok: reply(200, { credits: 1234 }), bad: reply(401, { detail: "Invalid API key" }) },
  ELEVENLABS_API_KEY: {
    ok: reply(200, { subscription: { character_limit: 100000, character_count: 2500 } }),
    bad: reply(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }),
  },
  FISH_AUDIO_API_KEY: { ok: reply(200, { credit: "4.5" }), bad: reply(401, { message: "Invalid token" }) },
  MINIMAX_API_KEY: {
    ok: reply(200, { base_resp: { status_code: 0, status_msg: "success" } }),
    bad: reply(200, { base_resp: { status_code: 2049, status_msg: "invalid api key" } }),
  },
  PEXELS_API_KEY: { ok: reply(200, { photos: [] }), bad: reply(401, { error: "Unauthorized" }) },
  PIXABAY_API_KEY: { ok: reply(200, { hits: [] }), bad: reply(400, "[ERROR 400] Invalid or missing API key") },
};

test("every checked provider has a case", () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...CHECKED].sort());
});

for (const [env, c] of Object.entries(CASES)) {
  test(`${env}: a working key is "ok"`, async () => {
    const r = await testKey(env, KEY, c.ok);
    assert.equal(r.state, "ok");
  });
  test(`${env}: a refused key is "bad", and the message never holds the key`, async () => {
    const r = await testKey(env, KEY, c.bad);
    assert.equal(r.state, "bad");
    assert.ok(r.message && r.message.length > 0);
    assert.ok(!r.message!.includes(KEY));
  });
  test(`${env}: no network is "unchecked"`, async () => {
    const r = await testKey(env, KEY, offline);
    assert.deepEqual(r, { state: "unchecked", message: "Couldn't check right now" });
  });
}

test("a provider in trouble is not a verdict on the key", async () => {
  assert.equal((await testKey("GEMINI_API_KEY", KEY, reply(503))).state, "unchecked");
  assert.equal((await testKey("PEXELS_API_KEY", KEY, reply(429))).state, "unchecked");
  assert.equal((await testKey("MINIMAX_API_KEY", KEY, reply(200, { base_resp: { status_code: 1002 } }))).state, "unchecked");
});

test("YouTube: a key whose quota is used up still works", async () => {
  const r = await testKey("YOUTUBE_API_KEY", KEY, reply(403, { error: { errors: [{ reason: "quotaExceeded" }] } }));
  assert.equal(r.state, "ok");
  assert.match(r.message ?? "", /quota/);
});

test("YouTube: the API turned off for the project is not accepted", async () => {
  const r = await testKey("YOUTUBE_API_KEY", KEY, reply(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }));
  assert.equal(r.state, "bad");
});

test("ElevenLabs: a restricted key that can't read the account works", async () => {
  const r = await testKey("ELEVENLABS_API_KEY", KEY, reply(401, { detail: { status: "missing_permissions", message: "missing user_read" } }));
  assert.equal(r.state, "ok");
});

test("a refusal that quotes the key has it taken out", async () => {
  const r = await testKey("PORTIX_API_KEY", KEY, reply(401, { error: { message: `token ${KEY} is not valid` } }));
  assert.equal(r.state, "bad");
  assert.ok(!r.message!.includes(KEY));
  assert.match(r.message!, /\*\*\*/);
});

test("Fish Audio falls back to its model list when the wallet is not there", async () => {
  const seen: string[] = [];
  const f: FetchLike = async (url) => {
    seen.push(String(url));
    return String(url).includes("/wallet/") ? new Response("", { status: 404 }) : new Response("{}", { status: 200 });
  };
  assert.equal((await testKey("FISH_AUDIO_API_KEY", KEY, f)).state, "ok");
  assert.equal(seen.length, 2);
});

test("a key nothing checks, or an empty one, is only saved", async () => {
  assert.deepEqual(await testKey("TMDB_API_KEY", KEY, reply(200)), { state: "unchecked" });
  assert.deepEqual(await testKey("GEMINI_API_KEY", "  ", offline), { state: "unchecked" });
});

test("the key goes in the header or query each provider expects", async () => {
  const calls: { url: string; headers: Record<string, string>; method?: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method });
    return new Response("{}", { status: 200 });
  };
  await testKey("ELEVENLABS_API_KEY", KEY, f);
  await testKey("PEXELS_API_KEY", KEY, f);
  await testKey("PIXABAY_API_KEY", KEY, f);
  await testKey("MINIMAX_API_KEY", KEY, f);
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/user");
  assert.equal(calls[0].headers["xi-api-key"], KEY);
  assert.equal(calls[1].url, "https://api.pexels.com/v1/search?query=nature&per_page=1");
  assert.equal(calls[1].headers.Authorization, KEY);
  assert.equal(calls[2].url, `https://pixabay.com/api/?key=${KEY}&q=nature&per_page=3`);
  assert.equal(calls[3].method, "POST");
  assert.equal(calls[3].headers.Authorization, `Bearer ${KEY}`);
});
