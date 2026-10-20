import { activeReceipts, currentMatching, reviewTarget, reviewStatus } from "./controls.js";

const emptyTotals = () => ({ charged: 0, paid: 0, waived: 0, outstanding: 0, dueNow: 0 });

export function buildAnnualReport(enrollments, receipts, year, date, reviews = []) {
  const records = enrollments.filter(record => record.year === year);
  const approved = records.filter(record => record.approval === "approved");
  const ids = new Set(approved.map(record => record.id));
  const allPayments = receipts.filter(receipt => ids.has(receipt.enrollmentId));
  const payments = activeReceipts(allPayments);
  const rows = [];
  const charges = [];
  const changes = [];
  for (const record of approved) {
    const member = `${record.firstName} ${record.surname}`;
    const groups = new Map();
    for (const charge of record.charges) {
      const membership = charge.id === "membership";
      const childIndex = membership ? null : charge.childIndex ?? Number(charge.id.split("-")[0]);
      const subjectId = membership ? "membership" : charge.subjectId ?? charge.id.slice(`${childIndex}-`.length).replace(/-(?:revision-\d+-)?\d+$/, "");
      const key = JSON.stringify([childIndex, subjectId]);
      const student = membership ? "Membership" : record.children[childIndex]?.name || "Student";
      const subject = membership ? charge.description : charge.description.split(" / ").slice(1).join(" / ") || subjectId;
      if (!groups.has(key)) groups.set(key, { enrollmentId: record.id, member, student, subject, ...emptyTotals() });
      const row = groups.get(key);
      const waived = charge.cancelledAmount || 0;
      const outstanding = charge.amount - charge.paid - waived;
      row.charged += charge.amount;
      row.paid += charge.paid;
      row.waived += waived;
      row.outstanding += outstanding;
      if (charge.due <= date) row.dueNow += outstanding;
      charges.push({ ...charge, enrollmentId: record.id, member, student, subject, outstanding });
    }
    rows.push(...groups.values());
    const children = items => items.map(child => ({ name: child.name, subjects: child.subjects }));
    changes.push(...(record.changes || []).map(change => ({ revision: change.revision, effective: change.effective, reason: change.reason, actor: change.actor, savedAt: change.savedAt, before: { children: children(change.before?.children || []) }, after: { children: children(change.after?.children || []) }, enrollmentId: record.id, member })));
  }
  const totals = emptyTotals();
  for (const row of rows) for (const field of Object.keys(totals)) totals[field] += row[field];
  const collected = payments.reduce((total, receipt) => total + receipt.amount, 0);
  const allocationDifference = payments.reduce((total, receipt) => total + Math.abs(receipt.amount - receipt.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)), 0);
  const ledger = new Map();
  for (const receipt of payments) for (const allocation of receipt.allocations) {
    const key = JSON.stringify([receipt.enrollmentId, allocation.id]);
    ledger.set(key, (ledger.get(key) || 0) + allocation.amount);
  }
  let ledgerDifference = 0;
  for (const charge of charges) {
    const key = JSON.stringify([charge.enrollmentId, charge.id]);
    ledgerDifference += Math.abs(charge.paid - (ledger.get(key) || 0));
    ledger.delete(key);
  }
  for (const amount of ledger.values()) ledgerDifference += Math.abs(amount);
  return { year, date, approved: approved.length, pending: records.filter(record => record.approval === "pending").length,
    students: approved.reduce((total, record) => total + record.children.length, 0),
    rows, charges, changes, receipts: allPayments.map(({ email, requestId, ...receipt }) => { void email; void requestId; return receipt; }), reviews: reviews.filter(review => ids.has(review.enrollmentId)).map(review => ({ ...review, displayStatus: reviewStatus(review, reviewTarget(enrollments, receipts, { id: review.enrollmentId, kind: review.kind, targetId: review.targetId })) })), totals, collected, allocationDifference, ledgerDifference,
    matched: payments.filter(receipt => currentMatching(receipt)?.status === "matched").reduce((sum, receipt) => sum + receipt.amount, 0),
    unmatched: payments.filter(receipt => currentMatching(receipt)?.status !== "matched").reduce((sum, receipt) => sum + receipt.amount, 0),
    reversed: allPayments.filter(receipt => receipt.reversal).reduce((sum, receipt) => sum + receipt.amount, 0),
    reconciled: totals.paid === collected && allocationDifference === 0 && ledgerDifference === 0,
  };
}

