# MyTropx Reloaded (Demo)

This demo is built to work **two ways**:

## Option A — Static site (fastest demo)
Deploy the **/public** folder as a static site.

- Works with cart + filters + quick view
- Uses `public/catalog.json`
- Checkout button will route to `success.html` (demo)

## Option B — Node server + Stripe Checkout
Run the included Express server:

```bash
npm install
npm start
```

Then open: http://localhost:4242

### Stripe (optional)
Set environment variables:

- `STRIPE_SECRET_KEY=...`
- `APP_ORIGIN=http://localhost:4242` (or your Render URL)

If `STRIPE_SECRET_KEY` is not set, the server runs in **DEMO MODE** and checkout routes to the success page.

## Render tips
- Static Site: publish directory `public`
- Web Service: `npm install` then `npm start`
