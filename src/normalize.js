// n8n Code node: "Normalize message" (mode: Run Once for All Items)
// Accepts items from Gmail Trigger (simple on/off), IMAP Email Trigger (simple or resolved format)
// and Microsoft Outlook Trigger (simplified or raw). Each trigger is followed by a "Tag mailbox" Set node
// that adds _mailbox (a label like "sales@gmail") and _provider (gmail | imap | outlook).
// Output: one flat item per message with the same field names, whatever mailbox it came from.

function parseAddress(v) {
  if (!v) return { email: '', name: '' };
  if (Array.isArray(v)) return parseAddress(v[0]);
  if (typeof v === 'object') {
    if (Array.isArray(v.value) && v.value.length) return { email: (v.value[0].address || '').toLowerCase(), name: v.value[0].name || '' };
    if (v.emailAddress) return { email: (v.emailAddress.address || '').toLowerCase(), name: v.emailAddress.name || '' };
    if (v.address) return { email: String(v.address).toLowerCase(), name: v.name || '' };
    if (v.text) return parseAddress(v.text);
    return { email: '', name: '' };
  }
  const s = String(v).trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() };
  const e = s.match(/[^\s<>"']+@[^\s<>"']+/);
  return { email: e ? e[0].toLowerCase() : '', name: '' };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

// Drop quoted history so the classifier only sees what the sender actually wrote now.
function stripQuoted(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .{3,120} wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From: .+/i.test(line) && out.length > 2) break;
    out.push(line);
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function hashKey(s) { // short stable id (FNV-1a) so the same message never gets two log rows
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const out = [];
for (const item of $input.all()) {
  const j = item.json || {};
  const provider = String(j._provider || '').toLowerCase() || (j.threadId ? 'gmail' : j.conversationId ? 'outlook' : 'imap');
  const mailbox = j._mailbox || provider;
  const from = parseAddress(j.from ?? j.From ?? j.sender);
  const subject = String(j.subject ?? j.Subject ?? '').trim();
  let body = j.text || j.textPlain || '';
  if (!body && (j.html || j.textHtml)) body = stripHtml(j.html || j.textHtml);
  if (!body && j.body && typeof j.body === 'object') body = j.body.contentType === 'html' ? stripHtml(j.body.content) : (j.body.content || '');
  if (!body) body = j.snippet || j.bodyPreview || '';
  body = stripQuoted(body).slice(0, 4000);
  const receivedRaw = j.date || j.Date || j.receivedDateTime || j.internalDate || '';
  let received = new Date(/^\d{12,}$/.test(String(receivedRaw)) ? Number(receivedRaw) : receivedRaw);
  if (isNaN(received)) received = new Date();
  const sourceId = String(j.id || j.messageId || (j.metadata && j.metadata['message-id']) || (j.attributes && j.attributes.uid) || '');
  const threadId = String(j.threadId || j.conversationId || (j.metadata && (j.metadata['in-reply-to'] || j.metadata['references'])) || '');
  const replyTo = parseAddress(j.replyTo || j['reply-to'] || (j.metadata && j.metadata['reply-to']));
  out.push({ json: {
    msg_key: provider + '-' + hashKey(mailbox + '|' + (sourceId || from.email + subject + received.toISOString())),
    received_at: received.toISOString(),
    mailbox, provider,
    source_id: sourceId,
    thread_id: threadId,
    from_email: from.email,
    from_name: from.name,
    reply_to: replyTo.email || from.email,
    subject: subject || '(no subject)',
    body,
    snippet: body.replace(/\s+/g, ' ').slice(0, 200),
  } });
}
return out;
