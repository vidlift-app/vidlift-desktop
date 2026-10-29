import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeviceCode, FolderCheck, InstallPlan, InstallProgress, LicenseResult, OldInstall } from "../shared/types";
import { ALWAYS, API_KEYS, INSTALL_STEPS, PART_GROUPS, URLS, formatKey, gb, keyComplete } from "./data";
import {
  GlyphDone,
  GlyphFailed,
  GlyphPending,
  GlyphRunning,
  IconAlert,
  IconArrowLeft,
  IconCheck,
  IconChip,
  IconCopy,
  IconDrive,
  IconExternal,
  IconFolder,
  IconGithub,
  IconKey,
  IconPlay,
  IconRetry,
} from "./icons";
import { Button, Checkbox, Details, Progress, SecretInput, Switch, WaitLine, markUrl } from "./ui";
import type { StepProps } from "./wizard-types";

const api = window.vidlift;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ------------------------------------------------------------ layout */

function Page({
  title,
  sub,
  head,
  children,
  left,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  head?: ReactNode;
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <>
      <div className="content">
        <div className="content-inner fade">
          {head}
          <h1 className="title">{title}</h1>
          {sub && <p className="sub">{sub}</p>}
          {children}
        </div>
      </div>
      <div className="footer-wrap">
        <div className="footer">
          <div className="footer-left">{left}</div>
          <div className="footer-right">{right}</div>
        </div>
      </div>
    </>
  );
}

const BackButton = ({ onClick }: { onClick: () => void }) => (
  <Button icon={<IconArrowLeft />} onClick={onClick}>
    Back
  </Button>
);

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const t = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [
    copied,
    (text: string) => {
      void api.copy(text);
      setCopied(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setCopied(false), 1500);
    },
  ];
}

/* ------------------------------------------------------------ 1. welcome */

