export const money = (pence) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100,
  );
export const frequencies = ["weekly", "monthly", "annually"];
export const defaultMembershipFees = { annual: 1000, lifetime: 10000 };
export const membershipPrices = settings => settings.membershipFees === undefined ? defaultMembershipFees : settings.membershipFees;
export function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ""))
    throw new Error("Choose a valid date.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error("Choose a valid date.");
  return parsed;
}

export function validateSettings(settings) {
  const fees = membershipPrices(settings);
  if (!fees || typeof fees !== "object" || [fees.annual, fees.lifetime].some(amount => !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000)) {
    throw new Error("Enter valid annual and lifetime membership prices between 0 and 10000 pounds.");
  }
  dateOnly(settings.start);
  dateOnly(settings.end);
  if (settings.start > settings.end)
    throw new Error("The academic year end must follow its start.");
  if (!/^\d{4}-\d{2}$/.test(settings.year))
    throw new Error("Use an academic year such as 2026-27.");
  if (!Array.isArray(settings.subjects) || settings.subjects.length > 200 || settings.subjects.filter(subject => !subject.deleted).length > 30)
    throw new Error("Keep up to 30 current subjects and 200 subjects including deleted records.");
  const ids = new Set();
  for (const subject of settings.subjects) {
    if (!subject.id || ids.has(subject.id))
      throw new Error("Subject IDs must be unique.");
    ids.add(subject.id);
    if (!subject.name?.trim() || subject.name.length > 80)
      throw new Error("Enter a subject name, up to 80 characters.");
    if (
      !Number.isSafeInteger(subject.price) ||
      subject.price < 0 ||
      subject.price > 1000000
    )
      throw new Error(
        "Enter a valid subject price between 0 and 10000 pounds.",
      );
    if (!frequencies.includes(subject.frequency))
      throw new Error("Choose weekly, monthly or annually.");
  }
  return settings;
}

export function prepareSettings(incoming, previous, timestamp) {
  validateSettings(incoming);
  const subjects = incoming.subjects.map(subject => {
    const stored = previous.subjects.find(item => item.id === subject.id);
    const deleted = subject.deleted === true;
    return {
      id: subject.id, name: subject.name.trim(), price: subject.price,
      frequency: subject.frequency, active: !deleted && subject.active === true,
      deleted, deletedAt: deleted ? stored?.deletedAt || timestamp : null,
    };
  });
  for (const stored of previous.subjects) {
    if (!subjects.some(subject => subject.id === stored.id)) {
      subjects.push({ ...stored, active: false, deleted: true, deletedAt: stored.deletedAt || timestamp });
    }
  }
  const membershipFees = { ...membershipPrices(incoming.membershipFees === undefined ? previous : incoming) };
  return validateSettings({ year: incoming.year, start: incoming.start, end: incoming.end, membershipFees, subjects, feesConfigured: true });
}

