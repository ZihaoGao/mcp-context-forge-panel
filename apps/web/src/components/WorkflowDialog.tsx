import { useEffect, useId, useRef, type ReactNode } from "react";

/** Temporary workflows keep their context in place and cannot be dismissed mid-write. */
export function WorkflowDialog({
  title,
  onClose,
  busy = false,
  en = false,
  children,
  footer,
  className = "",
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  en?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`action-dialog workflow-dialog ${className}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="button secondary"
          aria-label={closeLabel}
          disabled={busy}
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          {en ? "Close" : "关闭"}
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}
