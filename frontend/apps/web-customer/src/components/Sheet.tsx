import { useEffect, useRef, type ReactNode } from 'react';

// Bottom sheet on the native <dialog> element: focus trap, Esc to close and a labelled modal without a
// dialog library, which keeps the customer bundle inside its budget (TR-FE-05, TR-A11Y-01).
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-surface p-5 text-ink backdrop:bg-black/50 sm:mx-auto sm:mb-auto sm:max-w-lg sm:rounded-2xl"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="sheet-title" className="text-xl font-bold">
          {title}
        </h2>
        <button className="min-h-12 min-w-12 rounded-md text-2xl" aria-label="×" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
