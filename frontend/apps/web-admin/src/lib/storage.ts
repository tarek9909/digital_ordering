/** This tab's sessionStorage, or null where it is missing or blocked. */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const session = (): SessionStore | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};
