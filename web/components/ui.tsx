// ORION primitives. Styles live in styles/components.css; these only fix the markup and the rules
// (blue means "next step", status is written in words, every bar prints its value).
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./brand";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";
const btn = (variant: Variant, size: Size, tracked?: boolean, extra?: string) =>
  ["o-btn", `o-btn--${variant}`, size !== "md" && `o-btn--${size}`, tracked && "o-btn--tracked", extra].filter(Boolean).join(" ");

export function Button({ variant = "secondary", size = "md", tracked, arrow, icon, className, children, ...rest }:
  { variant?: Variant; size?: Size; tracked?: boolean; arrow?: boolean; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={btn(variant, size, tracked, className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
      {arrow && <Icon name="arrow" size={16} className="o-arrow-i" />}
    </button>
  );
}

export function ButtonLink({ variant = "secondary", size = "md", tracked, arrow, icon, className, children, ...rest }:
  { variant?: Variant; size?: Size; tracked?: boolean; arrow?: boolean; icon?: IconName } & ComponentProps<typeof Link>) {
  return (
    <Link className={btn(variant, size, tracked, className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
      {arrow && <Icon name="arrow" size={16} className="o-arrow-i" />}
    </Link>
  );
}

/** The posters' round blue arrow. Always labelled for screen readers. */
export function ArrowButton({ label, small, ...rest }: { label: string; small?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`o-arrow ${small ? "o-arrow--sm" : ""}`} aria-label={label} title={label} {...rest}>
      <Icon name="arrow" size={small ? 16 : 20} strokeWidth={1.8} />
    </button>
  );
}

export function Chip({ icon, pressed, quiet, children, ...rest }:
  { icon?: IconName; pressed?: boolean; quiet?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`o-chip ${quiet ? "o-chip--quiet" : ""}`} aria-pressed={pressed} {...rest}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function Tag({ tone = "neutral", plain, children }: { tone?: "neutral" | "blue" | "success" | "warning" | "danger"; plain?: boolean; children: ReactNode }) {
  return <span className={`o-tag ${tone !== "neutral" ? `o-tag--${tone}` : ""} ${plain ? "o-tag--plain" : ""}`}>{children}</span>;
}

export function Glass({ as: As = "div", tone, className, style, children, ...rest }:
  { as?: "div" | "section" | "article" | "aside" | "form"; tone?: "strong" | "frost"; className?: string; style?: CSSProperties; children: ReactNode } & Record<string, unknown>) {
  return <As className={`o-glass ${tone ? `o-glass--${tone}` : ""} ${className ?? ""}`} style={style} {...rest}>{children}</As>;
}

/** Swiss section number: "01 — How it works", over a hairline. */
export function Index({ n, children }: { n: string; children: ReactNode }) {
  return <div className="o-index"><span className="o-index__n">{n}</span><span className="o-index__l">{children}</span></div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`t-label ${className ?? ""}`}>{children}</span>;
}

export function Rule({ hair }: { hair?: boolean }) {
  return <hr className={`o-rule ${hair ? "o-rule--hair" : ""}`} />;
}

/** A labelled bar that prints its value. `band` draws the uncertainty range as a lighter span (0..1 coordinates). */
export function Meter({ label, value, display, lead, band }:
  { label: string; value: number; display: string; lead?: boolean; band?: [number, number] }) {
  const pct = Math.max(0.02, Math.min(1, value)) * 100;
  return (
    <div className={`o-meter ${lead ? "o-meter--lead" : ""}`}>
      <span className="o-meter__label">{label}</span>
      <span className="o-meter__value">{display}</span>
      <span className="o-meter__track" role="img" aria-label={`${label}: ${display}`}>
        {band && <span className="o-meter__band" style={{ left: `${band[0] * 100}%`, width: `${Math.max(0, band[1] - band[0]) * 100}%` }} />}
        <span className="o-meter__fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

export function Disclosure({ n, title, hint, open, children }: { n?: string; title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="o-disclosure" open={open}>
      <summary>
        {n && <span className="o-disclosure__n">{n}</span>}
        <span>{title}</span>
        {hint && <span className="o-disclosure__hint">{hint}</span>}
        <span className="o-disclosure__plus" aria-hidden style={hint ? undefined : { marginLeft: "auto" }} />
      </summary>
      <div className="o-disclosure__body">{children}</div>
    </details>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return <div className="o-stat"><span className="o-stat__v">{value}</span><span className="o-stat__l">{label}</span></div>;
}

export function Notice({ tone, icon, children }: { tone?: "warning" | "danger" | "blue"; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`o-notice ${tone ? `o-notice--${tone}` : ""}`} role={tone === "danger" ? "alert" : "status"}>
      {icon && <Icon name={icon} size={18} style={{ flex: "none", marginTop: 1 }} />}
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="o-field">
      <span className="o-field__label">{label}</span>
      {hint && <span className="o-field__hint">{hint}</span>}
      {children}
      {error && <span className="o-field__error">{error}</span>}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="o-kbd">{children}</kbd>;
}

export function Skeleton({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="o-skel" style={{ display: "block", width: w, height: h, borderRadius: r }} aria-hidden />;
}

/** The faint 12-column grid drawn behind a section. */
export function GridLines() {
  return <div className="grid-lines" aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>;
}
