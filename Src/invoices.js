const express = require("express");
const sqlite3 = require("sqlite3");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const suggestAddresses = require("./address-suggestions");
const invoiceAssistant = require("./invoice-assistant-api");

const databasePath = process.env.INVOICE_DB_PATH ||
  path.join(__dirname, "..", ".invoice-data", "invoices.db");

function invoiceNumber(id) {
  return "INV-" + String(id).padStart(4, "0");
}

function summary(row) {
  return {
    id: row.id,
    invoiceNumber: invoiceNumber(row.id),
    invoiceDate: row.invoice_date,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,
    total: "$" + (row.total_cents / 100).toFixed(2),
  };
}

function phoneDigits(value) {
  return value.replace(/\D/g, "");
}

function searchText(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function text(value, label, maxLength = 300) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(label + " is missing or too long.");
  }
  return value.trim();
}

function validateInvoice(body) {
  if (!body || typeof body.draftId !== "string" ||
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.draftId)) {
    throw new Error("Open a new invoice preview before saving.");
  }

  const customerName = text(body.customerName, "Customer name");
  if (!customerName) throw new Error("Enter a customer name before saving.");

  const customerAddress = text(body.customerAddress, "Customer address");
  const customerPhone = text(body.customerPhone, "Customer phone", 60);
  const jobTitle = text(body.jobTitle, "Job title");
  const jobTitleEnglish = body.jobTitleEnglish == null
    ? null : text(body.jobTitleEnglish, "English job title", 600) || null;

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) {
    throw new Error("Enter between 1 and 500 invoice items.");
  }

  let totalCents = 0;
  const items = body.items.map((item) => {
    if (!item) throw new Error("An invoice item is missing.");
    const name = text(item.name, "Item name");
    const description = text(item.description, "Item description", 5000);
    const quantity = text(item.quantity, "Quantity", 12) || "1";
    const price = text(item.price, "Price", 16);
    const priceValue = Number(price);
    const cents = Math.round(priceValue * 100);

    if (!/^\d+$/.test(quantity) || Number(quantity) < 1) {
      throw new Error("Use a whole number of at least 1 for each quantity.");
    }

    if ((price && !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(price)) ||
        !Number.isSafeInteger(cents) || cents > 9999999999) {
      throw new Error("Use a nonnegative price of up to $99,999,999.99.");
    }

    totalCents += cents;
    return { name, description, quantity, price: (cents / 100).toFixed(2) };
  });

  if (!body.items.some((item) => item.name.trim() || item.description.trim() || item.price.trim())) {
    throw new Error("Enter at least one invoice item before saving.");
  }

  return { customerName, customerAddress, customerPhone, jobTitle, jobTitleEnglish, items, totalCents };
}