export function validateEnrollment(input, settings, today) {
  for (const field of [
    "firstName",
    "surname",
    "address",
    "postcode",
    "email",
    "mobile",
  ]) {
    if (
      typeof input[field] !== "string" ||
      !input[field].trim() ||
      input[field].length > 300
    )
      throw new Error(`Please complete ${field}.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw new Error("Enter a valid email address.");
  if (!["annual", "lifetime"].includes(input.membership))
    throw new Error("Choose a membership type.");
  if (input.consent !== true)
    throw new Error("Please accept the membership declaration.");
  if (settings.end < today)
    throw new Error("Enrollment for this academic year has closed.");
  if (!Array.isArray(input.children) || input.children.length > 10)
    throw new Error("Add up to 10 children.");
  for (const child of input.children) {
    if (!child.name?.trim() || child.name.length > 150)
      throw new Error("Enter each child's name.");
    dateOnly(child.dob);
    if (child.dob > today)
      throw new Error("A date of birth cannot be in the future.");
    if (
      !Array.isArray(child.subjects) ||
      !child.subjects.length ||
      new Set(child.subjects).size !== child.subjects.length
    )
      throw new Error("Choose at least one subject for each child.");
    if (
      child.subjects.some(
        (id) =>
          !settings.subjects.some(
            (subject) => subject.id === id && subject.active && !subject.deleted,
          ),
      )
    )
      throw new Error("A selected subject is no longer available.");
    if (
      child.photo &&
      (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(child.photo) ||
        child.photo.length > 1400000)
    )
      throw new Error("Use a JPG or PNG photo under 1 MB.");
  }
  return input;
}

export function schedule(start, end, frequency) {
  const anchor = dateOnly(start);
  dateOnly(end);
  if (!frequencies.includes(frequency))
    throw new Error("Invalid billing frequency.");
  if (start > end) return [];
  if (frequency === "annually") return [start];
  const dates = [];
  for (let period = 0; period < 600; period++) {
    let next;
    if (frequency === "weekly") {
      next = new Date(anchor);
      next.setUTCDate(anchor.getUTCDate() + period * 7);
    } else {
      const first = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + period, 1),
      );
      const lastDay = new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next = new Date(
        Date.UTC(
          first.getUTCFullYear(),
          first.getUTCMonth(),
          Math.min(anchor.getUTCDate(), lastDay),
        ),
      );
    }
    const date = next.toISOString().slice(0, 10);
    if (date > end) return dates;
    dates.push(date);
  }
  throw new Error("Billing period is too long.");
}

export function buildCharges(input, settings, today, lifetime = false) {
  const start = today < settings.start ? settings.start : today;
  const charges = [
    {
      id: "membership",
      description: `${input.membership === "lifetime" ? "Lifetime" : "Annual"} membership`,
      due: start,
      amount: lifetime ? 0 : membershipPrices(settings)[input.membership],
      paid: 0,
    },
  ];
  input.children.forEach((child, childIndex) => {
    child.subjects.forEach((id) => {
      const subject = settings.subjects.find((item) => item.id === id);
      schedule(start, settings.end, subject.frequency).forEach((due, period) =>
        charges.push({
          id: `${childIndex}-${id}-${period}`,
          childIndex,
          subjectId: id,
          description: `${child.name} / ${subject.name}`,
          frequency: subject.frequency,
          due,
          amount: subject.price,
          paid: 0,
        }),
      );
    });
  });
  return charges;
}

export function reschedulePendingEnrollment(record, enrollmentDate, settings, today) {
  if (record.approval !== "pending") throw new Error("Only pending enrollments can have their start date selected during approval.");
  if (record.charges.some(charge => charge.paid > 0)) throw new Error("An enrollment with recorded payments cannot be rescheduled.");
  dateOnly(enrollmentDate);
  const start = settings.year === record.year ? settings.start : record.academicStart;
  const end = settings.year === record.year ? settings.end : record.academicEnd;
  if (!start || !end || enrollmentDate < start || enrollmentDate > today) throw new Error("Choose an enrollment date between the academic-year start and today.");
  const membership = record.charges.find(charge => charge.id === "membership");
  if (!membership) throw new Error("The membership charge is missing.");
  const charges = [{ ...membership, due: enrollmentDate, paid: 0 }];
  const groups = new Map();
  for (const charge of record.charges) {
    if (charge.id === "membership") continue;
    const childIndex = charge.childIndex ?? Number(charge.id.split("-")[0]);
    const subjectId = charge.subjectId ?? charge.id.slice(`${childIndex}-`.length).replace(/-\d+$/, "");
    const key = `${childIndex}:${subjectId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ charge, childIndex, subjectId });
  }
  for (const group of groups.values()) {
    const first = group[0].charge;
    const frequency = first.frequency;
    if (!frequencies.includes(frequency)) throw new Error("A subject billing frequency is missing from this enrollment.");
    const subject = settings.subjects.find(item => item.id === group[0].subjectId);
    const child = record.children[group[0].childIndex];
    const description = first.description || `${child?.name || "Student"} / ${subject?.name || "Subject"}`;
    schedule(enrollmentDate, end, frequency).forEach((due, period) => charges.push({ id: `${group[0].childIndex}-${group[0].subjectId}-${period}`, childIndex: group[0].childIndex, subjectId: group[0].subjectId, description, frequency, due, amount: first.amount, paid: 0 }));
  }
  return { ...record, enrollmentDate, academicStart: start, academicEnd: end, charges };
}

export function balance(charges, today = "9999-12-31") {
  return charges
    .filter((charge) => charge.due <= today)
    .reduce((total, charge) => total + charge.amount - charge.paid - (charge.cancelledAmount || 0), 0);
}

