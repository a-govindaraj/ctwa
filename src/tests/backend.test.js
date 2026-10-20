import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, handlePost, verifyAdmin } from "../backend/apps-script.js";
import worker from "../worker.js";

let sheets, properties, emails, uuid, claims, lockReleased, testDate;
function reset() {
  sheets = new Map();
  properties = new Map(
    Object.entries({
      SPREADSHEET_ID: "test",
      GOOGLE_CLIENT_ID: "client",
      ADMIN_EMAILS: "admin@example.com",
      GATEWAY_KEY: "secret",
      PHOTOS_FOLDER_ID: "folder",
    }),
  );
  emails = [];
  uuid = 0;
  lockReleased = 0;
  testDate = "2026-10-10";
  claims = {
    aud: "client",
    iss: "https://accounts.google.com",
    email: "admin@example.com",
    email_verified: "true",
    exp: Date.now() / 1000 + 3600,
  };
  for (const name of [
    "Settings",
    "Enrollments",
    "Members",
    "Receipts",
    "Audit",
    "AuditReviews",
    "YearSnapshots",
  ]) {
    const rows = [["ID", "JSON"]];
    sheets.set(name, {
      getDataRange: () => ({ getValues: () => structuredClone(rows) }),
      getLastColumn: () => Math.max(...rows.map((row) => row.length)),
      getMaxColumns: () => 50,
      getLastRow: () => rows.length,
      getRange: (row) => ({
        setValues: (values) => {
          rows[row - 1] = structuredClone(values[0]);
        },
      }),
    });
  }
  globalThis.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key),
      setProperty: (key, value) => properties.set(key, value),
    }),
  };
  globalThis.SpreadsheetApp = {
    openById: () => ({ getSheetByName: (name) => sheets.get(name) }),
    flush: () => {},
  };
  globalThis.Utilities = {
    formatDate: () => testDate,
    getUuid: () => String(++uuid).padEnd(32, "0"),
    newBlob: () => ({ getAs: () => ({ setName: () => ({}) }) }),
  };
  globalThis.UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(claims),
    }),
  };
  globalThis.MailApp = {
    getRemainingDailyQuota: () => 100,
    sendEmail: (message) => emails.push(message),
  };
  globalThis.DriveApp = { getFolderById: () => ({}) };
  globalThis.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => lockReleased++,
    }),
  };
  globalThis.ContentService = {
    MimeType: { JSON: "json" },
    createTextOutput: (value) => ({ setMimeType: () => JSON.parse(value) }),
  };
  admin("settings", {
    settings: {
      year: "2026-27",
      start: "2026-09-01",
      end: "2027-08-31",
      subjects: [
        {
          id: "tamil",
          name: "Tamil",
          price: 6000,
          frequency: "annually",
          active: true,
        },
      ],
    },
  });
}
const admin = (action, payload = {}) =>
  dispatch({ action, payload, credential: "token" });
const input = () => ({
  firstName: "Test",
  surname: "Family",
  address: "Example street",
  postcode: "CV1",
  email: "family@example.com",
  mobile: "07000000000",
  membership: "annual",
  consent: true,
  children: [{ name: "Child", dob: "2016-01-01", subjects: ["tamil"] }],
});
const enroll = () =>
  dispatch({
    action: "enroll",
    payload: { input: input(), requestId: "enroll-request-1" },
  }).id;

test("admin requests validate audience, verified email, expiry and allowlist", () => {
  reset();
  assert.throws(() => dispatch({ action: "dashboard" }), /sign in/);
  for (const change of [
    { aud: "wrong" },
    { email: "other@example.com" },
    { email_verified: false },
    { exp: 1 },
    { iss: "wrong" },
  ]) {
    const previous = { ...claims };
    Object.assign(claims, change);
    assert.throws(() => verifyAdmin("token"), /not authorised/);
    claims = previous;
  }
});
test("only the admin allowlist grants access even when a legacy auditor setting exists", () => {
  reset(); enroll();
  properties.set("AUDITOR_EMAILS", "auditor@example.com");
  claims.email = "auditor@example.com";
  for (const action of ["dashboard", "getSnapshot", "payment", "reversePayment", "matchPayment", "saveAuditReview", "saveSnapshot", "settings", "enroll", "editEnrollment", "approve", "verifyLifetime", "retryReceipt", "remind", "remindAll"]) assert.throws(() => admin(action), /not authorised/);
  assert.throws(() => verifyAdmin("token"), /not authorised/);
  claims.email = "admin@example.com";
  assert.equal(admin("dashboard").enrollments.length, 1);
});

