import { hashSecret, checkPassword } from '@dop/auth';
import { createDb } from '@dop/db';
import { uuidv7 } from '@dop/domain';
// Creates the first super admin (or resets a lost password) on a fresh server:
//   docker compose run --rm -e SERVICE_ROLE=create-admin -e ADMIN_EMAIL=you@x.com -e ADMIN_NAME="You" \
//     -e ADMIN_PASSWORD='…' api
// Two-factor sign-in is enrolled at the first console sign-in (mandatory for platform users, FR-SA-02).
const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim() || 'Super Admin';
const password = process.env.ADMIN_PASSWORD ?? '';
if (!url || !email || !password) {
    console.error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD are required');
    process.exit(1);
}
const problem = checkPassword(password, [email]);
if (problem) {
    console.error(`password rejected: ${problem} (10–128 characters, not a common password)`);
    process.exit(1);
}
const db = createDb(url);
const pdb = db.platform();
const existing = await pdb.selectFrom('platform_users').select('id').where('email', '=', email).executeTakeFirst();
const hash = await hashSecret(password);
if (existing) {
    await pdb.updateTable('platform_users').set({ password_hash: hash, status: 'active', role: 'super_admin' }).where('id', '=', existing.id).execute();
    console.log(`updated ${email} (super_admin)`);
}
else {
    await pdb.insertInto('platform_users').values({ id: uuidv7(), email, name, role: 'super_admin', status: 'active', password_hash: hash }).execute();
    console.log(`created ${email} (super_admin); sign in at https://admin.<domain> and set up your authenticator app`);
}
await db.destroy();
