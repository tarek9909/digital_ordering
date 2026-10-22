# Personal data inventory

Required by TR-PRV-01. Review this file every release and update it in the same pull request as any schema change that adds or removes personal data.

| Data | Where | Whose | Purpose | Retention | Processor |
| --- | --- | --- | --- | --- | --- |
| Name, email, password hash, locale, optional TOTP secret (encrypted) | `users` | Tenant owners and managers | Sign-in, account emails | Until the user deletes the account, or 30 days after the tenant is deleted if it is their last membership (TR-PRV-11, TR-PRV-12) | VPS host |
| Session token hashes, IP, user agent | `user_sessions`, `platform_sessions` | Tenant and platform users | Session security | Deleted 1 day after expiry (`retention.misc`) | VPS host |
| Name, email, role, TOTP secret (encrypted) | `platform_users` | Platform staff | Console access | While employed | VPS host |
| Staff device name, user agent | `staff_devices` | Venue devices (no person) | Device list, sign-out | Until revoked; purged with the tenant | VPS host |
| Random client ID (22 chars) | `ticket_followers.client_id`, browser `localStorage` | Customers (pseudonymous) | Links a phone to its tickets | Deleted with tickets after 90 days (TR-PRV-04) | VPS host |
| Web Push endpoint and keys | `push_subscriptions` | Customers (pseudonymous) | Sending Ready alerts | 30–90 minutes after the last ticket using it closes (TR-PRV-03) | VPS host; Google, Apple, Mozilla, Microsoft push services |
| Push delivery outcome per subscription | `alert_attempts`, `alert_deliveries` | Customers (pseudonymous) | Retrying failed alerts once, delivery-health report | 7 days (`retention.misc`) | VPS host |
| Old restaurant addresses (slugs) | `tenant_slug_aliases` | Tenant (business) | Redirects for 180 days (TR-URL-03) | 180 days; deleted with the tenant | VPS host |
| Ticket note, receipt number | `tickets.note`, `tickets.external_ref` | Customers (may contain a name if staff type one) | Matching orders | 90 days (TR-PRV-04) | VPS host |
| Rating comment (R1.1) | `ratings.comment` | Customers | Venue feedback | 90 days with the ticket | VPS host |
| IP addresses | Application and Caddy logs (Docker json-file, rotated) | Everyone | Security, debugging | 14 days; security logs 1 year with IPs truncated after 14 days (TR-PRV-05) | VPS host |
| Audit entries (actor, action, before/after) | `audit_log` | Users and platform staff | Accountability | 2 years; anonymised when the tenant is deleted (TR-PRV-06) | VPS host |
| Billing email, tax ID, invoices | `tenants`, `invoices`, Stripe | Tenant (business) | Billing, VAT | Invoices kept by Stripe for tax law | Stripe |
| Account emails (address, name, link) | SMTP provider | Tenant users and platform staff | Sending account emails | As the SMTP provider's logs keep them | SMTP provider |
| Backups of all of the above (encrypted) | Off-site backup storage | Everyone above | Recovery | 30 days | Backup storage provider |
| Error reports | Sentry | Everyone | Debugging | 30 days; `sendDefaultPii: false`, scrubbing on (TR-PRV-10) | Sentry |

**VPS host** is the provider running the server ([ADR 0007](../adr/0007-self-hosted-vps.md)). Record its name, the server's country and its data-processing terms here once chosen (BRD OI-04).

Customers never give their name, phone number or email (TR-PRV-02). The customer privacy notice is in `frontend/packages/i18n/locales/*/customer.json` (`privacy.body`).
