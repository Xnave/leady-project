"use client";

type Option<V extends string> = { value: V; label: string };

export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  size,
}: {
  label: string;
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  size?: "small";
}) {
  return (
    <div className={`persona-seg${size ? ` ${size}` : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`persona-seg-opt${o.value === value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