test("financial controls persist, reverse once, retain evidence and freeze snapshots", () => {
  reset(); const id = enroll(); admin("approve", { id });
  const receipt = admin("payment", { id, amount: 1500, method: "cash", requestId: "control-payment-1" });
  admin("matchPayment", { id, number: receipt.number, revision: 0, status: "matched", reference: "Deposit 123", date: testDate, reason: "Cash deposited" });
  assert.equal(admin("dashboard").receipts[0].matchingHistory[0].actor, "admin@example.com");
  assert.throws(() => admin("reversePayment", { id, number: receipt.number, revision: 1, requestId: "control-reverse-1", reason: "Wrong amount" }), /Remove/);
  const snapshot = admin("saveSnapshot", { year: "2026-27", label: "Treasurer review", requestId: "snapshot-request-1", report: { totals: { paid: 1 } } });
  assert.equal(admin("saveSnapshot", { year: "2026-27", label: "retry", requestId: "snapshot-request-1" }).id, snapshot.id);
  const frozen = admin("getSnapshot", { snapshotId: snapshot.id });
  assert.equal(frozen.report.collected, 1500);
  assert.equal(frozen.report.matched, 1500);
  admin("matchPayment", { id, number: receipt.number, revision: 1, status: "unmatched", reason: "Wrong deposit" });
  const payload = { id, number: receipt.number, revision: 2, requestId: "control-reverse-1", reason: "Wrong amount" };
  admin("reversePayment", payload); admin("reversePayment", payload);
  assert.equal(admin("dashboard").enrollments[0].charges[0].paid, 0);
  assert.equal(admin("dashboard").receipts[0].amount, 1500);
  assert.deepEqual(admin("getSnapshot", { snapshotId: snapshot.id }), frozen);
  admin("payment", { id, amount: 1000, method: "cash", requestId: "corrected-payment-1" });
  assert.equal(admin("dashboard").enrollments[0].charges[0].paid, 1000);
  properties.set("AUDITOR_EMAILS", "auditor@example.com"); claims.email = "auditor@example.com";
  assert.throws(() => admin("getSnapshot", { snapshotId: snapshot.id }), /not authorised/);
  assert.throws(() => admin("dashboard"), /not authorised/);
});

test("lifetime payment reversal removes entitlement and protects carried-forward membership", () => {
  for (const carryForward of [false, true]) {
    reset();
    const first = dispatch({ action: "enroll", payload: { input: { ...input(), membership: "lifetime" }, requestId: "lifetime-reversal-enroll" } }).id;
    admin("approve", { id: first });
    const receipt = admin("payment", { id: first, amount: 10000, method: "cash", requestId: "lifetime-reversal-payment" });
    const reversal = { id: first, number: receipt.number, revision: 0, reason: "Incorrect payment", requestId: "lifetime-reversal-control" };
    if (!carryForward) admin("reversePayment", reversal);
    const config = dispatch({ action: "config" });
    admin("settings", { settings: { ...config, year: "2027-28", start: "2027-09-01", end: "2028-08-31" } });
    testDate = "2027-09-01";
    const second = dispatch({ action: "enroll", payload: { input: input(), requestId: "next-year-lifetime-check" } }).id;
    admin("approve", { id: second });
    const secondRecord = admin("dashboard").enrollments.find(record => record.id === second);
    assert.equal(secondRecord.charges[0].amount, carryForward ? 0 : 1000);
    if (carryForward) assert.throws(() => admin("reversePayment", reversal), /carried forward/);
  }
});

