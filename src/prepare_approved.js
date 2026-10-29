// n8n Code node: "Pick approved, unsent replies" (mode: Run Once for All Items)
// Input: rows read from the log sheet. Only rows a human set to status "approved" pass, and only once
// (rows with sent_at are skipped). final_reply wins over draft_reply when the approver edited it.
const out = [];
for (const { json: r } of $input.all()) {
  if (String(r.status || '').trim().toLowerCase() !== 'approved') continue;
  if (String(r.sent_at || '').trim()) continue;
  const body = String(r.final_reply || '').trim() || String(r.draft_reply || '').trim();
  const to = String(r.reply_to || r.from_email || '').trim();
  if (!body || !/@/.test(to)) continue;
  const subject = /^re:/i.test(r.subject || '') ? r.subject : 'Re: ' + (r.subject || '');
  out.push({ json: { msg_key: r.msg_key, provider: String(r.provider || 'imap').toLowerCase(), mailbox: r.mailbox,
    source_id: r.source_id, to, subject, body } });
}
return out;