export function WelcomeStep({ go }: StepProps) {
  return (
    <Page
      head={<img src={markUrl} alt="" width={56} height={56} style={{ display: "block", marginBottom: 24 }} />}
      title="Welcome to VidLift"
      sub="Setup takes 15 to 30 minutes and needs the internet."
      right={
        <Button variant="primary" onClick={() => go("license")}>
          Start
        </Button>
      }
    >
      <div className="card facts section">
        <div className="fact">
          <IconKey />
          <span>
            <b>Your licence key</b> <span className="dim">— in your welcome email</span>
          </span>
        </div>
        <div className="fact">
          <IconGithub />
          <span>
            <b>A GitHub account</b> <span className="dim">with the VidLift invite accepted</span>
          </span>
        </div>
        <div className="fact">
          <IconDrive />
          <span>
            <b>About 15 GB</b> <span className="dim">free space</span>
          </span>
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 2. licence */

export function LicenseStep({ draft, update, go, back }: StepProps) {
  const key = draft.licenseKey;
  const ok = keyComplete(key);
  const next = () => {
    if (!ok) return;
    // A different key means the last check no longer counts.
    go("github", { licenseKey: key });
  };
  return (
    <Page
      title="Enter your licence key"
      left={<BackButton onClick={back} />}
      right={
        <Button variant="primary" disabled={!ok} onClick={next}>
          Continue
        </Button>
      }
    >
      <div className="section stack">
        <input
          className="input key-input"
          value={key}
          placeholder="VL-XXXX-XXXX-XXXX-XXXX"
          aria-label="Licence key"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            const v = formatKey(e.target.value);
            update({ licenseKey: v, license: v === key ? draft.license : null });
          }}
          onKeyDown={(e) => e.key === "Enter" && next()}
        />
        <div>
          <button type="button" className="btn-link" onClick={() => void api.openExternal(URLS.skool)}>
            Where's my key?
          </button>
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 3. github */

type GhPhase =
  | { k: "idle" }
  | { k: "starting" }
  | { k: "startError"; message: string }
  | { k: "code"; code: DeviceCode }
  | { k: "codeEnded"; message: string }
  | { k: "checking"; login: string }
  | { k: "result"; login: string; res: LicenseResult };

export function GithubStep({ draft, update, go, back }: StepProps) {
  const [phase, setPhase] = useState<GhPhase>(() =>
    draft.license && draft.githubLogin
      ? { k: "result", login: draft.githubLogin, res: draft.license }
      : draft.githubLogin
        ? { k: "checking", login: draft.githubLogin }
        : { k: "idle" },
  );
  const [copied, copy] = useCopied();
  const opened = useRef<string | null>(null);

  const start = async () => {
    setPhase({ k: "starting" });
    update({ license: null });
    try {
      const code = await api.githubStart();
      setPhase({ k: "code", code });
      if (opened.current !== code.device_code) {
        opened.current = code.device_code;
        void api.openExternal(code.verification_uri);
      }
    } catch (e) {
      setPhase({ k: "startError", message: errText(e) });
    }
  };

  // Poll GitHub every `interval` seconds while the code is on screen.
  useEffect(() => {
    if (phase.k !== "code") return;
    const code = phase.code;
    let interval = Math.max(1, code.interval);
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await api.githubPoll(code.device_code);
        if (cancelled) return;
        if (r.status === "pending" || r.status === "slow_down") {
          if (r.status === "slow_down") interval += 5;
          timer = window.setTimeout(tick, interval * 1000);
        } else if (r.status === "ok") {
          update({ githubLogin: r.login });
          void api.saveState({ githubLogin: r.login });
          setPhase({ k: "checking", login: r.login });
        } else {
          setPhase({ k: "codeEnded", message: "message" in r && r.message ? r.message : "The code was not approved." });
        }
      } catch (e) {
        if (!cancelled) setPhase({ k: "codeEnded", message: errText(e) });
      }
    };
    timer = window.setTimeout(tick, interval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, update]);

  // Signed in: check the licence against this GitHub account.
  useEffect(() => {
    if (phase.k !== "checking") return;
    let cancelled = false;
    void (async () => {
      let res: LicenseResult;
      try {
        res = await api.activateLicense(draft.licenseKey);
      } catch (e) {
        res = { ok: false, error: "unreachable", message: errText(e) };
      }
      if (cancelled) return;
      update({ license: res });
      setPhase({ k: "result", login: phase.login, res });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, draft.licenseKey, update]);

  const active = phase.k === "result" && phase.res.ok && phase.res.status !== "ended";
  const login = phase.k === "checking" || phase.k === "result" ? phase.login : null;

  const recheck = () => {
    if (!login) return void start();
    update({ license: null });
    setPhase({ k: "checking", login });
  };

  let primary: ReactNode;
  if (phase.k === "idle" || phase.k === "starting" || phase.k === "startError") {
    primary = (
      <Button variant="primary" icon={<IconGithub />} disabled={phase.k === "starting"} onClick={() => void start()}>
        Sign in with GitHub
      </Button>
    );
  } else {
    primary = (
      <Button variant="primary" disabled={!active} onClick={() => go("location")}>
        Continue
      </Button>
    );
  }

  return (
    <Page title="Sign in with GitHub" left={<BackButton onClick={back} />} right={primary}>
      <div className="section stack">
        {phase.k === "starting" && <WaitLine>Asking GitHub for a code</WaitLine>}

        {phase.k === "startError" && (
          <div className="card danger">
            <div className="card-title danger-text">
              <IconAlert />
              Couldn't reach GitHub
            </div>
            <div className="msg selectable">{phase.message}</div>
          </div>
        )}

        {phase.k === "code" && (
          <div className="card stack" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="code">{phase.code.user_code}</span>
              <Button icon={copied ? <IconCheck /> : <IconCopy />} onClick={() => copy(phase.code.user_code)}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div>
              <Button icon={<IconExternal />} onClick={() => void api.openExternal(phase.code.verification_uri)}>
                Open {phase.code.verification_uri.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </Button>
            </div>
            <WaitLine>Waiting for you to approve on GitHub</WaitLine>
          </div>
        )}

        {phase.k === "codeEnded" && (
          <div className="card warn">
            <div className="card-title lead tone-warn">
              <IconAlert />
              {phase.message}
            </div>
            <div className="actions">
              <Button icon={<IconRetry />} onClick={() => void start()}>
                Get a new code
              </Button>
            </div>
          </div>
        )}

        {login && (
          <div className="row dim">
            <IconGithub />
            <span>
              Signed in as <b style={{ color: "var(--text)" }}>@{login}</b>
            </span>
          </div>
        )}

        {phase.k === "checking" && <WaitLine>Checking your licence</WaitLine>}

        {phase.k === "result" && <LicenseCard res={phase.res} onRetry={recheck} onOtherAccount={() => void start()} />}
      </div>
    </Page>
  );
}

function LicenseCard({ res, onRetry, onOtherAccount }: { res: LicenseResult; onRetry: () => void; onOtherAccount: () => void }) {
  if (res.ok && res.status !== "ended") {
    return (
      <div className="card success">
        <div className="card-title">
          <span className="success-text" style={{ display: "flex" }}>
            <IconCheck />
          </span>
          Licence active{res.name ? ` · ${res.name}` : ""}
        </div>
        {res.skool && <div className="msg">Skool: {res.skool}</div>}
      </div>
    );
  }
  if (res.ok && res.status === "ended") {
    return (
      <div className="card warn">
        <div className="card-title lead tone-warn">
          <IconAlert />
          Your Skool membership has ended. Renew to install VidLift.
        </div>
        <div className="actions">
          <Button icon={<IconExternal />} onClick={() => void api.openExternal(URLS.skool)}>
            Renew on Skool
          </Button>
          <Button icon={<IconRetry />} onClick={onRetry}>
            I've renewed
          </Button>
        </div>
      </div>
    );
  }
  const code = res.error ?? "";
  const resign = code === "no_token" || code === "github_invalid";
  return (
    <div className="card danger">
      <div className="card-title lead tone-danger">
        <IconAlert />
        <span className="selectable">{res.message || "Your licence couldn't be checked."}</span>
      </div>
      <div className="actions">
        {code === "no_release_access" && (
          <Button icon={<IconExternal />} onClick={() => void api.openExternal(URLS.invite)}>
            Open the invite
          </Button>
        )}
        {(code === "github_mismatch" || code === "github_taken") && (
          <Button icon={<IconGithub />} onClick={onOtherAccount}>
            Use another GitHub account
          </Button>
        )}
        <Button icon={<IconRetry />} onClick={resign ? onOtherAccount : onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 4. location */

export function LocationStep({ draft, update, go, back }: StepProps) {
  const dir = draft.installDir;
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCheck(null);
    setCheckErr(null);
    api.checkFolder(dir).then(
      (c) => !cancelled && setCheck(c),
      (e) => !cancelled && setCheckErr(errText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [dir]);

  const change = async () => {
    const p = await api.chooseFolder("Where to install VidLift", dir);
    if (p) update({ installDir: p });
  };

  const blocked = !check || !check.ok;

  return (
    <Page
      title="Where to install"
      left={<BackButton onClick={back} />}
      right={
        <Button variant="primary" disabled={blocked} onClick={() => go("import")}>
          Continue
        </Button>
      }
    >
      <div className="section stack">
        <div className="row">
          <div className="path-box selectable" title={dir}>
            <span>{dir}</span>
          </div>
          <Button icon={<IconFolder />} onClick={() => void change()}>
            Change…
          </Button>
        </div>
        {!check && !checkErr && <WaitLine>Checking this folder</WaitLine>}
        {check && (
          <div className="dim">
            Free on this drive: <span className="mono" style={{ color: "var(--text)" }}>{check.freeGb == null ? "unknown" : gb(check.freeGb)}</span>
          </div>
        )}
        {check && check.message && (
          <div className={`row small ${check.ok ? "warn-text" : "danger-text"}`}>
            <IconAlert />
            <span>{check.message}</span>
          </div>
        )}
        {checkErr && (
          <div className="row small danger-text">
            <IconAlert />
            <span>{checkErr}</span>
          </div>
        )}
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 5. old VidLift */

export function ImportStep({ draft, update, go, back }: StepProps) {
  const [found, setFound] = useState<OldInstall | null>(null);
  const [busy, setBusy] = useState(false);
  const folder = draft.oldFolder;

  useEffect(() => {
    if (draft.oldChoice !== "old" || !folder) {
      setFound(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    api
      .checkOldInstall(folder)
      .then(
        (r) => !cancelled && setFound(r),
        (e) => !cancelled && setFound({ ok: false, path: folder, userGb: 0, message: errText(e) }),
      )
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [folder, draft.oldChoice]);

  const pick = async () => {
    const p = await api.chooseFolder("Your old VidLift folder", folder ?? undefined);
    if (p) update({ oldFolder: p });
  };

  const ready = draft.oldChoice === "first" || (draft.oldChoice === "old" && !!found?.ok && !busy);

  const choice = (id: "first" | "old", label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={draft.oldChoice === id}
      className={`choice${draft.oldChoice === id ? " on" : ""}`}
      onClick={() => update({ oldChoice: id })}
    >
      <span className="radio" />
      {label}
    </button>
  );

  return (
    <Page
      title="Your old VidLift"
      left={<BackButton onClick={back} />}
      right={
        <Button variant="primary" disabled={!ready} onClick={() => go("parts", draft.oldChoice === "first" ? { oldFolder: null } : {})}>
          Continue
        </Button>
      }
    >
      <div className="section stack" role="radiogroup" aria-label="Your old VidLift">
        {choice("first", "This is my first VidLift")}
        {choice("old", "I used VidLift before (the zip version)")}
      </div>
      {draft.oldChoice === "old" && (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="row">
            <div className={`path-box${folder ? " selectable" : " empty"}`} title={folder ?? undefined}>
              <span>{folder ?? "No folder chosen"}</span>
            </div>
            <Button icon={<IconFolder />} onClick={() => void pick()}>
              Choose…
            </Button>
          </div>
          {busy && <WaitLine>Looking for your videos and settings</WaitLine>}
          {!busy && found?.ok && (
            <div className="row">
              <span className="success-text" style={{ display: "flex" }}>
                <IconCheck />
              </span>
              <span className="dim">Found your videos and settings · {gb(found.userGb)} will be copied</span>
            </div>
          )}
          {!busy && found && !found.ok && (
            <div className="row small danger-text">
              <IconAlert />
              <span>{found.message ?? "No VidLift found in this folder."}</span>
            </div>
          )}
          <div className="small muted">Your old folder stays as it is. Delete it once the new app works.</div>
        </div>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------ 6. parts */

export function PartsStep({ draft, update, go, back }: StepProps) {
  const parts = new Set(draft.parts);
  const packs = new Set(draft.packs);

  const setPart = (id: string, on: boolean) => {
    const next = new Set(parts);
    if (on) {
      next.add(id);
      if (id === "tts") next.add("ai");
    } else {
      next.delete(id);
      if (id === "ai") next.delete("tts");
    }
    update({ parts: [...next] });
  };
  const setPack = (id: string, on: boolean) => {
    const next = new Set(packs);
    if (on) next.add(id);
    else next.delete(id);
    update({ packs: [...next] });
  };

  let total = ALWAYS.reduce((s, r) => s + r.gb, 0);
  for (const g of PART_GROUPS) for (const r of g.rows) if ((g.kind === "parts" ? parts : packs).has(r.id)) total += r.gb;

  return (
    <Page
      title="Choose what to install"
      sub="Anything left out can be added later in Settings › Setup."
      left={
        <>
          <BackButton onClick={back} />
          <span className="footer-note">
            About <span className="mono">{total.toFixed(1)} GB</span> to download
          </span>
        </>
      }
      right={
        <Button variant="primary" onClick={() => go("keys")}>
          Continue
        </Button>
      }
    >
      <div className="section">
        <div className="group">
        <div className="group-head">Always installed</div>
        {ALWAYS.map((r) => (
          <div className="part locked" key={r.id}>
            <Checkbox on locked label={r.name} />
            <div className="part-text">
              <span className="part-name">{r.name}</span>
            </div>
            <span className="part-size">{r.size}</span>
          </div>
        ))}
        </div>
        {PART_GROUPS.map((g) => (
          <div className="group" key={g.title}>
            <div className="group-head">{g.title}</div>
            {g.rows.map((r) => {
              const on = (g.kind === "parts" ? parts : packs).has(r.id);
              const set = g.kind === "parts" ? setPart : setPack;
              return (
                <div className="part" key={r.id} onClick={() => set(r.id, !on)}>
                  <Checkbox on={on} label={r.name} onChange={(v) => set(r.id, v)} />
                  <div className="part-text">
                    <span className="part-name">{r.name}</span>
                    {r.desc && <span className="part-desc">{r.desc}</span>}
                  </div>
                  <span className="part-size">{r.size}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 7. keys */

export function KeysStep({ draft, update, go, back }: StepProps) {
  const keys = draft.keys;
  return (
    <Page
      title="API keys (optional)"
      left={<BackButton onClick={back} />}
      right={
        <>
          <Button onClick={() => go("install", { keys: {} })}>Skip</Button>
          <Button variant="primary" onClick={() => go("install")}>
            Continue
          </Button>
        </>
      }
    >
      <div className="section stack" style={{ gap: 14 }}>
        {API_KEYS.map((k) => (
          <div key={k.env}>
            <label className="field-label" htmlFor={`key-${k.env}`}>
              <span>{k.label}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {k.env}
              </span>
            </label>
            <SecretInput
              id={`key-${k.env}`}
              value={keys[k.env] ?? ""}
              onChange={(v) => {
                const next = { ...keys };
                if (v) next[k.env] = v;
                else delete next[k.env];
                update({ keys: next });
              }}
            />
          </div>
        ))}
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 8. install */

export function InstallStep({ draft, go }: StepProps) {
  const [p, setP] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopied();
  const last = useRef<InstallProgress | null>(null);
  const started = useRef(false);

  const plan: InstallPlan = {
    parts: draft.parts,
    packs: draft.packs,
    oldFolder: draft.oldChoice === "old" ? draft.oldFolder : null,
    keys: draft.keys,
  };

  const run = async () => {
    setError(null);
    try {
      await api.install(plan);
      const err = last.current?.error;
      if (err) setError(err);
      else go("done");
    } catch (e) {
      setError(last.current?.error || errText(e));
    }
  };

  useEffect(() => {
    const off = api.onProgress((x) => {
      last.current = x;
      setP(x);
      if (x.error) setError(x.error);
    });
    if (!started.current) {
      started.current = true;
      void run();
    }
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = INSTALL_STEPS.filter((s) => s.id !== "import" || plan.oldFolder);
  const done = new Set(p?.done ?? []);
  const current = p?.step ?? "prepare";
  const log = p?.log ?? [];

  return (
    <Page title="Installing VidLift">
      <div className="section stack" style={{ gap: 18 }}>
        <ol className="isteps">
          {rows.map((s) => {
            const state = done.has(s.id) ? "done" : s.id === current ? (error ? "failed" : "running") : "pending";
            return (
              <li key={s.id} className={`istep ${state}`}>
                <span className="istep-glyph">
                  {state === "done" ? <GlyphDone /> : state === "running" ? <GlyphRunning /> : state === "failed" ? <GlyphFailed /> : <GlyphPending />}
                </span>
                <div className="istep-body">
                  <div className="istep-label">{s.label}</div>
                  {state === "running" && (
                    <>
                      <div className="istep-msg">{p?.message || "Starting"}</div>
                      <Progress fraction={p ? p.fraction : null} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {p?.hardware && (
          <div className="card row" style={{ padding: "12px 16px" }}>
            <span className="dim" style={{ display: "flex" }}>
              <IconChip />
            </span>
            <span>
              <span className="dim">This computer · </span>
              {p.hardware}
            </span>
          </div>
        )}

        {error && (
          <div className="card danger">
            <div className="card-title lead tone-danger">
              <IconAlert />
              <span className="selectable">{error}</span>
            </div>
            <div className="actions">
              <Button variant="primary" icon={<IconRetry />} onClick={() => void run()}>
                Try again
              </Button>
              <Button icon={copied ? <IconCheck /> : <IconCopy />} onClick={() => copy([error, "", ...log].join("\n"))}>
                {copied ? "Copied" : "Copy details"}
              </Button>
            </div>
          </div>
        )}

        <Details lines={log} />
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------ 9. done */

export function DoneStep({ draft, update }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.finish({ crashReports: draft.crashReports, openAtLogin: draft.openAtLogin });
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <Page
      head={
        <div style={{ marginBottom: 20 }}>
          <GlyphDone size={48} />
        </div>
      }
      title="VidLift is ready"
      right={
        <Button variant="primary" icon={<IconPlay />} disabled={busy} onClick={() => void open()}>
          Open VidLift
        </Button>
      }
    >
      <div className="section">
        <div className="switch-row">
          <Switch on={draft.crashReports} label="Send crash reports to the VidLift team" onChange={(v) => update({ crashReports: v })} />
          <div>
            <div style={{ fontWeight: 500 }}>Send crash reports to the VidLift team</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              Errors and system details only. Never your videos or keys.
            </div>
          </div>
        </div>
        <div className="switch-row">
          <Switch on={draft.openAtLogin} label="Open VidLift when I sign in" onChange={(v) => update({ openAtLogin: v })} />
          <div style={{ fontWeight: 500 }}>Open VidLift when I sign in</div>
        </div>
        {err && (
          <div className="row small danger-text" style={{ marginTop: 12 }}>
            <IconAlert />
            <span className="selectable">{err}</span>
          </div>
        )}
      </div>
    </Page>
  );
}
