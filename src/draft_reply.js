// n8n Code node: "Draft reply (needs approval)" (mode: Run Once for All Items)
// Writes a short template reply per category. NOTHING IS SENT HERE.
// status = pending_approval: a human must change it to "approved" in the log sheet (optionally editing
// final_reply first). Only then does the "Send approved replies" branch send it.
// Spam gets no draft and status = ignored_spam. Swap this node for an AI Agent / OpenAI node if you
// prefer AI drafts; keep the same output fields so the approval step still applies.

// ===== EDIT ME =====
const SIGNATURE = '\n\nBest,\nThe YourCompany team';
const LINKS = { booking: 'https://cal.com/yourcompany/intro', status: 'https://status.yourcompany.example' };
// ===================

function firstName(m) {
  const n = (m.from_name || '').trim().split(/\s+/)[0];
  return n && /^[\p{L}'-]{2,}$/u.test(n) ? n : 'there';
}
const T = {
  lead: m => `Hi ${firstName(m)},\n\nThanks for reaching out about "${m.subject}". ${m.owner.replace(/^.*\((.*)\)$/, '$1')} will look after you personally.\n\nTo give you an accurate answer, could you share (1) what you want to achieve, (2) your timeline and (3) a rough budget range? If it is easier to talk, pick a 15-minute slot here: ${LINKS.booking}`,
  support: m => `Hi ${firstName(m)},\n\nThanks for letting us know. We have logged your message ("${m.subject}") and ${m.owner.replace(/^.*\((.*)\)$/, '$1')} is looking into it.\n\nIf you can, reply with a screenshot, the time it happened and any error text, so we can reproduce it faster. Live status: ${LINKS.status}`,
  billing: m => `Hi ${firstName(m)},\n\nThanks for your message about "${m.subject}". Our billing team has it and will check your account.\n\nPlease reply with the invoice number or the last 4 digits of the card used, never the full card number.`,
  needs_triage: m => `Hi ${firstName(m)},\n\nThanks for your email ("${m.subject}"). We have received it and the right person will get back to you shortly.`,
};

const nowIso = new Date().toISOString();
return $input.all().map(({ json: m }) => {
  const isSpam = m.category === 'spam';
  const draft = isSpam ? '' : T[m.category](m) + SIGNATURE;
  return { json: {
    msg_key: m.msg_key, received_at: m.received_at, mailbox: m.mailbox, provider: m.provider,
    source_id: m.source_id, thread_id: m.thread_id, from_email: m.from_email, from_name: m.from_name, reply_to: m.reply_to,
    subject: m.subject, snippet: m.snippet, category: m.category, confidence: m.confidence, matched_rules: m.matched_rules,
    owner: m.owner, owner_email: m.owner_email, priority: m.priority,
    draft_reply: draft, final_reply: '',
    status: isSpam ? 'ignored_spam' : 'pending_approval',
    approved_by: '', sent_at: '', logged_at: nowIso,
  } };
});
