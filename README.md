# Freelance Ledger

A simple, mobile-first accounting tracker for an Indian freelancer. It runs entirely in the browser, stores data locally on the device, and works offline after its first load.

## Use it

Open `index.html` in a browser for a quick preview. To install it on a phone or use its offline capability, publish this folder to any static web host (for example, GitHub Pages, Netlify, or Cloudflare Pages), open the secure HTTPS address, then choose **Add to Home Screen** / **Install app**.

## Included

- Clients and projects
- INR invoices with due dates, optional GST rate and GSTIN, and automatic invoice numbering
- Full and partial payment records with common Indian payment modes
- Expense records
- Dashboard and six-month income/expense report
- JSON backup and restore

## Privacy and syncing

The MVP intentionally has no account or cloud database. Each device keeps a private copy of its data. Use **Settings → Export backup** on one device and **Import backup** on the other to move the same records. Automatic, live phone/laptop sync requires a hosted database and sign-in service.

GST fields are provided for record-keeping convenience only; this tool is not tax advice.
