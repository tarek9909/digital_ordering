// Local storage holds only `dop.clientId` and `dop.tickets` (TR-FE-09): no secrets, closed tickets pruned after
// 24 h, at most 20. Every access is guarded: private mode and blocked storage must not break the page.

export interface StoredTicket {
  token: string;
  venueCode: string;
  addedAt: number;
  closedAt?: number;
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomId(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % 62]).join('');
}

let memoryClientId: string | null = null;

export function clientId(): string {
  try {
    let id = localStorage.getItem('dop.clientId');
    if (!id || !/^[0-9A-Za-z]{22}$/.test(id)) {
      id = randomId();
      localStorage.setItem('dop.clientId', id);
    }
    return id;
  } catch {
    memoryClientId ??= randomId();
    return memoryClientId;
  }
}

const DAY_MS = 24 * 3600_000;

/**
 * Closed tickets go 24 h after this phone saw them closed. A ticket never seen closed is still closed by the
 * nightly auto-close (TR-ALG-10) within a business day, so an entry older than 48 h has been closed for over 24 h.
 */
function keep(t: StoredTicket, now: number): boolean {
  if (t.closedAt) return now - t.closedAt < DAY_MS;
  return now - t.addedAt < 2 * DAY_MS;
}

export function storedTickets(): StoredTicket[] {
  try {
    const raw = JSON.parse(localStorage.getItem('dop.tickets') ?? '[]') as StoredTicket[];
    const now = Date.now();
    return raw.filter((t) => keep(t, now)).slice(-20);
  } catch {
    return [];
  }
}

function save(list: StoredTicket[]) {
  try {
    localStorage.setItem('dop.tickets', JSON.stringify(list.slice(-20)));
  } catch {
    /* storage blocked: the page still works for this visit */
  }
}

export function rememberTicket(token: string, venueCode: string) {
  const list = storedTickets().filter((t) => t.token !== token);
  list.push({ token, venueCode, addedAt: Date.now() });
  save(list);
}

export function markClosed(token: string) {
  save(storedTickets().map((t) => (t.token === token && !t.closedAt ? { ...t, closedAt: Date.now() } : t)));
}

/** Drops a ticket the server no longer knows (404), so it cannot linger in the list. */
export function forgetTicket(token: string) {
  save(storedTickets().filter((t) => t.token !== token));
}

/** When this phone first saw the ticket closed, if it did. */
export function closedAtOf(token: string): number | undefined {
  return storedTickets().find((t) => t.token === token)?.closedAt;
}
