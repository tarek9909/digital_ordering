// Container entry: starts the bundle for SERVICE_ROLE (api | realtime | worker | migrate | create-admin).
const role = process.env.SERVICE_ROLE ?? 'api';
const allowed = ['api', 'realtime', 'worker', 'migrate', 'create-admin'];
if (!allowed.includes(role)) {
  console.error(`Unknown SERVICE_ROLE ${role}`);
  process.exit(1);
}
await import(`./dist/${role}/main.js`);
