import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

// Bottom sheet on the native <dialog> element: focus trap, Esc to close and a labelled modal without a
// dialog library, which keeps the customer bundle inside its budget (TR-FE-05, TR-A11Y-01). It slides up from the
// bottom edge (a centred card on wide screens); `leaving` plays the slide away while the parent unmounts it.
export function Sheet({ title, onClose, leaving, children }: { title: string; onClose: () => void; leaving?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // Focus starts on the sheet itself (announced by its title), not on the close button.
      d.focus();
    }
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      tabIndex={-1}
      data-leaving={leaving || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!leaving) onClose();
      }}
      onClick={(e) => {
        // A tap on the backdrop (outside the panel) closes the sheet.
        if (e.target === e.currentTarget && !leaving) onClose();
      }}
      className="sheet m-0 outline-none mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[1.75rem] bg-surface p-0 text-ink shadow-dialog sm:mx-auto sm:mb-auto sm:max-w-md sm:rounded-dialog"
    >
      <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <span aria-hidden="true" className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="sheet-title" className="font-display text-xl font-bold tracking-tight">
            {title}
          </h2>
          <button className="-me-2 grid min-h-12 min-w-12 place-items-center rounded-full text-muted transition-colors hover:bg-canvas hover:text-ink" aria-label="×" onClick={onClose}>
            <CloseIcon className="size-6" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
