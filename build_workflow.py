"""Builds unified_inbox_router.workflow.json from src/*.js. Run: python3 build_workflow.py"""
import json, pathlib
here = pathlib.Path(__file__).parent
src = lambda n: (here / "src" / n).read_text()

SHEET_DOC = {"__rl": True, "mode": "url", "value": "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"}
SHEET_TAB = {"__rl": True, "mode": "name", "value": "inbox_log"}
SLACK_CH = lambda name: {"__rl": True, "mode": "name", "value": name}
COLS = ["msg_key", "received_at", "mailbox", "provider", "source_id", "thread_id", "from_email", "from_name", "reply_to",
        "subject", "snippet", "category", "confidence", "matched_rules", "owner", "owner_email", "priority",
        "draft_reply", "final_reply", "status", "approved_by", "sent_at", "logged_at"]
schema = lambda cols: [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
                        "type": "string", "canBeUsedToMatch": True} for c in cols]

def code(id_, name, file, pos):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": src(file)}}

def tag(id_, name, mailbox, provider, pos):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": pos,
            "parameters": {"mode": "manual", "includeOtherFields": True, "options": {}, "assignments": {"assignments": [
                {"id": id_ + "-1", "name": "_mailbox", "value": mailbox, "type": "string"},
                {"id": id_ + "-2", "name": "_provider", "value": provider, "type": "string"}]}}}

def note(id_, name, pos, w, h, content, color=None):
    p = {"width": w, "height": h, "content": content}
    if color: p["color"] = color
    return {"id": id_, "name": name, "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": pos, "parameters": p}

