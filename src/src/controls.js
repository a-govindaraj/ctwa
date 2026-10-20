import { dateOnly } from "./billing.js";

export const reviewStatuses = ["checked", "query", "resolved"];
export const currentMatching = receipt => receipt.matchingHistory?.at(-1) || null;
export const activeReceipts = receipts => receipts.filter(receipt => !receipt.reversal);

export function assertReversalAllowed(receipt, record, enrollments) {
  if (receipt.allocations.some(item => item.id === "membership") && record.membership === "lifetime" && enrollments.some(item => item.id !== record.id && item.email === record.email && item.approval === "approved" && item.charges.find(charge => charge.id === "membership")?.amount === 0)) {
    throw new Error("Lifetime membership has been carried forward to another enrollment. Resolve that membership record before reversing this payment.");
  }
}

export function hydrateEnrollment(record, receipts) {
  const charges = record.charges.map(charge => ({ ...charge, paid: 0 }));
  for (const receipt of activeReceipts(receipts).filter(item => item.enrollmentId === record.id)) {
    for (const allocation of receipt.allocations) {
      const charge = charges.find(item => item.id === allocation.id);
      if (!charge) throw new Error("A payment allocation is missing its charge. Contact the system administrator.");
      charge.paid += allocation.amount;
    }
  }
  return { ...record, charges };
}

function note(value, label, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Enter ${label}, up to ${maximum} characters.`);
  return value.trim();
}

function currentRevision(record, payload) {
  if ((record.controlRevision || 0) !== payload.revision) throw new Error("This record has changed. Refresh before saving.");
}

export function reverseReceipt(receipt, payload, actor, timestamp) {
  if (receipt.reversal) {
    if (receipt.reversal.requestId === payload.requestId) return receipt;
    throw new Error("This receipt has already been reversed.");
  }
  currentRevision(receipt, payload);
  if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId)) throw new Error("Invalid correction reference.");
  if (currentMatching(receipt)?.status === "matched") throw new Error("Remove the bank/cash match with a reason before reversing this receipt.");
  return { ...receipt, controlRevision: (receipt.controlRevision || 0) + 1, reversal: { reason: note(payload.reason, "a reversal reason"), actor, savedAt: timestamp, requestId: payload.requestId } };
}

export function matchReceipt(receipt, payload, actor, timestamp, today) {
  currentRevision(receipt, payload);
  if (receipt.reversal) throw new Error("Reversed receipts cannot be matched.");
  if (!["matched", "unmatched"].includes(payload.status)) throw new Error("Choose a valid matching status.");
  if (currentMatching(receipt)?.status === payload.status || payload.status === "unmatched" && !currentMatching(receipt)) throw new Error("The receipt already has this matching status.");
  const reason = note(payload.reason, "a matching note or correction reason");
  const entry = { status: payload.status, reason, actor, savedAt: timestamp };
  if (payload.status === "matched") {
    entry.reference = note(payload.reference, "a bank statement or cash-deposit reference", 300);
    dateOnly(payload.date);
    if (payload.date < receipt.date || payload.date > today) throw new Error("Choose a settlement date between the payment date and today.");
    entry.date = payload.date;
  }
  return { ...receipt, controlRevision: (receipt.controlRevision || 0) + 1, matchingHistory: [...(receipt.matchingHistory || []), entry] };
}

export function reviewTarget(enrollments, receipts, payload) {
  const record = enrollments.find(item => item.id === payload.id);
  if (!record) throw new Error("Enrollment not found.");
  let target;
  if (payload.kind === "receipt") {
    const receipt = receipts.find(item => item.number === payload.targetId && item.enrollmentId === record.id);
    if (!receipt) throw new Error("Receipt not found.");
    target = { number: receipt.number, amount: receipt.amount, allocations: receipt.allocations, reversal: receipt.reversal || null, matchingHistory: receipt.matchingHistory || [] };
  } else if (payload.kind === "charge") {
    const charge = record.charges.find(item => item.id === payload.targetId);
    if (!charge) throw new Error("Charge not found.");
    target = charge;
  } else if (payload.kind === "enrollment" && payload.targetId === record.id) {
    target = { revision: record.revision || 0, approval: record.approval, charges: record.charges };
  } else throw new Error("Choose a receipt, charge or enrollment to review.");
  return { key: JSON.stringify([record.id, payload.kind, payload.targetId]), year: record.year, fingerprint: JSON.stringify(target) };
}

export function saveReview(previous, target, payload, actor, timestamp) {
  if ((previous?.revision || 0) !== payload.revision) throw new Error("This review has changed. Refresh before saving.");
  if (payload.fingerprint !== target.fingerprint) throw new Error("The financial record has changed. Reopen it before reviewing.");
  if (!reviewStatuses.includes(payload.status)) throw new Error("Choose a valid review status.");
  if (payload.status === "resolved" && previous?.status !== "query") throw new Error("Only an open query can be resolved.");
  const entry = { status: payload.status, note: note(payload.note, "review notes"), actor, savedAt: timestamp, fingerprint: target.fingerprint };
  return { id: target.key, enrollmentId: payload.id, kind: payload.kind, targetId: payload.targetId, year: target.year, revision: (previous?.revision || 0) + 1, ...entry, history: [...(previous?.history || []), entry] };
}

export function reviewStatus(review, target) {
  if (!review) return "Not reviewed";
  if (review.fingerprint !== target.fingerprint) return "Needs recheck";
  return { checked: "Checked", query: "Query raised", resolved: "Resolved" }[review.status];
}