export function allocatePayment(charges, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance(charges))
    throw new Error(
      "Payment must be positive and cannot exceed the outstanding balance.",
    );
  let remaining = amount;
  const allocations = [];
  const ordered = [...charges].sort(
    (left, right) =>
      left.due.localeCompare(right.due) ||
      (left.id === "membership" ? -1 : right.id === "membership" ? 1 : 0),
  );
  const updated = charges.map((charge) => ({ ...charge }));
  for (const charge of ordered) {
    const paid = Math.min(remaining, charge.amount - charge.paid - (charge.cancelledAmount || 0));
    if (paid > 0) {
      updated.find((item) => item.id === charge.id).paid += paid;
      allocations.push({
        id: charge.id,
        description: charge.description,
        due: charge.due,
        amount: paid,
      });
      remaining -= paid;
    }
  }
  return { charges: updated, allocations };
}

export function reviseEnrollment(record, payload, settings, today) {
  const belongsToSubject = (charge, childIndex, id) => {
    if (charge.subjectId !== undefined) return charge.childIndex === childIndex && charge.subjectId === id;
    const prefix = `${childIndex}-${id}-`;
    return charge.id.startsWith(prefix) && /^\d+$/.test(charge.id.slice(prefix.length));
  };
  if ((record.revision || 0) !== payload.revision) throw new Error("This enrollment has changed. Reopen the editor before saving.");
  if (typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 300) throw new Error("Enter a reason for this change, up to 300 characters.");
  const unpaidApplication = record.approval === "pending" && record.charges.every(charge => charge.paid === 0);
  const firstDue = record.charges[0].due;
  const effective = unpaidApplication ? firstDue : payload.effective;
  dateOnly(effective);
  if (!unpaidApplication && effective < today) throw new Error("Use today or a future date. Earlier fees cannot be removed through subject editing.");
  const end = record.academicEnd || (settings.year === record.year ? settings.end : record.charges.map(charge => charge.due).sort().at(-1));
  if (effective > end) throw new Error("The change must fall within the enrollment's academic year.");
  if (!Array.isArray(payload.children) || payload.children.length !== record.children.length) throw new Error("Edit the existing children without removing their records.");
  const updated = { ...record, charges: record.charges.map(charge => ({ ...charge })), revision: (record.revision || 0) + 1 };
  const details = payload.details || {};
  for (const field of ["firstName", "surname", "address", "postcode", "mobile", "telephone"]) {
    const value = details[field];
    if (typeof value !== "string" || value.length > 300 || (field !== "telephone" && !value.trim())) throw new Error(`Please complete ${field}.`);
    updated[field] = value.trim();
  }
  updated.children = payload.children.map((child, childIndex) => {
    const original = record.children[childIndex];
    if (typeof child.name !== "string" || !child.name.trim() || child.name.length > 150) throw new Error("Enter each child's name.");
    dateOnly(child.dob);
    if (child.dob > today) throw new Error("A date of birth cannot be in the future.");
    if (!Array.isArray(child.subjects) || new Set(child.subjects).size !== child.subjects.length) throw new Error("Subject selections must be unique.");
    const removed = original.subjects.filter(id => !child.subjects.includes(id));
    const added = child.subjects.filter(id => !original.subjects.includes(id));
    for (const id of removed) {
      updated.charges.forEach(charge => {
        const matches = belongsToSubject(charge, childIndex, id);
        if (matches && charge.due >= effective && charge.amount > charge.paid + (charge.cancelledAmount || 0)) {
          charge.cancelledAmount = charge.amount - charge.paid;
          charge.cancelledFrom = effective;
          charge.cancellationReason = payload.reason.trim();
        }
      });
    }
    for (const id of added) {
      if (settings.year !== record.year) throw new Error("New subjects can only be added to the currently configured academic year.");
      const subject = settings.subjects.find(item => item.id === id && item.active && !item.deleted);
      if (!subject) throw new Error("A selected subject is no longer available.");
      schedule(effective, end, subject.frequency).forEach((due, period) => {
        const alreadyCharged = updated.charges.some(charge => belongsToSubject(charge, childIndex, id) && (charge.due === due || subject.frequency === "annually" && charge.frequency === "annually") && charge.amount - (charge.cancelledAmount || 0) > 0);
        if (!alreadyCharged) updated.charges.push({ id: `${childIndex}-${id}-revision-${updated.revision}-${period}`, childIndex, subjectId: id, description: `${child.name.trim()} / ${subject.name}`, frequency: subject.frequency, due, amount: subject.price, paid: 0 });
      });
    }
    return { ...original, name: child.name.trim(), dob: child.dob, class: String(child.class || "").slice(0, 50), index: String(child.index || "").slice(0, 50), subjects: [...child.subjects] };
  });
  updated.changes = [...(record.changes || []), { revision: updated.revision, effective, reason: payload.reason.trim(), before: { firstName: record.firstName, surname: record.surname, address: record.address, postcode: record.postcode, mobile: record.mobile, telephone: record.telephone || "", children: record.children.map(child => ({ name: child.name, dob: child.dob, class: child.class || "", index: child.index || "", subjects: child.subjects })) }, after: { ...details, children: updated.children.map(child => ({ name: child.name, dob: child.dob, class: child.class, index: child.index, subjects: child.subjects })) } }];
  return updated;
}

