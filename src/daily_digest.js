// n8n Code node: "Build daily digest" (mode: Run Once for All Items)
// Input: all rows of the log sheet. Output: one item with a Slack-ready text covering the last 24 hours,
// plus every reply still waiting for approval (whatever its age), oldest first.
const now = $input.first().json.__now ? new Date($input.first().json.__now) : new Date(); // __now: tests only
const since = now.getTime() - 24 * 3600 * 1000;
const rows = $input.all().map(i => i.json).filter(r => r.msg_key);
const recent = rows.filter(r => new Date(r.received_at).getTime() >= since);
const byCat = {}; const byOwner = {};
for (const r of recent) {
  byCat[r.category] = (byCat[r.category] || 0) + 1;
  if (r.category !== 'spam') byOwner[r.owner] = (byOwner[r.owner] || 0) + 1;
}
const pending = rows.filter(r => String(r.status).toLowerCase() === 'pending_approval')
  .sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
const age = r => { const m = Math.round((now - new Date(r.received_at)) / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const sentToday = rows.filter(r => r.sent_at && new Date(r.sent_at).getTime() >= since).length;
const lines = [
  `*Inbox digest, last 24h* (${now.toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
  `Received: ${recent.length}  |  lead ${byCat.lead || 0} · support ${byCat.support || 0} · billing ${byCat.billing || 0} · triage ${byCat.needs_triage || 0} · spam ${byCat.spam || 0}`,
  `Replies sent after approval: ${sentToday}`,
  `By owner: ${Object.entries(byOwner).map(([o, n]) => `${o} ${n}`).join(', ') || 'none'}`,
  pending.length ? `*Waiting for approval: ${pending.length}* (oldest first)` : 'Nothing waiting for approval.',
  ...pending.slice(0, 10).map(r => `• [${r.category}${r.priority === 'high' ? ', HIGH' : ''}] ${r.subject} — ${r.from_email} — ${r.owner} — waiting ${age(r)}`),
];
if (pending.length > 10) lines.push(`…and ${pending.length - 10} more in the sheet.`);
return [{ json: { text: lines.join('\n'), received: recent.length, by_category: byCat, by_owner: byOwner, pending: pending.length, sent: sentToday } }];