test("existing installations can read reports before adding review and snapshot sheets", () => {
  reset(); sheets.delete("AuditReviews"); sheets.delete("YearSnapshots");
  const data = admin("dashboard");
  assert.deepEqual(data.reviews, []);
  assert.deepEqual(data.snapshots, []);
  assert.throws(() => admin("getSnapshot", { snapshotId: "missing" }), /not found/);
});

test("audit queries persist independently of financial data and reject stale reviews", () => {
  reset(); const id = enroll(); admin("approve", { id });
  const record = admin("dashboard").enrollments[0];
  const payload = { id, kind: "charge", targetId: record.charges[1].id, revision: 0, status: "query", note: "Check subject price", fingerprint: JSON.stringify(record.charges[1]) };
  admin("saveAuditReview", payload);
  assert.throws(() => admin("saveAuditReview", payload), /review has changed/);
  admin("saveAuditReview", { ...payload, revision: 1, status: "resolved", note: "Price confirmed" });
  assert.equal(admin("dashboard").reviews[0].history.length, 2);
  assert.deepEqual(admin("dashboard").enrollments[0], record);
});

test("enrollment uses server prices, ignores client status and is idempotent", () => {
  reset();
  const value = { ...input(), charges: [{ amount: 1 }], approval: "approved" };
  const request = {
    action: "enroll",
    payload: { input: value, requestId: "enroll-request-1" },
  };
  assert.equal(dispatch(request).id, dispatch(request).id);
  const data = admin("dashboard");
  assert.equal(data.enrollments.length, 1);
  assert.equal(data.enrollments[0].approval, "pending");
  assert.equal(data.enrollments[0].charges[1].amount, 6000);
  assert.equal(emails.length, 1);
});

test("admin-selected enrollment date anchors due dates and is saved on approval", () => {
  reset();
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, subjects: [
    { id: "tamil", name: "Tamil", price: 6000, frequency: "annually", active: true },
    { id: "monthly", name: "Monthly", price: 2500, frequency: "monthly", active: true },
    { id: "weekly", name: "Weekly", price: 700, frequency: "weekly", active: true },
  ] } });
  const enrollmentInput = { ...input(), children: [{ ...input().children[0], subjects: ["tamil", "monthly", "weekly"] }] };
  const id = dispatch({ action: "enroll", payload: { input: enrollmentInput, requestId: "approval-date-test" } }).id;
  const pending = admin("dashboard").enrollments.find(record => record.id === id);
  assert.equal(pending.charges[2].due, "2026-10-10");
  assert.throws(() => admin("approve", { id, enrollmentDate: "2026-08-31" }), /between the academic-year start/);
  assert.equal(admin("dashboard").enrollments.find(record => record.id === id).approval, "pending");
  admin("approve", { id, enrollmentDate: "2026-09-15" });
  const approved = admin("dashboard").enrollments.find(record => record.id === id);
  assert.equal(approved.enrollmentDate, "2026-09-15");
  assert.equal(approved.charges[0].due, "2026-09-15");
  assert.equal(approved.charges.find(charge => charge.subjectId === "monthly" && charge.due === "2026-09-15").amount, 2500);
  assert.ok(approved.charges.some(charge => charge.subjectId === "weekly" && charge.due === "2026-09-15"));
  assert.ok(approved.charges.some(charge => charge.subjectId === "weekly" && charge.due === "2026-09-22"));
  assert.equal(approved.charges[1].due, "2026-09-15");
  assert.equal(approved.charges[1].amount, 6000);
});
test("payment retries produce one receipt and the ledger computes the correct balance", () => {
  reset();
  const id = enroll();
  assert.throws(
    () =>
      admin("payment", {
        id,
        amount: 1000,
        method: "cash",
        requestId: "payment-request-1",
      }),
    /Approve/,
  );
  admin("approve", { id });
  const payload = {
    id,
    amount: 1500,
    method: "cash",
    requestId: "payment-request-1",
  };
  const receipt = admin("payment", payload);
  assert.equal(admin("payment", payload).number, receipt.number);
  const data = admin("dashboard");
  assert.equal(data.receipts.length, 1);
  assert.equal(data.enrollments[0].charges[0].paid, 1000);
  assert.equal(data.enrollments[0].charges[1].paid, 500);
  assert.equal(emails.length, 2);
});
test("failed receipt email never rolls back the payment and can be retried", () => {
  reset();
  const id = enroll();
  admin("approve", { id });
  globalThis.MailApp.sendEmail = () => {
    throw new Error("Email unavailable");
  };
  const receipt = admin("payment", {
    id,
    amount: 1000,
    method: "cash",
    requestId: "payment-request-1",
  });
  assert.equal(receipt.emailStatus, "failed");
  assert.equal(admin("dashboard").enrollments[0].charges[0].paid, 1000);
  globalThis.MailApp.sendEmail = (message) => emails.push(message);
  admin("retryReceipt", { id, number: receipt.number });
  assert.equal(admin("dashboard").receipts[0].emailStatus, "sent");
});
test("previous lifetime verification recognises old payment without refunding and reminders are not duplicated", () => {
  reset();
  const id = enroll();
  admin("verifyLifetime", { id, reference: "Paper receipt 2018-123" });
  admin("approve", { id });
  const record = admin("dashboard").enrollments[0];
  assert.equal(record.charges[0].amount, 0);
  assert.equal(record.charges[1].amount, 6000);
  admin("remind", { id });
  admin("remind", { id });
  assert.equal(emails.length, 2);
});

