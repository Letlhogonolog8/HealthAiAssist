/**
 * Generates the secrets this application makes for itself.
 *
 *   npm run secrets              print a fresh set with guidance
 *   npm run secrets -- --railway print them as `railway variables set` commands
 *   npm run secrets -- --rotate  print an ENCRYPTION_KEYS line that ADDS a key
 *
 * Three of the required values are not obtained from anyone — they are random
 * bytes, and the only thing that matters is that they come from a CSPRNG and are
 * never reused between environments. Everything else in .env.example comes from
 * a third party and is listed at the end with where to get it.
 *
 * This never writes to .env. A generator that edits the file in place is one
 * mis-run away from replacing a live SESSION_SECRET (logging every user out) or
 * a live ENCRYPTION_KEY (making every encrypted row permanently unreadable).
 * Printing and letting a human place the value is the safer default for
 * something this destructive to get wrong.
 */
import { randomBytes } from 'crypto';

const args = new Set(process.argv.slice(2));
const railway = args.has('--railway');
const rotate = args.has('--rotate');

/** SESSION_SECRET: 64 bytes. The app refuses anything under 64 characters. */
const sessionSecret = () => randomBytes(64).toString('hex');

/** An encryption key: exactly 32 bytes, which is what AES-256 takes. */
const encryptionKey = () => randomBytes(32).toString('hex');

const rule = (label: string) => {
  console.log('');
  console.log(`── ${label} ${'─'.repeat(Math.max(0, 72 - label.length))}`);
};

function printRotation(): void {
  const next = encryptionKey();

  rule('Adding a key to an existing keyring');
  console.log('');
  console.log('  New key material:');
  console.log(`    ${next}`);
  console.log('');
  console.log('  Take your CURRENT ENCRYPTION_KEYS value and append this key under a new');
  console.log('  id, keeping every existing key in place:');
  console.log('');
  console.log('    ENCRYPTION_KEYS=k1:<existing>,k2:' + next);
  console.log('    ENCRYPTION_ACTIVE_KEY_ID=k2');
  console.log('');
  console.log('  Then, in order:');
  console.log('    1. Deploy. New writes use k2; existing rows still decrypt under k1.');
  console.log('    2. npm run crypto:rotate    re-encrypt existing rows');
  console.log('    3. npm run crypto:status    confirm nothing remains on k1');
  console.log('    4. Remove k1 from ENCRYPTION_KEYS and redeploy.');
  console.log('');
  console.log('  Step 4 is the only irreversible one. Removing a key while rows still');
  console.log('  reference it makes those rows permanently unreadable, which is why');
  console.log('  step 3 is a check and not a wait.');
}

function printFresh(): void {
  const session = sessionSecret();
  const key = encryptionKey();

  const values: Array<[string, string, string]> = [
    ['SESSION_SECRET', session, 'Signs session cookies. Production will not start without it.'],
    ['ENCRYPTION_KEYS', `k1:${key}`, 'At-rest encryption. The "k1:" prefix is the key id and is required.'],
    ['ENCRYPTION_ACTIVE_KEY_ID', 'k1', 'Which key encrypts new data. All listed keys can decrypt.'],
  ];

  if (railway) {
    rule('Railway');
    console.log('');
    for (const [name, value] of values) {
      console.log(`railway variables set ${name}="${value}"`);
    }
    console.log('');
    console.log('# Also required in production, but not secrets:');
    console.log('railway variables set NODE_ENV="production"');
    console.log('railway variables set HTTPS_ONLY="true"');
    console.log('railway variables set PUBLIC_APP_URL="https://your-app.up.railway.app"');
    return;
  }

  rule('Generated secrets');
  console.log('');
  for (const [name, value, note] of values) {
    console.log(`  ${name}`);
    console.log(`    ${value}`);
    console.log(`    ${note}`);
    console.log('');
  }

  rule('Where to put them');
  console.log('');
  console.log('  Local development:  paste into .env (which is gitignored).');
  console.log('  Railway:            Variables tab, or `npm run secrets -- --railway`.');
  console.log('');
  console.log('  Use DIFFERENT values in development and production. A development');
  console.log('  secret ends up in shell history, screenshots and terminal scrollback;');
  console.log('  sharing one with production makes all of that production-sensitive.');

  rule('Before you replace an existing value');
  console.log('');
  console.log('  SESSION_SECRET   Replacing it invalidates every session. Everyone is');
  console.log('                   logged out. Recoverable, but do it deliberately.');
  console.log('');
  console.log('  ENCRYPTION_KEYS  Replacing a key rather than ADDING one makes every');
  console.log('                   encrypted row permanently unreadable. There is no');
  console.log('                   recovery. To change keys safely:');
  console.log('                     npm run secrets -- --rotate');

  rule('What this cannot generate');
  console.log('');
  const external: Array<[string, string]> = [
    ['DATABASE_URL', 'Supabase → Settings → Database → Connection string (URI)'],
    ['SENDGRID_API_KEY', 'sendgrid.com → Settings → API Keys → Create (Restricted, Mail Send only)'],
    ['NOTIFICATION_FROM_EMAIL', 'An address you have verified in SendGrid → Sender Authentication'],
    ['TWILIO_ACCOUNT_SID', 'console.twilio.com → Account Info'],
    ['TWILIO_AUTH_TOKEN', 'console.twilio.com → Account Info (rotate if it has ever been shared)'],
    ['TWILIO_SMS_NUMBER', 'A Twilio number with SMS enabled, in E.164 form (+27...)'],
    ['OPENAI_API_KEY', 'platform.openai.com → API keys'],
    ['GOOGLE_CLOUD_SCAN_BUCKET', 'A private GCS bucket; the service account needs objectAdmin on it'],
  ];
  for (const [name, where] of external) {
    console.log(`  ${name.padEnd(26)} ${where}`);
  }
  console.log('');
  console.log('  Every one of these is optional except DATABASE_URL. The application');
  console.log('  reports unconfigured integrations on /api/ready rather than pretending');
  console.log('  they work.');
}

if (rotate) printRotation();
else printFresh();
console.log('');
