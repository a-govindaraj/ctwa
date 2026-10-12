import { balance, buildCharges, money, receiptHtml, membershipPrices } from "./billing.js";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api, demo, setCredential, today } from "./service.js";
import SecurityCheck from "./SecurityCheck.jsx";
import { Printer } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { Pencil } from "lucide-react";
import "./App.css";

const emptyChild = () => ({
  name: "",
  dob: "",
  class: "",
  index: "",
  subjects: [],
  photo: "",
});
const emptyForm = () => ({
  firstName: "",
  surname: "",
  address: "",
  postcode: "",
  email: "",
  mobile: "",
  telephone: "",
  membership: "annual",
  consent: false,
  children: [],
});
const dateLabel = (value) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}

function EnrollmentForm({ settings, admin, onDone }) {
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const update = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const updateChild = (index, field, value) =>
    setForm((current) => ({
      ...current,
      children: current.children.map((child, childIndex) =>
        childIndex === index ? { ...child, [field]: value } : child,
      ),
    }));
  const charges = buildCharges(form, settings, today());
  const due = balance(
    charges,
    today() < settings.start ? settings.start : today(),
  );
  async function photo(index, file) {
    if (!file) return updateChild(index, "photo", "");
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 1000000
    ) {
      setError("Choose a JPG or PNG photo under 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateChild(index, "photo", reader.result);
    reader.onerror = () => setError("Unable to read that photo.");
    reader.readAsDataURL(file);
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (step === 1 && form.children.some((child) => !child.subjects.length)) {
      setError("Choose at least one subject for each child.");
      return;
    }
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const result = await api("enroll", {
        input: form,
        requestId: requestId.current,
        captcha,
      });
      setSuccess(result.id);
      onDone?.();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
      setCaptchaKey((value) => value + 1);
    }
  }
  if (success)
    return (
      <section className="success-panel">
        <CheckCircle2 size={44} />
        <p className="eyebrow">APPLICATION RECEIVED</p>
        <h1>Thank you, {form.firstName}.</h1>
        <p>Your enrollment reference</p>
        <strong className="reference">{success}</strong>
        <p>
          Your application is awaiting review. A receipt will be issued after
          payment is confirmed.
        </p>
        <button
          onClick={() => {
            setForm(emptyForm());
            setStep(0);
            setSuccess("");
            requestId.current = crypto.randomUUID();
          }}
        >
          <Plus size={17} />
          New enrollment
        </button>
      </section>
    );
  return (
    <div className="enrollment-layout">
      <section className="form-main">
        <div className="page-heading">
          <p className="eyebrow">MEMBERSHIP & STUDENT ENROLLMENT</p>
          <h1>{admin ? "Enroll a family" : "Join our community"}</h1>
          <p>
            Coventry Tamil Academy of Language & Arts{" "}
            <span className="dot">/</span> {settings.year}
          </p>
        </div>
        <ol className="steps">
          {["Member details", "Children & subjects", "Review & submit"].map(
            (label, index) => (
              <li
                key={label}
                className={
                  step === index ? "current" : step > index ? "complete" : ""
                }
              >
                <span>{step > index ? <Check size={15} /> : index + 1}</span>
                <b>{label}</b>
              </li>
            ),
          )}
        </ol>
        <form onSubmit={submit}>
          {step === 0 && (
            <>
              <div className="section-title">
                <Users size={20} />
                <h2>Member details</h2>
              </div>
              <div className="fields two">
                <Field
                  label="First name"
                  required
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(event) => update("firstName", event.target.value)}
                  maxLength={100}
                />
                <Field
                  label="Surname"
                  required
                  autoComplete="family-name"
                  value={form.surname}
                  onChange={(event) => update("surname", event.target.value)}
                  maxLength={100}
                />
              </div>
              <Field label="Postal address">
                <textarea
                  required
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(event) => update("address", event.target.value)}
                  maxLength={300}
                  rows={2}
                />
              </Field>
              <div className="fields two">
                <Field
                  label="Postcode"
                  required
                  autoComplete="postal-code"
                  value={form.postcode}
                  onChange={(event) => update("postcode", event.target.value)}
                  maxLength={20}
                />
                <Field
                  label="Email address"
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  maxLength={150}
                />
              </div>
              <div className="fields two">
                <Field
                  label="Mobile number"
                  required
                  type="tel"
                  autoComplete="tel"
                  value={form.mobile}
                  onChange={(event) => update("mobile", event.target.value)}
                  maxLength={30}
                />
                <Field
                  label="Telephone (optional)"
                  type="tel"
                  value={form.telephone}
                  onChange={(event) => update("telephone", event.target.value)}
                  maxLength={30}
                />
              </div>
              <h2 className="spaced">Membership</h2>
              <div className="membership-options">
                {[
                  ["annual", "Annual membership", membershipPrices(settings).annual],
                  ["lifetime", "Lifetime membership", membershipPrices(settings).lifetime],
                ].map(([value, label, amount]) => (
                  <label
                    key={value}
                    className={form.membership === value ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="membership"
                      value={value}
                      checked={form.membership === value}
                      onChange={() => update("membership", value)}
                    />
                    <span>
                      <b>{label}</b>
                      <small>
                        {value === "annual"
                          ? `Academic year ${settings.year}`
                          : "One-time membership fee"}
                      </small>
                    </span>
                    <strong>{money(amount)}</strong>
                  </label>
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="section-title">
                <Users size={20} />
                <h2>Children & subjects</h2>
              </div>
              {form.children.map((child, index) => (
                <section className="child-section" key={index}>
                  <div className="row between">
                    <h3>Child {index + 1}</h3>
                    <button
                      type="button"
                      className="icon-button danger"
                      title={`Remove child ${index + 1}`}
                      aria-label={`Remove child ${index + 1}`}
                      onClick={() =>
                        update(
                          "children",
                          form.children.filter(
                            (_, childIndex) => childIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <div className="fields two">
                    <Field
                      label="Child's name"
                      required
                      value={child.name}
                      maxLength={150}
                      onChange={(event) =>
                        updateChild(index, "name", event.target.value)
                      }
                    />
                    <Field
                      label="Date of birth"
                      type="date"
                      required
                      max={today()}
                      value={child.dob}
                      onChange={(event) =>
                        updateChild(index, "dob", event.target.value)
                      }
                    />
                  </div>
                  <div className="fields two">
                    <Field
                      label="Class (optional)"
                      value={child.class}
                      maxLength={50}
                      onChange={(event) =>
                        updateChild(index, "class", event.target.value)
                      }
                    />
                    <Field
                      label="Student index number (if known)"
                      value={child.index}
                      maxLength={50}
                      onChange={(event) =>
                        updateChild(index, "index", event.target.value)
                      }
                    />
                  </div>
                  <Field
                    label="Admission photo (optional, JPG/PNG, max 1 MB)"
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={(event) => photo(index, event.target.files[0])}
                  />
                  {child.photo && (
                    <img
                      className="photo-preview"
                      src={child.photo}
                      alt={`${child.name || "Child"} admission photo`}
                    />
                  )}
                  <fieldset className="subjects">
                    <legend>Subjects</legend>
                    {settings.subjects
                      .filter((subject) => subject.active)
                      .map((subject) => (
                        <label
                          key={subject.id}
                          className={
                            child.subjects.includes(subject.id)
                              ? "selected"
                              : ""
                          }
                        >
                          <input
                            type="checkbox"
                            checked={child.subjects.includes(subject.id)}
                            onChange={(event) =>
                              updateChild(
                                index,
                                "subjects",
                                event.target.checked
                                  ? [...child.subjects, subject.id]
                                  : child.subjects.filter(
                                      (id) => id !== subject.id,
                                    ),
                              )
                            }
                          />
                          <span>
                            {subject.name}
                            <small>
                              {money(subject.price)} /{" "}
                              {subject.frequency === "annually"
                                ? "year"
                                : subject.frequency === "monthly"
                                  ? "month"
                                  : "week"}
                            </small>
                          </span>
                        </label>
                      ))}
                  </fieldset>
                </section>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={form.children.length >= 10}
                onClick={() =>
                  update("children", [...form.children, emptyChild()])
                }
              >
                <Plus size={17} />
                Add child
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <div className="section-title">
                <FileText size={20} />
                <h2>Review your enrollment</h2>
              </div>
              <div className="review-block">
                <h3>
                  {form.firstName} {form.surname}
                </h3>
                <p>
                  {form.address}, {form.postcode}
                </p>
                <p>
                  {form.email} <span className="dot">/</span> {form.mobile}
                </p>
                <span className="badge">
                  {form.membership === "annual" ? "Annual" : "Lifetime"}{" "}
                  membership
                </span>
              </div>
              {form.children.map((child, index) => (
                <div className="review-block" key={index}>
                  <h3>{child.name}</h3>
                  <p>{dateLabel(child.dob)}</p>
                  <p>
                    {child.subjects
                      .map(
                        (id) =>
                          settings.subjects.find((subject) => subject.id === id)
                            ?.name,
                      )
                      .join(", ")}
                  </p>
                </div>
              ))}
              <label className="consent">
                <input
                  required
                  type="checkbox"
                  checked={form.consent}
                  onChange={(event) => update("consent", event.target.checked)}
                />
                <span>
                  I agree to abide by CTWA's Constitution and Rules and
                  Regulations, and acknowledge the{" "}
                  <a
                    href={
                      import.meta.env.VITE_PRIVACY_URL ||
                      "https://tamils.org.uk/"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    privacy notice
                  </a>
                  .
                </span>
              </label>
            </>
          )}
          {step === 2 && !demo && !admin && (
            <SecurityCheck key={captchaKey} onToken={setCaptcha} />
          )}
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          <div className="form-actions">
            {step > 0 ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setStep(step - 1);
                  setError("");
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              disabled={
                busy ||
                !settings.feesConfigured ||
                (!demo && !import.meta.env.VITE_PRIVACY_URL) ||
                (step === 2 && !demo && !admin && !captcha)
              }
              type="submit"
            >
              {busy
                ? "Submitting..."
                : step === 2
                  ? "Submit enrollment"
                  : "Continue"}
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </section>
      <aside className="enrollment-summary">
        <p className="eyebrow">YOUR ENROLLMENT</p>
        <h2>{settings.year}</h2>
        <p className="muted">
          {dateLabel(settings.start)} - {dateLabel(settings.end)}
        </p>
        <div className="summary-line">
          <span>
            {form.membership === "annual" ? "Annual" : "Lifetime"} membership
          </span>
          <b>{money(membershipPrices(settings)[form.membership])}</b>
        </div>
        {form.children.map((child, index) => (
          <div key={index} className="summary-child">
            <b>{child.name || `Child ${index + 1}`}</b>
            {child.subjects.map((id) => {
              const subject = settings.subjects.find((item) => item.id === id);
              return (
                <div className="summary-line" key={id}>
                  <span>
                    {subject.name}
                    <small>{subject.frequency}</small>
                  </span>
                  <b>{money(subject.price)}</b>
                </div>
              );
            })}
          </div>
        ))}
        <div className="summary-total">
          <span>Initial fees</span>
          <strong>{money(due)}</strong>
        </div>
        <p className="muted small">
          Subject charges start{" "}
          {dateLabel(today() < settings.start ? settings.start : today())}.
          Existing lifetime membership is verified during approval.
        </p>
        <div className="summary-note">
          <ShieldCheck size={20} />
          <span>
            Payment is confirmed by the charity after your application is
            reviewed.
          </span>
        </div>
      </aside>
    </div>
  );
}

function FeeSettings({ settings, onSaved }) {
  const [draft, setDraft] = useState(() => ({ ...structuredClone(settings), membershipFees: { ...membershipPrices(settings) } }));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedCount = draft.subjects.filter(subject => subject.deleted).length;
  function toggleDeleted(subject) {
    if (!subject.deleted && !window.confirm(`Delete ${subject.name || "this subject"}? Existing enrollments, charges and receipts will be retained.`)) return;
    setDraft(current => ({ ...current, subjects: current.subjects.map(item => item.id === subject.id ? { ...item, name: item.name.trim() || "Unnamed subject", deleted: !item.deleted, active: false } : item) }));
    setMessage(subject.deleted ? "Subject restored. Select Open and save fees to offer it again." : "Subject marked as deleted. Save fees to apply.");
  }
  const change = (id, field, value) =>
    setDraft((current) => ({
      ...current,
      subjects: current.subjects.map((subject) =>
        subject.id === id ? { ...subject, [field]: value } : subject,
      ),
    }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("settings", { settings: draft });
      await onSaved();
      setMessage("Fees saved. Existing enrollment charges are unchanged.");
    } catch (failure) {
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="page-heading">
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>Subjects & fees</h1>
      </div>
      <div className="fields three">
        <Field
          label="Academic year"
          required
          pattern="[0-9]{4}-[0-9]{2}"
          value={draft.year}
          onChange={(event) => setDraft({ ...draft, year: event.target.value })}
        />
        <Field
          label="Year starts"
          required
          type="date"
          value={draft.start}
          onChange={(event) =>
            setDraft({ ...draft, start: event.target.value })
          }
        />
        <Field
          label="Year ends"
          required
          type="date"
          value={draft.end}
          onChange={(event) => setDraft({ ...draft, end: event.target.value })}
        />
      </div>
      <h2>Membership fees</h2>
      <div className="fields two">
        <Field label="Annual membership (GBP)" type="number" required min="0" max="10000" step="0.01" disabled={busy} value={draft.membershipFees.annual / 100} onChange={event => setDraft(current => ({ ...current, membershipFees: { ...current.membershipFees, annual: Math.round(Number(event.target.value) * 100) } }))} />
        <Field label="Lifetime membership (GBP)" type="number" required min="0" max="10000" step="0.01" disabled={busy} value={draft.membershipFees.lifetime / 100} onChange={event => setDraft(current => ({ ...current, membershipFees: { ...current.membershipFees, lifetime: Math.round(Number(event.target.value) * 100) } }))} />
      </div>
      <h2>Subject fees</h2>
      <div className="fee-list">
        <label className="deleted-toggle"><input type="checkbox" checked={showDeleted} onChange={event => setShowDeleted(event.target.checked)} />Show deleted subjects ({deletedCount})</label>
        {draft.subjects.filter(subject => showDeleted || !subject.deleted).map((subject) => (
          <div className={`fee-row${subject.deleted ? " deleted" : ""}`} key={subject.id}>
            <Field
              label="Subject"
              required
              disabled={subject.deleted || busy}
              value={subject.name}
              maxLength={80}
              onChange={(event) =>
                change(subject.id, "name", event.target.value)
              }
            />
            <Field
              label="Price (GBP)"
              disabled={subject.deleted || busy}
              type="number"
              min="0"
              max="10000"
              step="0.01"
              required
              value={subject.price / 100}
              onChange={(event) =>
                change(
                  subject.id,
                  "price",
                  Math.round(Number(event.target.value) * 100),
                )
              }
            />
            <Field label="Billing">
              <select
                disabled={subject.deleted || busy}
                value={subject.frequency}
                onChange={(event) =>
                  change(subject.id, "frequency", event.target.value)
                }
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annually">Annually</option>
              </select>
            </Field>
            <label className="active-check">
              <input
                type="checkbox"
                disabled={subject.deleted || busy}
                checked={subject.active}
                onChange={(event) =>
                  change(subject.id, "active", event.target.checked)
                }
              />
              Open
            </label>
            <div className="subject-action">
              {subject.deleted && <span className="badge">Deleted</span>}
              <button type="button" className={`icon-button${subject.deleted ? "" : " danger"}`} disabled={busy} title={`${subject.deleted ? "Restore" : "Delete"} ${subject.name || "subject"}`} aria-label={`${subject.deleted ? "Restore" : "Delete"} ${subject.name || "subject"}`} onClick={() => toggleDeleted(subject)}>
                {subject.deleted ? <RotateCcw size={17} /> : <Trash2 size={17} />}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="row between">
        <button
          className="secondary"
          type="button"
          disabled={busy || draft.subjects.filter(subject => !subject.deleted).length >= 30 || draft.subjects.length >= 200}
          onClick={() =>
            setDraft({
              ...draft,
              subjects: [
                ...draft.subjects,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  price: 0,
                  frequency: "annually",
                  active: true,
                },
              ],
            })
          }
        >
          <Plus size={16} />
          Add subject
        </button>
        <button disabled={busy}>
          <Check size={16} />
          {busy ? "Saving..." : "Save fees"}
        </button>
      </div>
      {message && (
        <p role="status" className="alert">
          {message}
        </p>
      )}
    </form>
  );
}

function ReceiptView({ receipt, onClose }) {
  const dialog = useRef(null);
  const printFrame = useRef(null);
  const [printReady, setPrintReady] = useState(false);
  const downloadUrls = useRef([]);
  useEffect(() => () => downloadUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [
      ...dialog.current.querySelectorAll("button, a[href]"),
    ];
    focusable()[0]?.focus();
    const keyboard = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = focusable();
        if (event.shiftKey && document.activeElement === elements[0]) {
          event.preventDefault();
          elements.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === elements.at(-1)
        ) {
          event.preventDefault();
          elements[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [onClose]);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([receiptHtml(receipt)], { type: "text/html" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${receipt.number}.html`;
    downloadUrls.current.push(url);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
      >
        <div className="row between">
          <h2 id="receipt-title">Payment receipt</h2>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <iframe ref={printFrame} className="receipt-preview" title="Printable receipt" sandbox="allow-same-origin allow-modals" onLoad={() => setPrintReady(true)} srcDoc={receiptHtml(receipt)} />
        <p className="muted">
          Email:{" "}
          {receipt.emailStatus === "demo"
            ? "not sent (demo)"
            : receipt.emailStatus}
        </p>
        <div className="receipt-actions">
          <button disabled={!printReady} onClick={() => printFrame.current.contentWindow.print()}><Printer size={16} />Print receipt</button>
          <button className="secondary" onClick={download}><Download size={16} />Download receipt</button>
        </div>
      </section>
    </div>
  );
}

function EnrollmentEditor({ record, settings, onSaved, onCancel }) {
  const dialog = useRef(null);
  const [details, setDetails] = useState(() => Object.fromEntries(["firstName", "surname", "address", "postcode", "mobile", "telephone"].map(field => [field, record[field] || ""])));
  const [children, setChildren] = useState(() => record.children.map(child => ({ name: child.name, dob: child.dob, class: child.class || "", index: child.index || "", subjects: [...child.subjects] })));
  const [effective, setEffective] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unpaidApplication = record.approval === "pending" && record.charges.every(charge => charge.paid === 0);
  const updateChild = (index, field, value) => setChildren(current => current.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child));
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const handleCancel = event => { event.preventDefault(); onCancel(); };
    element.addEventListener("cancel", handleCancel);
    return () => { element.removeEventListener("cancel", handleCancel); element.close(); };
  }, [onCancel]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api("editEnrollment", { id: record.id, revision: record.revision || 0, details, children, effective, reason }); await onSaved(result.message); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="enrollment-editor-dialog" aria-labelledby="enrollment-editor-title"><form className="enrollment-editor" onSubmit={save}>
    <header className="editor-heading"><div><p className="eyebrow">{record.id}</p><h2 id="enrollment-editor-title">Edit enrollment</h2></div><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Close</button></header>
    <details className="editor-disclosure"><summary><b>Member details</b><small>{record.firstName} {record.surname} · {record.email}</small></summary>
    <div className="fields two">{[["firstName", "First name"], ["surname", "Surname"], ["address", "Postal address"], ["postcode", "Postcode"], ["mobile", "Mobile number"], ["telephone", "Telephone (optional)"]].map(([field, label]) => <Field key={field} label={label} required={field !== "telephone"} maxLength={300} value={details[field]} disabled={busy} onChange={event => setDetails({ ...details, [field]: event.target.value })} />)}</div>
    <p className="muted small">Member email and membership type remain unchanged.</p></details>
    {children.map((child, index) => {
      const selectedIds = new Set(record.children[index].subjects);
      const options = settings.subjects.filter(subject => selectedIds.has(subject.id) || settings.year === record.year && subject.active && !subject.deleted);
      for (const id of selectedIds) if (!options.some(subject => subject.id === id)) {
        const charge = record.charges.find(item => item.subjectId === id && item.childIndex === index || item.id.startsWith(`${index}-${id}-`));
        options.push({ id, name: charge?.description.split(" / ").slice(1).join(" / ") || id });
      }
      const subjectNames = options.filter(subject => child.subjects.includes(subject.id)).map(subject => subject.name).join(", ") || "No subjects selected";
      return <details className="editor-disclosure child-editor-disclosure" key={index}><summary><b>Child {index + 1}: {child.name}</b><small>{subjectNames}</small></summary><section className="child-section"><div className="fields two"><Field label="Child's name" required maxLength={150} value={child.name} disabled={busy} onChange={event => updateChild(index, "name", event.target.value)} /><Field label="Date of birth" required type="date" max={today()} value={child.dob} disabled={busy} onChange={event => updateChild(index, "dob", event.target.value)} /><Field label="Class (optional)" maxLength={50} value={child.class} disabled={busy} onChange={event => updateChild(index, "class", event.target.value)} /><Field label="Student index number" maxLength={50} value={child.index} disabled={busy} onChange={event => updateChild(index, "index", event.target.value)} /></div>
        <fieldset className="subjects"><legend>Subjects</legend>{options.map(subject => <label key={subject.id} className={child.subjects.includes(subject.id) ? "selected" : ""}><input type="checkbox" disabled={busy} checked={child.subjects.includes(subject.id)} onChange={event => updateChild(index, "subjects", event.target.checked ? [...child.subjects, subject.id] : child.subjects.filter(id => id !== subject.id))} /><span>{subject.name}<small>{selectedIds.has(subject.id) ? "Existing enrollment price retained" : `${money(subject.price)} / ${subject.frequency}`}</small></span></label>)}</fieldset></section></details>;
    })}
    {unpaidApplication ? <p className="small muted">Unpaid application: subject changes apply from the original enrollment start.</p> : <Field label="Subject changes effective from" type="date" required min={today()} max={record.academicEnd || (settings.year === record.year ? settings.end : undefined)} value={effective} disabled={busy} onChange={event => setEffective(event.target.value)} />}
    <p className="small muted">Removed subjects stop unpaid charges from this date. Earlier charges and receipts stay unchanged. Paid amounts are retained; no automatic refund or proration.</p>
    <Field label="Reason for change"><textarea required maxLength={300} rows={2} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button disabled={busy}><Check size={16} />{busy ? "Saving..." : "Save enrollment changes"}</button></div>
  </form></dialog>;
}

function FeeSchedule({ charges }) {
  const [page, setPage] = useState(0);
  const date = today();
  const outstanding = charge => charge.amount - charge.paid - (charge.cancelledAmount || 0) > 0;
  const filtered = charges.filter(charge => charge.due <= date && outstanding(charge)).sort((left, right) => left.due.localeCompare(right.due));
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="fee-schedule" aria-labelledby="fee-schedule-title">
    <div className="fee-schedule-heading"><h2 id="fee-schedule-title">Payment due</h2><span className="muted small">{filtered.length} unpaid charges due</span></div>
    <div className="table-wrap"><table className="fee-schedule-table"><thead><tr><th scope="col">Payment for</th><th scope="col">Due date</th><th scope="col">Amount</th><th scope="col">Paid</th><th scope="col">Cancelled</th></tr></thead><tbody>{visible.map(charge => <tr key={charge.id}><td>{charge.description}</td><td>{dateLabel(charge.due)}</td><td>{money(charge.amount)}</td><td>{money(charge.paid)}</td><td>{money(charge.cancelledAmount || 0)}</td></tr>)}</tbody></table>{!visible.length && <p className="empty">No unpaid fees are currently due.</p>}</div>
    {filtered.length > 0 && <div className="schedule-pagination"><p className="muted small" role="status">Showing {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length}</p><div className="row"><button type="button" className="icon-button" title="Previous fee schedule page" aria-label="Previous fee schedule page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={17} /></button><span className="small">Page {currentPage + 1} of {pageCount}</span><button type="button" className="icon-button" title="Next fee schedule page" aria-label="Next fee schedule page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ArrowRight size={17} /></button></div></div>}
  </section>;
}

function EnrollmentDetail({
  record,
  settings,
  receipts,
  onBack,
  onRefresh,
  notify,
  openReceipt,
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checkingPreviousMembership, setCheckingPreviousMembership] = useState(false);
  const [previousPaymentReference, setPreviousPaymentReference] = useState("");
  const [membershipError, setMembershipError] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(record.enrollmentDate || today());
  async function verifyPreviousMembership() {
    if (busy || !previousPaymentReference.trim()) return;
    setBusy(true); setMembershipError("");
    try {
      const result = await api("verifyLifetime", { id: record.id, reference: previousPaymentReference });
      await onRefresh(); setCheckingPreviousMembership(false); notify(result.message);
    } catch (failure) { setMembershipError(failure.message); }
    finally { setBusy(false); }
  }
  const requestId = useRef(crypto.randomUUID());
  const due = balance(record.charges, today());
  const paymentAmount = amount === "" ? (due / 100).toFixed(2) : amount;
  async function action(name, payload = {}) {
    setBusy(true);
    try {
      const result = await api(name, { id: record.id, ...payload });
      await onRefresh();
      if (name === "payment") {
        requestId.current = crypto.randomUUID();
        openReceipt(result);
      } else notify(result.message || "Enrollment approved.");
    } catch (failure) {
      notify(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={16} />
        All enrollments
      </button>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">{record.id}</p>
          <h1>
            {record.firstName} {record.surname}
          </h1>
          <span className={`badge ${record.approval}`}>{record.approval}</span>
        </div>
        <button className="secondary edit-enrollment-button" disabled={busy} onClick={() => setEditing(true)}><Pencil size={16} />Edit enrollment</button>
      </div>
      {record.approval === "pending" && <section className="approval-panel" aria-label="Approve enrollment"><div className="approval-date-control"><Field label="Enrollment start date" type="date" required min={record.academicStart || settings.start} max={today()} value={enrollmentDate} disabled={busy || editing} onChange={event => setEnrollmentDate(event.target.value)} /><button disabled={busy || editing || !enrollmentDate} onClick={() => action("approve", { enrollmentDate })}><Check size={16} />Approve enrollment</button></div><p className="muted small">Weekly and monthly due dates start from this date.</p></section>}
      {editing ? <EnrollmentEditor record={record} settings={settings} onCancel={() => setEditing(false)} onSaved={async message => { await onRefresh(); setEditing(false); notify(message); }} /> : <>
      <div className="detail-columns">
        <section>
          <h2>Family details</h2>
          <p>
            {record.email}
            <br />
            {record.mobile}
            <br />
            {record.address}, {record.postcode}
          </p>
          <p>
            {record.year} / {record.membership} membership
          </p>
          {record.charges[0].amount > 0 && record.charges[0].paid === 0 && (
            <details className="previous-membership-records"><summary>Previous membership records (optional)</summary>
              <p>Only use this if the member paid lifetime membership before this app and you have checked the charity's paper records.</p>
              <button className="text-button" disabled={busy} onClick={() => { setPreviousPaymentReference(""); setMembershipError(""); setCheckingPreviousMembership(true); }}><ShieldCheck size={16} />Verify previously paid lifetime membership</button>
            </details>
          )}
          {record.children.map((child, index) => (
            <div className="review-block" key={index}>
              <h3>{child.name}</h3>
              <p>
                Born {dateLabel(child.dob)} / Class: {child.class || "-"} /
                Index: {child.index || "-"}
              </p>
              {child.photoUrl && (
                <a href={child.photoUrl} target="_blank" rel="noreferrer">
                  Admission photo (restricted)
                </a>
              )}
            </div>
          ))}
          <h2 className="spaced">Receipts</h2>
          {receipts
            .filter((receipt) => receipt.enrollmentId === record.id)
            .map((receipt) => (
              <div key={receipt.number} className="receipt-row">
                <button
                  className="text-button"
                  onClick={() => openReceipt(receipt)}
                >
                  <FileText size={16} />
                  {receipt.number} <b>{money(receipt.amount)}</b>
                </button>
                {receipt.emailStatus === "failed" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      action("retryReceipt", { number: receipt.number })
                    }
                  >
                    <Mail size={16} />
                    Retry email
                  </button>
                )}
              </div>
            ))}
        </section>
        <section className="payment-panel">
          <p className="eyebrow">PAYMENTS</p>
          <h2>
            Due now <strong>{money(due)}</strong>
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              action("payment", {
                amount: Math.round(Number(paymentAmount) * 100),
                method,
                reference,
                requestId: requestId.current,
              });
            }}
          >
            <Field
              label="Amount received (GBP)"
              type="number"
              min="0.01"
              max={balance(record.charges) / 100}
              step="0.01"
              required
              value={paymentAmount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Field label="Payment method">
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {["cash", "bank transfer", "card", "cheque"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Payment reference (optional)"
              value={reference}
              maxLength={100}
              onChange={(event) => setReference(event.target.value)}
            />
            <button
              disabled={
                busy ||
                record.approval !== "approved" ||
                balance(record.charges) === 0
              }
            >
              <CreditCard size={16} />
              {busy ? "Saving..." : "Record payment & receipt"}
            </button>
          </form>
          <button
            className="text-button"
            disabled={busy || record.approval !== "approved" || due <= 0}
            onClick={() => action("remind")}
          >
            <Mail size={16} />
            Send payment reminder
          </button>
          {record.lastReminder && (
            <p className="small muted">
              Last reminder: {dateLabel(record.lastReminder)}
            </p>
          )}
        </section>
      </div>
      <FeeSchedule charges={record.charges} />
      {record.changes?.length > 0 && <section className="change-history"><h2>Change history</h2>{record.changes.map(change => <p key={change.revision}><b>Revision {change.revision}</b> / Effective {dateLabel(change.effective)}<br />{change.reason}<small>{change.actor || "Admin"}{change.savedAt ? ` / ${change.savedAt.slice(0, 10)}` : ""}</small></p>)}</section>}
      </>}
      {checkingPreviousMembership && <ConfirmationDialog title="Verify previously paid lifetime membership" description="Confirm that the charity's old records show this member has already paid lifetime membership." Icon={ShieldCheck} busy={busy} error={membershipError} confirmLabel="Verify membership" confirmDisabled={!previousPaymentReference.trim()} onCancel={() => setCheckingPreviousMembership(false)} onConfirm={verifyPreviousMembership}>
        <p className="reminder-dialog-note">No new membership fee will be due. No money will be refunded. Subject fees and existing receipts will stay unchanged.</p>
        <Field label="Previous receipt or paper-record reference" required maxLength={300} value={previousPaymentReference} disabled={busy} onChange={event => setPreviousPaymentReference(event.target.value)} />
      </ConfirmationDialog>}
    </>
  );
}

function ConfirmationDialog({ title, description, children, Icon = Mail, busy, error, confirmLabel, confirmDisabled = false, onCancel, onConfirm }) {
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="reminder-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); } }}>
    <div className="reminder-dialog-icon"><Icon size={24} /></div>
    <h2 id={titleId}>{title}</h2>
    <p id={descriptionId}>{description}</p>
    {children}
    {error && <p className="alert error" role="alert">{error}</p>}
    {busy && <p role="status" className="reminder-dialog-note">Processing. Please keep this page open.</p>}
    <div className="reminder-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel} autoFocus>Cancel</button><button type="button" disabled={busy || confirmDisabled} onClick={onConfirm}><Icon size={17} />{busy ? "Processing..." : confirmLabel}</button></div>
  </dialog>;
}

function PaymentReminderDialog({ confirmation, busy, error, onCancel, onConfirm }) {
  return <ConfirmationDialog title="Send payment reminders?" description="Send individual payment-due emails to approved members with outstanding fees for this academic year." busy={busy} error={error} confirmLabel="Send reminders" onCancel={onCancel} onConfirm={onConfirm}>
    <dl className="reminder-dialog-summary"><div><dt>Academic year</dt><dd>{confirmation.year}</dd></div><div><dt>Members with payment due</dt><dd>{confirmation.count}</dd></div></dl>
    <p className="reminder-dialog-note">Members already reminded today will be skipped. Paid-up members and pending applications will not receive an email.</p>
    {demo && <p className="reminder-dialog-note">Demo mode: reminders are recorded, but no emails are sent.</p>}
  </ConfirmationDialog>;
}

function Admin({ settings, onConfig, onLogout }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [filter, setFilter] = useState("all");
  const [year, setYear] = useState(settings.year);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reminding, setReminding] = useState(false);
  const [reminderConfirmation, setReminderConfirmation] = useState(null);
  const [reminderError, setReminderError] = useState("");
  async function remindAll() {
    if (reminding || !reminderConfirmation) return;
    setReminding(true);
    setReminderError("");
    try { const result = await api("remindAll", { year: reminderConfirmation.year }); await refresh(); setNotice(result.message); setReminderConfirmation(null); }
    catch (failure) { setReminderError(failure.message); }
    finally { setReminding(false); }
  }
  async function refresh() {
    const updated = await api("dashboard");
    setData(updated);
    await onConfig();
  }
  useEffect(() => {
    let active = true;
    api("dashboard")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const records = (data?.enrollments || []).filter(record => record.year === year);
  const availableYears = [...new Set([settings.year, ...(data?.enrollments || []).map(record => record.year)])].sort().reverse();
  const transactions = (data?.receipts || []).filter(receipt => (data?.enrollments || []).some(record => record.id === receipt.enrollmentId && record.year === year));
  const pending = records.filter((record) => record.approval === "pending");
  const owing = records.filter(
    (record) =>
      record.approval === "approved" && balance(record.charges, today()) > 0,
  );
  const selectedRecord = records.find((record) => record.id === selected);
  const visible = records.filter(
    (record) =>
      (filter === "all" ||
        (filter === "pending" && record.approval === "pending") ||
        (filter === "unpaid" &&
          record.approval === "approved" &&
          balance(record.charges, today()) > 0)) &&
      `${record.id} ${record.firstName} ${record.surname} ${record.email}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="admin-layout">
      <aside className="admin-nav">
        <p className="eyebrow">ADMIN WORKSPACE</p>
        {[
          ["dashboard", LayoutDashboard, "Overview"],
          ["enroll", Plus, "New enrollment"],
          ["fees", Settings, "Subjects & fees"],
          ["transactions", FileText, "Transactions"],
        ].map(([value, Icon, label]) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => {
              setTab(value);
              setSelected(null);
              setNotice("");
            }}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
        <button onClick={onLogout}>
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <section className="admin-main">
        {notice && (
          <div role="status" className="alert row between">
            {notice}
            <button className="text-button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading enrollments...</p>}
        {data && tab === "enroll" && (
          <EnrollmentForm settings={settings} admin onDone={refresh} />
        )}
        {data && tab === "fees" && (
          <FeeSettings
            key={settings.year}
            settings={settings}
            onSaved={refresh}
          />
        )}
        {data && tab === "transactions" && (
          <>
            <div className="page-heading row between">
              <div><p className="eyebrow">PAYMENT RECORDS</p><h1>Transactions</h1></div>
              <select className="year-select" aria-label="Transaction academic year" value={year} onChange={event => setYear(event.target.value)}>{availableYears.map(value => <option key={value}>{value}</option>)}</select>
            </div>
            <div className="transaction-summary"><div><span>Collected in {year}</span><strong>{money(transactions.reduce((total, item) => total + item.amount, 0))}</strong></div><div><span>Recorded payments</span><strong>{transactions.length}</strong></div></div>
            <div className="table-wrap">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Member</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount received</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((item) => (
                    <tr key={item.number}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setReceipt(item)}
                        >
                          {item.number}
                        </button>
                      </td>
                      <td>{item.name}</td>
                      <td>{dateLabel(item.date)}</td>
                      <td>{item.method}</td>
                      <td>{item.reference || "-"}</td>
                      <td>{money(item.amount)}</td>
                      <td>{item.emailStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!transactions.length && (
                <p className="empty">No transactions recorded for {year}.</p>
              )}
            </div>
          </>
        )}
        {data &&
          tab === "dashboard" &&
          (selectedRecord ? (
            <EnrollmentDetail
              key={selectedRecord.id}
              record={selectedRecord}
              settings={settings}
              receipts={data.receipts}
              onBack={() => setSelected(null)}
              onRefresh={refresh}
              notify={setNotice}
              openReceipt={setReceipt}
            />
          ) : (
            <>
              <div className="page-heading row between">
                <div>
                  <p className="eyebrow">ACADEMIC YEAR {year}</p>
                  <h1>Enrollment overview</h1>
                  <p>{dateLabel(today())}</p>
                </div>
                <div className="detail-actions"><button className="secondary" disabled={reminding || owing.length === 0} onClick={() => { setReminderError(""); setReminderConfirmation({ year, count: owing.length }); }}><Mail size={17} />{reminding ? "Sending reminders..." : "Remind all payment due"}</button>
                <button onClick={() => setTab("enroll")}>
                  <Plus size={17} />
                  New enrollment
                </button>
                </div>
              </div>
              <div className="stats">
                <button onClick={() => setFilter("all")}>
                  <Users size={19} />
                  <span>Total enrollments</span>
                  <strong>{records.length}</strong>
                </button>
                <button onClick={() => setFilter("pending")}>
                  <ShieldCheck size={19} />
                  <span>Awaiting approval</span>
                  <strong>{pending.length}</strong>
                </button>
                <button onClick={() => setFilter("unpaid")}>
                  <CreditCard size={19} />
                  <span>Payment due</span>
                  <strong>{owing.length}</strong>
                </button>
                <div>
                  <FileText size={19} />
                  <span>Collected</span>
                  <strong>
                    {money(
                      data.receipts.filter(receipt => records.some(record => record.id === receipt.enrollmentId)).reduce(
                        (total, item) => total + item.amount,
                        0,
                      ),
                    )}
                  </strong>
                </div>
              </div>
              <div className="list-toolbar">
                <select className="year-select" aria-label="Academic year" value={year} onChange={event => { setYear(event.target.value); setSelected(null); }}>
                  {availableYears.map(value => <option key={value}>{value}</option>)}
                </select>
                <div
                  className="tabs"
                  role="tablist"
                  aria-label="Enrollment status"
                >
                  {[
                    ["all", "All enrollments"],
                    ["pending", "To approve"],
                    ["unpaid", "Payment due"],
                  ].map(([value, label]) => (
                    <button
                      role="tab"
                      aria-selected={filter === value}
                      className={filter === value ? "active" : ""}
                      key={value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search enrollments"
                    placeholder="Search name or enrollment ID"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member / Enrollment ID</th>
                      <th>Children</th>
                      <th>Approval</th>
                      <th>Due now</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((record) => {
                      const currentDue = balance(record.charges, today());
                      const paymentDue = record.approval === "approved" && currentDue > 0;
                      return (
                      <tr key={record.id}>
                        <td>
                          <b>
                            {record.firstName} {record.surname}
                          </b>
                          <small className="enrollment-id">{record.id}</small>
                        </td>
                        <td>{record.children.length}</td>
                        <td>
                          <span className={`badge ${record.approval}`}>
                            {record.approval}
                          </span>
                        </td>
                        <td>
                          <div className="due-cell">
                            {money(currentDue)}
                            {paymentDue && <span className="badge payment-due">Payment due</span>}
                          </div>
                        </td>
                        <td>
                          <button
                            title={`Open ${record.firstName}`}
                            aria-label={`Open ${record.firstName}`}
                            className="icon-button"
                            onClick={() => setSelected(record.id)}
                          >
                            <ChevronRight size={20} />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="empty">No matching enrollments.</p>
                )}
              </div>
            </>
          ))}
      </section>
      {receipt && (
        <ReceiptView receipt={receipt} onClose={() => setReceipt(null)} />
      )}
      {reminderConfirmation && <PaymentReminderDialog confirmation={reminderConfirmation} busy={reminding} error={reminderError} onCancel={() => setReminderConfirmation(null)} onConfirm={remindAll} />}
    </div>
  );
}

function Login({ onLogin }) {
  const container = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async (response) => {
          setCredential(response.credential);
          try {
            await api("dashboard");
            onLogin();
          } catch (failure) {
            setCredential("");
            setError(failure.message);
          }
        },
      });
      window.google.accounts.id.renderButton(container.current, {
        theme: "outline",
        size: "large",
      });
    };
    script.onerror = () =>
      setError("Google sign-in could not load. Check your connection.");
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [onLogin]);
  return (
    <section className="login-panel">
      <ShieldCheck size={36} />
      <p className="eyebrow">CHARITY ADMINISTRATION</p>
      <h1>Admin sign-in</h1>
      {demo ? (
        <button onClick={onLogin}>
          Open demo workspace
          <ArrowRight size={17} />
        </button>
      ) : (
        <>
          <div ref={container} />
          {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <p role="alert">Google sign-in has not been configured.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
    </section>
  );
}

export default function App() {
  const readPortal = () => window.location.hash === "#admin" ? "admin" : "public";
  const [portal, setPortal] = useState(readPortal);
  const [signedIn, setSignedIn] = useState(false);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [install, setInstall] = useState(null);
  async function refreshConfig() {
    setSettings(await api("config"));
  }
  useEffect(() => {
    api("config")
      .then(setSettings)
      .catch((failure) => setError(failure.message));
    const listener = (event) => {
      event.preventDefault();
      setInstall(event);
    };
    window.addEventListener("beforeinstallprompt", listener);
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  useEffect(() => {
    const onHashChange = () => { setPortal(readPortal()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    document.title = `CTWA | ${portal === "admin" ? "Administration" : "Membership & Enrollment"}`;
  }, [portal]);
  return (
    <>
      <header className="site-header">
        <a
          className="brand"
          href="#public"
        >
          <img src="/logo.png" alt="CTWA crest" />
          <span>
            <b>
              Coventry Tamil
              <br />
              Welfare Association
            </b>
            <small lang="ta">தமிழால் இணைவோம்</small>
          </span>
        </a>
        <nav aria-label="Portal">
          <a
            href="#public"
            className={portal === "public" ? "active" : ""}
            aria-current={portal === "public" ? "page" : undefined}
          >
            <Users size={16} />
            Enrollment
          </a>
          <a
            href="#admin"
            className={portal === "admin" ? "active" : ""}
            aria-current={portal === "admin" ? "page" : undefined}
          >
            <ShieldCheck size={16} />
            Admin
          </a>
          {install && (
            <button
              title="Install application"
              aria-label="Install application"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              <Download size={18} />
            </button>
          )}
        </nav>
      </header>
      {demo && (
        <div className="demo-banner">
          Demo workspace · Sample fees and fictional records · No emails sent ·
          Changes reset on refresh
        </div>
      )}
      <main>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {!settings && !error && (
          <p role="status" className="loading">
            Loading enrollment...
          </p>
        )}
        {settings && !settings.feesConfigured && (
          <p className="alert">
            Enrollment opens after the admin configures subject fees.
          </p>
        )}
        {settings &&
          (portal === "public" ? (
            <EnrollmentForm settings={settings} />
          ) : signedIn ? (
            <Admin
              settings={settings}
              onConfig={refreshConfig}
              onLogout={() => {
                setCredential("");
                setSignedIn(false);
              }}
            />
          ) : (
            <Login onLogin={() => setSignedIn(true)} />
          ))}
      </main>
      <footer className="site-footer">
        <span>
          Coventry Tamil Welfare Association <span className="dot">/</span>{" "}
          Registered charity 1093924
        </span>
        <a href="mailto:coventrytamils2002@gmail.com">
          Contact the charity
          <ArrowRight size={14} />
        </a>
        {import.meta.env.VITE_PRIVACY_URL && <a href={import.meta.env.VITE_PRIVACY_URL} target="_blank" rel="noreferrer">Privacy notice</a>}
        <a href="https://tamils.org.uk/" target="_blank" rel="noreferrer">Charity website</a>
      </footer>
    </>
  );
}