function csv(rows) {
  const cell = value => {
    const text = String(value ?? "");
    const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return rows.map(row => Array.from({ length: rows[0].length }, (_, index) => cell(row[index])).join(",")).join("\r\n");
}

const pounds = amount => (amount / 100).toFixed(2);

export function annualReportCsv(report) {
  const amounts = row => [row.charged, row.paid, row.waived, row.outstanding, row.dueNow].map(pounds);
  return csv([
    ["Academic year", "Snapshot date", "Enrollment", "Member", "Student", "Subject", "Scheduled fees GBP", "Collected GBP", "Waived GBP", "Outstanding full year GBP", "Due now GBP"],
    ...report.rows.map(row => [report.year, report.date, row.enrollmentId, row.member, row.student, row.subject, ...amounts(row)]),
    [report.year, report.date, "TOTAL", "", "", "", ...amounts(report.totals)],
  ]);
}

export function auditReportCsv(report) {
  return csv([
    ["Type", "Academic year", "Snapshot date", "Enrollment", "Member", "Record ID", "Description", "Due / payment date", "Charge GBP", "Paid / allocation GBP", "Waived GBP", "Outstanding GBP", "Effective date", "Reason", "Actor", "Recorded at", "Payment method", "Reference", "Subjects before (IDs)", "Subjects after (IDs)"],
    ...report.charges.map(charge => ["Charge", report.year, report.date, charge.enrollmentId, charge.member, charge.id, charge.description, charge.due, pounds(charge.amount), pounds(charge.paid), pounds(charge.cancelledAmount || 0), pounds(charge.outstanding), charge.cancelledFrom, charge.cancellationReason]),
    ...report.receipts.flatMap(receipt => [
      [receipt.reversal ? "Reversed receipt (excluded)" : "Receipt", report.year, report.date, receipt.enrollmentId, receipt.name, receipt.number, "Original payment", receipt.date, "", pounds(receipt.amount), "", "", "", "", receipt.recordedBy, "", receipt.method, receipt.reference],
      ...receipt.allocations.map(allocation => [receipt.reversal ? "Reversed allocation (excluded)" : "Allocation", report.year, report.date, receipt.enrollmentId, receipt.name, receipt.number, `${allocation.id}: ${allocation.description}`, allocation.due, "", pounds(allocation.amount), "", "", "", "", receipt.recordedBy, "", receipt.method, receipt.reference]),
      ...(receipt.reversal ? [["Reversal", report.year, report.date, receipt.enrollmentId, receipt.name, receipt.number, "Payment correction; no refund", receipt.reversal.savedAt?.slice(0, 10), "", pounds(-receipt.amount), "", "", "", receipt.reversal.reason, receipt.reversal.actor, receipt.reversal.savedAt]] : []),
      ...(receipt.matchingHistory || []).map(entry => ["Bank/cash match", report.year, report.date, receipt.enrollmentId, receipt.name, receipt.number, entry.status, entry.date, "", "", "", "", "", entry.reason, entry.actor, entry.savedAt, receipt.method, entry.reference]),
    ]),
    ...report.changes.map(change => ["Change", report.year, report.date, change.enrollmentId, change.member, `Revision ${change.revision}`, "Enrollment revision", "", "", "", "", "", change.effective, change.reason, change.actor, change.savedAt, "", "", JSON.stringify((change.before?.children || []).map(child => ({ name: child.name, subjects: child.subjects }))), JSON.stringify((change.after?.children || []).map(child => ({ name: child.name, subjects: child.subjects })))]),
    ...(report.reviews || []).flatMap(review => [
      ["Current review status", report.year, report.date, review.enrollmentId, "", review.targetId, `${review.kind}: ${review.displayStatus}`, "", "", "", "", "", "", review.note, review.actor, review.savedAt],
      ...review.history.map(entry => ["Audit review history", report.year, report.date, review.enrollmentId, "", review.targetId, `${review.kind}: ${entry.status}`, "", "", "", "", "", "", entry.note, entry.actor, entry.savedAt]),
    ]),
  ]);
}

export function createYearSnapshot(report, payload, actor, timestamp, id) {
  if (!/^\d{4}-\d{2}$/.test(report.year || "")) throw new Error("Choose an academic year.");
  if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId)) throw new Error("Invalid snapshot reference.");
  if (typeof payload.label !== "string" || !payload.label.trim() || payload.label.length > 120) throw new Error("Enter a snapshot label, up to 120 characters.");
  if (!report.approved) throw new Error("There are no approved enrollments to snapshot.");
  if (!report.reconciled) throw new Error("Resolve receipt allocation differences before saving a snapshot.");
  return { id, year: report.year, label: payload.label.trim(), requestId: payload.requestId, savedBy: actor, savedAt: timestamp, report: JSON.parse(JSON.stringify(report)), summaryCsv: annualReportCsv(report), auditCsv: auditReportCsv(report) };
}