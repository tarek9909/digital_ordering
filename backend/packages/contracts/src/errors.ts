// Error catalogue (TRD appendix 30.1). Every typed error that reaches HTTP maps to one of these.

export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, title: 'Request failed validation' },
  UNAUTHENTICATED: { status: 401, title: 'Sign-in required' },
  MFA_REQUIRED: { status: 401, title: 'Second factor needed' },
  CSRF_FAILED: { status: 403, title: 'Missing or wrong CSRF token' },
  FORBIDDEN: { status: 403, title: 'Not allowed' },
  TENANT_SUSPENDED: { status: 403, title: 'Account suspended' },
  TENANT_INACTIVE: { status: 403, title: 'Subscription required' },
  TRIAL_DAILY_LIMIT: { status: 403, title: 'Trial ticket limit reached for today' },
  PLAN_LIMIT: { status: 403, title: 'Plan limit reached' },
  FEATURE_NOT_IN_PLAN: { status: 403, title: 'Feature not in plan' },
  EMAIL_NOT_VERIFIED: { status: 403, title: 'Email must be verified first' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  INVITATION_EXPIRED: { status: 410, title: 'Invitation used, revoked or expired' },
  PAIRING_CODE_INVALID: { status: 422, title: 'Pairing code wrong or expired' },
  SUPPORT_CODE_INVALID: { status: 422, title: 'Support code wrong or expired' },
  UPLOAD_INVALID: { status: 422, title: 'File type, size or dimensions not allowed' },
  CLAIM_INVALID: { status: 422, title: 'Number or claim code wrong' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, title: 'Idempotency key reused with a different body' },
  EXTERNAL_REF_IN_USE: { status: 409, title: 'Receipt number already used by an open ticket' },
  PLAN_DOWNGRADE_BLOCKED: { status: 409, title: 'Usage exceeds the target plan' },
  TICKET_VERSION_CONFLICT: { status: 409, title: 'Ticket was changed by another device' },
  INVALID_TRANSITION: { status: 409, title: 'Status change not allowed' },
  CHECK_CODE_REQUIRED: { status: 409, title: 'Check code required' },
  CHECK_CODE_INVALID: { status: 409, title: 'Check code wrong' },
  REOPEN_WINDOW_PASSED: { status: 409, title: 'Over 30 minutes since collection' },
  NUMBERS_EXHAUSTED: { status: 409, title: 'No free number in range' },
  SLUG_TAKEN: { status: 409, title: 'Address already taken' },
  SLUG_RESERVED: { status: 409, title: 'Address not available' },
  EMAIL_TAKEN: { status: 409, title: 'Email already registered' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: 'Same key still processing' },
  PIN_LOCKED: { status: 423, title: 'Too many wrong PINs' },
  ACCOUNT_LOCKED: { status: 423, title: 'Too many failed sign-ins' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, title: 'Unexpected error' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
  MAINTENANCE: { status: 503, title: 'Planned maintenance' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId?: string;
  data?: unknown;
  errors?: Array<{ path: string; message: string }>;
}

/** Typed application error (TR-CODE-04). Never throw a bare Error towards the HTTP layer. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly data?: unknown;
  readonly errors?: Array<{ path: string; message: string }>;

  constructor(
    code: ErrorCode,
    detail?: string,
    extra?: { data?: unknown; errors?: Array<{ path: string; message: string }> },
  ) {
    super(detail ?? ERROR_CODES[code].title);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.data = extra?.data;
    this.errors = extra?.errors;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
