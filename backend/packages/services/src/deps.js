export const LOCAL_PORTS = { customer: 5173, staff: 5174, display: 5175, admin: 5176, console: 5177, www: 5178 };
export function urls(c) {
    const base = (host, app) => {
        const port = c.localPorts?.[app];
        return `${c.scheme}://${host}${port ? `:${port}` : ''}`;
    };
    return {
        ticket: (token) => `${base(`t.${c.domain}`, 'customer')}/${token}`,
        venue: (venueCode) => `${base(`t.${c.domain}`, 'customer')}/v/${venueCode}`,
        staff: (slug, staffKey) => `${base(`${slug}.${c.domain}`, 'staff')}/staff/${staffKey}`,
        admin: (slug, path = '') => `${base(`${slug}.${c.domain}`, 'admin')}/admin${path}`,
        www: (path = '') => `${base(`www.${c.domain}`, 'www')}${path}`,
        console: (path = '') => `${base(`admin.${c.domain}`, 'console')}${path}`,
        logo: (key) => (key ? `${c.cdnBaseUrl}/${key}` : null),
    };
}