test("previous lifetime verification needs evidence and cannot change membership already paid in the app", () => {
  reset(); const id = enroll();
  assert.throws(() => admin("verifyLifetime", { id }), /paper-record reference/);
  assert.equal(admin("dashboard").enrollments[0].charges[0].amount, 1000);
  admin("approve", { id });
  admin("payment", { id, amount: 1000, method: "cash", requestId: "membership-already-paid" });
  const before = admin("dashboard");
  assert.throws(() => admin("verifyLifetime", { id, reference: "Old paper record" }), /already recorded/);
  assert.deepEqual(admin("dashboard"), before);
});
test("gateway key is mandatory and locks are released after errors", () => {
  reset();
  assert.equal(
    handlePost({ postData: { contents: JSON.stringify({ action: "config" }) } })
      .ok,
    false,
  );
  assert.equal(
    handlePost({
      postData: {
        contents: JSON.stringify({ action: "dashboard", gatewayKey: "secret" }),
      },
    }).ok,
    false,
  );
  assert.equal(lockReleased, 1);
});

test("paid lifetime membership carries forward to a new annual enrollment", () => {
  reset();
  const first = dispatch({ action: "enroll", payload: { input: { ...input(), membership: "lifetime" }, requestId: "first-lifetime-request" } }).id;
  admin("approve", { id: first });
  admin("payment", { id: first, amount: 10000, method: "cash", requestId: "lifetime-payment-request" });
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, year: "2027-28", start: "2027-09-01", end: "2028-08-31" } });
  testDate = "2027-09-10";
  const second = dispatch({ action: "enroll", payload: { input: input(), requestId: "second-year-request" } }).id;
  assert.notEqual(first, second);
  admin("approve", { id: second });
  const renewed = admin("dashboard").enrollments.find(record => record.id === second);
  assert.equal(renewed.charges[0].amount, 0);
  assert.equal(renewed.charges[1].amount, 6000);
});

test("large records round-trip across text-safe spreadsheet chunks", () => {
  reset();
  const config = dispatch({ action: "config" });
  const subjects = Array.from({ length: 5 }, (_, index) => ({ id: `weekly-${index}`, name: `Subject ${index}`, price: 500, frequency: "weekly", active: true }));
  admin("settings", { settings: { ...config, subjects } });
  const value = { ...input(), children: Array.from({ length: 3 }, (_, index) => ({ name: `Child ${index} ${"Longname".repeat(10)}`, dob: "2016-01-01", subjects: subjects.map(subject => subject.id) })) };
  const id = dispatch({ action: "enroll", payload: { input: value, requestId: "large-family-request" } }).id;
  const row = sheets.get("Enrollments").getDataRange().getValues().find(values => values[0] === id);
  assert.ok(row.length > 2);
  assert.ok(row.slice(1).every(chunk => chunk.startsWith("~")));
  assert.equal(admin("dashboard").enrollments[0].children.length, 3);
});

