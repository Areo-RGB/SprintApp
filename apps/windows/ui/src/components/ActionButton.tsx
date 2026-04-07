type ActionButtonProps = {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "start" | "stop";
  active?: boolean;
};

export default function ActionButton({
  label,
  onClick,
  busy,
  disabled = false,
  variant = "primary",
  active = false,
}: ActionButtonProps) {
  let className = "rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50";
  if (variant === "secondary") {
    className += active
      ? " border border-slate-700 bg-slate-700 text-white"
      : " border border-slate-300 bg-white text-slate-700";
  } else if (variant === "start") {
    className += active
      ? " border border-emerald-700 bg-emerald-600 text-white ring-2 ring-emerald-300"
      : " border border-emerald-300 bg-emerald-50 text-emerald-700";
  } else if (variant === "stop") {
    className += active
      ? " border border-rose-700 bg-rose-600 text-white ring-2 ring-rose-300"
      : " border border-slate-300 bg-white text-slate-600";
  } else {
    className += " bg-slate-900 text-white";
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {busy ? "Working..." : label}
    </button>
  );
}
