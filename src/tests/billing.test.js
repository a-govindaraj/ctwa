import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAnnualReport, annualReportCsv, auditReportCsv, createYearSnapshot } from "../src/reports.js";
import { hydrateEnrollment, reverseReceipt, matchReceipt, reviewTarget, saveReview, reviewStatus } from "../src/controls.js";
import {
  schedule,
  buildCharges,
  allocatePayment,
  balance,
  receiptHtml,
  validateEnrollment,
  validateSettings,
  prepareSettings,
  reviseEnrollment,
  reschedulePendingEnrollment,
} from "../src/billing.js";

const settings = {
  year: "2026-27",
  start: "2026-09-01",
  end: "2027-08-31",
  subjects: [
    {
      id: "tamil",
      name: "Tamil",
      price: 2000,
      frequency: "monthly",
      active: true,
    },
  ],
};
const input = {
  firstName: "Test",
  surname: "Family",
  address: "Example",
  postcode: "CV1",
  email: "test@example.com",
  mobile: "07000000000",
  membership: "annual",
  consent: true,
  children: [{ name: "Child", dob: "2016-01-01", subjects: ["tamil"] }],
};

test("central demo JSON contains valid unique families, configured prices and the three-child example", () => {
  const demo = JSON.parse(readFileSync(new URL("../src/demo-data.json", import.meta.url), "utf8"));
  validateSettings(demo.settings);
  const ids = new Set(); const emails = new Set();
  for (const record of demo.enrollments) {
    validateEnrollment(record, demo.settings, "2026-10-10");
    assert.ok(!ids.has(record.id)); ids.add(record.id);
    assert.ok(!emails.has(record.email)); emails.add(record.email);
    assert.ok(["pending", "approved"].includes(record.approval));
  }
  const family = demo.enrollments.find(record => record.children.length === 3);
  assert.ok(family);
  const charges = buildCharges(family, demo.settings, "2026-10-10");
  assert.equal(balance(charges, "2026-10-10"), 17000);
  assert.deepEqual(new Set(charges.filter(charge => charge.frequency).map(charge => charge.frequency)), new Set(["annually", "monthly", "weekly"]));
  assert.deepEqual(demo.members, []);
  assert.deepEqual(demo.payments, []);
});

