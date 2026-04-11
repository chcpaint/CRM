# Google Drive Auto-Import Setup Guide

This guide walks you through setting up automatic sales data import from Google Drive into the CHC CRM.

## How It Works

1. Someone exports the "Profit Analysis Customer Sales Detail" report from AccountEdge and saves the CSV into a shared Google Drive folder
2. Every weekday at 10AM (configurable), the CRM checks that folder for new CSV files
3. New files are parsed, records are matched to existing accounts, and imported into the sales data
4. Processed files are automatically moved to a "Processed" subfolder
5. Manual uploads on the Sales page still work anytime for ad-hoc imports

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with **digital@chcpaint.com** (or whichever Google account you prefer)
3. Click **Select a project** → **New Project**
4. Name it **CHC CRM** and click **Create**

## Step 2: Enable the Google Drive API

1. In the Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for **Google Drive API**
3. Click on it and press **Enable**

## Step 3: Create a Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **Service account**
3. Name: **chc-crm-import**
4. Click **Create and Continue** → **Done** (skip optional steps)
5. Click on the new service account email (looks like `chc-crm-import@chc-crm-xxxxx.iam.gserviceaccount.com`)
6. Go to the **Keys** tab
7. Click **Add Key** → **Create new key** → **JSON** → **Create**
8. A JSON file will download — **keep this safe, you'll need it**

## Step 4: Set Up the Google Drive Folder

1. In Google Drive, create a folder called **CRM Sales Import** (or any name you like)
2. Right-click the folder → **Share**
3. Paste the service account email from Step 3 (the long `@...iam.gserviceaccount.com` address)
4. Give it **Editor** access (it needs to move files to the Processed subfolder)
5. Click **Send**
6. Open the folder in Drive — copy the **folder ID** from the URL:
   ```
   https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID
   ```

## Step 5: Add Environment Variables to Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click on the **refinish-ai-crm** service
3. Go to **Environment** → **Environment Variables**
4. Add these three variables:

| Variable | Value |
|----------|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Paste the **entire contents** of the JSON key file from Step 3 (the whole `{...}` block) |
| `GDRIVE_FOLDER_ID` | The folder ID from Step 4 |
| `GDRIVE_IMPORT_CRON` | `0 10 * * 1-5` (optional — this is the default: 10AM weekdays) |

5. Click **Save Changes** — Render will redeploy automatically

## Step 6: Test It

1. Drop a test CSV file into your Google Drive folder
2. In the CRM, go to **Admin** → **Data** tab
3. You should see "Connected" status with the schedule
4. Click **Run Import Now** to test
5. Check the Sales page — your data should appear
6. Check the Drive folder — the CSV should have moved to the "Processed" subfolder

## Schedule Options

The `GDRIVE_IMPORT_CRON` variable uses cron format. Some examples:

| Schedule | Cron Expression |
|----------|----------------|
| 10AM weekdays (default) | `0 10 * * 1-5` |
| 10AM every day | `0 10 * * *` |
| 8AM and 2PM weekdays | `0 8,14 * * 1-5` |
| Every hour during business hours | `0 8-17 * * 1-5` |

## Troubleshooting

**"Not configured" in Admin panel:** The environment variables aren't set on Render, or the service hasn't redeployed after adding them.

**"No CSV files found":** The folder is empty or the service account doesn't have access. Double-check the folder sharing in Drive.

**"Unmatched" records:** These are customer names in the CSV that don't closely match any account in the CRM. They're still imported (with `customer_name` stored) — you can view them on the Sales page.

**Files not moving to Processed:** The service account needs **Editor** access to the folder, not just Viewer.
