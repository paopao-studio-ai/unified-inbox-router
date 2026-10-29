// n8n Code node: "Classify & assign owner" (mode: Run Once for All Items)
// Keyword classifier: lead / support / billing / spam, plus "needs_triage" when nothing matches.
// It is deliberately simple and explainable: every decision lists the rules that fired (matched_rules).
// To use an LLM instead, put n8n's "Text Classifier" (AI) node here; keep the output field names.

// ===== EDIT ME: who owns what =====
const OWNERS = {
  lead:         [{ name: 'Sales (Ana)', email: 'ana@yourcompany.example' }],
  support:      [{ name: 'Support (Ben)', email: 'ben@yourcompany.example' }, { name: 'Support (Cy)', email: 'cy@yourcompany.example' }],
  billing:      [{ name: 'Billing (Di)', email: 'di@yourcompany.example' }],
  needs_triage: [{ name: 'Office manager', email: 'office@yourcompany.example' }],
  spam:         [{ name: '(nobody)', email: '' }],
};
// Sender domains that always go to a named owner (key accounts), whatever the category.
const DOMAIN_OWNERS = { 'bigclient.example': { name: 'Account manager (Eve)', email: 'eve@yourcompany.example' } };
// Senders that are never spam (your own domain, key suppliers).
const ALLOWLIST_DOMAINS = ['yourcompany.example'];
// ===================================

const RULES = {
  spam: [
    [/\b(guest post|backlinks?|seo (services|package|audit) for your|rank (you|your site) on (the )?first page)\b/i, 3],
    [/\b(crypto|bitcoin|forex|investment opportunity|lottery|you have won|inheritance)\b/i, 3],
    [/\b(web ?design|app development|lead generation) (services|agency) (for|to) (you|your)/i, 2],
    [/\bunsubscribe\b/i, 1], [/\b(limited time|act now|100% free|risk[- ]free)\b/i, 1],
  ],
  billing: [
    [/\b(invoice|receipt|billing|billed|charged?|charges|refund|chargeback|payment (failed|declined|issue)|credit card|subscription|renewal|vat|tax id)\b/i, 2],
    [/\b(cancel (my )?(plan|subscription|account)|double charged|overcharged|wrong amount)\b/i, 3],
  ],
  support: [
    [/\b(not working|doesn'?t work|broken|error|bug|crash(es|ed)?|can'?t (log ?in|login|access|find)|password reset|issue with|problem with|stopped working)\b/i, 2],
    [/\b(where is my order|tracking|delivery|shipped|return|exchange|damaged|missing item)\b/i, 2],
    [/\b(help|support|how do i|urgent)\b/i, 1],
  ],
  lead: [
    [/\b(quote|pricing|price list|how much|rates?|estimate|proposal|budget)\b/i, 2],
    [/\b(interested in|looking for (a|an|someone)|would like to (hire|book|order|work)|can you (build|help us|do)|book a (call|demo|meeting)|demo|consultation|partnership)\b/i, 2],
    [/\b(new project|our (company|team|business)|for (our|my) (store|clinic|agency|firm|restaurant))\b/i, 1],
  ],
};
const URGENT = /\b(urgent|asap|immediately|today|down|outage|chargeback|legal|lawyer)\b/i;

function pick(list, key) { // stable round-robin by message key: same message -> same owner, no state needed
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

return $input.all().map(({ json: m }) => {
  const domain = (m.from_email.split('@')[1] || '').toLowerCase();
  const subj = m.subject || ''; const body = m.body || '';
  const scores = {}; const fired = [];
  for (const [cat, rules] of Object.entries(RULES)) {
    scores[cat] = 0;
    for (const [re, w] of rules) {
      const inSubj = re.test(subj), inBody = re.test(body);
      if (inSubj || inBody) { scores[cat] += w * (inSubj ? 2 : 1); fired.push(cat + ':' + (re.source.match(/\(([^)|]{3,30})/) || [, re.source.slice(0, 20)])[1]); }
    }
  }
  if (ALLOWLIST_DOMAINS.includes(domain)) scores.spam = 0;
  // spam only wins when it clearly outscores real intent
  let category = 'needs_triage'; let best = 0;
  for (const cat of ['billing', 'support', 'lead']) if (scores[cat] > best) { best = scores[cat]; category = cat; }
  if (scores.spam >= 3 && scores.spam > best) { category = 'spam'; best = scores.spam; }
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const confidence = category === 'needs_triage' ? 0 : Math.round((best / total) * 100) / 100;
  const owner = DOMAIN_OWNERS[domain] && category !== 'spam' ? DOMAIN_OWNERS[domain] : pick(OWNERS[category], m.msg_key);
  const priority = category === 'spam' ? 'none' : (URGENT.test(subj + ' ' + body) || (category === 'lead' && /\bbudget\b/i.test(body))) ? 'high' : 'normal';
  return { json: { ...m, category, confidence, matched_rules: fired.join(', '), owner: owner.name, owner_email: owner.email, priority } };
});
