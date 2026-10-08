const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Create/open database
const db = new sqlite3.Database("database.db");

// Create table

db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT
    )
`);

// Save a name
app.post("/save", function (req, res) {
  const name = req.body.name;

  db.run("INSERT INTO users (name) VALUES (?)", [name], function (error) {
    if (error) {
      console.log(error);
      res.send("Error saving name");
    } else {
      res.send("Name saved!");
    }
  });
});

app.listen(3000, function () {
  console.log("Server running on http://localhost:3000");
});
app.listen(3000, "0.0.0.0", function () {
  console.log("Server running on port 3000");
});
