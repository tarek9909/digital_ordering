// Pure helpers between forms and API bodies (TR-FE-21). Kept free of React so they are unit-tested.

export interface MappedFieldErrors<F extends string> {
  fields: Array<[F, string]>;
  /** Server errors whose path is not a field on this form. */
  rest: string[];
}

/** Splits `ApiError.fieldErrors()` into errors for known form fields and the rest. */
export function mapFieldErrors<F extends string>(errors: Record<string, string>, known: readonly F[]): MappedFieldErrors<F> {
  const out: MappedFieldErrors<F> = { fields: [], rest: [] };
  for (const [path, message] of Object.entries(errors)) {
    const root = path.split('.')[0] ?? path;
    const hit = known.find((k) => k === path || k === root);
    if (hit) out.fields.push([hit, message]);
    else out.rest.push(`${path}: ${message}`);
  }
  return out;
}

/** Restaurant name handed over from the landing preview (`?name=`), for the contact page. */
export function prefillName(search = typeof window === 'undefined' ? '' : window.location.search): string {
  return (new URLSearchParams(search).get('name') ?? '').trim().slice(0, 120);
}
