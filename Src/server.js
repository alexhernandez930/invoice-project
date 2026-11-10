const { existsSync } = require("node:fs");
const path = require("node:path");

for (const filename of ["openai.env", "groq.env"]) {
  const assistantEnv = path.join(__dirname, "..", ".invoice-data", filename);
  if (existsSync(assistantEnv)) process.loadEnvFile(assistantEnv);
}

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const createInvoiceRouter = require("./invoices");
const createAccounts = require("./accounts");

const app = express();
const port = Number(process.env.INVOICE_PORT || 3000);

app.use((req, res, next) => {
  if (!["localhost", "127.0.0.1"].includes(req.hostname)) return res.sendStatus(403);
  const origin = req.get("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      ((origin && origin !== req.protocol + "://" + req.get("Host")) ||
       req.get("Sec-Fetch-Site") === "cross-site")) return res.sendStatus(403);
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
  });
  next();
});
app.use(express.json({ limit: "4mb" }));

const db = new sqlite3.Database("database.db");
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )
`);

async function start() {
  const accounts = await createAccounts();
  const invoices = await createInvoiceRouter(accounts.findUser);
  app.use("/api/auth", accounts.router);
  app.use("/api/invoices", accounts.loadAccount, accounts.requireAccount, invoices);

  const sendPage = (res, name) => res.sendFile(path.join(__dirname, name));
  app.get(["/", "/index.html"], accounts.loadAccount, (req, res) => {
    res.redirect(req.account ? "/create-invoice.html" : "/login.html");
  });
  app.get("/login.html", accounts.loadAccount, (req, res) => {
    if (req.account) return res.redirect("/create-invoice.html");
    sendPage(res, "login.html");
  });
  for (const page of ["create-invoice.html", "invoice.html", "invoices.html", "admin.html"]) {
    app.get("/" + page, accounts.loadAccount, (req, res) => {
      if (!req.account) return res.redirect("/login.html");
      if (page === "admin.html" && req.account.role !== "admin") return res.sendStatus(403);
      sendPage(res, page);
    });
  }

  app.post("/save", accounts.loadAccount, accounts.requireAccount, function (req, res) {
    db.run("INSERT INTO users (name) VALUES (?)", [req.body.name], function (error) {
      res.send(error ? "Error saving name" : "Name saved!");
    });
  });

  app.use((req, res, next) => {
    if (!/\.(?:css|js|webp)$/i.test(decodeURIComponent(req.path))) return res.sendStatus(404);
    next();
  });
  app.use(express.static(__dirname, { index: false }));

  app.listen(port, "127.0.0.1", (error) => {
    if (error) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Server running on http://127.0.0.1:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