test("custom lifetime payments remain valid after membership prices change", () => {
  reset();
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, membershipFees: { annual: 1500, lifetime: 12500 } } });
  const first = dispatch({ action: "enroll", payload: { input: { ...input(), membership: "lifetime" }, requestId: "custom-lifetime-enroll" } }).id;
  admin("approve", { id: first });
  admin("payment", { id: first, amount: 12500, method: "cash", requestId: "custom-lifetime-payment" });
  const updated = dispatch({ action: "config" });
  admin("settings", { settings: { ...updated, year: "2027-28", start: "2027-09-01", end: "2028-08-31", membershipFees: { annual: 2500, lifetime: 20000 } } });
  testDate = "2027-09-10";
  const second = dispatch({ action: "enroll", payload: { input: input(), requestId: "custom-lifetime-renew" } }).id;
  admin("approve", { id: second });
  const records = admin("dashboard").enrollments;
  assert.equal(records.find(record => record.id === first).charges[0].amount, 12500);
  assert.equal(records.find(record => record.id === second).charges[0].amount, 0);
});

test("admin subject revisions retain receipts and cancelled balances survive reload", () => {
  reset();
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, subjects: config.subjects.map(subject => ({ ...subject, frequency: "monthly", price: 2000 })) } });
  const id = enroll(); admin("approve", { id });
  admin("payment", { id, amount: 3000, method: "cash", requestId: "revision-payment" });
  const record = admin("dashboard").enrollments[0];
  const receipts = admin("dashboard").receipts;
  const details = Object.fromEntries(["firstName", "surname", "address", "postcode", "mobile", "telephone"].map(field => [field, record[field] || ""]));
  const payload = { id, revision: 0, details, effective: "2026-12-10", reason: "Leaving after two months", children: record.children.map(child => ({ ...child, subjects: [] })) };
  assert.throws(() => dispatch({ action: "editEnrollment", payload }), /sign in/);
  admin("editEnrollment", payload);
  const updated = admin("dashboard");
  assert.deepEqual(updated.receipts, receipts);
  assert.equal(updated.enrollments[0].charges[1].paid, 2000);
  assert.equal(updated.enrollments[0].charges.find(charge => charge.due === "2026-12-10").cancelledAmount, 2000);
  assert.equal(updated.enrollments[0].changes[0].actor, "admin@example.com");
  assert.throws(() => admin("editEnrollment", payload), /changed/);
});

test("batch reminders target approved current-due members and skip same-day repeats", () => {
  reset();
  const approved = enroll(); admin("approve", { id: approved });
  const paid = dispatch({ action: "enroll", payload: { input: { ...input(), email: "paid@example.com" }, requestId: "paid-member-enroll" } }).id;
  admin("approve", { id: paid }); admin("payment", { id: paid, amount: 7000, method: "cash", requestId: "paid-member-payment" });
  dispatch({ action: "enroll", payload: { input: { ...input(), email: "pending@example.com" }, requestId: "pending-member-enroll" } });
  const before = emails.length;
  assert.throws(() => dispatch({ action: "remindAll", payload: { year: "2026-27" } }), /sign in/);
  const result = admin("remindAll", { year: "2026-27" });
  assert.equal(result.sent, 1); assert.equal(emails.length, before + 1);
  assert.equal(emails.at(-1).to, "family@example.com");
  assert.equal(admin("remindAll", { year: "2026-27" }).skipped, 1);
  assert.equal(admin("remindAll", { year: "2025-26" }).sent, 0);
});