imap_params = {"mailbox": "INBOX", "postProcessAction": "read", "format": "simple", "downloadAttachments": False, "options": {}}
nodes = [
    # ---- intake: one trigger per mailbox ----
    {"id": "t-gmail", "name": "Gmail: sales inbox", "type": "n8n-nodes-base.gmailTrigger", "typeVersion": 1.2, "position": [0, 0],
     "parameters": {"pollTimes": {"item": [{"mode": "everyMinute"}]}, "simple": False,
                    "filters": {"readStatus": "unread", "includeSpamTrash": False}, "options": {}}},
    {"id": "t-yahoo", "name": "IMAP: Yahoo inbox", "type": "n8n-nodes-base.emailReadImap", "typeVersion": 2, "position": [0, 200],
     "parameters": imap_params},
    {"id": "t-imap2", "name": "IMAP: custom-domain inbox", "type": "n8n-nodes-base.emailReadImap", "typeVersion": 2, "position": [0, 400],
     "parameters": imap_params},
    {"id": "t-outlook", "name": "Outlook: support inbox", "type": "n8n-nodes-base.microsoftOutlookTrigger", "typeVersion": 1, "position": [0, 600],
     "parameters": {"pollTimes": {"item": [{"mode": "everyMinute"}]}, "event": "messageReceived", "output": "raw",
                    "filters": {"readStatus": "unread"}, "options": {}}},
    tag("s-gmail", "Tag: Gmail", "sales@gmail", "gmail", [240, 0]),
    tag("s-yahoo", "Tag: Yahoo", "info@yahoo", "imap", [240, 200]),
    tag("s-imap2", "Tag: custom domain", "hello@yourdomain", "imap", [240, 400]),
    tag("s-outlook", "Tag: Outlook", "support@outlook", "outlook", [240, 600]),
    # ---- process ----
    code("c-norm", "Normalize message", "normalize.js", [500, 300]),
    code("c-class", "Classify & assign owner", "classify_route.js", [740, 300]),
    code("c-draft", "Draft reply (needs approval)", "draft_reply.js", [980, 300]),
    {"id": "g-log", "name": "Log to sheet", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [1220, 300],
     "parameters": {"operation": "append", "documentId": SHEET_DOC, "sheetName": SHEET_TAB,
                    "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": schema(COLS)},
                    "options": {}}},
    {"id": "i-needs", "name": "Needs approval?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [1460, 300],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                                   "conditions": [{"id": "cond-1", "leftValue": "={{ $('Draft reply (needs approval)').item.json.status }}",
                                                   "rightValue": "pending_approval", "operator": {"type": "string", "operation": "equals"}}],
                                   "combinator": "and"}, "options": {}}},
    {"id": "sl-ask", "name": "Ask owner to approve (Slack)", "type": "n8n-nodes-base.slack", "typeVersion": 2.3, "position": [1700, 220],
     "parameters": {"select": "channel", "channelId": SLACK_CH("#inbox-approvals"),
                    "text": "={{ (() => { const d = $('Draft reply (needs approval)').item.json; return `${d.priority === 'high' ? ':rotating_light: HIGH ' : ''}*${d.category.toUpperCase()}* for ${d.owner}\\nFrom: ${d.from_email} (${d.mailbox})\\nSubject: ${d.subject}\\n> ${d.snippet}\\n\\n*Draft reply (not sent):*\\n${d.draft_reply}\\n\\nTo send: open the inbox_log sheet, row msg_key=${d.msg_key}, edit final_reply if needed, set status = approved.`; })() }}",
                    "otherOptions": {}}},
    # ---- send only what a human approved ----
    {"id": "t-send", "name": "Every 5 min: send approved", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 900],
     "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 5}]}}},
    {"id": "g-read-ok", "name": "Read approved rows", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [240, 900],
     "parameters": {"documentId": SHEET_DOC, "sheetName": SHEET_TAB,
                    "filtersUI": {"values": [{"lookupColumn": "status", "lookupValue": "approved"}]},
                    "options": {"returnFirstMatch": False}}, "alwaysOutputData": False},
    code("c-ok", "Pick approved, unsent replies", "prepare_approved.js", [480, 900]),
    {"id": "sw-prov", "name": "Reply from the same mailbox", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [720, 900],
     "parameters": {"rules": {"values": [
         {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                         "conditions": [{"leftValue": "={{ $json.provider }}", "rightValue": p, "operator": {"type": "string", "operation": "equals"}}],
                         "combinator": "and"}, "renameOutput": True, "outputKey": p} for p in ["gmail", "outlook", "imap"]]},
         "options": {}}},
    {"id": "m-gmail", "name": "Gmail: reply in thread", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "position": [980, 780],
     "parameters": {"resource": "message", "operation": "reply", "messageId": "={{ $json.source_id }}", "emailType": "text",
                    "message": "={{ $json.body }}", "options": {"appendAttribution": False}}},
    {"id": "m-outlook", "name": "Outlook: reply in thread", "type": "n8n-nodes-base.microsoftOutlook", "typeVersion": 2, "position": [980, 900],
     "parameters": {"resource": "message", "operation": "reply",
                    "messageId": {"__rl": True, "mode": "id", "value": "={{ $json.source_id }}"},
                    "message": "={{ $json.body }}", "additionalFields": {}}},
    {"id": "m-smtp", "name": "SMTP: send (Yahoo / custom domain)", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [980, 1020],
     "parameters": {"fromEmail": "={{ $json.mailbox === 'info@yahoo' ? 'info@yahoo.example' : 'hello@yourdomain.example' }}",
                    "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}", "emailFormat": "text",
                    "text": "={{ $json.body }}", "options": {"appendAttribution": False}}},
    {"id": "g-mark", "name": "Mark row sent", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [1240, 900],
     "parameters": {"operation": "update", "documentId": SHEET_DOC, "sheetName": SHEET_TAB,
                    "columns": {"mappingMode": "defineBelow",
                                "value": {"msg_key": "={{ $('Pick approved, unsent replies').item.json.msg_key }}",
                                          "status": "sent", "sent_at": "={{ $now.toISO() }}"},
                                "matchingColumns": ["msg_key"], "schema": schema(["msg_key", "status", "sent_at"])},
                    "options": {}}},
    # ---- daily digest ----
    {"id": "t-digest", "name": "Daily 08:00 digest", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 1250],
     "parameters": {"rule": {"interval": [{"triggerAtHour": 8}]}}},
    {"id": "g-read-all", "name": "Read log", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [240, 1250],
     "parameters": {"documentId": SHEET_DOC, "sheetName": SHEET_TAB, "options": {}}},
    code("c-digest", "Build daily digest", "daily_digest.js", [480, 1250]),
    {"id": "sl-digest", "name": "Post digest (Slack)", "type": "n8n-nodes-base.slack", "typeVersion": 2.3, "position": [720, 1250],
     "parameters": {"select": "channel", "channelId": SLACK_CH("#inbox-digest"), "text": "={{ $json.text }}", "otherOptions": {}}},
    # ---- notes ----
    note("n-1", "About", [-60, -420], 560, 380,
         "## Unified inbox router (demo by Paopao Studio)\nGmail + Yahoo (IMAP) + any IMAP mailbox + Outlook → one log, one owner per message, one approval queue.\n\n1. **Intake**: one trigger per mailbox, tagged with its name.\n2. **Normalize → Classify → Assign owner**: lead / support / billing / spam / needs_triage, keyword rules (every decision lists the rules that fired).\n3. **Draft reply**: written to the sheet as `pending_approval`. **Nothing is sent automatically.**\n4. **Approve**: a human sets `status = approved` in the sheet (edit `final_reply` first if needed). The 5-minute branch sends only those rows, from the mailbox the message came to, and marks them `sent`.\n5. **Digest**: 08:00 summary to Slack.\n\nSetup and limits: see README."),
    note("n-2", "Credentials", [560, -420], 520, 380,
         "### Credentials you need\n- **Gmail**: Google OAuth2 (Gmail + Sheets scopes). Google Cloud app in *Testing* → token dies after 7 days; publish to *In production*. Unused 6 months or password change → reconnect.\n- **Yahoo / custom domain**: IMAP + SMTP with an *app password* (Yahoo: Account security → Generate app password).\n- **Outlook.com / Microsoft 365**: Microsoft Outlook OAuth2. Not IMAP: Microsoft turned off password (basic) auth for Outlook IMAP/SMTP, and n8n's IMAP node only does passwords.\n- **Google Sheets**: tab `inbox_log` with the header row from README.\n- **Slack**: bot token, channels `#inbox-approvals`, `#inbox-digest`.", "5"),
]
c = lambda n: [{"node": n, "type": "main", "index": 0}]
connections = {
    "Gmail: sales inbox": {"main": [c("Tag: Gmail")]},
    "IMAP: Yahoo inbox": {"main": [c("Tag: Yahoo")]},
    "IMAP: custom-domain inbox": {"main": [c("Tag: custom domain")]},
    "Outlook: support inbox": {"main": [c("Tag: Outlook")]},
    "Tag: Gmail": {"main": [c("Normalize message")]},
    "Tag: Yahoo": {"main": [c("Normalize message")]},
    "Tag: custom domain": {"main": [c("Normalize message")]},
    "Tag: Outlook": {"main": [c("Normalize message")]},
    "Normalize message": {"main": [c("Classify & assign owner")]},
    "Classify & assign owner": {"main": [c("Draft reply (needs approval)")]},
    "Draft reply (needs approval)": {"main": [c("Log to sheet")]},
    "Log to sheet": {"main": [c("Needs approval?")]},
    "Needs approval?": {"main": [c("Ask owner to approve (Slack)"), []]},
    "Every 5 min: send approved": {"main": [c("Read approved rows")]},
    "Read approved rows": {"main": [c("Pick approved, unsent replies")]},
    "Pick approved, unsent replies": {"main": [c("Reply from the same mailbox")]},
    "Reply from the same mailbox": {"main": [c("Gmail: reply in thread"), c("Outlook: reply in thread"), c("SMTP: send (Yahoo / custom domain)")]},
    "Gmail: reply in thread": {"main": [c("Mark row sent")]},
    "Outlook: reply in thread": {"main": [c("Mark row sent")]},
    "SMTP: send (Yahoo / custom domain)": {"main": [c("Mark row sent")]},
    "Daily 08:00 digest": {"main": [c("Read log")]},
    "Read log": {"main": [c("Build daily digest")]},
    "Build daily digest": {"main": [c("Post digest (Slack)")]},
}
wf = {"name": "Unified inbox router (Gmail + IMAP + Outlook, human-approved replies)", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "pinData": {}, "meta": {"templateCredsSetupCompleted": False}, "tags": []}
(here / "unified_inbox_router.workflow.json").write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print("written", len(nodes), "nodes")
