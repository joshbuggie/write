import type React from "react";

type SettingsGroupProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
};

/** A titled block of related fields in Settings, separated from the previous one by a hairline. */
export function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h4 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h4>
      {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-3 flex flex-col gap-3.5">{children}</div>
    </div>
  );
}
