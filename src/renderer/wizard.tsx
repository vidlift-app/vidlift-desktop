// The install wizard: eight steps in one window, resuming where it stopped.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import type { ShellInfo, WizardStep } from "../shared/types";
import type { Draft, StepProps } from "./wizard-types";
import "./styles.css";
import { ALL_PACKS, ALL_PARTS, WIZARD_STEPS, stepIndex } from "./data";
import { GlyphCurrent, GlyphDone, GlyphPending } from "./icons";
import { markUrl } from "./ui";
import { AiStep, DoneStep, GithubStep, InstallStep, LicenseStep, LocationStep, PartsStep, WelcomeStep } from "./steps";

const api = window.vidlift;

function draftFrom(info: ShellInfo): Draft {
  const s = info.state;
  return {
    licenseKey: s.licenseKey ?? "",
    githubLogin: s.githubLogin,
    license: null,
    installDir: s.installDir ?? info.defaultInstallDir,
    parts: s.parts ?? [...ALL_PARTS],
    packs: s.packs ?? [...ALL_PACKS],
    keys: {},
    voice: s.voice ?? { mode: "local" },
    crashReports: s.crashReports ?? true,
    openAtLogin: s.openAtLogin ?? false,
  };
}

function Rail({ step, version, onPick }: { step: WizardStep; version: string; onPick: (s: WizardStep) => void }) {
  const cur = stepIndex(step);
  const locked = step === "install" || step === "done";
  return (
    <aside className="rail">
      <div className="brand">
        <img src={markUrl} alt="" />
        <span>VidLift</span>
      </div>
      <ol className="steps">
        {WIZARD_STEPS.map((s, i) => {
          const state = i < cur ? "done" : i === cur ? "current" : "upcoming";
          const clickable = state === "done" && !locked;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`step-row ${state}${clickable ? " clickable" : ""}`}
                disabled={!clickable}
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => clickable && onPick(s.id)}
              >
                {state === "done" ? <GlyphDone /> : state === "current" ? <GlyphCurrent /> : <GlyphPending />}
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="rail-foot">Setup {version}</div>
    </aside>
  );
}

function App() {
  const [info, setInfo] = useState<ShellInfo | null>(null);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void api.info().then((i) => {
      setInfo(i);
      setDraft(draftFrom(i));
      // A step this version no longer has (an older shell.json) starts over.
      const saved = ["keys", "import"].includes(i.state.step as string) ? "ai" : i.state.step;
      setStep(i.state.setupDone ? "done" : stepIndex(saved) >= 0 ? saved : "welcome");
    });
  }, []);

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);

  const go = useCallback(
    (next: WizardStep, patch: Partial<Draft> = {}) => {
      if (!draft) return;
      const nd = { ...draft, ...patch };
      setDraft(nd);
      setStep(next);
      void api.saveState({
        step: next,
        licenseKey: nd.licenseKey || null,
        githubLogin: nd.githubLogin,
        installDir: nd.installDir,
        parts: nd.parts,
        packs: nd.packs,
        voice: nd.voice,
      });
    },
    [draft],
  );

  if (!info || !draft) return null;

  const i = stepIndex(step);
  const back = () => {
    if (i > 0) go(WIZARD_STEPS[i - 1].id);
  };
  const props: StepProps = { info, draft, update, go, back };

  return (
    <div className="shell">
      <Rail step={step} version={info.version} onPick={(s) => go(s)} />
      <main className="main" key={step}>
        {step === "welcome" && <WelcomeStep {...props} />}
        {step === "license" && <LicenseStep {...props} />}
        {step === "github" && <GithubStep {...props} />}
        {step === "location" && <LocationStep {...props} />}
        {step === "ai" && <AiStep {...props} />}
        {step === "parts" && <PartsStep {...props} />}
        {step === "install" && <InstallStep {...props} />}
        {step === "done" && <DoneStep {...props} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