async function createInvoiceRouter(findUser) {
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
  db.configure("busyTimeout", 5000);

  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));
  await run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT NOT NULL UNIQUE,
      invoice_date TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      phone_digits TEXT NOT NULL,
      customer_search TEXT NOT NULL,
      job_title TEXT NOT NULL,
      job_title_english TEXT,
      items_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      owner_id TEXT
    )
  `);
  await run("BEGIN IMMEDIATE");
  try {
    const columns = await all("PRAGMA table_info(invoices)");
    if (!columns.some((column) => column.name === "owner_id")) {
      await run("ALTER TABLE invoices ADD COLUMN owner_id TEXT");
    }
    if (!columns.some((column) => column.name === "job_title_english")) {
      await run("ALTER TABLE invoices ADD COLUMN job_title_english TEXT");
    }
    await run("CREATE INDEX IF NOT EXISTS invoice_owner ON invoices(owner_id, id)");
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  const router = express.Router();

  router.post("/", async (req, res) => {
    let invoice;
    try {
      invoice = validateInvoice(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const { customerName, customerAddress, customerPhone, jobTitle, jobTitleEnglish, items, totalCents } = invoice;
    const draftId = req.account.id + ":" + req.body.draftId;
    const values = [
      draftId, customerName, customerAddress, customerPhone,
      phoneDigits(customerPhone), searchText(customerName + "\n" + customerAddress),
      jobTitle, jobTitleEnglish, JSON.stringify(items), totalCents, req.account.id, draftId,
    ];
    const inserted = await get(`
      INSERT INTO invoices (
        draft_id, invoice_date, customer_name, customer_address, customer_phone,
        phone_digits, customer_search, job_title, job_title_english, items_json, total_cents, owner_id
      )
      SELECT ?, date('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE draft_id = ?)
      ON CONFLICT(draft_id) DO NOTHING
      RETURNING id
    `, values);
    const row = inserted || await get("SELECT id FROM invoices WHERE draft_id = ? AND owner_id = ?",
      [draftId, req.account.id]);
    res.status(inserted ? 201 : 200).json({ id: row.id });
  });

  router.get("/", async (req, res) => {
    let ownerId = req.account.id;
    let ownerName = req.account.username;
    if (req.query.owner !== undefined) {
      if (req.account.role !== "admin") return res.sendStatus(403);
      if (req.query.owner === "legacy") {
        ownerId = ownerName = null;
      } else {
        const owner = typeof req.query.owner === "string" && await findUser(req.query.owner);
        if (!owner) return res.status(404).json({ error: "Account not found." });
        ownerId = req.query.owner;
        ownerName = owner.username;
      }
    }
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length > 300) return res.status(400).json({ error: "Search is too long." });

    const before = typeof req.query.before === "string" && /^\d+$/.test(req.query.before)
      ? Number(req.query.before) : null;
    const number = /^(?:inv-?)?0*(\d+)$/i.exec(query);
    const id = number && Number.isSafeInteger(Number(number[1])) ? Number(number[1]) : null;
    const digits = /^[+\d().\s-]+$/.test(query) ? phoneDigits(query) : "";
    const rows = await all(`
      SELECT id, invoice_date, customer_name, customer_address, customer_phone, total_cents
      FROM invoices
      WHERE owner_id IS ? AND (? IS NULL OR id < ?) AND (
        ? = '' OR id = ? OR instr(customer_search, ?) > 0
        OR (? != '' AND instr(phone_digits, ?) > 0)
      )
      ORDER BY id DESC
      LIMIT 51
    `, [ownerId, before, before, query, id, searchText(query), digits, digits]);
    res.json({
      ownerName,
      invoices: rows.slice(0, 50).map(summary),
      next: rows.length > 50 ? rows[49].id : null,
    });
  });

  router.get("/addresses", suggestAddresses);
  router.use("/assistant", invoiceAssistant);

  router.get("/customers", async (req, res) => {
    const query = typeof req.query.q === "string" ? searchText(req.query.q.trim()) : "";
    if (query.length < 2 || query.length > 300) return res.json([]);

    const rows = await all(`
      WITH contacts AS (
        SELECT id, phone_digits, customer_address,
          substr(customer_search, 1, instr(customer_search, char(10)) - 1) AS name_key
        FROM invoices
        WHERE owner_id = ?
      ), matches AS (
        SELECT max(id) AS id
        FROM contacts
        WHERE instr(name_key, ?) > 0
        GROUP BY name_key, phone_digits, CASE WHEN phone_digits = '' THEN customer_address END
      )
      SELECT customer_name AS name, customer_phone AS phone, customer_address AS address
      FROM matches JOIN invoices USING (id)
      ORDER BY id DESC
      LIMIT 8
    `, [req.account.id, query]);
    res.json(rows);
  });

  router.param("id", (req, res, next, value) => {
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id < 1) {
      return res.status(404).json({ error: "Invoice not found." });
    }
    req.invoiceId = id;
    next();
  });

  router.get("/:id", async (req, res) => {
    const row = await get("SELECT * FROM invoices WHERE id = ? AND (owner_id = ? OR ? = 'admin')",
      [req.invoiceId, req.account.id, req.account.role]);
    if (!row) return res.status(404).json({ error: "Invoice not found." });
    const canEdit = row.owner_id === req.account.id;
    const owner = canEdit ? req.account : await findUser(row.owner_id);
    res.json({
      ...summary(row), jobTitle: row.job_title, jobTitleEnglish: row.job_title_english,
      items: JSON.parse(row.items_json),
      canEdit, ownerId: row.owner_id, ownerName: owner?.username || null,
    });
  });

  router.patch("/:id", async (req, res) => {
    let customerAddress;
    let jobTitle;
    let jobTitleEnglish;
    try {
      if (req.body?.customerAddress !== undefined) {
        customerAddress = text(req.body.customerAddress, "Customer address");
      }
      if (req.body?.jobTitle !== undefined) {
        jobTitle = text(req.body.jobTitle, "Job description");
        jobTitleEnglish = req.body.jobTitleEnglish == null
          ? null : text(req.body.jobTitleEnglish, "English job title", 600) || null;
      }
      if (customerAddress === undefined && jobTitle === undefined) {
        throw new Error("Enter an address or job description to update.");
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const row = await get(`
      SELECT customer_name, customer_address, job_title FROM invoices WHERE id = ? AND owner_id = ?
    `, [req.invoiceId, req.account.id]);
    if (!row) return res.status(404).json({ error: "Invoice not found." });

    const address = customerAddress ?? row.customer_address;
    const job = jobTitle ?? row.job_title;
    const updated = await get(`
      UPDATE invoices
      SET customer_address = ?, job_title = ?,
          job_title_english = CASE WHEN ? THEN ? ELSE job_title_english END,
          customer_search = ?
      WHERE id = ? AND owner_id = ? AND customer_address = ? AND job_title = ?
      RETURNING customer_address, job_title, job_title_english
    `, [
      address, job, Number(jobTitle !== undefined), jobTitleEnglish ?? null,
      searchText(row.customer_name + "\n" + address),
      req.invoiceId, req.account.id, row.customer_address, row.job_title,
    ]);
    if (!updated) {
      return res.status(409).json({ error: "This invoice changed while saving. Try again." });
    }
    res.json({
      customerAddress: updated.customer_address, jobTitle: updated.job_title,
      jobTitleEnglish: updated.job_title_english,
    });
  });

  router.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: "The invoice database is unavailable. Try again." });
  });

  return router;
}

module.exports = createInvoiceRouter;
