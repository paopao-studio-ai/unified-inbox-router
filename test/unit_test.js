// Runs the Code-node sources with mocked n8n globals against SAMPLE data. Usage: node test/unit_test.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const node = (file, items) => {
  const wrapped = items.map(json => ({ json }));
  const $input = { all: () => wrapped, first: () => wrapped[0] };
  return new Function('$input', load(file))($input).map(i => i.json);
};
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample_emails.SAMPLE.json'), 'utf8')).items;

const norm = node('normalize.js', sample);
assert.strictEqual(norm.length, 6);
assert.deepStrictEqual(norm.map(m => m.from_email), ['maria.lopez@sample-dental.example', 'tom.reed@sample-mail.example',
  'billing-questions@sample-shop.example', 'outreach@sample-seo.example', 'pat@bigclient.example', 'ops@sample-agency.example']);
assert.ok(!/old quoted text/.test(norm[0].body), 'quoted history stripped');
assert.ok(/charged twice/.test(norm[2].body) && !/<b>/.test(norm[2].body), 'html stripped');
assert.strictEqual(norm[1].source_id, '<sample-1042@sample-mail.example>');
assert.strictEqual(new Set(norm.map(m => m.msg_key)).size, 6, 'unique keys');
assert.deepStrictEqual(node('normalize.js', sample).map(m => m.msg_key), norm.map(m => m.msg_key), 'keys stable across runs');

const cls = node('classify_route.js', norm);
const cats = cls.map(m => m.category);
assert.deepStrictEqual(cats, ['lead', 'support', 'billing', 'spam', 'needs_triage', 'support']);
assert.strictEqual(cls[0].owner, 'Sales (Ana)'); assert.strictEqual(cls[0].priority, 'high'); // budget mentioned
assert.strictEqual(cls[2].owner, 'Billing (Di)');
assert.strictEqual(cls[4].owner, 'Account manager (Eve)'); // key-account domain override
assert.strictEqual(cls[5].priority, 'high'); // "URGENT"
assert.ok(cls.every(m => m.matched_rules !== undefined));

const drafts = node('draft_reply.js', cls);
assert.ok(drafts.filter(d => d.category !== 'spam').every(d => d.status === 'pending_approval' && d.draft_reply.length > 40));
const spam = drafts.find(d => d.category === 'spam');
assert.strictEqual(spam.status, 'ignored_spam'); assert.strictEqual(spam.draft_reply, '');
assert.ok(drafts.every(d => d.status !== 'approved' && d.status !== 'sent'), 'workflow never approves or sends by itself');
assert.match(drafts[0].draft_reply, /^Hi Maria,/);

// Nothing goes out until a human sets status=approved; already-sent rows are never resent.
assert.deepStrictEqual(node('prepare_approved.js', drafts), []);
const rows = drafts.map(d => ({ ...d }));
rows[0].status = 'Approved'; rows[0].final_reply = 'Hi Maria, edited by a human.';
rows[1].status = 'approved';
rows[2].status = 'approved'; rows[2].sent_at = '2026-10-29T19:00:00Z';
const toSend = node('prepare_approved.js', rows);
assert.strictEqual(toSend.length, 2);
assert.strictEqual(toSend[0].body, 'Hi Maria, edited by a human.'); assert.strictEqual(toSend[0].provider, 'gmail');
assert.strictEqual(toSend[1].subject, 'Re: Order #1042 - tracking not working'); assert.strictEqual(toSend[1].provider, 'imap');

rows[2].status = 'sent';
const digestIn = rows.map((r, i) => (i === 0 ? { ...r, __now: '2026-10-30T08:00:00Z' } : r));
const dg = node('daily_digest.js', digestIn)[0];
assert.strictEqual(dg.received, 6); assert.strictEqual(dg.pending, 2); assert.strictEqual(dg.by_category.spam, 1);
assert.match(dg.text, /Waiting for approval: 2/);

fs.writeFileSync(path.join(__dirname, 'sample_output.SAMPLE.json'), JSON.stringify({ _note: 'SAMPLE output from SAMPLE input. Not a client result.', log_rows: drafts, digest: dg }, null, 2));
console.log('OK: normalize 6 shapes, classify', cats.join('/'), '| approval gate holds | digest:', dg.text.split('\n')[1]);
