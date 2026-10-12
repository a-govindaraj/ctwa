import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
