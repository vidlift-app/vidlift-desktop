// The start-up window: shown while VidLift's Python side starts or updates,
// and what went wrong when it could not.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { ShellStatus } from "../shared/types";
import "./styles.css";
import { IconAlert, IconCheck, IconCopy, IconFile, IconPower, IconRetry } from "./icons";
import { Button, Details, markUrl } from "./ui";

const api = window.vidlift;

const DEFAULTS: Record<ShellStatus["mode"], string> = {
  starting: "Starting VidLift…",
  updating: "Updating VidLift…",
  error: "",
};

function Waiting() {
  const [s, setS] = useState<ShellStatus>({ mode: "starting", message: "", log: [] });
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => api.onShellStatus((x) => {
    setS(x);
    setRetrying(false);
  }), []);

  if (s.mode === "error") {
    return (
      <div className="waiting">
        <div className="card danger waiting-error fade">
          <div className="card-title danger-text">
            <IconAlert />
            VidLift couldn't start
          </div>
          {s.message && <div className="msg selectable">{s.message}</div>}
          <div style={{ marginTop: 14 }}>
            <Details lines={s.log} />
          </div>
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <Button
                variant="primary"
                icon={<IconRetry />}
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void api.retryStart().catch(() => setRetrying(false));
                }}
              >
                Try again
              </Button>
              <Button
                icon={copied ? <IconCheck /> : <IconCopy />}
                onClick={() => {
                  void api.copy([s.message, "", ...s.log].join("\n"));
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy details"}
              </Button>
              <Button icon={<IconFile />} onClick={() => void api.openLogs()}>
                Open logs
              </Button>
            </div>
            <Button icon={<IconPower />} onClick={() => void api.quit()}>
              Quit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="waiting">
      <div className="waiting-center fade">
        <img className="pulse" src={markUrl} alt="" />
        <div className="waiting-status" role="status">
          <span>{s.message || DEFAULTS[s.mode]}</span>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Waiting />);
