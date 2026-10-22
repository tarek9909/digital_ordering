import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Password rules (TR-AUTH-04): 10–128 characters, checked against a bundled breached-password list.
// data/breached-passwords.txt holds the top-100,000 list's entries of 10+ characters (tools/fetch-breached-list.mjs,
// pinned and checksummed, committed); the build copies it to dist/data, which is `../data` from each bundle too.
// A short built-in list is always applied.
const BUILT_IN = [
    '1234567890', '12345678910', '0123456789', 'qwertyuiop', 'password123', 'password12', '1q2w3e4r5t',
    'qwerty1234', 'iloveyou12', 'abcdefghij', 'aaaaaaaaaa', '1111111111', '0000000000', 'abc1234567',
    'welcome123', 'passw0rd12', 'football12', 'princess12', 'qwerty123456', 'password1234',
];
let list = null;
function breached() {
    if (list)
        return list;
    list = new Set(BUILT_IN);
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'breached-passwords.txt');
    if (existsSync(file)) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const p = line.trim().toLowerCase();
            if (p.length >= 10)
                list.add(p);
        }
    }
    return list;
}
export function checkPassword(password, context = []) {
    if (password.length < 10)
        return 'too_short';
    if (password.length > 128)
        return 'too_long';
    const lower = password.toLowerCase();
    if (breached().has(lower))
        return 'breached';
    if (context.some((c) => c.length >= 4 && lower === c.toLowerCase()))
        return 'breached';
    return null;
}
