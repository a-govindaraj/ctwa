import { useEffect, useRef, useState } from "react";
import { Download, FileText, Printer, Search, ShieldCheck, Save } from "lucide-react";
import { money } from "./billing.js";
import { annualReportCsv, auditReportCsv, buildAnnualReport } from "./reports.js";
import { api, today } from "./service.js";
import { currentMatching } from "./controls.js";
import { ReceiptControlDialog, ReviewDialog, SnapshotDialog } from "./AuditControls.jsx";

export default function AnnualReport({ enrollments, receipts, reviews, snapshots, onRefresh, notify, year, years, onYear, onEnrollment, onReceipt }) {
  const [view, setView] = useState("summary");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [receiptControl, setReceiptControl] = useState(null);
  const [reviewSelection, setReviewSelection] = useState(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const report = savedSnapshot?.report || buildAnnualReport(enrollments, receipts, year, today(), reviews);
  const locked = !!savedSnapshot || loadingSnapshot;
  const views = [["summary", "Student & subject"], ["charges", "All charges"], ["receipts", "Receipts"], ["waivers", "Waivers"], ["changes", "Changes"], ["reviews", "Audit reviews"]];
  const waivers = report.charges.filter(charge => charge.cancelledAmount > 0);
  const match = values => values.join(" ").toLowerCase().includes(search.trim().toLowerCase());
  const enrollment = row => locked ? <>{row.member || row.name}<small>{row.enrollmentId}</small></> : <button type="button" className="text-button" onClick={() => onEnrollment(row.enrollmentId)}>{row.member || row.name}<small>{row.enrollmentId}</small></button>;
  const reviewCell = (row, kind, targetId) => {
    const review = report.reviews.find(item => item.enrollmentId === row.enrollmentId && item.kind === kind && item.targetId === targetId);
    const label = review?.displayStatus || "Not reviewed";
    return locked ? label : <button type="button" className="text-button" title={`Review ${kind} ${targetId}`} onClick={() => setReviewSelection({ id: row.enrollmentId, kind, targetId })}><ShieldCheck size={15} />{label}</button>;
  };
  async function saved(message) { await onRefresh(); setReceiptControl(null); setReviewSelection(null); setSavingSnapshot(false); notify(message); }
  async function loadSnapshot(id) {
    if (!id) { setSavedSnapshot(null); return; }
    setLoadingSnapshot(true); setError("");
    try { setSavedSnapshot(await api("getSnapshot", { snapshotId: id })); }
    catch (failure) { setError(failure.message); }
    finally { setLoadingSnapshot(false); }
  }
  const financialHeaders = ["Scheduled", "Collected", "Waived", "Outstanding", "Due now"];
  const amounts = row => [row.charged, row.paid, row.waived, row.outstanding, row.dueNow].map(money);
  let headers;
  let rows;
  if (view === "summary") {
    headers = ["Member / enrollment", "Student", "Subject", ...financialHeaders, "Enrollment review"];
    rows = report.rows.filter(row => match([row.member, row.enrollmentId, row.student, row.subject])).map(row => [enrollment(row), row.student, row.subject, ...amounts(row), reviewCell(row, "enrollment", row.enrollmentId)]);
  } else if (view === "receipts") {
    headers = ["Receipt", "Member / enrollment", "Date", "Original amount", "Method", "Reference", "Payment status", "Bank/cash matching", "Review", "Controls"];
    rows = report.receipts.filter(row => match([row.number, row.name, row.enrollmentId, row.reference || "", row.recordedBy || "", row.reversal ? "reversed" : "active", currentMatching(row)?.status || "unmatched"])).map(row => [<button type="button" className="text-button" onClick={() => onReceipt(row)}><FileText size={15} />{row.number}<small>{row.recordedBy || "Actor not recorded"}</small></button>, enrollment(row), row.date, money(row.amount), row.method, row.reference || "-", row.reversal ? <><b>Reversed</b><small>{row.reversal.reason}<br />{row.reversal.actor} / {row.reversal.savedAt}</small></> : "Active", <details><summary>{currentMatching(row)?.status === "matched" ? "Matched" : "Unmatched"}</summary>{(row.matchingHistory || []).map((entry, index) => <p key={index}>{entry.status} / {entry.reference || "-"} / {entry.date || "-"}<small>{entry.reason}<br />{entry.actor} / {entry.savedAt}</small></p>)}</details>, reviewCell(row, "receipt", row.number), !locked && !row.reversal ? <button type="button" className="text-button" onClick={() => setReceiptControl(row)}><ShieldCheck size={15} />Manage receipt</button> : "-"]);
  } else if (view === "reviews") {
    headers = ["Enrollment", "Type", "Record", "Status", "Latest note", "Reviewed by", "Recorded at", "Review"];
    rows = report.reviews.filter(row => match([row.enrollmentId, row.kind, row.targetId, row.displayStatus, row.note, row.actor])).map(row => [row.enrollmentId, row.kind, row.targetId, row.displayStatus, row.note, row.actor, row.savedAt, reviewCell(row, row.kind, row.targetId)]);
  } else if (view === "changes") {
    headers = ["Member / enrollment", "Revision", "Effective", "Reason", "Changed by", "Recorded at"];
    rows = report.changes.filter(row => match([row.member, row.enrollmentId, row.reason, row.actor || ""])).map(row => [enrollment(row), row.revision, row.effective, row.reason, row.actor || "Not recorded", row.savedAt || "Not recorded"]);
  } else {
    headers = ["Member / enrollment", "Charge / student / subject", "Due", "Amount", "Paid", "Waived", "Outstanding", "Waiver effective", "Reason", "Review"];
    rows = (view === "waivers" ? waivers : report.charges).filter(row => match([row.member, row.enrollmentId, row.id, row.student, row.subject, row.cancellationReason || ""])).map(row => [enrollment(row), <><b>{row.student} / {row.subject}</b><small>{row.id}</small></>, row.due, money(row.amount), money(row.paid), money(row.cancelledAmount || 0), money(row.outstanding), row.cancelledFrom || "-", row.cancellationReason || "-", reviewCell(row, "charge", row.id)]);
  }
  function download(audit) {
    setError("");
    try {
      const content = savedSnapshot ? audit ? savedSnapshot.auditCsv : savedSnapshot.summaryCsv : audit ? auditReportCsv(report) : annualReportCsv(report);
      const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
      urls.current.push(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `CTWA-${audit ? "audit-evidence" : "annual-report"}-${year}-${savedSnapshot ? `${savedSnapshot.id}-` : ""}${report.date}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setError("The report could not be downloaded. Please try again.");
    }
  }
  return <section className="annual-report" aria-labelledby="annual-report-title">
    <div className="page-heading row between"><div><p className="eyebrow">FINANCIAL RECORDS / {year}</p><h1 id="annual-report-title">Annual report & audit</h1><p>{savedSnapshot ? "Saved" : "Current"} snapshot: {report.date}. Enrollment academic year, not payment-date year.</p></div><label className="field report-year"><span>Academic year</span><select value={year} disabled={loadingSnapshot} onChange={event => onYear(event.target.value)}>{years.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <label className="field snapshot-selector"><span>Report version</span><select disabled={loadingSnapshot} value={savedSnapshot?.id || ""} onChange={event => loadSnapshot(event.target.value)}><option value="">Current records</option>{snapshots.filter(item => item.year === year).map(item => <option key={item.id} value={item.id}>{item.label} / {item.savedAt}</option>)}</select></label>
    {loadingSnapshot && <p role="status">Loading saved report...</p>}
    {savedSnapshot && <p className="alert">Fixed copy: {savedSnapshot.label}<br />Saved by {savedSnapshot.savedBy} / {savedSnapshot.savedAt}. Current records may differ.</p>}
    <dl className="report-counts"><div><dt>Approved enrollments</dt><dd>{report.approved}</dd></div><div><dt>Students</dt><dd>{report.students}</dd></div><div><dt>Pending (excluded)</dt><dd>{report.pending}</dd></div><div><dt>Receipts</dt><dd>{report.receipts.length}</dd></div></dl>
    <dl className="report-totals">{financialHeaders.map((label, index) => <div key={label}><dt>{label}{label === "Scheduled" || label === "Outstanding" ? " (full year)" : ""}</dt><dd>{amounts(report.totals)[index]}</dd></div>)}</dl>
    <dl className="report-counts"><div><dt>Bank/cash matched</dt><dd>{money(report.matched)}</dd></div><div><dt>Unmatched collections</dt><dd>{money(report.unmatched)}</dd></div><div><dt>Reversed (excluded)</dt><dd>{money(report.reversed)}</dd></div><div><dt>Open / stale queries</dt><dd>{report.reviews.filter(item => item.status === "query" || item.displayStatus === "Needs recheck").length}</dd></div></dl>
    <p className={`alert${report.reconciled ? "" : " error"}`} role="status">{report.reconciled ? "Receipt allocations reconcile with recorded collections." : `Reconciliation needs attention. Receipt total: ${money(report.collected)}; charge payments: ${money(report.totals.paid)}; receipt allocation differences: ${money(report.allocationDifference)}; charge allocation differences: ${money(report.ledgerDifference)}.`}</p>
    <p className="muted small">Scheduled = collected + waived + outstanding. Full-year totals include future fees. Due now includes unpaid fees due through {report.date}. {savedSnapshot ? "This fixed copy retains the records saved at the time; it is not audit certification." : "This is a current record snapshot, not a historical year-end certification."}</p>
    <div className="report-actions"><button type="button" className="secondary" disabled={loadingSnapshot} onClick={() => download(false)}><Download size={16} />Summary CSV</button><button type="button" className="secondary" disabled={loadingSnapshot} onClick={() => download(true)}><Download size={16} />Audit evidence CSV</button><button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />Print view</button>{!locked && <button type="button" className="secondary" onClick={() => setSavingSnapshot(true)}><Save size={16} />Save fixed snapshot</button>}</div>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="report-toolbar"><div className="tabs" role="tablist" aria-label="Report view">{views.map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={view === value} className={view === value ? "active" : ""} onClick={() => setView(value)}>{label}</button>)}</div><label className="search"><Search size={17} /><input aria-label="Search report records" placeholder="Search report records" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <h2 className="report-view-title">{views.find(([value]) => value === view)[1]} <span className="muted small">({rows.length})</span></h2>
    <div className="table-wrap"><table className="report-table"><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="empty">{search.trim() ? "No matching records." : "No records for this view and academic year."}</p>}</div>
    {receiptControl && !locked && <ReceiptControlDialog receipt={receiptControl} onCancel={() => setReceiptControl(null)} onSaved={saved} />}
    {reviewSelection && !locked && <ReviewDialog selection={reviewSelection} enrollments={enrollments} receipts={receipts} reviews={reviews} onCancel={() => setReviewSelection(null)} onSaved={saved} />}
    {savingSnapshot && !locked && <SnapshotDialog year={year} onCancel={() => setSavingSnapshot(false)} onSaved={saved} />}
  </section>;
}