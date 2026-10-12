import {
  allocatePayment,
  balance,
  buildCharges,
  validateEnrollment,
  validateSettings,
  prepareSettings,
  reviseEnrollment,
  reschedulePendingEnrollment,
} from "./billing.js";
import demoData from "./demo-data.json";

export const demo = import.meta.env.VITE_DEMO !== "false";
export const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
let credential = "";
export const setCredential = (value) => {
  credential = value;
};
const state = demo ? { settings: structuredClone(demoData.settings), enrollments: [], receipts: [], members: structuredClone(demoData.members) } : null;
const id = (prefix) =>
  `${prefix}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

function enroll(input, requestId) {
  const existing = state.enrollments.find(
    (item) => item.requestId === requestId,
  );
  if (existing) return { id: existing.id };
  validateEnrollment(input, state.settings, today());
  if (
    state.enrollments.some(
      (item) =>
        item.email.toLowerCase() === input.email.trim().toLowerCase() &&
        item.year === state.settings.year,
    )
  )
    throw new Error(
      "This email already has an enrollment for this year. Please contact the admin.",
    );
  const record = {
    ...structuredClone(input),
    email: input.email.trim().toLowerCase(),
    id: id("CTWA"),
    requestId,
    year: state.settings.year,
    academicStart: state.settings.start,
    academicEnd: state.settings.end,
    created: today(),
    approval: "pending",
    charges: buildCharges(input, state.settings, today()),
  };
  state.enrollments.push(record);
  return { id: record.id };
}

if (demo) {
  validateSettings(state.settings);
  const seedIds = new Set();
  for (const sample of demoData.enrollments) {
    if (!sample.id || seedIds.has(sample.id) || !["pending", "approved"].includes(sample.approval)) throw new Error("Demo enrollments need unique IDs and a valid approval status.");
    seedIds.add(sample.id);
    const { id: seedId, approval, ...input } = sample;
    const result = enroll(input, `demo-${seedId}`);
    const record = state.enrollments.find(item => item.id === result.id);
    record.id = seedId;
    record.approval = approval;
  }
  for (const payment of demoData.payments) {
    const record = state.enrollments.find(item => item.id === payment.enrollmentId);
    if (!record || record.approval !== "approved" || !payment.requestId || !["cash", "bank transfer", "card", "cheque"].includes(payment.method) || state.receipts.some(receipt => receipt.requestId === payment.requestId)) throw new Error("Invalid demo payment.");
    const result = allocatePayment(record.charges, payment.amount);
    record.charges = result.charges;
    state.receipts.push({ number: `CTWA-R-${String(state.receipts.length + 1).padStart(6, "0")}`, requestId: payment.requestId, enrollmentId: record.id, name: `${record.firstName} ${record.surname}`, email: record.email, date: today(), amount: payment.amount, method: payment.method, reference: payment.reference || "", allocations: result.allocations, emailStatus: "demo" });
  }
}

async function demoRequest(action, payload) {
  if (action === "config") return structuredClone(state.settings);
  if (action === "dashboard") return structuredClone(state);
  if (action === "remindAll") {
    const candidates = state.enrollments.filter(item => item.year === payload.year && item.approval === "approved" && balance(item.charges, today()) > 0);
    let sent = 0; let skipped = 0;
    candidates.forEach(item => { if (item.lastReminder === today()) skipped++; else { item.lastReminder = today(); sent++; } });
    return { sent, skipped, failed: 0, deferred: 0, message: `Demo reminders for ${payload.year}: ${sent} recorded, ${skipped} already reminded today. No emails were sent.` };
  }
  if (action === "enroll") return enroll(payload.input, payload.requestId);
  if (action === "settings") {
    state.settings = prepareSettings(payload.settings, state.settings, new Date().toISOString());
    return { ok: true };
  }
  const record = state.enrollments.find((item) => item.id === payload.id);
  if (!record) throw new Error("Enrollment not found.");
  if (action === "editEnrollment") {
    Object.assign(record, reviseEnrollment(record, payload, state.settings, today()));
    record.changes[record.changes.length - 1].actor = "Demo admin";
    record.changes[record.changes.length - 1].savedAt = new Date().toISOString();
    return { message: "Enrollment updated. Earlier fees and receipts are unchanged; prepaid fees are retained." };
  }
  if (action === "approve") {
    if (record.approval === "pending") Object.assign(record, reschedulePendingEnrollment(record, payload.enrollmentDate || today(), state.settings, today()));
    record.approval = "approved";
    record.enrollmentDate = record.enrollmentDate || today();
    if (
      state.members.some(
        (member) => member.email === record.email && member.lifetime,
      )
    ) {
      record.charges[0].amount = 0;
      record.charges[0].description = "Previously paid lifetime membership";
    }
    return { ok: true };
  }
  if (action === "verifyLifetime") {
    if (record.charges[0].paid > 0)
      throw new Error(
        "Membership payment is already recorded. Do not change paid charges.",
      );
    if (typeof payload.reference !== "string" || !payload.reference.trim() || payload.reference.length > 300) throw new Error("Enter the previous lifetime membership receipt or paper-record reference.");
    state.members.push({ email: record.email, lifetime: true, previousPaymentReference: payload.reference.trim() });
    record.charges[0].amount = 0;
    record.charges[0].description = "Previously paid lifetime membership";
    return {
      message: "Previously paid lifetime membership verified. No new membership fee is due. No money was refunded; subject fees are unchanged.",
    };
  }
  if (action === "payment") {
    const existing = state.receipts.find(
      (item) => item.requestId === payload.requestId,
    );
    if (existing) return structuredClone(existing);
    if (record.approval !== "approved")
      throw new Error("Approve the enrollment before collecting payment.");
    if (!["cash", "bank transfer", "card", "cheque"].includes(payload.method))
      throw new Error("Choose a payment method.");
    const result = allocatePayment(record.charges, payload.amount);
    const receipt = {
      number: `CTWA-R-${String(state.receipts.length + 1).padStart(6, "0")}`,
      requestId: payload.requestId,
      enrollmentId: record.id,
      name: `${record.firstName} ${record.surname}`,
      email: record.email,
      date: today(),
      amount: payload.amount,
      method: payload.method,
      reference: payload.reference,
      allocations: result.allocations,
      emailStatus: "demo",
    };
    record.charges = result.charges;
    state.receipts.push(receipt);
    if (
      record.membership === "lifetime" &&
      record.charges[0].paid === record.charges[0].amount &&
      !state.members.some((member) => member.email === record.email)
    )
      state.members.push({ email: record.email, lifetime: true });
    return structuredClone(receipt);
  }
  if (action === "remind") {
    if (balance(record.charges, today()) <= 0 || record.approval !== "approved")
      throw new Error("No approved fees are currently due.");
    record.lastReminder = today();
    return { message: "Demo reminder recorded. No email was sent." };
  }
  if (action === "retryReceipt")
    return { message: "Demo receipt. No email was sent." };
  throw new Error("Unknown action.");
}

export async function api(action, payload = {}) {
  if (demo) return demoRequest(action, payload);
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, payload, credential }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(
      data.error || "Unable to complete the request. Please try again.",
    );
  return data.result;
}
