import type { ReactNode } from "react";

type Props = {
  name: string;
  value: string;
  checked: boolean;
  onChange?: () => void;
  title: string;
  blurb?: string;
  disabled?: boolean;
  type?: "radio" | "checkbox";
  children?: ReactNode;
};

export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  blurb,
  disabled,
  type = "radio",
  children,
}: Props) {
  return (
    <label className={`radio-card${checked ? " selected" : ""}${disabled ? " disabled" : ""}`}>
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <div className="radio-card-body">
        <strong>{title}</strong>
        {blurb ? <span className="muted">{blurb}</span> : null}
        {children}
      </div>
    </label>
  );
}