test("monthly dates preserve the anchor across short months", () => {
  assert.deepEqual(schedule("2027-01-31", "2027-04-30", "monthly"), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
  ]);
});
test("weekly and annual schedules respect the end date", () => {
  assert.deepEqual(schedule("2026-10-10", "2026-10-24", "weekly"), [
    "2026-10-10",
    "2026-10-17",
    "2026-10-24",
  ]);
  assert.deepEqual(schedule("2026-10-10", "2027-08-31", "annually"), [
    "2026-10-10",
  ]);
});
test("lifetime members pay no membership charge but still pay subjects", () => {
  const charges = buildCharges(input, settings, "2026-10-10", true);
  assert.equal(charges[0].amount, 0);
  assert.equal(balance(charges, "2026-10-10"), 2000);
  assert.equal(charges.length, 12);
});
test("payments allocate membership first, do not mutate history, and allow partial payments", () => {
  const charges = buildCharges(input, settings, "2026-10-10");
  const paid = allocatePayment(charges, 1500);
  assert.equal(charges[0].paid, 0);
  assert.equal(paid.charges[0].paid, 1000);
  assert.equal(paid.charges[1].paid, 500);
  assert.equal(balance(paid.charges, "2026-10-10"), 1500);
  assert.equal(
    paid.allocations.reduce((total, item) => total + item.amount, 0),
    1500,
  );
  assert.throws(() => allocatePayment(charges, balance(charges) + 1));
  assert.throws(() => allocatePayment(charges, 10.1));
});
test("prices are snapshotted and future charges are excluded from current balance", () => {
  const charges = buildCharges(input, settings, "2026-10-10");
  const edited = structuredClone(settings);
  edited.subjects[0].price = 5000;
  assert.equal(charges[1].amount, 2000);
  assert.equal(balance(charges, "2026-10-10"), 3000);
  assert.equal(
    balance(buildCharges(input, edited, "2026-10-10"), "2026-10-10"),
    6000,
  );
});
test("invalid, unavailable and duplicate subjects are rejected", () => {
  assert.equal(validateEnrollment(input, settings, "2026-10-10"), input);
  assert.throws(() =>
    validateEnrollment({ ...input, consent: false }, settings, "2026-10-10"),
  );
  assert.throws(() =>
    validateEnrollment(
      {
        ...input,
        children: [{ ...input.children[0], subjects: ["tamil", "tamil"] }],
      },
      settings,
      "2026-10-10",
    ),
  );
  assert.throws(() =>
    validateEnrollment(
      { ...input, children: [{ ...input.children[0], dob: "2026-02-30" }] },
      settings,
      "2026-10-10",
    ),
  );
  assert.throws(() =>
    validateSettings({
      ...settings,
      subjects: [{ ...settings.subjects[0], price: -1 }],
    }),
  );
});
test("receipts escape user content", () => {
  const html = receiptHtml({
    number: "R-1",
    date: "2026-10-10",
    name: "<script>alert(1)</script>",
    enrollmentId: "E-1",
    method: "cash",
    amount: 1000,
    allocations: [],
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("membership prices are configurable, validated and snapshotted", () => {
  const configured = { ...settings, membershipFees: { annual: 1500, lifetime: 12500 } };
  const oldCharges = buildCharges(input, settings, "2026-10-10");
  assert.equal(buildCharges(input, configured, "2026-10-10")[0].amount, 1500);
  assert.equal(buildCharges({ ...input, membership: "lifetime" }, configured, "2026-10-10")[0].amount, 12500);
  assert.equal(oldCharges[0].amount, 1000);
  assert.equal(buildCharges(input, configured, "2026-10-10", true)[0].amount, 0);
  for (const annual of [-1, 1.5, NaN, 1000001]) assert.throws(() => validateSettings({ ...configured, membershipFees: { annual, lifetime: 12500 } }), /membership prices/);
  assert.deepEqual(prepareSettings(settings, configured, "2026-10-10").membershipFees, configured.membershipFees);
});

test("receipts use a compact print layout and escape long payment details", () => {
  const html = receiptHtml({ number: "CTWA-R-000001", date: "2026-10-10", name: "Family", enrollmentId: "CTWA-123", method: "cash", reference: "<script>bad</script>", amount: 1500, allocations: [{ description: "A very long child and subject name <img src=x onerror=alert(1)>", due: "2026-10-10", amount: 1500 }] });
  assert.ok(html.includes("size:80mm 200mm"));
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("Total paid: £15.00"));
  assert.ok(html.includes("overflow-wrap:anywhere"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

const editableRecord = () => ({ ...structuredClone(input), id: "E-1", year: settings.year, academicEnd: settings.end, approval: "approved", charges: buildCharges(input, settings, "2026-10-10") });
const editPayload = record => ({ revision: record.revision || 0, effective: "2026-12-10", reason: "Family changed subject choices", details: { firstName: record.firstName, surname: record.surname, address: record.address, postcode: record.postcode, mobile: record.mobile, telephone: record.telephone || "" }, children: structuredClone(record.children) });

test("withdrawal stops future unpaid fees but retains earlier fees and payment history", () => {
  const record = editableRecord();
  record.charges = allocatePayment(record.charges, 3000).charges;
  const payload = editPayload(record);
  payload.children[0].subjects = [];
  const edited = reviseEnrollment(record, payload, settings, "2026-11-10");
  assert.equal(balance(edited.charges), 2000);
  assert.equal(edited.charges[1].paid, 2000);
  assert.equal(edited.charges.find(charge => charge.due === "2026-12-10").cancelledAmount, 2000);
  assert.equal(record.children[0].subjects.length, 1);
  assert.equal(edited.changes[0].before.children[0].subjects[0], "tamil");
  assert.throws(() => allocatePayment(edited.charges, 2001));
});

test("partial subject withdrawal preserves other subjects, siblings and earlier payments", () => {
  const config = { ...settings, subjects: [...settings.subjects, { id: "music", name: "Music", frequency: "monthly", price: 500, active: true }] };
  const record = editableRecord();
  record.children[0].subjects.push("music");
  record.children.push({ ...structuredClone(input.children[0]), name: "Sibling", class: "", index: "" });
  record.charges = allocatePayment(buildCharges(record, config, "2026-10-10"), 1500).charges;
  const payload = editPayload(record);
  payload.children[0].subjects = ["music"];
  const updated = reviseEnrollment(record, payload, config, "2026-11-10");
  const cancelled = updated.charges.filter(charge => charge.cancelledAmount > 0);
  assert.equal(cancelled.length, 9);
  assert.ok(cancelled.every(charge => charge.childIndex === 0 && charge.subjectId === "tamil" && charge.due >= payload.effective));
  assert.deepEqual(updated.charges.filter(charge => !cancelled.some(item => item.id === charge.id)), record.charges.filter(charge => !cancelled.some(item => item.id === charge.id)));
  assert.equal(balance(record.charges) - balance(updated.charges), 18000);
  assert.equal(updated.charges.find(charge => charge.id === "0-tamil-0").paid, 500);
  assert.deepEqual(updated.children[0].subjects, ["music"]);
  assert.deepEqual(updated.children[1], record.children[1]);
  assert.equal(updated.changes[0].reason, payload.reason);
  assert.deepEqual(record.children[0].subjects, ["tamil", "music"]);
});

test("annual reports reconcile full-year fees, receipts, waivers and current dues", () => {
  const record = editableRecord();
  const payment = allocatePayment(record.charges, 3500);
  record.charges = payment.charges;
  const payload = editPayload(record); payload.children[0].subjects = [];
  const stopped = reviseEnrollment(record, payload, settings, "2026-11-10");
  const receipt = { number: "R-1", enrollmentId: record.id, amount: 3500, allocations: payment.allocations, date: "2026-10-10", name: "Test Family", method: "cash", recordedBy: "admin@example.com" };
  const report = buildAnnualReport([stopped, { ...editableRecord(), id: "pending", approval: "pending" }, { ...editableRecord(), id: "old", year: "2025-26" }], [receipt, { ...receipt, enrollmentId: "old" }], settings.year, "2026-11-10");
  assert.equal(report.approved, 1);
  assert.equal(report.pending, 1);
  assert.equal(report.students, 1);
  assert.equal(report.rows.length, 2);
  assert.equal(report.receipts.length, 1);
  assert.deepEqual(report.totals, { charged: 23000, paid: 3500, waived: 18000, outstanding: 1500, dueNow: 1500 });
  assert.equal(report.reconciled, true);
  assert.equal(report.charges.filter(charge => charge.cancelledAmount).length, 9);
  assert.equal(report.changes[0].reason, payload.reason);
  const earlier = buildAnnualReport([record], [receipt], settings.year, "2026-10-10");
  assert.equal(earlier.totals.dueNow, 0);
  assert.equal(earlier.totals.outstanding, 19500);
  assert.deepEqual(buildAnnualReport([], [], settings.year, "2026-10-10").rows, []);
  assert.equal(buildAnnualReport([record], [], settings.year, "2026-10-10").reconciled, false);
  assert.equal(buildAnnualReport([record], [{ ...receipt, amount: 3600 }], settings.year, "2026-10-10").allocationDifference, 100);
  const wrongAllocation = { ...receipt, allocations: [{ id: "missing", amount: 3500 }] };
  assert.equal(buildAnnualReport([record], [wrongAllocation], settings.year, "2026-10-10").reconciled, false);
  const legacy = { ...record, charges: record.charges.map(({ childIndex, subjectId, ...charge }) => { void childIndex; void subjectId; return charge; }) };
  assert.deepEqual(buildAnnualReport([legacy], [receipt], settings.year, "2026-10-10").rows, earlier.rows);
});

test("report exports quote names, protect formulas and include audit evidence", () => {
  const record = editableRecord(); record.firstName = '=HYPERLINK("bad")'; record.children[0].name = "Child, One\nSecond line";
  const payload = editPayload(record); payload.children[0].subjects = [];
  const stopped = reviseEnrollment(record, payload, settings, "2026-11-10");
  stopped.changes[0].actor = "admin@example.com";
  const report = buildAnnualReport([stopped], [], settings.year, "2026-11-10");
  const summary = annualReportCsv(report);
  assert.ok(summary.includes(`"'=HYPERLINK(""bad"") Family"`));
  assert.ok(summary.includes('"Child, One\nSecond line"'));
  assert.ok(summary.includes('"230.00","0.00","180.00","50.00","50.00"'));
  const audit = auditReportCsv(report);
  assert.ok(audit.includes('"Charge"'));
  assert.ok(audit.includes(payload.reason));
  assert.ok(audit.includes("admin@example.com"));
  assert.ok(audit.includes('"Revision 1"'));
});

test("receipt reversals retain originals, reopen balances and cannot be applied twice", () => {
  const record = editableRecord();
  const paid = allocatePayment(record.charges, 1500);
  const receipt = { number: "R-1", enrollmentId: record.id, date: "2026-10-10", amount: 1500, allocations: paid.allocations };
  const payload = { revision: 0, reason: "Wrong amount", requestId: "reverse-request-1" };
  const reversed = reverseReceipt(receipt, payload, "Admin", "2026-10-19T10:00:00Z");
  assert.deepEqual(reversed.allocations, receipt.allocations);
  assert.equal(receipt.reversal, undefined);
  assert.equal(balance(hydrateEnrollment(record, [reversed]).charges), balance(record.charges));
  assert.equal(balance(hydrateEnrollment(record, [receipt]).charges), balance(record.charges) - 1500);
  assert.deepEqual(reverseReceipt(reversed, payload, "Admin", "later"), reversed);
  assert.throws(() => reverseReceipt(reversed, { ...payload, requestId: "another-request-1" }, "Admin", "later"), /already/);
  assert.throws(() => reverseReceipt(receipt, { ...payload, reason: "" }, "Admin", "later"), /reason/);
});

test("reports and printable receipts distinguish reversals from active collections", () => {
  const record = editableRecord();
  const allocated = allocatePayment(record.charges, 1500);
  const receipt = { number: "R-1", enrollmentId: record.id, date: "2026-10-10", name: "Test Family", amount: 1500, method: "cash", allocations: allocated.allocations };
  const reversed = reverseReceipt(receipt, { revision: 0, reason: "Wrong <amount>", requestId: "reverse-request-1" }, "Admin", "2026-10-19T10:00:00Z");
  const report = buildAnnualReport([hydrateEnrollment(record, [reversed])], [reversed], settings.year, "2026-10-19");
  assert.equal(report.collected, 0);
  assert.equal(report.reversed, 1500);
  assert.equal(report.unmatched, 0);
  assert.equal(report.reconciled, true);
  assert.ok(auditReportCsv(report).includes("Reversed allocation (excluded)"));
  const html = receiptHtml(reversed);
  assert.ok(html.includes("REVERSED / Original receipt"));
  assert.ok(html.includes("Wrong &lt;amount&gt;"));
  assert.ok(!html.includes("Total paid:"));
  const snapshot = createYearSnapshot(report, { requestId: "snapshot-request-1", label: "Reviewed copy" }, "Admin", "now", "S-1");
  report.totals.charged = 1;
  assert.equal(snapshot.report.totals.charged, 23000);
  assert.throws(() => createYearSnapshot({ ...report, reconciled: false }, { requestId: "snapshot-request-1", label: "Copy" }, "Admin", "now", "S-2"), /differences/);
});

test("matching requires settlement evidence, stale checks and an unmatch before reversal", () => {
  const receipt = { date: "2026-10-10" };
  const payload = { revision: 0, status: "matched", reference: "Bank page 3", date: "2026-10-11", reason: "Matched to deposit" };
  const matched = matchReceipt(receipt, payload, "Admin", "2026-10-19", "2026-10-19");
  assert.equal(matched.matchingHistory[0].reference, "Bank page 3");
  assert.throws(() => matchReceipt(receipt, { ...payload, date: "2026-10-20" }, "Admin", "now", "2026-10-19"), /settlement date/);
  assert.throws(() => matchReceipt(receipt, { ...payload, reference: "" }, "Admin", "now", "2026-10-19"), /reference/);
  assert.throws(() => matchReceipt(matched, payload, "Admin", "now", "2026-10-19"), /changed/);
  assert.throws(() => reverseReceipt(matched, { revision: 1, reason: "Wrong amount", requestId: "reverse-request-1" }, "Admin", "now"), /Remove/);
  const unmatched = matchReceipt(matched, { revision: 1, status: "unmatched", reason: "Wrong deposit" }, "Admin", "now", "2026-10-19");
  assert.equal(unmatched.matchingHistory.length, 2);
  assert.ok(reverseReceipt(unmatched, { revision: 2, reason: "Wrong amount", requestId: "reverse-request-1" }, "Admin", "now").reversal);
});

test("audit reviews retain query history and require rechecking changed financial records", () => {
  const record = editableRecord();
  const payload = { id: record.id, kind: "charge", targetId: record.charges[1].id, revision: 0, status: "query", note: "Confirm waiver" };
  const target = reviewTarget([record], [], payload);
  payload.fingerprint = target.fingerprint;
  const queried = saveReview(null, target, payload, "Admin", "now");
  const resolved = saveReview(queried, target, { ...payload, revision: 1, status: "resolved", note: "Evidence checked" }, "Admin", "later");
  assert.equal(resolved.history.length, 2);
  assert.equal(reviewStatus(resolved, target), "Resolved");
  record.charges[1].paid = 100;
  assert.equal(reviewStatus(resolved, reviewTarget([record], [], payload)), "Needs recheck");
  assert.throws(() => saveReview(null, target, { ...payload, fingerprint: "old" }, "Admin", "now"), /changed/);
  assert.throws(() => saveReview(null, target, { ...payload, status: "resolved" }, "Admin", "now"), /open query/);
});

test("prepayment is retained and only the unpaid remainder is cancelled", () => {
  const record = editableRecord();
  record.charges = allocatePayment(record.charges, 6000).charges;
  const payload = editPayload(record); payload.children[0].subjects = [];
  const edited = reviseEnrollment(record, payload, settings, "2026-11-10");
  const thirdMonth = edited.charges.find(charge => charge.due === "2026-12-10");
  assert.equal(thirdMonth.amount, 2000); assert.equal(thirdMonth.paid, 1000); assert.equal(thirdMonth.cancelledAmount, 1000);
  assert.equal(balance(edited.charges), 0);
});

test("pending subject changes recalculate unpaid choices from the original start", () => {
  const record = { ...editableRecord(), approval: "pending" };
  const config = { ...settings, subjects: [...settings.subjects, { id: "music", name: "Music", frequency: "weekly", price: 500, active: true }] };
  const payload = editPayload(record); payload.children[0].subjects = ["music"];
  const edited = reviseEnrollment(record, payload, config, "2026-11-10");
  assert.ok(edited.charges.filter(charge => charge.subjectId === "tamil").every(charge => charge.cancelledAmount === charge.amount));
  assert.equal(edited.charges.find(charge => charge.subjectId === "music").due, "2026-10-10");
  assert.equal(edited.charges[0].amount, 1000);
});

test("adding a subject later starts new prices on the effective date and rejects stale edits", () => {
  const record = editableRecord();
  const config = { ...settings, subjects: [...settings.subjects, { id: "music", name: "Music", frequency: "monthly", price: 3500, active: true }] };
  const payload = editPayload(record); payload.children[0].subjects.push("music");
  const edited = reviseEnrollment(record, payload, config, "2026-11-10");
  const newCharges = edited.charges.filter(charge => charge.subjectId === "music");
  assert.equal(newCharges[0].due, "2026-12-10"); assert.equal(newCharges[0].amount, 3500);
  assert.throws(() => reviseEnrollment(edited, payload, config, "2026-11-10"), /changed/);
  assert.throws(() => reviseEnrollment(record, { ...payload, effective: "2026-10-10" }, config, "2026-11-10"), /Earlier fees/);
  assert.throws(() => reviseEnrollment(record, { ...payload, reason: "" }, config, "2026-11-10"), /reason/);
});

test("similar subject IDs are not cancelled together, including legacy charges", () => {
  const config = { ...settings, subjects: [...settings.subjects, { id: "tamil-extra", name: "Extra", frequency: "monthly", price: 700, active: true }] };
  const record = editableRecord(); record.children[0].subjects.push("tamil-extra");
  record.charges = buildCharges({ ...input, children: record.children }, config, "2026-10-10").map(({ subjectId, childIndex, ...charge }) => { void subjectId; void childIndex; return charge; });
  const payload = editPayload(record); payload.children[0].subjects = ["tamil-extra"];
  const updated = reviseEnrollment(record, payload, config, "2026-11-10");
  assert.ok(updated.charges.filter(charge => charge.id.startsWith("0-tamil-extra-")).every(charge => !charge.cancelledAmount));
});

test("rejoining a paid annual subject does not charge the same annual fee twice", () => {
  const config = { ...settings, subjects: settings.subjects.map(subject => ({ ...subject, frequency: "annually" })) };
  const record = editableRecord(); record.charges = allocatePayment(buildCharges(input, config, "2026-10-10"), 3000).charges;
  const withdrawal = editPayload(record); withdrawal.children[0].subjects = [];
  const stopped = reviseEnrollment(record, withdrawal, config, "2026-11-10");
  const rejoin = editPayload(stopped); rejoin.effective = "2027-01-10"; rejoin.children[0].subjects = ["tamil"];
  const updated = reviseEnrollment(stopped, rejoin, config, "2026-11-10");
  assert.equal(updated.charges.length, record.charges.length);
  assert.equal(balance(updated.charges), 0);
});

test("approval date anchors weekly and monthly due dates while preserving quoted fees", () => {
  const configured = { ...settings, subjects: [{ id: "monthly", name: "Monthly", price: 2500, frequency: "monthly", active: true }, { id: "weekly", name: "Weekly", price: 700, frequency: "weekly", active: true }] };
  const enrollment = { ...input, year: configured.year, academicStart: configured.start, academicEnd: configured.end, approval: "pending", children: [{ ...input.children[0], subjects: ["monthly", "weekly"] }], charges: buildCharges({ ...input, children: [{ ...input.children[0], subjects: ["monthly", "weekly"] }] }, configured, "2026-10-10") };
  const shiftedPrices = { ...configured, subjects: configured.subjects.map(subject => ({ ...subject, price: subject.price + 500 })) };
  const approved = reschedulePendingEnrollment(enrollment, "2026-11-15", shiftedPrices, "2026-12-01");
  assert.equal(approved.enrollmentDate, "2026-11-15");
  assert.deepEqual(approved.charges.filter(charge => charge.subjectId === "monthly").slice(0, 3).map(charge => charge.due), ["2026-11-15", "2026-12-15", "2027-01-15"]);
  assert.equal(approved.charges.filter(charge => charge.subjectId === "monthly").at(-1).due, "2027-08-15");
  assert.deepEqual(approved.charges.filter(charge => charge.subjectId === "weekly").slice(0, 3).map(charge => charge.due), ["2026-11-15", "2026-11-22", "2026-11-29"]);
  assert.equal(approved.charges.find(charge => charge.subjectId === "monthly").amount, 2500);
  assert.equal(enrollment.charges.find(charge => charge.subjectId === "monthly").due, "2026-10-10");
  assert.throws(() => reschedulePendingEnrollment(enrollment, "2026-08-31", configured, "2026-12-01"), /between the academic-year start/);
  assert.throws(() => reschedulePendingEnrollment(enrollment, "2026-12-02", configured, "2026-12-01"), /between the academic-year start/);
});
