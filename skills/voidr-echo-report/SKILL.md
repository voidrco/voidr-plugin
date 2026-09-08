---
name: voidr-echo-report
description: Generates an authenticated Voidr Echo daily, weekly, monthly, or custom-period monitoring report and emails its evidence-bound artifacts only after the user confirms the exact application and complete civil-day range.
---

# Generate a Voidr Echo monitoring report

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process.

Read `../CONTRACTS.md` once before starting and follow it throughout this flow.

## Outcome

Generate one evidence-bound Echo monitoring report for an explicit inclusive
range of complete civil days. The server emails the HTML report and its XLSX,
Markdown, and PDF artifacts only to the authenticated member. Never ask for,
accept, construct, or pass a recipient address.

Report generation is a delivery action. An initial request to generate or send
is intent, not approval of the resolved delivery details.

## Workflow

1. Call `voidr_auth_status` with `{}` as the first platform action. If no valid
   account is active, stop and direct the user to `/voidr-connect`; do not try
   to authenticate inside this skill. Continue only when the returned account
   can write.
2. Resolve the application from current platform data:
   - If the user supplied an application id, it is still only a locator. Call
     `echo_list_applications` and match it against the returned applications.
   - If the name matches exactly one application, use it.
   - Otherwise render the returned applications with `ask_user`. Never ask the
     user to type an id, and never infer an application from a repository,
     workspace, previous conversation, or email subject.
3. Resolve the inclusive report dates as complete civil days:
   - daily: the previous complete civil day;
   - weekly: the previous complete Monday-to-Sunday week;
   - monthly: the previous complete calendar month;
   - custom: the exact inclusive `fromDate` and `toDate` requested by the user.
   Reject a future or still-open day and a range longer than 93 days. Use the
   requested organization timezone; otherwise use `America/Sao_Paulo`.
4. Present one compact confirmation summary containing the exact application,
   inclusive start and end dates, timezone, HTML/XLSX/Markdown/PDF artifacts,
   and the fact that delivery goes only to the signed-in member's email. Do not
   expose the address returned by authentication. Ask for explicit confirmation
   and stop. Do not call `echo_generate_monitoring_report` in this turn.
5. On a separate, unambiguous approval, call
   `echo_generate_monitoring_report` exactly once with only:

   ```json
   {
     "applicationId": "<id returned by echo_list_applications>",
     "fromDate": "YYYY-MM-DD",
     "toDate": "YYYY-MM-DD",
     "timezone": "America/Sao_Paulo",
     "confirmed": true
   }
   ```

6. Report delivery only when the tool returns success. Summarize the period and
   returned artifact status without exposing signed URLs or internal envelopes.
   If the call fails or times out, say that delivery was not confirmed. A
   timeout is not proof of failure or success: never retry blindly, because a
   retry could send a duplicate email.

## Safety

- Never generate for an application or date range that was not shown in the
  confirmation summary.
- Never pass `recipient`, `recipientEmail`, `email`, or an equivalent field.
- Never reveal credentials, signed URLs, access tokens, storage locations, or
  internal infrastructure.
- Never claim an email was sent from a queued, partial, timed-out, or failed
  result.
- Do not combine report generation with test execution, schedule changes, or
  any other write.

## Tool routing

This skill uses exactly three MCP tools:

| When you need | Call exactly |
| --- | --- |
| Validate the selected local account and write access | `voidr_auth_status` |
| Resolve the application from the authenticated organization | `echo_list_applications` |
| Generate and email the separately confirmed report | `echo_generate_monitoring_report` |

Any other Voidr MCP tool is out of scope for this skill.