export function receiptHtml(receipt) {
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(receipt.number)}</title><style>
@page{size:80mm 200mm;margin:4mm}
*{box-sizing:border-box}body{margin:0;background:#edf0ee;color:#111;font:11px "Courier New",monospace;line-height:1.45}
.receipt{width:80mm;max-width:100%;margin:12px auto;padding:4mm;background:#fff;overflow-wrap:anywhere}
header{text-align:center;border-bottom:1px dashed #555;padding-bottom:10px}h1{font-size:13px;line-height:1.5;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;margin:10px 0 0}p{margin:4px 0}small{font-size:10px}
.details{margin:10px 0}.details b{font-weight:bold}.items{width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0}.items th,.items td{text-align:left;vertical-align:top;padding:6px 0;border-bottom:1px dashed #bbb}.items th:last-child,.items td:last-child{text-align:right;width:21mm;white-space:nowrap}.items td:first-child{padding-right:5px}.items small{display:block;color:#444;margin-top:3px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
.total{border-top:1px dashed #555;border-bottom:1px dashed #555;padding:10px 0;font-size:14px;font-weight:bold;text-align:right;break-inside:avoid}footer{margin-top:12px;text-align:center;font-size:9px;break-inside:avoid}
@media print{html,body{width:72mm;background:#fff}.receipt{width:72mm;margin:0;padding:0}}
</style></head><body><article class="receipt"><header><h1>Coventry Tamil Welfare Association</h1><small>Registered Charity Number: 1093924</small><h2>${receipt.reversal ? "REVERSED / Original receipt" : "Payment receipt"}</h2></header>${receipt.reversal ? `<section class="details"><p><b>Reversed:</b> ${escape(receipt.reversal.savedAt)}</p><p><b>By:</b> ${escape(receipt.reversal.actor)}</p><p><b>Reason:</b> ${escape(receipt.reversal.reason)}</p><p>Excluded from collections. No refund was made by this reversal.</p></section>` : ""}<section class="details"><p><b>Receipt:</b> ${escape(receipt.number)}</p><p><b>Date:</b> ${escape(receipt.date)}</p><p><b>Received from:</b> ${escape(receipt.name)}</p><p><b>Enrollment:</b> ${escape(receipt.enrollmentId)}</p><p><b>Method:</b> ${escape(receipt.method)}</p><p><b>Reference:</b> ${escape(receipt.reference || "-")}</p></section><table class="items"><thead><tr><th>Payment for</th><th>Amount</th></tr></thead><tbody>${receipt.allocations.map(item => `<tr><td>${escape(item.description)}<small>Period: ${escape(item.due)}</small></td><td>${money(item.amount)}</td></tr>`).join("")}</tbody></table><p class="total">${receipt.reversal ? "Original payment" : "Total paid"}: ${money(receipt.amount)}</p><footer><p>${receipt.reversal ? "Reversed record; not a current payment confirmation." : "Thank you for your payment."}</p><p>coventrytamils2002@gmail.com<br>tamils.org.uk</p></footer></article></body></html>`;
}
