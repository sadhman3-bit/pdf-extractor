# Security policy

PDF Extractor runs entirely in the browser and handles business documents, so security reports are taken seriously.

## Supported versions

Only the latest release (the version deployed to GitHub Pages from `main`) gets fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it (with a synthetic PDF if a document triggers it; never send real documents), and what an attacker could do with it. You'll get an acknowledgement within a week.

## In scope

- Any way for a PDF, template or settings file to run script, read other files, or send data anywhere.
- Any request the app makes to a site other than its own.
- Ways around the Content Security Policy.
- Problems in how the app reads or writes the working folder, such as writing outside it.

## How the app is protected

- A strict Content Security Policy is set in the page: `default-src 'self'`, no inline scripts, and `connect-src 'self'`.
- PDF text is shown as text only. There's no `eval`, `new Function` or `innerHTML` with document content.
- pdf.js runs with `isEvalSupported: false`, and the OCR files are hosted with the app.
- There's no server, account system, telemetry or analytics.
