# Invoice maker

Run `node server.js` from the `Src` directory, then open [Sign In](http://127.0.0.1:3000/login.html). Use **Create an account** to register a regular user. Each account can create, search, open, and edit its own invoices. Customer suggestions also come from that account's saved invoices.

When creating a user or administrator account, choose a password of 15–128 characters and enter it twice. The form shows password strength and whether the two entries match.

Use **My logo** on the create form to upload a PNG, JPEG, or WebP image up to 10 MB. The app saves it with your account and uses it in invoice previews and newly printed PDFs. **Use default logo** restores the palm tree.

For first-time admin setup, open **Set up administrator** on the sign-in page and enter the one-time token from `.invoice-data/admin-setup-token` along with your chosen username and password. The administrator page lists all accounts and provides a separate, read-only invoice view for each other account. Use **Reset password** on a user's row to set and confirm a replacement password. The reset signs the user out of all active sessions. Invoices saved before accounts existed appear under **Invoices created before accounts**.

Choose **Preview Invoice**, then **Save the invoice** and **Confirm save** to assign an invoice number and date. [Saved Invoices](http://127.0.0.1:3000/invoices.html) searches by number, customer name, phone, or address. Open a result to print it, save a PDF, or use **Edit invoice** to update the address or job description.

Use the **Español / English** button to set the website language. The browser remembers that choice. Each invoice preview opens in English and has its own **Español / English** button. The assistant translates the job title, item names, and item descriptions for the English preview. The Spanish view uses the original wording.

On the create form, start typing a name to find a customer from saved invoices. Select a match to fill the name, phone, and address. Typing in the address field requests suggestions from [Photon](https://github.com/komoot/photon#demo-server). You can always enter an address manually. Set `INVOICE_PHOTON_URL` to your Photon instance's `/api` endpoint if needed.

To use Groq for the work assistant, set `GROQ_API_KEY` in the server environment or in `.invoice-data/groq.env`, then restart the server. Groq uses `whisper-large-v3-turbo` for voice recordings and `openai/gpt-oss-20b` for item extraction. The server selects Groq when its key is present. Otherwise, it uses `OPENAI_API_KEY` from the server environment or `.invoice-data/openai.env` for `gpt-transcribe` and `gpt-5.4-mini`. Keep keys in the local, ignored folder or in your environment.

In **Describe the work**, type or record in English or Spanish, select **Create items**, then review the suggested rows and supply any highlighted prices before previewing.

SQLite stores invoices in `.invoice-data/invoices.db` and accounts in `.invoice-data/accounts.db`. The accounts database stores salted password hashes and expiring sessions. Back up the two database files together after stopping the server so invoice ownership can be restored. The app regenerates the printable invoice from its saved details. Keep any PDF you send separately if you need an exact copy of the document as it was sent.
