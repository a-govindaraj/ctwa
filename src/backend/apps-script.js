import {
  allocatePayment,
  balance,
  buildCharges,
  receiptHtml,
  validateEnrollment,
  prepareSettings,
  reviseEnrollment,
  reschedulePendingEnrollment,
  money,
} from "../src/billing.js";
import { defaultSettings } from "../src/defaults.js";

const properties = () => PropertiesService.getScriptProperties();
const now = () =>
  Utilities.formatDate(new Date(), "Europe/London", "yyyy-MM-dd");
const uid = (prefix) =>
  `${prefix}-${Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
const book = () =>
  SpreadsheetApp.openById(properties().getProperty("SPREADSHEET_ID"));

function table(name) {
  const sheet = book().getSheetByName(name);
  if (!sheet) throw new Error("Run setup before using the live application.");
  return {
    all() {
      return sheet
        .getDataRange()
        .getValues()
        .slice(1)
        .filter((row) => row[0])
        .map((row) =>
          JSON.parse(
            row
              .slice(1)
              .filter(Boolean)
              .map((value) => String(value).slice(1))
              .join(""),
          ),
        );
    },
    save(key, record) {
      const json = JSON.stringify(record);
      if (json.length > 1200000)
        throw new Error(
          "This record exceeds the storage limit. Contact the charity.",
        );
      const chunks = [];
      for (let offset = 0; offset < json.length; offset += 40000)
        chunks.push(`~${json.slice(offset, offset + 40000)}`);
      const rows = sheet.getDataRange().getValues();
      const existing = rows.findIndex(
        (row, index) => index > 0 && row[0] === key,
      );
      const columns = Math.max(sheet.getLastColumn(), chunks.length + 1);
      if (columns > sheet.getMaxColumns())
        sheet.insertColumnsAfter(
          sheet.getMaxColumns(),
          columns - sheet.getMaxColumns(),
        );
      const values = [key, ...chunks];
      while (values.length < columns) values.push("");
      sheet
        .getRange(
          existing < 0 ? sheet.getLastRow() + 1 : existing + 1,
          1,
          1,
          columns,
        )
        .setValues([values]);
      SpreadsheetApp.flush();
    },
  };
}

function settings() {
  return table("Settings").all()[0] || defaultSettings;
}
function audit(action, actor, target) {
  const id = uid("AUDIT");
  table("Audit").save(id, {
    id,
    date: new Date().toISOString(),
    action,
    actor,
    target,
  });
}

export function verifyAdmin(credential) {
  if (
    !credential ||
    typeof credential !== "string" ||
    credential.length > 10000
  )
    throw new Error("Please sign in with an authorised admin Google account.");
  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    { muteHttpExceptions: true },
  );
  if (response.getResponseCode() !== 200)
    throw new Error("Your sign-in has expired. Sign out and sign in again.");
  const claims = JSON.parse(response.getContentText());
  const allowed = (properties().getProperty("ADMIN_EMAILS") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    !properties().getProperty("GOOGLE_CLIENT_ID") ||
    claims.aud !== properties().getProperty("GOOGLE_CLIENT_ID") ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      claims.iss,
    ) ||
    String(claims.email_verified) !== "true" ||
    Number(claims.exp) <= Date.now() / 1000 ||
    !allowed.includes(String(claims.email).toLowerCase())
  )
    throw new Error(
      "This Google account is not authorised to administer CTWA.",
    );
  return claims.email.toLowerCase();
}

function hydrated(record, receipts) {
  const charges = record.charges.map((charge) => ({ ...charge, paid: 0 }));
  receipts
    .filter((receipt) => receipt.enrollmentId === record.id)
    .forEach((receipt) =>
      receipt.allocations.forEach((allocation) => {
        const charge = charges.find((item) => item.id === allocation.id);
        if (!charge)
          throw new Error(
            "A payment allocation is missing its charge. Contact the system administrator.",
          );
        charge.paid += allocation.amount;
      }),
    );
  return { ...record, charges };
}

function hasLifetime(email, enrollments, receipts) {
  return (
    table("Members")
      .all()
      .some((member) => member.email === email && member.lifetime) ||
    enrollments.some((record) => {
      const member = hydrated(record, receipts);
      return (
        member.email === email &&
        member.approval === "approved" &&
        member.membership === "lifetime" &&
        member.charges[0].paid === member.charges[0].amount
      );
    })
  );
}

function receiptEmail(receipt) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1)
      throw new Error("Email quota reached.");
    const pdf = Utilities.newBlob(
      receiptHtml(receipt),
      "text/html",
      `${receipt.number}.html`,
    )
      .getAs("application/pdf")
      .setName(`${receipt.number}.pdf`);
    MailApp.sendEmail({
      to: receipt.email,
      subject: `CTWA payment receipt ${receipt.number}`,
      body: `Thank you for your payment of ${money(receipt.amount)}. Your receipt is attached. Enrollment: ${receipt.enrollmentId}.`,
      attachments: [pdf],
      name: "Coventry Tamil Welfare Association",
    });
    receipt.emailStatus = "sent";
    receipt.emailSentAt = new Date().toISOString();
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
    body: `Dear ${record.firstName},\n\nYour current outstanding fees are ${money(balance(record.charges, now()))}.\nEnrollment: ${record.id}\n\nPlease contact the charity to arrange payment. If you have already paid, please send your payment reference so we can reconcile it.\n\nCoventry Tamil Welfare Association`,
    name: "Coventry Tamil Welfare Association",
  });
  record.lastReminder = now();
  table("Enrollments").save(record.id, {
    ...record,
    charges: record.charges.map((charge) => ({ ...charge, paid: 0 })),
  });
  return { message: "Payment reminder sent." };
}

function savePhotos(input, id) {
  const folder = DriveApp.getFolderById(
    properties().getProperty("PHOTOS_FOLDER_ID"),
  );
  return input.children.map((child, index) => {
    const result = {
      name: child.name,
      dob: child.dob,
      class: String(child.class || "").slice(0, 50),
      index: String(child.index || "").slice(0, 50),
      subjects: child.subjects,
    };
    if (child.photo) {
      const [header, encoded] = child.photo.split(",");
      const bytes = Utilities.base64Decode(encoded);
      const png = header.includes("png");
      if (
        bytes.length > 1000000 ||
        (png
          ? (bytes[0] & 255) !== 137 ||
            bytes[1] !== 80 ||
            bytes[2] !== 78 ||
            bytes[3] !== 71
          : (bytes[0] & 255) !== 255 ||
            (bytes[1] & 255) !== 216 ||
            (bytes[2] & 255) !== 255)
      )
        throw new Error("The admission photo is not a valid JPG or PNG.");
      const file = folder.createFile(
        Utilities.newBlob(
          bytes,
          png ? "image/png" : "image/jpeg",
          `${id}-child-${index + 1}.${png ? "png" : "jpg"}`,
        ),
      );
      result.photoUrl = file.getUrl();
    }
    return result;
  });
}

export function dispatch(request) {
  const { action, payload = {}, credential } = request;
  if (action === "config") return settings();
  const actor =
    action === "enroll" && !credential ? "public" : verifyAdmin(credential);
  const enrollments = table("Enrollments").all();
  const receipts = table("Receipts").all();
  if (action === "remindAll") {
    if (!/^\d{4}-\d{2}$/.test(payload.year || "")) throw new Error("Choose an academic year.");
    const candidates = enrollments.map(item => hydrated(item, receipts)).filter(item => item.year === payload.year && item.approval === "approved" && balance(item.charges, now()) > 0);
    const result = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
    const started = Date.now();
    for (const candidate of candidates) {
      if (candidate.lastReminder === now()) { result.skipped++; continue; }
      if (MailApp.getRemainingDailyQuota() < 1 || Date.now() - started > 45000) { result.deferred++; continue; }
      try { sendReminder(candidate); result.sent++; }
      catch { result.failed++; }
    }
    audit(action, actor, `${payload.year}: ${JSON.stringify(result)}`);
    return { ...result, message: `Payment reminders for ${payload.year}: ${result.sent} sent, ${result.skipped} already reminded today, ${result.failed} failed, ${result.deferred} deferred. Deferred or failed reminders can be retried; the daily scheduler also checks unpaid members.` };
  }
  if (action === "dashboard")
    return {
      enrollments: enrollments.map((record) => hydrated(record, receipts)),
      receipts,
    };
  if (action === "settings") {
    const value = prepareSettings(payload.settings, settings(), new Date().toISOString());
    table("Settings").save("settings", value);
    audit(action, actor, value.year);
    return { ok: true };
  }
  if (action === "enroll") {
    if (
      typeof payload.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId)
    )
      throw new Error("Invalid submission reference.");
    const existing = enrollments.find(
      (record) => record.requestId === payload.requestId,
    );
    if (existing) return { id: existing.id };
    const config = settings();
    if (!config.feesConfigured)
      throw new Error("Subject fees are not configured yet.");
    validateEnrollment(payload.input, config, now());
    const email = payload.input.email.trim().toLowerCase();
    if (
      enrollments.some(
        (record) => record.email === email && record.year === config.year,
      )
    )
      throw new Error(
        "This email already has an enrollment for this year. Please contact the admin.",
      );
    const input = payload.input;
    const id = uid("CTWA");
    const record = {
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
      consentAt: new Date().toISOString(),
      created: now(),
      approval: "pending",
      children: savePhotos(input, id),
      charges: buildCharges(input, config, now()),
    };
    table("Enrollments").save(id, record);
    audit(action, actor, id);
    try {
      MailApp.sendEmail({
        to: email,
        subject: `CTWA enrollment received ${id}`,
        body: `Dear ${record.firstName},\n\nYour enrollment for ${record.year} has been received.\nReference: ${id}\n\nThe charity will review your application. A receipt will be issued after your payment is confirmed.\n\nCoventry Tamil Welfare Association`,
        name: "Coventry Tamil Welfare Association",
      });
    } catch {
      console.error("Enrollment confirmation could not be delivered.");
    }
    return { id };
  }
  const original = enrollments.find((record) => record.id === payload.id);
  if (!original) throw new Error("Enrollment not found.");
  const record = hydrated(original, receipts);
  if (action === "editEnrollment") {
    const updated = reviseEnrollment(record, payload, settings(), now());
    updated.changes[updated.changes.length - 1].actor = actor;
    updated.changes[updated.changes.length - 1].savedAt = new Date().toISOString();
    table("Enrollments").save(record.id, { ...updated, charges: updated.charges.map(charge => ({ ...charge, paid: 0 })) });
    audit(action, actor, record.id);
    return { message: "Enrollment updated. Earlier fees and receipts are unchanged; prepaid fees are retained." };
  }
  if (action === "verifyLifetime") {
    if (record.charges[0].paid > 0)
      throw new Error(
        "Membership payment is already recorded. Do not change paid charges.",
      );
    if (typeof payload.reference !== "string" || !payload.reference.trim() || payload.reference.length > 300) throw new Error("Enter the previous lifetime membership receipt or paper-record reference.");
    const member = table("Members")
      .all()
      .find((item) => item.email === record.email) || {
      id: uid("MEMBER"),
      email: record.email,
    };
    table("Members").save(member.id, {
      ...member,
      lifetime: true,
      verifiedBy: actor,
      verifiedAt: new Date().toISOString(),
      previousPaymentReference: payload.reference.trim(),
    });
    original.charges[0].amount = 0;
    original.charges[0].description = "Previously paid lifetime membership";
    table("Enrollments").save(record.id, original);
    audit(action, actor, record.id);
    return {
      message: "Previously paid lifetime membership verified. No new membership fee is due. No money was refunded; subject fees are unchanged.",
    };
  }
  if (action === "approve") {
    const approvedRecord = record.approval === "pending"
      ? reschedulePendingEnrollment(original, payload.enrollmentDate || now(), settings(), now())
      : { ...original };
    if (
      hasLifetime(record.email, enrollments, receipts) &&
      approvedRecord.charges[0].paid === 0
    ) {
      approvedRecord.charges[0].amount = 0;
      approvedRecord.charges[0].description = "Previously paid lifetime membership";
    }
    approvedRecord.approval = "approved";
    approvedRecord.approvedBy = actor;
    approvedRecord.approvedAt = new Date().toISOString();
    approvedRecord.enrollmentDate = approvedRecord.enrollmentDate || now();
    table("Enrollments").save(record.id, { ...approvedRecord, charges: approvedRecord.charges.map(charge => ({ ...charge, paid: 0 })) });
    audit(action, actor, `${record.id} / ${approvedRecord.enrollmentDate}`);
    return { ok: true };
  }
  if (action === "payment") {
    if (
      typeof payload.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(payload.requestId)
    )
      throw new Error("Invalid payment reference.");
    const existing = receipts.find(
      (item) => item.requestId === payload.requestId,
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
    const sequence =
      Number(properties().getProperty("RECEIPT_SEQUENCE") || 0) + 1;
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
      emailStatus: "queued",
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
      (item) =>
        item.number === payload.number && item.enrollmentId === record.id,
    );
    if (!receipt) throw new Error("Receipt not found.");
    if (receipt.emailStatus === "sent")
      return { message: "Receipt email has already been sent." };
    receiptEmail(receipt);
    return {
      message:
        receipt.emailStatus === "sent"
          ? "Receipt email sent."
          : "Email could not be sent. Please retry later.",
    };
  }
  throw new Error("Unknown action.");
}

export function handlePost(event) {
  const lock = LockService.getScriptLock();
  let locked = false;
  let response;
  try {
    const request = JSON.parse(event.postData.contents);
    const key = properties().getProperty("GATEWAY_KEY");
    if (!key || request.gatewayKey !== key) throw new Error("Access denied.");
    locked = lock.tryLock(20000);
    if (!locked) throw new Error("The system is busy. Please try again.");
    response = { ok: true, result: dispatch(request) };
  } catch (failure) {
    response = {
      ok: false,
      error: failure.message || "Unable to process this request.",
    };
  } finally {
    if (locked) lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

export function setup() {
  const spreadsheet = book();
  for (const name of [
    "Settings",
    "Enrollments",
    "Members",
    "Receipts",
    "Audit",
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
      DriveApp.createFolder("CTWA private admission photos").getId(),
    );
  if (
    !ScriptApp.getProjectTriggers().some(
      (trigger) => trigger.getHandlerFunction() === "sendScheduledReminders",
    )
  )
    ScriptApp.newTrigger("sendScheduledReminders")
      .timeBased()
      .everyDays(1)
      .atHour(9)
      .inTimezone("Europe/London")
      .create();
}

export function sendScheduledReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const receipts = table("Receipts").all();
    for (const receipt of receipts.filter(
      (item) => item.emailStatus !== "sent",
    )) {
      if (MailApp.getRemainingDailyQuota() < 1) break;
      receiptEmail(receipt);
    }
    for (const original of table("Enrollments").all()) {
      if (MailApp.getRemainingDailyQuota() < 1) break;
      const record = hydrated(original, receipts);
      const elapsed = record.lastReminder
        ? (new Date(`${now()}T00:00:00Z`) -
            new Date(`${record.lastReminder}T00:00:00Z`)) /
          86400000
        : Infinity;
      if (
        record.approval === "approved" &&
        balance(record.charges, now()) > 0 &&
        elapsed >= 7
      ) {
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
