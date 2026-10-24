const KEY = 'dop.staff.counterId';

/** The counter this device picked at sign-in; new tickets default to it. */
export function storedCounterId(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function storeCounterId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked */
  }
}
