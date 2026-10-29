import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconCheck, IconChevron, IconEye, IconEyeOff } from "./icons";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  icon?: ReactNode;
  iconAfter?: ReactNode;
};

export function Button({ variant = "secondary", icon, iconAfter, children, className, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant}${className ? " " + className : ""}`} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </button>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function WaitLine({ children }: { children: ReactNode }) {
  return (
    <div className="wait-line" role="status">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** 4px bar; `null` slides an indeterminate segment. */
export function Progress({ fraction }: { fraction: number | null }) {
  if (fraction == null) {
    return (
      <div className="bar indet" role="progressbar" aria-busy="true">
        <i />
      </div>
    );
  }
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Checkbox({ on, locked, onChange, label }: { on: boolean; locked?: boolean; onChange?: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={locked || undefined}
      aria-label={label}
      className={`check${locked ? " locked" : on ? " on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!locked) onChange?.(!on);
      }}
    >
      {(on || locked) && <IconCheck strokeWidth={2.2} />}
    </button>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

export function SecretInput({
  value,
  onChange,
  id,
  placeholder,
  onBlur,
  onPaste,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  placeholder?: string;
  onBlur?: () => void;
  onPaste?: () => void;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="secret">
      <input
        id={id}
        className="input"
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim())}
        onBlur={onBlur}
        onPaste={onPaste}
      />
      <button type="button" className="eye" aria-label={show ? "Hide key" : "Show key"} title={show ? "Hide" : "Show"} onClick={() => setShow(!show)}>
        {show ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
}

/** "Show details" toggle over a selectable, self-scrolling log box. */
export function Details({ lines, label = "Show details" }: { lines: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (open && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [open, lines]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className={`toggle-link${open ? " open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevron />
        {open ? "Hide details" : label}
      </button>
      {open && (
        <pre className="log" ref={box}>
          {lines.length ? lines.join("\n") : "No output yet."}
        </pre>
      )}
    </div>
  );
}

/** The bundled mark (inlined by Vite as a data: URL). */
export { default as markUrl } from "./vidlift-icon.svg";
