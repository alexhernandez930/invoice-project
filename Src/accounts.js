const express = require("express");
const sqlite3 = require("sqlite3");
const { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } = require("node:crypto");
const { mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { invoiceNewPasswordIssue } = require("./password-strength");

const databasePath = process.env.INVOICE_ACCOUNTS_DB_PATH ||
  path.join(__dirname, "..", ".invoice-data", "accounts.db");
const setupPath = path.join(path.dirname(databasePath), "admin-setup-token");
const sessionCookie = "invoice_session";
const sessionDuration = 24 * 60 * 60 * 1000;
const deriveKey = promisify(scrypt);
const passwordOptions = { N: 2 ** 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const pngHeader = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function validLogo(data) {
  if (!Buffer.isBuffer(data) || data.length < 45 || !data.subarray(0, 16).equals(pngHeader)) {
    return false;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && width <= 512 && height > 0 && height <= 512;
}

function digest(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionHash(req) {
  const match = /(?:^|;\s*)invoice_session=([a-f0-9]{64})(?:;|$)/.exec(req.get("Cookie") || "");
  return match ? digest(match[1]) : null;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" };
}

function credentials(body) {
  const username = typeof body?.username === "string" ? body.username.trim().normalize("NFKC") : "";
  const password = typeof body?.password === "string" ? body.password : "";
  return { username, usernameKey: username.toLowerCase(), password };
}

function setupToken() {
  try {
    writeFileSync(setupPath, randomBytes(24).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readFileSync(setupPath, "utf8").trim();
}

async function createAccounts() {
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
  const exec = promisify(db.exec.bind(db));
  await exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS single_admin ON users(role) WHERE role = 'admin';
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS account_logos (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      image BLOB NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS revoke_sessions_after_password_reset
      AFTER UPDATE OF password_hash ON users
      BEGIN
        DELETE FROM sessions WHERE user_id = NEW.id;
      END;
  `);

  const adminExists = () => get("SELECT 1 FROM users WHERE role = 'admin'");
  const initialToken = await adminExists() ? null : setupToken();
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = randomBytes(64);
  const router = express.Router();
  let attempts = [];
  let hashing = 0;

  async function loadAccount(req, res, next) {
    res.set("Cache-Control", "no-store");
    const hash = sessionHash(req);
    if (hash) {
      req.account = await get(`
        SELECT users.id, users.username, users.role
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE token_hash = ? AND expires_at > ?
      `, [hash, Date.now()]);
    }
    next();
  }

  function requireAccount(req, res, next) {
    const expected = req.get("X-Invoice-Account");
    if (!req.account || (expected && expected !== req.account.id)) {
      return res.status(401).json({ error: "Sign in to continue." });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.account.role !== "admin") return res.sendStatus(403);
    next();
  }

  async function hashPassword(password, salt) {
    if (hashing >= 2) {
      const error = new Error("Too many sign-in attempts. Try again shortly.");
      error.status = 429;
      throw error;
    }
    hashing++;
    try {
      return await deriveKey(password, salt, 64, passwordOptions);
    } finally {
      hashing--;
    }
  }

  async function startSession(req, res, account, passwordHash) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    // A reset can occur while an earlier sign-in is still verifying its password.
    const session = await get(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ?
      RETURNING token_hash
    `, [digest(token), now + sessionDuration, account.id, passwordHash]);
    if (!session) return res.status(401).json({ error: "Incorrect username or password." });
    await run("DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?", [now, sessionHash(req)]);
    res.cookie(sessionCookie, token, { ...cookieOptions(req), maxAge: sessionDuration });
    res.json({ account });
  }

  router.use(loadAccount);
  router.get("/session", (req, res) => res.json({ account: req.account || null }));
  router.get("/setup", async (req, res) => res.json({ available: !await adminExists() }));

  router.post(["/login", "/register", "/setup"], async (req, res) => {
    if (!req.is("application/json")) return res.sendStatus(415);
    const now = Date.now();
    attempts = attempts.filter((time) => now - time < 60000);
    if (attempts.length >= 20 || hashing >= 2) {
      return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });
    }
    attempts.push(now);

    const { username, usernameKey, password } = credentials(req.body);
    const action = req.path.toLowerCase().replace(/\/$/, "");
    if (action === "/login") {
      if (!username || username.length > 32 || !password || password.length > 128) {
        return res.status(401).json({ error: "Incorrect username or password." });
      }
      const user = await get("SELECT * FROM users WHERE username_key = ?", [usernameKey]);
      const hash = await hashPassword(password, user?.salt || dummySalt);
      if (!timingSafeEqual(hash, user ? Buffer.from(user.password_hash, "hex") : dummyHash) || !user) {
        return res.status(401).json({ error: "Incorrect username or password." });
      }
      return startSession(req, res, { id: user.id, username: user.username, role: user.role }, user.password_hash);
    }

    const role = action === "/setup" ? "admin" : "user";
    if (role === "admin") {
      if (!initialToken || await adminExists()) {
        return res.status(409).json({ error: "The administrator account already exists." });
      }
      const token = typeof req.body?.setupToken === "string" ? req.body.setupToken.trim() : "";
      if (!timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(digest(initialToken), "hex"))) {
        return res.status(403).json({ error: "The administrator setup token is incorrect." });
      }
    }
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
      return res.status(400).json({ error: "Use 3–32 letters, numbers, periods, hyphens, or underscores for the username." });
    }
    const passwordIssue = invoiceNewPasswordIssue(password, req.body.passwordConfirmation, username);
    if (passwordIssue) return res.status(400).json({ error: passwordIssue });

    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hashPassword(password, salt)).toString("hex");
    const account = { id: randomUUID(), username, role };
    try {
      await run("INSERT INTO users (id, username, username_key, salt, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
        [account.id, username, usernameKey, salt, passwordHash, role]);
    } catch (error) {
      if (error.code !== "SQLITE_CONSTRAINT") throw error;
      const adminCreated = role === "admin" && await adminExists();
      return res.status(409).json({
        error: adminCreated ? "The administrator account already exists." : "That username is already taken.",
      });
    }
    if (role === "admin") {
      try {
        unlinkSync(setupPath);
      } catch {
        // The unique admin constraint makes the token unusable after setup.
      }
    }
    await startSession(req, res, account, passwordHash);
  });

  router.post("/logout", async (req, res) => {
    await run("DELETE FROM sessions WHERE token_hash = ?", [sessionHash(req)]);
    res.clearCookie(sessionCookie, cookieOptions(req));
    res.sendStatus(204);
  });

  router.get(["/logo", "/logo/:id"], requireAccount, async (req, res) => {
    const userId = req.params.id || req.account.id;
    if (userId !== req.account.id && req.account.role !== "admin") return res.sendStatus(404);
    const logo = await get("SELECT image FROM account_logos WHERE user_id = ?", [userId]);
    if (!logo) return res.redirect("/palm_cute.webp");
    res.type("png").send(logo.image);
  });

  router.put("/logo", requireAccount, express.raw({ type: "image/png", limit: "2mb", inflate: false }), async (req, res) => {
    if (!req.is("image/png") || !validLogo(req.body)) {
      return res.status(400).json({ error: "Choose a valid PNG, JPEG, or WebP image." });
    }
    await run(`
      INSERT INTO account_logos (user_id, image) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET image = excluded.image
    `, [req.account.id, req.body]);
    res.sendStatus(204);
  });

  router.delete("/logo", requireAccount, async (req, res) => {
    await run("DELETE FROM account_logos WHERE user_id = ?", [req.account.id]);
    res.sendStatus(204);
  });

  router.get("/users", requireAccount, requireAdmin, async (req, res) => {
    res.json(await all("SELECT id, username, role FROM users ORDER BY username_key"));
  });

  router.patch("/users/:id/password", requireAccount, requireAdmin, async (req, res) => {
    if (!req.is("application/json")) return res.sendStatus(415);
    const user = await get("SELECT id, username FROM users WHERE id = ? AND role = 'user'", [req.params.id]);
    if (!user) return res.status(404).json({ error: "User account not found." });

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const issue = invoiceNewPasswordIssue(password, req.body?.passwordConfirmation, user.username);
    if (issue) return res.status(400).json({ error: issue });

    const salt = randomBytes(16).toString("hex");
    const hash = await hashPassword(password, salt);
    const updated = await get(`
      UPDATE users SET salt = ?, password_hash = ?
      WHERE id = ? AND role = 'user' RETURNING id
    `, [salt, hash.toString("hex"), user.id]);
    if (!updated) return res.status(404).json({ error: "User account not found." });
    res.sendStatus(204);
  });

  router.use((error, req, res, next) => {
    if (error.status === 429) return res.status(429).json({ error: error.message });
    if (error.status === 413) return res.status(413).json({ error: "The logo image is too large." });
    console.error("Account operation failed:", error.code || error.name);
    res.status(500).json({ error: "The accounts database is unavailable. Try again." });
  });

  return {
    router, loadAccount, requireAccount,
    findUser: (id) => get("SELECT username FROM users WHERE id = ?", [id]),
  };
}

module.exports = createAccounts;