test("batch reminder failures and quota exhaustion are reported without marking sent", () => {
  reset(); const id = enroll(); admin("approve", { id });
  globalThis.MailApp.getRemainingDailyQuota = () => 0;
  assert.equal(admin("remindAll", { year: "2026-27" }).deferred, 1);
  assert.equal(admin("dashboard").enrollments[0].lastReminder, undefined);
  globalThis.MailApp.getRemainingDailyQuota = () => 100;
  globalThis.MailApp.sendEmail = () => { throw new Error("Mail failed"); };
  assert.equal(admin("remindAll", { year: "2026-27" }).failed, 1);
  assert.equal(admin("dashboard").enrollments[0].lastReminder, undefined);
});

test("soft-deleted subjects stay stored and preserve existing charges and receipts", () => {
  reset();
  const id = enroll();
  admin("approve", { id });
  admin("payment", { id, amount: 1500, method: "cash", requestId: "payment-before-delete" });
  const before = admin("dashboard");
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, subjects: config.subjects.map(subject => subject.id === "tamil" ? { ...subject, deleted: true, active: true } : subject) } });
  const deleted = dispatch({ action: "config" }).subjects.find(subject => subject.id === "tamil");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.active, false);
  assert.ok(deleted.deletedAt);
  assert.deepEqual(admin("dashboard"), before);
  assert.throws(() => dispatch({ action: "enroll", payload: { input: { ...input(), email: "another@example.com" }, requestId: "deleted-subject-enroll" } }), /no longer available/);
});

test("omitting a subject from an update archives it instead of removing history", () => {
  reset();
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, subjects: [] } });
  const retained = dispatch({ action: "config" }).subjects.find(subject => subject.id === "tamil");
  assert.equal(retained.name, "Tamil");
  assert.equal(retained.deleted, true);
});

test("restoring a deleted subject keeps its identity and permits enrollment when reopened", () => {
  reset();
  const config = dispatch({ action: "config" });
  admin("settings", { settings: { ...config, subjects: config.subjects.map(subject => ({ ...subject, deleted: true })) } });
  const archived = dispatch({ action: "config" });
  admin("settings", { settings: { ...archived, subjects: archived.subjects.map(subject => subject.id === "tamil" ? { ...subject, deleted: false, active: true } : subject) } });
  const restored = dispatch({ action: "config" }).subjects.find(subject => subject.id === "tamil");
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.id, "tamil");
  assert.ok(enroll());
});

const gatewayRequest = (body, origin = "https://enroll.example.com") => new Request("https://enroll.example.com/api", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const gatewayEnv = { APPS_SCRIPT_URL: "https://script.google.com/macros/s/example/exec", GATEWAY_KEY: "private-key", TURNSTILE_SECRET: "private-captcha-key" };

test("gateway rejects cross-origin and unconfigured requests", async () => {
  const denied = await worker.fetch(gatewayRequest({ action: "config" }, "https://other.example.com"), gatewayEnv);
  assert.equal(denied.status, 403);
  const missing = await worker.fetch(gatewayRequest({ action: "config" }), {});
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("Cache-Control"), "no-store");
});

test("failed public security checks never reach Apps Script", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return Response.json({ success: false }); };
  try {
    const response = await worker.fetch(gatewayRequest({ action: "enroll", payload: { captcha: "invalid" } }), gatewayEnv);
    assert.equal(response.status, 400);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("turnstile"));
  } finally { globalThis.fetch = previous; }
});

test("valid public checks forward a server-owned key without leaking it", async () => {
  const previous = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    if (url.includes("turnstile")) return Response.json({ success: true, hostname: "enroll.example.com" });
    forwarded = JSON.parse(options.body);
    return Response.json({ ok: true, result: { id: "CTWA-TEST" } });
  };
  try {
    const response = await worker.fetch(gatewayRequest({ action: "enroll", payload: { captcha: "valid" }, gatewayKey: "attacker" }), gatewayEnv);
    assert.equal(response.status, 200);
    assert.equal(forwarded.gatewayKey, "private-key");
    assert.ok(!(await response.text()).includes("private-key"));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally { globalThis.fetch = previous; }
});
