import { useState } from 'react';

/** Cursor paging with a back stack: the API only gives `nextCursor`. */
export function useCursorPager() {
  const [stack, setStack] = useState<string[]>([]);
  return {
    cursor: stack[stack.length - 1],
    page: stack.length + 1,
    canPrev: stack.length > 0,
    next: (c: string) => setStack((s) => [...s, c]),
    prev: () => setStack((s) => s.slice(0, -1)),
    reset: () => setStack([]),
  };
}
