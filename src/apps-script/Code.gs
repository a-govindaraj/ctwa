var CTWA = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // backend/apps-script.js
  var apps_script_exports = {};
  __export(apps_script_exports, {
    dispatch: () => dispatch,
    handlePost: () => handlePost,
    sendScheduledReminders: () => sendScheduledReminders,
    setup: () => setup,
    verifyAdmin: () => verifyAdmin
  });

  // src/billing.js
  var money = (pence) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100
  );
  var frequencies = ["weekly", "monthly", "annually"];
  var defaultMembershipFees = { annual: 1e3, lifetime: 1e4 };
  var membershipPrices = (settings2) => settings2.membershipFees === void 0 ? defaultMembershipFees : settings2.membershipFees;
  function dateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ""))
      throw new Error("Choose a valid date.");
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      throw new Error("Choose a valid date.");
    return parsed;
  }
  function validateSettings(settings2) {
    const fees = membershipPrices(settings2);
    if (!fees || typeof fees !== "object" || [fees.annual, fees.lifetime].some((amount) => !Number.isSafeInteger(amount) || amount < 0 || amount > 1e6)) {
      throw new Error("Enter valid annual and lifetime membership prices between 0 and 10000 pounds.");
    }
    dateOnly(settings2.start);
    dateOnly(settings2.end);
    if (settings2.start > settings2.end)
      throw new Error("The academic year end must follow its start.");
    if (!/^\d{4}-\d{2}$/.test(settings2.year))
      throw new Error("Use an academic year such as 2026-27.");
    if (!Array.isArray(settings2.subjects) || settings2.subjects.length > 200 || settings2.subjects.filter((subject) => !subject.deleted).length > 30)
      throw new Error("Keep up to 30 current subjects and 200 subjects including deleted records.");
    const ids = /* @__PURE__ */ new Set();
    for (const subject of settings2.subjects) {
      if (!subject.id || ids.has(subject.id))
        throw new Error("Subject IDs must be unique.");
      ids.add(subject.id);
      if (!subject.name?.trim() || subject.name.length > 80)
        throw new Error("Enter a subject name, up to 80 characters.");
      if (!Number.isSafeInteger(subject.price) || subject.price < 0 || subject.price > 1e6)
        throw new Error(
          "Enter a valid subject price between 0 and 10000 pounds."
        );
      if (!frequencies.includes(subject.frequency))
        throw new Error("Choose weekly, monthly or annually.");
    }
    return settings2;
  }
  function prepareSettings(incoming, previous, timestamp) {
    validateSettings(incoming);
    const subjects = incoming.subjects.map((subject) => {
      const stored = previous.subjects.find((item) => item.id === subject.id);
      const deleted = subject.deleted === true;
      return {
        id: subject.id,
        name: subject.name.trim(),
        price: subject.price,
        frequency: subject.frequency,
        active: !deleted && subject.active === true,
        deleted,
        deletedAt: deleted ? stored?.deletedAt || timestamp : null
      };
    });
    for (const stored of previous.subjects) {
      if (!subjects.some((subject) => subject.id === stored.id)) {
        subjects.push({ ...stored, active: false, deleted: true, deletedAt: stored.deletedAt || timestamp });
      }
    }
    const membershipFees = { ...membershipPrices(incoming.membershipFees === void 0 ? previous : incoming) };
    return validateSettings({ year: incoming.year, start: incoming.start, end: incoming.end, membershipFees, subjects, feesConfigured: true });
  }
  function validateEnrollment(input, settings2, today) {
    for (const field of [
      "firstName",
      "surname",
      "address",
      "postcode",
      "email",
      "mobile"
    ]) {
      if (typeof input[field] !== "string" || !input[field].trim() || input[field].length > 300)
        throw new Error(`Please complete ${field}.`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      throw new Error("Enter a valid email address.");
    if (!["annual", "lifetime"].includes(input.membership))
      throw new Error("Choose a membership type.");
    if (input.consent !== true)
      throw new Error("Please accept the membership declaration.");
    if (settings2.end < today)
      throw new Error("Enrollment for this academic year has closed.");
    if (!Array.isArray(input.children) || input.children.length > 10)
      throw new Error("Add up to 10 children.");
    for (const child of input.children) {
      if (!child.name?.trim() || child.name.length > 150)
        throw new Error("Enter each child's name.");
      dateOnly(child.dob);
      if (child.dob > today)
        throw new Error("A date of birth cannot be in the future.");
      if (!Array.isArray(child.subjects) || !child.subjects.length || new Set(child.subjects).size !== child.subjects.length)
        throw new Error("Choose at least one subject for each child.");
      if (child.subjects.some(
        (id) => !settings2.subjects.some(
          (subject) => subject.id === id && subject.active && !subject.deleted
        )
      ))
        throw new Error("A selected subject is no longer available.");
      if (child.photo && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(child.photo) || child.photo.length > 14e5))
        throw new Error("Use a JPG or PNG photo under 1 MB.");
    }
    return input;
  }
  function schedule(start, end, frequency) {
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
          Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + period, 1)
        );
        const lastDay = new Date(
          Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
        ).getUTCDate();
        next = new Date(
          Date.UTC(
            first.getUTCFullYear(),
            first.getUTCMonth(),
            Math.min(anchor.getUTCDate(), lastDay)
          )
        );
      }
      const date = next.toISOString().slice(0, 10);
      if (date > end) return dates;
      dates.push(date);
    }
    throw new Error("Billing period is too long.");
  }
  function buildCharges(input, settings2, today, lifetime = false) {
    const start = today < settings2.start ? settings2.start : today;
    const charges = [
      {
        id: "membership",
        description: `${input.membership === "lifetime" ? "Lifetime" : "Annual"} membership`,
        due: start,
        amount: lifetime ? 0 : membershipPrices(settings2)[input.membership],
        paid: 0
      }
    ];
    input.children.forEach((child, childIndex) => {
      child.subjects.forEach((id) => {
        const subject = settings2.subjects.find((item) => item.id === id);
        schedule(start, settings2.end, subject.frequency).forEach(
          (due, period) => charges.push({
            id: `${childIndex}-${id}-${period}`,
            childIndex,
            subjectId: id,
            description: `${child.name} / ${subject.name}`,
            frequency: subject.frequency,
            due,
            amount: subject.price,
            paid: 0
          })
        );
      });
    });
    return charges;
  }
  function reschedulePendingEnrollment(record, enrollmentDate, settings2, today) {
    if (record.approval !== "pending") throw new Error("Only pending enrollments can have their start date selected during approval.");
    if (record.charges.some((charge) => charge.paid > 0)) throw new Error("An enrollment with recorded payments cannot be rescheduled.");
    dateOnly(enrollmentDate);
    const start = settings2.year === record.year ? settings2.start : record.academicStart;
    const end = settings2.year === record.year ? settings2.end : record.academicEnd;
    if (!start || !end || enrollmentDate < start || enrollmentDate > today) throw new Error("Choose an enrollment date between the academic-year start and today.");
    const membership = record.charges.find((charge) => charge.id === "membership");
    if (!membership) throw new Error("The membership charge is missing.");
    const charges = [{ ...membership, due: enrollmentDate, paid: 0 }];
    const groups = /* @__PURE__ */ new Map();
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
      const subject = settings2.subjects.find((item) => item.id === group[0].subjectId);
      const child = record.children[group[0].childIndex];
      const description = first.description || `${child?.name || "Student"} / ${subject?.name || "Subject"}`;
      schedule(enrollmentDate, end, frequency).forEach((due, period) => charges.push({ id: `${group[0].childIndex}-${group[0].subjectId}-${period}`, childIndex: group[0].childIndex, subjectId: group[0].subjectId, description, frequency, due, amount: first.amount, paid: 0 }));
    }
    return { ...record, enrollmentDate, academicStart: start, academicEnd: end, charges };
  }
  function balance(charges, today = "9999-12-31") {
    return charges.filter((charge) => charge.due <= today).reduce((total, charge) => total + charge.amount - charge.paid - (charge.cancelledAmount || 0), 0);
  }
  function allocatePayment(charges, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance(charges))
      throw new Error(
        "Payment must be positive and cannot exceed the outstanding balance."
      );
    let remaining = amount;
    const allocations = [];
    const ordered = [...charges].sort(
      (left, right) => left.due.localeCompare(right.due) || (left.id === "membership" ? -1 : right.id === "membership" ? 1 : 0)
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
          amount: paid
        });
        remaining -= paid;
      }
    }
    return { charges: updated, allocations };
  }
  function reviseEnrollment(record, payload, settings2, today) {
    const belongsToSubject = (charge, childIndex, id) => {
      if (charge.subjectId !== void 0) return charge.childIndex === childIndex && charge.subjectId === id;
      const prefix = `${childIndex}-${id}-`;
      return charge.id.startsWith(prefix) && /^\d+$/.test(charge.id.slice(prefix.length));
    };
    if ((record.revision || 0) !== payload.revision) throw new Error("This enrollment has changed. Reopen the editor before saving.");
    if (typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 300) throw new Error("Enter a reason for this change, up to 300 characters.");
    const unpaidApplication = record.approval === "pending" && record.charges.every((charge) => charge.paid === 0);
    const firstDue = record.charges[0].due;
    const effective = unpaidApplication ? firstDue : payload.effective;
    dateOnly(effective);
    if (!unpaidApplication && effective < today) throw new Error("Use today or a future date. Earlier fees cannot be removed through subject editing.");
    const end = record.academicEnd || (settings2.year === record.year ? settings2.end : record.charges.map((charge) => charge.due).sort().at(-1));
    if (effective > end) throw new Error("The change must fall within the enrollment's academic year.");
    if (!Array.isArray(payload.children) || payload.children.length !== record.children.length) throw new Error("Edit the existing children without removing their records.");
    const updated = { ...record, charges: record.charges.map((charge) => ({ ...charge })), revision: (record.revision || 0) + 1 };
    const details = payload.details || {};
    for (const field of ["firstName", "surname", "address", "postcode", "mobile", "telephone"]) {
      const value = details[field];
      if (typeof value !== "string" || value.length > 300 || field !== "telephone" && !value.trim()) throw new Error(`Please complete ${field}.`);
      updated[field] = value.trim();
    }
    updated.children = payload.children.map((child, childIndex) => {
      const original = record.children[childIndex];
      if (typeof child.name !== "string" || !child.name.trim() || child.name.length > 150) throw new Error("Enter each child's name.");
      dateOnly(child.dob);
      if (child.dob > today) throw new Error("A date of birth cannot be in the future.");
      if (!Array.isArray(child.subjects) || new Set(child.subjects).size !== child.subjects.length) throw new Error("Subject selections must be unique.");
      const removed = original.subjects.filter((id) => !child.subjects.includes(id));
      const added = child.subjects.filter((id) => !original.subjects.includes(id));
      for (const id of removed) {
        updated.charges.forEach((charge) => {
          const matches = belongsToSubject(charge, childIndex, id);
          if (matches && charge.due >= effective && charge.amount > charge.paid + (charge.cancelledAmount || 0)) {
            charge.cancelledAmount = charge.amount - charge.paid;
            charge.cancelledFrom = effective;
            charge.cancellationReason = payload.reason.trim();
          }
        });
      }
      for (const id of added) {
        if (settings2.year !== record.year) throw new Error("New subjects can only be added to the currently configured academic year.");
        const subject = settings2.subjects.find((item) => item.id === id && item.active && !item.deleted);
        if (!subject) throw new Error("A selected subject is no longer available.");
        schedule(effective, end, subject.frequency).forEach((due, period) => {
          const alreadyCharged = updated.charges.some((charge) => belongsToSubject(charge, childIndex, id) && (charge.due === due || subject.frequency === "annually" && charge.frequency === "annually") && charge.amount - (charge.cancelledAmount || 0) > 0);
          if (!alreadyCharged) updated.charges.push({ id: `${childIndex}-${id}-revision-${updated.revision}-${period}`, childIndex, subjectId: id, description: `${child.name.trim()} / ${subject.name}`, frequency: subject.frequency, due, amount: subject.price, paid: 0 });
        });
      }
      return { ...original, name: child.name.trim(), dob: child.dob, class: String(child.class || "").slice(0, 50), index: String(child.index || "").slice(0, 50), subjects: [...child.subjects] };
    });
    updated.changes = [...record.changes || [], { revision: updated.revision, effective, reason: payload.reason.trim(), before: { firstName: record.firstName, surname: record.surname, address: record.address, postcode: record.postcode, mobile: record.mobile, telephone: record.telephone || "", children: record.children.map((child) => ({ name: child.name, dob: child.dob, class: child.class || "", index: child.index || "", subjects: child.subjects })) }, after: { ...details, children: updated.children.map((child) => ({ name: child.name, dob: child.dob, class: child.class, index: child.index, subjects: child.subjects })) } }];
    return updated;
  }
  function receiptHtml(receipt) {
    const escape = (value) => String(value).replace(
      /[&<>"']/g,
      (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
    );
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(receipt.number)}</title><style>
@page{size:80mm 200mm;margin:4mm}
*{box-sizing:border-box}body{margin:0;background:#edf0ee;color:#111;font:11px "Courier New",monospace;line-height:1.45}
.receipt{width:80mm;max-width:100%;margin:12px auto;padding:4mm;background:#fff;overflow-wrap:anywhere}
header{text-align:center;border-bottom:1px dashed #555;padding-bottom:10px}h1{font-size:13px;line-height:1.5;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;margin:10px 0 0}p{margin:4px 0}small{font-size:10px}
.details{margin:10px 0}.details b{font-weight:bold}.items{width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0}.items th,.items td{text-align:left;vertical-align:top;padding:6px 0;border-bottom:1px dashed #bbb}.items th:last-child,.items td:last-child{text-align:right;width:21mm;white-space:nowrap}.items td:first-child{padding-right:5px}.items small{display:block;color:#444;margin-top:3px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
.total{border-top:1px dashed #555;border-bottom:1px dashed #555;padding:10px 0;font-size:14px;font-weight:bold;text-align:right;break-inside:avoid}footer{margin-top:12px;text-align:center;font-size:9px;break-inside:avoid}
@media print{html,body{width:72mm;background:#fff}.receipt{width:72mm;margin:0;padding:0}}
</style></head><body><article class="receipt"><header><h1>Coventry Tamil Welfare Association</h1><small>Registered Charity Number: 1093924</small><h2>Payment receipt</h2></header><section class="details"><p><b>Receipt:</b> ${escape(receipt.number)}</p><p><b>Date:</b> ${escape(receipt.date)}</p><p><b>Received from:</b> ${escape(receipt.name)}</p><p><b>Enrollment:</b> ${escape(receipt.enrollmentId)}</p><p><b>Method:</b> ${escape(receipt.method)}</p><p><b>Reference:</b> ${escape(receipt.reference || "-")}</p></section><table class="items"><thead><tr><th>Payment for</th><th>Amount</th></tr></thead><tbody>${receipt.allocations.map((item) => `<tr><td>${escape(item.description)}<small>Period: ${escape(item.due)}</small></td><td>${money(item.amount)}</td></tr>`).join("")}</tbody></table><p class="total">Total paid: ${money(receipt.amount)}</p><footer><p>Thank you for your payment.</p><p>coventrytamils2002@gmail.com<br>tamils.org.uk</p></footer></article></body></html>`;
  }

  // src/defaults.js
  var defaultSettings = {
    year: "2026-27",
    start: "2026-09-01",
    end: "2027-08-31",
    feesConfigured: false,
    membershipFees: { ...defaultMembershipFees },
    subjects: [
      "Tamil Language",
      "Bharathanatiyam",
      "Vocal Music",
      "Keyboard",
      "Mirudangam",
      "Veena",
      "Violin",
      "Kuchipudi",
      "Key Stage 1",
      "Key Stage 2",
      "Key Stage 3"
    ].map((name, index) => ({
      id: `subject-${index + 1}`,
      name,
      price: 0,
      frequency: "annually",
      active: true
    }))
  };

  // backend/apps-script.js
  var properties = () => PropertiesService.getScriptProperties();
  var now = () => Utilities.formatDate(/* @__PURE__ */ new Date(), "Europe/London", "yyyy-MM-dd");
  var uid = (prefix) => `${prefix}-${Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  var book = () => SpreadsheetApp.openById(properties().getProperty("SPREADSHEET_ID"));
  function table(name) {
    const sheet = book().getSheetByName(name);
    if (!sheet) throw new Error("Run setup before using the live application.");
    return {
      all() {
        return sheet.getDataRange().getValues().slice(1).filter((row) => row[0]).map(
          (row) => JSON.parse(
            row.slice(1).filter(Boolean).map((value) => String(value).slice(1)).join("")
          )
        );
      },
      save(key, record) {
        const json = JSON.stringify(record);
        if (json.length > 12e5)
          throw new Error(
            "This record exceeds the storage limit. Contact the charity."
          );
        const chunks = [];
        for (let offset = 0; offset < json.length; offset += 4e4)
          chunks.push(`~${json.slice(offset, offset + 4e4)}`);
        const rows = sheet.getDataRange().getValues();
        const existing = rows.findIndex(
          (row, index) => index > 0 && row[0] === key
        );
        const columns = Math.max(sheet.getLastColumn(), chunks.length + 1);
        if (columns > sheet.getMaxColumns())
          sheet.insertColumnsAfter(
            sheet.getMaxColumns(),
            columns - sheet.getMaxColumns()
          );
        const values = [key, ...chunks];
        while (values.length < columns) values.push("");
        sheet.getRange(
          existing < 0 ? sheet.getLastRow() + 1 : existing + 1,
          1,
          1,
          columns
        ).setValues([values]);
        SpreadsheetApp.flush();
      }
    };
  }
  function settings() {
    return table("Settings").all()[0] || defaultSettings;
  }
  function audit(action, actor, target) {
    const id = uid("AUDIT");
    table("Audit").save(id, {
      id,
      date: (/* @__PURE__ */ new Date()).toISOString(),
      action,
      actor,
      target
    });
  }
  function verifyAdmin(credential) {
    if (!credential || typeof credential !== "string" || credential.length > 1e4)
      throw new Error("Please sign in with an authorised admin Google account.");
    const response = UrlFetchApp.fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200)
      throw new Error("Your sign-in has expired. Sign out and sign in again.");
    const claims = JSON.parse(response.getContentText());
    const allowed = (properties().getProperty("ADMIN_EMAILS") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!properties().getProperty("GOOGLE_CLIENT_ID") || claims.aud !== properties().getProperty("GOOGLE_CLIENT_ID") || !["https://accounts.google.com", "accounts.google.com"].includes(
      claims.iss
    ) || String(claims.email_verified) !== "true" || Number(claims.exp) <= Date.now() / 1e3 || !allowed.includes(String(claims.email).toLowerCase()))
      throw new Error(
        "This Google account is not authorised to administer CTWA."
      );
    return claims.email.toLowerCase();
  }
  function hydrated(record, receipts) {
    const charges = record.charges.map((charge) => ({ ...charge, paid: 0 }));
    receipts.filter((receipt) => receipt.enrollmentId === record.id).forEach(
      (receipt) => receipt.allocations.forEach((allocation) => {
        const charge = charges.find((item) => item.id === allocation.id);
        if (!charge)
          throw new Error(
            "A payment allocation is missing its charge. Contact the system administrator."
          );
        charge.paid += allocation.amount;
      })
    );
    return { ...record, charges };
  }
  function hasLifetime(email, enrollments, receipts) {
    return table("Members").all().some((member) => member.email === email && member.lifetime) || enrollments.some((record) => {
      const member = hydrated(record, receipts);
      return member.email === email && member.approval === "approved" && member.membership === "lifetime" && member.charges[0].paid === member.charges[0].amount;
    });
  }
  function receiptEmail(receipt) {
    try {
      if (MailApp.getRemainingDailyQuota() < 1)
        throw new Error("Email quota reached.");
      const pdf = Utilities.newBlob(
        receiptHtml(receipt),
        "text/html",
        `${receipt.number}.html`
      ).getAs("application/pdf").setName(`${receipt.number}.pdf`);
      MailApp.sendEmail({
        to: receipt.email,
        subject: `CTWA payment receipt ${receipt.number}`,
        body: `Thank you for your payment of ${money(receipt.amount)}. Your receipt is attached. Enrollment: ${receipt.enrollmentId}.`,
        attachments: [pdf],
        name: "Coventry Tamil Welfare Association"
      });
      receipt.emailStatus = "sent";
      receipt.emailSentAt = (/* @__PURE__ */ new Date()).toISOString();
    } catch {
      receipt.emailStatus = "failed";
    }
    table("Receipts").save(receipt.number, receipt);
    return receipt;
  }
  function sendReminder(record) {
    if (record.approval !== "approved" || balance(record.charges, now()) <= 0)
      throw new Error("No approved fees are currently due.");
    if (record.lastReminder === now())
      return { message: "A reminder has already been sent today." };
    if (MailApp.getRemainingDailyQuota() < 1)
      throw new Error("Email quota reached. Try again tomorrow.");
    MailApp.sendEmail({
      to: record.email,
      subject: `CTWA payment reminder ${record.id}`,
      body: `Dear ${record.firstName},

Your current outstanding fees are ${money(balance(record.charges, now()))}.
Enrollment: ${record.id}

Please contact the charity to arrange payment. If you have already paid, please send your payment reference so we can reconcile it.

Coventry Tamil Welfare Association`,
      name: "Coventry Tamil Welfare Association"
    });
    record.lastReminder = now();
    table("Enrollments").save(record.id, {
      ...record,
      charges: record.charges.map((charge) => ({ ...charge, paid: 0 }))
    });
    return { message: "Payment reminder sent." };
  }
  function savePhotos(input, id) {
    const folder = DriveApp.getFolderById(
      properties().getProperty("PHOTOS_FOLDER_ID")
    );
    return input.children.map((child, index) => {
      const result = {
        name: child.name,
        dob: child.dob,
        class: String(child.class || "").slice(0, 50),
        index: String(child.index || "").slice(0, 50),
        subjects: child.subjects
      };
      if (child.photo) {
        const [header, encoded] = child.photo.split(",");
        const bytes = Utilities.base64Decode(encoded);
        const png = header.includes("png");
        if (bytes.length > 1e6 || (png ? (bytes[0] & 255) !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 : (bytes[0] & 255) !== 255 || (bytes[1] & 255) !== 216 || (bytes[2] & 255) !== 255))
          throw new Error("The admission photo is not a valid JPG or PNG.");
        const file = folder.createFile(
          Utilities.newBlob(
            bytes,
            png ? "image/png" : "image/jpeg",
            `${id}-child-${index + 1}.${png ? "png" : "jpg"}`
          )
        );
        result.photoUrl = file.getUrl();
      }
      return result;
    });
  }
  function dispatch(request) {
    const { action, payload = {}, credential } = request;
    if (action === "config") return settings();
    const actor = action === "enroll" && !credential ? "public" : verifyAdmin(credential);
    const enrollments = table("Enrollments").all();
    const receipts = table("Receipts").all();
    if (action === "remindAll") {
      if (!/^\d{4}-\d{2}$/.test(payload.year || "")) throw new Error("Choose an academic year.");
      const candidates = enrollments.map((item) => hydrated(item, receipts)).filter((item) => item.year === payload.year && item.approval === "approved" && balance(item.charges, now()) > 0);
      const result = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
      const started = Date.now();
      for (const candidate of candidates) {
        if (candidate.lastReminder === now()) {
          result.skipped++;
          continue;
        }
        if (MailApp.getRemainingDailyQuota() < 1 || Date.now() - started > 45e3) {
          result.deferred++;
          continue;
        }
        try {
          sendReminder(candidate);
          result.sent++;
        } catch {
          result.failed++;
        }
      }
      audit(action, actor, `${payload.year}: ${JSON.stringify(result)}`);
      return { ...result, message: `Payment reminders for ${payload.year}: ${result.sent} sent, ${result.skipped} already reminded today, ${result.failed} failed, ${result.deferred} deferred. Deferred or failed reminders can be retried; the daily scheduler also checks unpaid members.` };
    }
    if (action === "dashboard")
      return {
        enrollments: enrollments.map((record2) => hydrated(record2, receipts)),
        receipts
      };
    if (action === "settings") {
      const value = prepareSettings(payload.settings, settings(), (/* @__PURE__ */ new Date()).toISOString());
      table("Settings").save("settings", value);
      audit(action, actor, value.year);
      return { ok: true };
    }
    if (action === "enroll") {
      if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId))
        throw new Error("Invalid submission reference.");
      const existing = enrollments.find(
        (record3) => record3.requestId === payload.requestId
      );
      if (existing) return { id: existing.id };
      const config = settings();
      if (!config.feesConfigured)
        throw new Error("Subject fees are not configured yet.");
      validateEnrollment(payload.input, config, now());
      const email = payload.input.email.trim().toLowerCase();
      if (enrollments.some(
        (record3) => record3.email === email && record3.year === config.year
      ))
        throw new Error(
          "This email already has an enrollment for this year. Please contact the admin."
        );
      const input = payload.input;
      const id = uid("CTWA");
      const record2 = {
        id,
        requestId: payload.requestId,
        year: config.year,
        academicStart: config.start,
        academicEnd: config.end,
        firstName: input.firstName.trim(),
        surname: input.surname.trim(),
        address: input.address.trim(),
        postcode: input.postcode.trim(),
        email,
        mobile: input.mobile.trim(),
        telephone: String(input.telephone || "").slice(0, 30),
        membership: input.membership,
        consent: true,
        consentAt: (/* @__PURE__ */ new Date()).toISOString(),
        created: now(),
        approval: "pending",
        children: savePhotos(input, id),
        charges: buildCharges(input, config, now())
      };
      table("Enrollments").save(id, record2);
      audit(action, actor, id);
      try {
        MailApp.sendEmail({
          to: email,
          subject: `CTWA enrollment received ${id}`,
          body: `Dear ${record2.firstName},

Your enrollment for ${record2.year} has been received.
Reference: ${id}

The charity will review your application. A receipt will be issued after your payment is confirmed.

Coventry Tamil Welfare Association`,
          name: "Coventry Tamil Welfare Association"
        });
      } catch {
        console.error("Enrollment confirmation could not be delivered.");
      }
      return { id };
    }
    const original = enrollments.find((record2) => record2.id === payload.id);
    if (!original) throw new Error("Enrollment not found.");
    const record = hydrated(original, receipts);
    if (action === "editEnrollment") {
      const updated = reviseEnrollment(record, payload, settings(), now());
      updated.changes[updated.changes.length - 1].actor = actor;
      updated.changes[updated.changes.length - 1].savedAt = (/* @__PURE__ */ new Date()).toISOString();
      table("Enrollments").save(record.id, { ...updated, charges: updated.charges.map((charge) => ({ ...charge, paid: 0 })) });
      audit(action, actor, record.id);
      return { message: "Enrollment updated. Earlier fees and receipts are unchanged; prepaid fees are retained." };
    }
    if (action === "verifyLifetime") {
      if (record.charges[0].paid > 0)
        throw new Error(
          "Membership payment is already recorded. Do not change paid charges."
        );
      if (typeof payload.reference !== "string" || !payload.reference.trim() || payload.reference.length > 300) throw new Error("Enter the previous lifetime membership receipt or paper-record reference.");
      const member = table("Members").all().find((item) => item.email === record.email) || {
        id: uid("MEMBER"),
        email: record.email
      };
      table("Members").save(member.id, {
        ...member,
        lifetime: true,
        verifiedBy: actor,
        verifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
        previousPaymentReference: payload.reference.trim()
      });
      original.charges[0].amount = 0;
      original.charges[0].description = "Previously paid lifetime membership";
      table("Enrollments").save(record.id, original);
      audit(action, actor, record.id);
      return {
        message: "Previously paid lifetime membership verified. No new membership fee is due. No money was refunded; subject fees are unchanged."
      };
    }
    if (action === "approve") {
      const approvedRecord = record.approval === "pending" ? reschedulePendingEnrollment(original, payload.enrollmentDate || now(), settings(), now()) : { ...original };
      if (hasLifetime(record.email, enrollments, receipts) && approvedRecord.charges[0].paid === 0) {
        approvedRecord.charges[0].amount = 0;
        approvedRecord.charges[0].description = "Previously paid lifetime membership";
      }
      approvedRecord.approval = "approved";
      approvedRecord.approvedBy = actor;
      approvedRecord.approvedAt = (/* @__PURE__ */ new Date()).toISOString();
      approvedRecord.enrollmentDate = approvedRecord.enrollmentDate || now();
      table("Enrollments").save(record.id, { ...approvedRecord, charges: approvedRecord.charges.map((charge) => ({ ...charge, paid: 0 })) });
      audit(action, actor, `${record.id} / ${approvedRecord.enrollmentDate}`);
      return { ok: true };
    }
    if (action === "payment") {
      if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId))
        throw new Error("Invalid payment reference.");
      const existing = receipts.find(
        (item) => item.requestId === payload.requestId
      );
      if (existing) {
        if (existing.enrollmentId !== record.id)
          throw new Error("Payment reference belongs to a different enrollment.");
        return existing;
      }
      if (record.approval !== "approved")
        throw new Error("Approve the enrollment before recording a payment.");
      if (!["cash", "bank transfer", "card", "cheque"].includes(payload.method))
        throw new Error("Choose a valid payment method.");
      const allocated = allocatePayment(record.charges, payload.amount);
      const sequence = Number(properties().getProperty("RECEIPT_SEQUENCE") || 0) + 1;
      properties().setProperty("RECEIPT_SEQUENCE", String(sequence));
      const receipt = {
        number: `CTWA-R-${String(sequence).padStart(6, "0")}`,
        requestId: payload.requestId,
        enrollmentId: record.id,
        name: `${record.firstName} ${record.surname}`,
        email: record.email,
        date: now(),
        amount: payload.amount,
        method: payload.method,
        reference: String(payload.reference || "").slice(0, 100),
        allocations: allocated.allocations,
        recordedBy: actor,
        emailStatus: "queued"
      };
      table("Receipts").save(receipt.number, receipt);
      audit(action, actor, receipt.number);
      return receiptEmail(receipt);
    }
    if (action === "remind") {
      const result = sendReminder(record);
      audit(action, actor, record.id);
      return result;
    }
    if (action === "retryReceipt") {
      const receipt = receipts.find(
        (item) => item.number === payload.number && item.enrollmentId === record.id
      );
      if (!receipt) throw new Error("Receipt not found.");
      if (receipt.emailStatus === "sent")
        return { message: "Receipt email has already been sent." };
      receiptEmail(receipt);
      return {
        message: receipt.emailStatus === "sent" ? "Receipt email sent." : "Email could not be sent. Please retry later."
      };
    }
    throw new Error("Unknown action.");
  }
  function handlePost(event) {
    const lock = LockService.getScriptLock();
    let locked = false;
    let response;
    try {
      const request = JSON.parse(event.postData.contents);
      const key = properties().getProperty("GATEWAY_KEY");
      if (!key || request.gatewayKey !== key) throw new Error("Access denied.");
      locked = lock.tryLock(2e4);
      if (!locked) throw new Error("The system is busy. Please try again.");
      response = { ok: true, result: dispatch(request) };
    } catch (failure) {
      response = {
        ok: false,
        error: failure.message || "Unable to process this request."
      };
    } finally {
      if (locked) lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  function setup() {
    const spreadsheet = book();
    for (const name of [
      "Settings",
      "Enrollments",
      "Members",
      "Receipts",
      "Audit"
    ]) {
      if (!spreadsheet.getSheetByName(name)) {
        const sheet = spreadsheet.insertSheet(name);
        sheet.appendRow(["ID", "Record JSON"]);
        sheet.setFrozenRows(1);
      }
    }
    if (!table("Settings").all().length)
      table("Settings").save("settings", defaultSettings);
    if (!properties().getProperty("PHOTOS_FOLDER_ID"))
      properties().setProperty(
        "PHOTOS_FOLDER_ID",
        DriveApp.createFolder("CTWA private admission photos").getId()
      );
    if (!ScriptApp.getProjectTriggers().some(
      (trigger) => trigger.getHandlerFunction() === "sendScheduledReminders"
    ))
      ScriptApp.newTrigger("sendScheduledReminders").timeBased().everyDays(1).atHour(9).inTimezone("Europe/London").create();
  }
  function sendScheduledReminders() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e3)) return;
    try {
      const receipts = table("Receipts").all();
      for (const receipt of receipts.filter(
        (item) => item.emailStatus !== "sent"
      )) {
        if (MailApp.getRemainingDailyQuota() < 1) break;
        receiptEmail(receipt);
      }
      for (const original of table("Enrollments").all()) {
        if (MailApp.getRemainingDailyQuota() < 1) break;
        const record = hydrated(original, receipts);
        const elapsed = record.lastReminder ? (/* @__PURE__ */ new Date(`${now()}T00:00:00Z`) - /* @__PURE__ */ new Date(`${record.lastReminder}T00:00:00Z`)) / 864e5 : Infinity;
        if (record.approval === "approved" && balance(record.charges, now()) > 0 && elapsed >= 7) {
          try {
            sendReminder(record);
            audit("scheduledReminder", "system", record.id);
          } catch {
            console.error("A scheduled reminder could not be delivered.");
          }
        }
      }
    } finally {
      lock.releaseLock();
    }
  }
  return __toCommonJS(apps_script_exports);
})();
function doPost(event) { return CTWA.handlePost(event); }
function setup() { return CTWA.setup(); }
function sendScheduledReminders() { return CTWA.sendScheduledReminders(); }
