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
  let className = "rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  if (variant === "secondary") {
    className += active
      ? " border border-slate-400 bg-slate-700 text-white"
      : " border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  } else if (variant === "start") {
    className += active
      ? " border border-emerald-400 bg-emerald-100 text-emerald-800"
      : " border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-50";
  } else if (variant === "stop") {
    className += active
      ? " border border-rose-300 bg-rose-100 text-rose-700"
      : " border border-slate-300 bg-slate-100 text-slate-400";
  } else {
    className += " bg-slate-900 text-white";
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {busy ? "Working..." : label}
    </button>
  );
}
