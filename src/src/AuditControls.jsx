import { useEffect, useId, useRef, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { api, today } from "./service.js";
import { money } from "./billing.js";
import { currentMatching, reviewStatus, reviewTarget } from "./controls.js";

function ControlDialog({ title, onCancel, onSubmit, children, submitLabel = "Save", disabled = false }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await onSubmit(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="reminder-dialog control-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}><form onSubmit={submit}>
    <h2 id={titleId}>{title}</h2><fieldset disabled={busy} className="control-fields">{children}</fieldset>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="reminder-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button disabled={busy || disabled}><Check size={16} />{busy ? "Saving..." : submitLabel}</button></div>
  </form></dialog>;
}

export function ReceiptControlDialog({ receipt, onCancel, onSaved }) {
  const matched = currentMatching(receipt)?.status === "matched";
  const [action, setAction] = useState(matched ? "unmatched" : "matched");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today());
  const requestId = useRef(crypto.randomUUID());
  return <ControlDialog title={`Receipt controls: ${receipt.number}`} onCancel={onCancel} disabled={!!receipt.reversal} submitLabel={action === "reverse" ? "Reverse payment" : "Save matching"} onSubmit={async () => {
    const result = await api(action === "reverse" ? "reversePayment" : "matchPayment", { id: receipt.enrollmentId, number: receipt.number, revision: receipt.controlRevision || 0, reason, reference, date, status: action, requestId: requestId.current });
    await onSaved(result.message);
  }}>
    <p>{receipt.name} / {money(receipt.amount)}</p>
    <label className="field"><span>Action</span><select value={action} onChange={event => setAction(event.target.value)}>{!matched && <option value="matched">Match to bank statement / cash deposit</option>}{matched && <option value="unmatched">Remove bank/cash match</option>}<option value="reverse" disabled={matched}>Reverse incorrect payment</option></select></label>
    {action === "matched" && <><label className="field"><span>Statement or deposit reference</span><input required maxLength={300} value={reference} onChange={event => setReference(event.target.value)} /></label><label className="field"><span>Settlement date</span><input type="date" required min={receipt.date} max={today()} value={date} onChange={event => setDate(event.target.value)} /></label></>}
    {action === "reverse" && <p className="alert">The full {money(receipt.amount)} will be reversed. Fees become unpaid again. The original receipt stays on record. No money is refunded. Record a replacement payment separately.</p>}
    <label className="field"><span>Reason / evidence note</span><textarea required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <details className="control-history"><summary>Matching and correction history</summary>{!(receipt.matchingHistory || []).length && !receipt.reversal && <p>No matching or correction history.</p>}{(receipt.matchingHistory || []).map((entry, index) => <p key={index}><b>{entry.status}</b> / {entry.reference || "-"} / {entry.date || "-"}<br />{entry.reason}<small>{entry.actor} / {entry.savedAt}</small></p>)}{receipt.reversal && <p><b>Reversed</b><br />{receipt.reversal.reason}<small>{receipt.reversal.actor} / {receipt.reversal.savedAt}</small></p>}</details>
  </ControlDialog>;
}

export function ReviewDialog({ selection, enrollments, receipts, reviews, onCancel, onSaved }) {
  const [target] = useState(() => reviewTarget(enrollments, receipts, selection));
  const [previous] = useState(() => reviews.find(item => item.id === target.key));
  const [status, setStatus] = useState("checked");
  const [note, setNote] = useState("");
  return <ControlDialog title="Audit sample review" onCancel={onCancel} submitLabel="Save review" onSubmit={async () => {
    const result = await api("saveAuditReview", { ...selection, revision: previous?.revision || 0, fingerprint: target.fingerprint, status, note });
    await onSaved(result.message);
  }}>
    <p><ShieldCheck size={16} /> {selection.id} / {selection.kind} / {selection.targetId}</p><p>Current status: {reviewStatus(previous, target)}</p>
    <label className="field"><span>Review status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="checked">Checked</option><option value="query">Query raised</option><option value="resolved" disabled={previous?.status !== "query"}>Resolved</option></select></label>
    <label className="field"><span>Review notes / evidence reference</span><textarea required rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
    {previous?.history.length > 0 && <details className="control-history"><summary>Review history ({previous.history.length})</summary>{previous.history.map((entry, index) => <p key={index}><b>{entry.status}</b><br />{entry.note}<small>{entry.actor} / {entry.savedAt}</small></p>)}</details>}
  </ControlDialog>;
}

export function SnapshotDialog({ year, onCancel, onSaved }) {
  const [label, setLabel] = useState("");
  const requestId = useRef(crypto.randomUUID());
  return <ControlDialog title={`Save fixed report: ${year}`} onCancel={onCancel} submitLabel="Save snapshot" onSubmit={async () => {
    const result = await api("saveSnapshot", { year, label, requestId: requestId.current });
    await onSaved(result.message);
  }}><label className="field"><span>Snapshot label</span><input required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label><p>Contains the current full-year report, matching, reversals and audit-review evidence. Later changes will not update this saved copy. This does not lock the academic year or certify bank balances.</p></ControlDialog>;
}