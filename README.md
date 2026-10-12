Open the URL Vite prints. Select **Admin**, then **Open demo workspace**. Demo fees are examples, not the charity's actual prices. Demo records are fictional, held in memory, and reset when the page reloads. No emails are sent. Do not use the demo to collect real personal information or money.

# CTWA Membership & Enrollment

A responsive public enrollment form and admin workspace, with installable PWA support. The source paper forms remain in `requirement/`.

## Try it locally

From the `src` directory:

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Open the URL Vite prints. Select **Admin**, then **Open demo workspace**. Demo fees are examples, not the charity's actual prices. Demo records are fictional, held in memory, and reset when the page reloads. No emails are sent. Do not use the demo to collect real personal information or money.

All demo seed data is in `src/src/demo-data.json`: academic-year and fee settings, subjects, families and children, plus optional `members` and `payments` arrays. Prices are in pence (1000 = GBP 10). Sample enrollment IDs and approval states are defined there. The three-child example is `CTWA-DEMO-004`.

Edit that JSON to change demo examples. Billing dates, balances and receipts are calculated by the application rather than copied into the fixture. Seed enrollments start on the current London date (or academic-year start if later); update the year dates in the JSON when using a later academic year. Optional payment seeds use `enrollmentId`, a unique `requestId`, `amount` in pence, `method` and optional `reference`; the app generates their receipt and allocations. Use fictional records only. UI edits are temporary and do not write back to the JSON; reload resets them. Rebuild the preview after changing the JSON. Live mode ignores the demo fixture and uses the API.

```powershell
npm test
npm run lint
npm run build
npm run build:backend
```

Node 20.11 supports the application tooling. Use Node 22.13 or newer for the Cloudflare deployment CLI.

## Included workflow

- Enrollment is the first screen, with Admin as the only other app view. A small Tamil brand line, charity website, contact email and configured privacy notice links remain. Old Home/About links open Enrollment; history and promotional content belong on the charity's main website.
- Public and admin-created enrollments, with multiple children, subjects and optional admission photos.
- During admin approval, choose the enrollment start date between the academic-year start and today. Weekly/monthly/annual due dates are rescheduled from that date while retaining the prices quoted at application; approval date and schedule are recorded.
- Admin-configurable annual and lifetime membership fees (initial defaults GBP 10 and GBP 100). Annual enrollment remains required for lifetime members. Fee changes affect new enrollments only; existing charges and paid lifetime memberships retain their original values.
- Admin-configurable subjects, prices, weekly/monthly/annual billing, and academic-year dates.
- Subject deletion is soft only: use the trash icon, then **Save fees**. Deleted subjects are hidden from new enrollments but their definitions, existing charges and receipts are retained. Use **Show deleted subjects** to restore a subject, then select **Open** and save to offer it again. Deletion does not cancel existing students' scheduled fees.
- Approval, verified legacy lifetime membership, outstanding balances, academic-year filtering and enrollment reference search.
- Enrollment details show only unpaid charges currently due, with 10-row pagination. Upcoming charges and future-fee totals are not displayed. Recurring schedules remain stored and become due as their dates arrive; receipts and change history retain historical records.
- Previously paid lifetime membership is an optional paper-record check inside **Previous membership records**. It requires the old receipt or record reference. Verification recognises that earlier payment so no new membership fee is due; it does not refund money, change subject fees or alter receipts. The action is hidden when membership has already been paid in this app or no new membership fee is due.
- Admin enrollment editing: correct existing family/student details and add or remove subjects with an effective date and reason. Unpaid pending applications revise choices from their original start. Approved enrollments stop only unpaid charges dated on/after the chosen date; earlier fees and prepaid amounts stay unchanged. New subjects start on that date at current configured prices. No automatic refunds or proration. Change history and revision checks protect records; email/membership identity and existing children are retained.
- Admin approval lets the reviewer choose an enrollment start date between the academic-year start and today. Weekly/monthly/annual due dates are recalculated from that date using the subject prices quoted at submission.
- Cash, bank transfer, card-terminal and cheque payment recording, partial payments, numbered receipts, and downloadable printable receipts.
- Compact 80 mm printable receipts with receipt number, member, enrollment, payment method, reference, itemized payment allocations and total. The admin receipt preview has Print and Download actions; browser printing also supports Save as PDF. Live emailed PDFs use the same template; failed receipt emails remain visible and can be retried.
- The **Transactions** tab filters receipts by academic year and shows total collected, payment count, member, date, method, reference, email status and receipt access.
- Manual reminders and a daily scheduler that reminds approved unpaid families at most once every seven days.
- **Remind all payment due** on the dashboard sends reminders for the selected academic year after confirmation, skipping pending applications, members with no current balance and anyone reminded that day. Results show sent, skipped, failed and deferred counts. Email-quota or time-budget deferrals can be retried; the daily scheduler also checks unpaid members. Each member gets an individual email, not a shared recipient list.
- Batch reminders use an in-app confirmation dialog showing the academic year and member count, with Cancel/Send actions, loading and error states. The dialog supports mobile screens and keyboard dismissal; dismissal is blocked while sending.
- Server-side admin authorization, locking, idempotent payment requests, audit records, and private photo storage.

Weekly charges recur every seven days from enrollment (or academic-year start if later). Monthly charges recur on the same day, clamped to the month's last day. Charges stop at academic-year end. No attendance tracking, holiday exclusions, proration or automatic card collection is included. Fees are snapshotted at enrollment; later fee edits do not rewrite historical charges. Future charges can be prepaid.

