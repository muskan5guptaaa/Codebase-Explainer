import { useEffect, useRef, useState } from "react";

/** Small dropdown menu: closes on outside click, Escape, or choosing an item. */
export default function Menu({ label, ariaLabel, buttonClassName, children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !root.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, hint }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
      <span className="text-slate-900">{children}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </button>
  );
}
