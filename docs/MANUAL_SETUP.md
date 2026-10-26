# Manual setup (for the owner)

These steps need a person: they involve your GitHub account, your SharePoint site and your work PC. Do them in order.

## 1. The code and the live app

The code is published at https://github.com/sadhman3-bit/pdf-extractor under the MIT licence, and GitHub Pages serves the app at https://sadhman3-bit.github.io/pdf-extractor/.

- Every push to `main` runs the **CI** workflow (lint, typecheck, unit tests, build and end-to-end tests) and the **Deploy** workflow, which republishes the app. Check both on the repository's **Actions** tab.
- Pages is set to **Settings → Pages → Build and deployment → Source: GitHub Actions**. If the site ever stops updating, check that setting and re-run **Deploy** from the Actions tab.
- The app is built for the `/pdf-extractor/` path. If you rename the repository, change `base` in `apps/web/vite.config.ts` to match.

To work on the code on another PC:

```
git clone https://github.com/sadhman3-bit/pdf-extractor.git
cd pdf-extractor
pnpm install
```

## 2. Repository settings worth turning on

In the repository's **Settings**:

1. **Code security → Private vulnerability reporting:** turn it on, so people can report security problems privately (see `SECURITY.md`).
2. **Code security → Dependabot alerts:** turn it on to hear about vulnerable dependencies.
3. **Branches → Add branch ruleset** for `main`: require the **CI** check to pass before merging pull requests.

## 3. Create the shared folder

1. In your SharePoint site's document library, create a folder called `PDF Extractor`.
2. Choose **Sync** (or **Add shortcut to My files**) so it appears in File Explorer through OneDrive.
3. Optional but recommended: right-click the synced folder and choose **Always keep on this device**, so PDFs open without a download pause.

## 4. First run on the work PC

1. Open `https://sadhman3-bit.github.io/pdf-extractor/` in **Chrome or Edge**.
2. Choose **Get started → Choose folder** and pick the synced `PDF Extractor` folder. Allow the browser to view and edit files.
3. Choose **Create folders**, then enter your name.
4. Optional: install the app from the address bar so it opens in its own window and works offline.

## 5. Map your first supplier

Use real sample PDFs on the work PC. They stay on that PC and in SharePoint; nothing is uploaded.

1. **Templates → New template**, drop a sample, and map the values and table (see `USER_GUIDE.md`, section 3).
2. **Test on samples** with 3 or 4 more PDFs from the same supplier, apply any suggested fixes, and save.
3. Copy a few PDFs into `Inbox/` and run **Process** to see the outputs in `Output/`.

## 6. Connect Power Automate and Power BI

1. Build the three flows in `POWER_AUTOMATE.md`: email to Inbox, the morning Teams nudge, and output to a SharePoint list (optional).
2. Connect Power BI using `POWER_BI.md`.

## 7. Check the work network

Open `https://sadhman3-bit.github.io/pdf-extractor/` on a work PC on the office network and on VPN. If it's blocked, ask IT to allow `sadhman3-bit.github.io` (it only serves the app's static files; no data is sent to it).

## 8. Tell your manager

Once the tool is part of a daily process, let your manager know: what it does, where the folder is, and who looks after the templates. Point them to `PRIVACY.md` for how documents are handled.

## If you change things later

- **New release:** push to `main`. CI runs, and the Deploy workflow republishes Pages. Users get the new version the next time they open the app (the offline copy updates itself).
- **Templates** are plain JSON in the shared folder. Use **Settings → Export all templates (zip)** as a backup.