## Live setup

Use a charity-controlled Google account and Cloudflare account. This version needs no separately hosted API server: Google Apps Script is the backend, with a small Cloudflare Worker gateway to support same-origin PWA requests securely.

### 1. Google Sheets and Apps Script

1. Create a **private** Google Sheet and copy its spreadsheet ID from its URL.
2. Open its Apps Script project. Run `npm run build:backend` locally and put the generated `src/apps-script/Code.gs` into the project.
3. Enable viewing the Apps Script manifest in project settings and use `src/apps-script/appsscript.json`.
4. Add these **Script Properties**:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | The private spreadsheet ID |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID from step 2 below |
| `ADMIN_EMAILS` | Comma-separated authorized Google email addresses |
| `GATEWAY_KEY` | A randomly generated secret, also stored as a Worker secret |

5. Run `setup()` manually and authorize access. It creates the Settings, Enrollments, Members, Receipts and Audit tabs, a private admission-photo folder and the daily reminder trigger.
6. Share **only the private photo folder** with named admin accounts that need to view photos. Do not enable link sharing. Admin users do not need direct spreadsheet editing access.
7. Deploy as a **Web app**, executing as the charity account, with access **Anyone**. Direct calls are rejected without the gateway secret; every admin action additionally verifies a Google identity token. Copy the `/exec` deployment URL. An organization policy might prohibit this deployment mode; resolve that before collecting data.

Records are split into text-safe JSON chunks to avoid Sheets' per-cell limit and formula interpretation. Treat tabs as application storage, not editable accounting worksheets. Back up the Sheet and Drive folder. Never reset the receipt counter on an existing installation.

### 2. Admin Google sign-in

Create a Google OAuth **Web application** client. Configure the consent screen and authorized JavaScript origins for the actual HTTPS app domain. The client ID is public, not a secret. Add permitted admin emails to Apps Script `ADMIN_EMAILS`. Server checks include signature verification through Google's tokeninfo endpoint, audience, issuer, expiry, verified email and allowlist. Tokens remain in memory; sign in again when they expire.

### 3. Public submission protection

Create a Cloudflare Turnstile widget restricted to the actual app hostname. Its site key is public; store its secret key only in Worker secrets. Public submissions are checked before reaching Apps Script. Admin-created enrollments use admin authorization instead.

### 4. Host the PWA

Create `src/.env.local` using `.env.example`, setting:

```text
VITE_DEMO=false
VITE_GOOGLE_CLIENT_ID=your-public-client-id
VITE_TURNSTILE_SITE_KEY=your-public-widget-site-key
VITE_PRIVACY_URL=https://your-published-approved-privacy-notice
```

Set `APPS_SCRIPT_URL` in `src/wrangler.jsonc` to the deployed `/exec` URL. Build, add Worker secrets interactively, and deploy from `src`:

```powershell
npm run build
npx wrangler@4 secret put GATEWAY_KEY
npx wrangler@4 secret put TURNSTILE_SECRET
npx wrangler@4 deploy
```

Enter secrets directly in your terminal. **Never place secrets in `VITE_*` variables, source files, or shared chat.** The gateway key must match the Apps Script property. Configure the final HTTPS hostname in both Google OAuth and Turnstile, then rebuild/redeploy when public environment variables change.

PWA installation uses the browser's installation UI; an install button appears where `beforeinstallprompt` is supported. On iOS use the browser's Add to Home Screen option. Only static interface assets are cached: API responses, family records and photos are not. Live enrollment and admin operations require an internet connection. Increase the service-worker cache version when releasing changes.

## Before collecting real records

- Publish a charity-approved UK GDPR privacy notice, retention schedule and procedures for correcting/deleting records and restricting children's photos. Live form submission is disabled without a configured privacy notice URL.
- Configure actual fees in **Subjects & fees** before opening enrollment. Production starts with enrollment closed until fees are configured.
- Test an enrollment, approval, cash payment, PDF email delivery, reminder, second admin authorization, and unauthorized access against the real Google deployment.
- Confirm that no private records or photos are publicly accessible and that backups can be restored.
- Monitor Google Apps Script execution, email and document-conversion quotas. Reminders stop when the email quota is exhausted; receipt delivery failures do not undo recorded payments.

The local tests mock Google services; they do not certify live OAuth, Google permissions, Drive sharing, PDF conversion or email delivery. Interrupted email sends can produce a duplicate email, but not a duplicate payment. Subject withdrawal cancels unpaid scheduled charges only; cash refunds, credit transfers, whole-enrollment cancellation, accounting exports and online payment checkout are not included in this first version.

The CTWA crest is sourced from `https://tamils.org.uk/images/CTWALogo.jpg`, credited to Coventry Tamil Welfare Association, and only resized/converted for the interface and PWA icons.

Home, About and promotional imagery are not part of the app interface. The charity's main website holds that content. Previously downloaded archive assets remain unused: `community.jpg`, `celebration.jpg`, and `community-sports.jpg` came from CTWA's website; `thiruvalluvar.jpg` is Yoursridhar's unedited photograph from `https://commons.wikimedia.org/wiki/File:Thiruvalluvar_123.jpg`, licensed under CC BY-SA 4.0 (`https://creativecommons.org/licenses/by-sa/4.0/`). These files are not displayed or included in the app's PWA cache.