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
  let className = "inline-flex items-center justify-center font-bold uppercase tracking-widest border-[3px] border-black transition-all active:translate-y-[2px] active:translate-x-[2px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 text-sm";
  
  if (variant === "secondary") {
    className += active
      ? " bg-black text-[#FFEA00] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      : " bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100";
  } else if (variant === "start") {
    className += active
      ? " bg-[#00E676] text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      : " bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-[#00E676]";
  } else if (variant === "stop") {
    className += active
      ? " bg-[#FF1744] text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      : " bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FF1744] hover:text-white";
  } else {
    className += " bg-[#FFEA00] text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFD600]";
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {busy ? "WORKING..." : label}
    </button>
  );
}
