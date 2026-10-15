import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export function RowActionMenu({
  items,
}: {
  items: { id: string; label: string; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 260,
    maxHeight: 280,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(260, window.innerWidth - margin * 2);
    const below = window.innerHeight - anchor.bottom - margin * 2;
    const above = anchor.top - margin * 2;
    const upward = menu.current.scrollHeight > below && above > below;
    const maxHeight = Math.max(0, upward ? above : below);
    const height = Math.min(menu.current.scrollHeight, maxHeight);
    setPosition({
      width,
      left: Math.max(
        margin,
        Math.min(anchor.right - width, window.innerWidth - width - margin),
      ),
      top: upward ? anchor.top - margin - height : anchor.bottom + margin,
      maxHeight,
    });
    menu.current
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target))
        close();
    }
    function scroll(event: Event) {
      if (!menu.current?.contains(event.target as Node)) close();
    }
    const resize = () => close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label="Resource actions"
            className="row-action-popover"
            style={position}
            onKeyDown={(event) => {
              const buttons = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>("button") ||
                  [],
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (event.key === "Escape") {
                event.preventDefault();
                close(true);
              } else if (event.key === "Tab") close(true);
              else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
