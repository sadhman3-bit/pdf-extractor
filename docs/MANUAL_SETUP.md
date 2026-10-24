# Manual setup (for the owner)

These steps need a person: they involve your GitHub account, your SharePoint site and your work PC. Do them in order.

## 1. Publish the code on GitHub

The repository was built locally and has no remote yet.

1. On GitHub, create an empty **public** repository called `pdf-extractor` (don't add a README or .gitignore; the code has them). The code has no licence file yet: choose one and add a `LICENSE` file if others may reuse it.
2. In a terminal in the project folder:

   ```
   git remote add origin https://github.com/<owner>/pdf-extractor.git
   git push -u origin main --tags
   ```

3. Open the repository's **Actions** tab and check that the **CI** workflow runs green (lint, typecheck, unit tests, build and end-to-end tests).

## 2. Turn on GitHub Pages

1. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Re-run the **Deploy** workflow from the Actions tab (or push any commit).
3. The app goes live at `https://<owner>.github.io/pdf-extractor/`. Open it and check you see "Welcome to PDF Extractor".

The app is built for the `/pdf-extractor/` path. If you name the repository differently, change `base` in `apps/web/vite.config.ts` to match.

## 3. Create the shared folder

1. In your SharePoint site's document library, create a folder called `PDF Extractor`.
2. Choose **Sync** (or **Add shortcut to My files**) so it appears in File Explorer through OneDrive.
3. Optional but recommended: right-click the synced folder and choose **Always keep on this device**, so PDFs open without a download pause.

## 4. First run on the work PC

1. Open `https://<owner>.github.io/pdf-extractor/` in **Chrome or Edge**.
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

Open `https://<owner>.github.io/pdf-extractor/` on a work PC on the office network and on VPN. If it's blocked, ask IT to allow `<owner>.github.io` (it only serves the app's static files; no data is sent to it).

## 8. Tell your manager

Once the tool is part of a daily process, let your manager know: what it does, where the folder is, and who looks after the templates. Point them to `PRIVACY.md` for how documents are handled.

## If you change things later

- **New release:** push to `main`. CI runs, and the Deploy workflow republishes Pages. Users get the new version the next time they open the app (the offline copy updates itself).
- **Templates** are plain JSON in the shared folder. Use **Settings → Export all templates (zip)** as a backup.
