import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function Modal({
   title,
   children,
   onClose,
   className = "",
}: {
   title: string;
   children: ReactNode;
   onClose?: () => void;
   className?: string;
}) {
   const ref = useRef<HTMLDivElement>(null);
   const close = useRef(onClose);
   close.current = onClose;
   useEffect(() => {
      const previous = document.activeElement as HTMLElement | null;
      const oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const focusables = () => [
         ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'
         ) ?? []),
      ];
      (focusables()[0] ?? ref.current)?.focus();
      const keyboard = (event: KeyboardEvent) => {
         if (event.key === "Escape" && close.current) {
            event.preventDefault();
            close.current();
         }
         if (event.key !== "Tab") return;
         const items = focusables();
         const first = items[0];
         const last = items[items.length - 1];
         if (!first) {
            event.preventDefault();
            return;
         }
         if (
            event.shiftKey &&
            (document.activeElement === first ||
               document.activeElement === ref.current)
         ) {
            event.preventDefault();
            last.focus();
         } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
         }
      };
      document.addEventListener("keydown", keyboard);
      return () => {
         document.body.style.overflow = oldOverflow;
         document.removeEventListener("keydown", keyboard);
         previous?.focus();
      };
   }, []);
   return createPortal(
      <div
         className={`modal-backdrop ${className}`.trim()}
         onClick={(e) => {
            if (e.target === e.currentTarget) close.current?.();
         }}
      >
         <div
            ref={ref}
            className="modal-body"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabIndex={-1}
         >
            <h2 id="modal-title">{title}</h2>
            {children}
         </div>
      </div>,
      document.body
   );
}
