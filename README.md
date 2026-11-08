# Collection dashboard

Static dashboard for the Recycle & Reward bottle scans. It shows collection totals, a 7/30-day collection trend, customer history, and live scans. It is separate from the customer app in `Apps-Hafiz/www`.

## Run it

From the `Apps-Hafiz` folder:

```powershell
npm run dashboard
```

Open:

```text
http://localhost:3001/
```

Any static file server works. Opening `index.html` through a local server is recommended so browser storage and CDN scripts behave normally.

## Data source

The dashboard listens to the EMQX broker:

```text
testtopic/hafiz-dash/#
```

- `testtopic/hafiz-dash/state/<accountId>` retains the latest daily, weekly, and all-time bottle totals for one customer.
- `testtopic/hafiz-dash/scan` carries live scan events.

The app publishes one bottle per successful scan. QR points remain the reward value.

## Sample data

When the dashboard has no real customer data, it shows four sample customers. Real MQTT snapshots replace the sample data automatically. Use the three-line sample data menu in the Customers panel to load or clear it manually. While sample data is active, a red dot appears above the summary; select the dot to clear it.

### Load your own sample data

Open the three-line sample data menu in the Customers panel and choose **Load my data** to import a JSON or CSV file. Imported customers are treated as sample data: they survive a page refresh, and they are removed automatically when a real scan arrives or when you choose **Clear sample data**.

The JSON file can be one customer, an array of customers, or an object with a `customers` array. Customer snapshots use the same fields as the MQTT state messages; `today` and `week` are optional when `daily` is present.

```json
{
  "customers": [
    {
      "accountId": "sample-aisyah",
      "customer": "Aisyah",
      "daily": {
        "2026-11-02": 12,
        "2026-11-03": 8,
        "2026-11-08": 4
      },
      "total": 320,
      "lastScanAt": "2026-11-08T09:15:00Z"
    }
  ]
}
```

An optional `events` array fills the **Live scans** feed:

```json
{
  "customers": [ ... ],
  "events": [
    {
      "accountId": "sample-aisyah",
      "customer": "Aisyah",
      "bottles": 1,
      "scannedAt": "2026-11-08T09:15:00Z"
    }
  ]
}
```

CSV files can use either of these shapes:

- A summary row per customer, matching the CSV export from the Customers toolbar: `Customer,Account,Today,This week,All-time,Last scan`
- A daily row per customer per day: `Customer,Account,Date,Bottles`

A ready-to-edit summary template is included as [sample-data-template.csv](sample-data-template.csv). Column names are case-insensitive. If `Account` is omitted, the dashboard creates an id from the customer name.
