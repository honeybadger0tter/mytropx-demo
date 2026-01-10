import express from "express";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const DEMO_MODE = !process.env.STRIPE_SECRET_KEY;

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN = process.env.APP_ORIGIN || "http://localhost:4242";
const stripe = DEMO_MODE ? null : new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Catalog (server is source-of-truth for names/prices/images) ---
const CATALOG = [
  {
    id: "cb13-neo-zipper-brief",
    name: "CB13 Neo Zipper Brief",
    price: 34.0,
    image: "https://www.mytropx.com/assets/images/CB13-Z13N-image.jpg",
    tags: ["brief", "neo", "cb13"],
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "manpak-neoprene-jock",
    name: "ManPak Neoprene Jock",
    price: 26.95,
    image: "https://www.mytropx.com/assets/images/MP2053-BLK.jpg",
    tags: ["jock", "neo", "gear"],
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ugs-night-brief",
    name: "UGS Night Brief",
    price: 22.95,
    image: "https://www.mytropx.com/assets/images/UGS-527-NVY.jpg",
    tags: ["brief", "ugs"],
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ugs-grey-jockstrap",
    name: "UGS Grey Jockstrap",
    price: 19.95,
    image: "https://www.mytropx.com/assets/images/UGS-2002-GRY.jpg",
    tags: ["jock", "ugs"],
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "cb13-slingshot-thong",
    name: "CB13 Slingshot Thong",
    price: 24.0,
    image: "https://www.mytropx.com/assets/images/CB13-SLINGSHOT-BLK.jpg",
    tags: ["thong", "cb13"],
    sizes: ["S", "M", "L", "XL"]
  }
];

function moneyToCents(amount) {
  return Math.round(Number(amount) * 100);
}

function getProductOrThrow(id) {
  const p = CATALOG.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown product id: ${id}`);
  return p;
}

function sanitizeQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(99, Math.floor(n));
}

function computeSubtotal(items) {
  let subtotal = 0;
  for (const it of items) {
    const p = getProductOrThrow(it.id);
    subtotal += p.price * sanitizeQty(it.qty);
  }
  return Number(subtotal.toFixed(2));
}

function buildLineItems(items) {
  return items.map((it) => {
    const p = getProductOrThrow(it.id);
    const qty = sanitizeQty(it.qty);
    const size = typeof it.size === "string" ? it.size : "";

    return {
      quantity: qty,
      price_data: {
        currency: "usd",
        unit_amount: moneyToCents(p.price),
        product_data: {
          name: size ? `${p.name} (Size ${size})` : p.name,
          images: [p.image],
          metadata: {
            catalog_id: p.id,
            size: size || "N/A"
          }
        }
      }
    };
  });
}

// Shipping policy for demo:
// - If subtotal >= 100 => free standard shipping option appears
// - Otherwise show standard paid shipping + express paid shipping
function buildShippingOptions(subtotal) {
  const options = [];

  if (subtotal >= 100) {
    options.push({
      shipping_rate_data: {
        display_name: "Standard Shipping (Free over $100)",
        type: "fixed_amount",
        fixed_amount: { amount: 0, currency: "usd" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 3 },
          maximum: { unit: "business_day", value: 6 }
        }
      }
    });
  } else {
    options.push({
      shipping_rate_data: {
        display_name: "Standard Shipping",
        type: "fixed_amount",
        fixed_amount: { amount: 995, currency: "usd" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 3 },
          maximum: { unit: "business_day", value: 6 }
        }
      }
    });
  }

  options.push({
    shipping_rate_data: {
      display_name: "Express Shipping",
      type: "fixed_amount",
      fixed_amount: { amount: 1995, currency: "usd" },
      delivery_estimate: {
        minimum: { unit: "business_day", value: 1 },
        maximum: { unit: "business_day", value: 2 }
      }
    }
  });

  return options;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/catalog", (_req, res) => {
  res.json(CATALOG);
});

app.post("/create-checkout-session", async (req, res) => {
  if(DEMO_MODE){
    // No Stripe keys provided — keep the demo flowing.
    return res.json({ url: "/success.html?demo=1" });
  }
  try {
    const { items, fulfillment } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    // Validate + compute
    const subtotal = computeSubtotal(items);
    const line_items = buildLineItems(items);

    const baseParams = {
      mode: "payment",
      line_items,
      success_url: `${ORIGIN}/success.html`,
      cancel_url: `${ORIGIN}/cancel.html`,
      // Strongly recommended so you can reconcile in your system:
      client_reference_id: `cart_${Date.now()}`
    };

    let sessionParams = { ...baseParams };

    if (fulfillment === "pickup") {
      // Pickup: no shipping address collection required
      sessionParams = {
        ...sessionParams,
        phone_number_collection: { enabled: true },
        // Collect billing so you have a usable contact record.
        billing_address_collection: "auto",
        metadata: {
          fulfillment: "pickup",
          pickup_location: "MyTropx Store"
        }
      };
    } else {
      // Ship it (default)
      sessionParams = {
        ...sessionParams,
        shipping_address_collection: {
          allowed_countries: ["US"]
        },
        shipping_options: buildShippingOptions(subtotal),
        metadata: {
          fulfillment: "ship"
        }
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`✅ Server running on ${ORIGIN} (port ${PORT})${DEMO_MODE ? ' [DEMO MODE]' : ''}`));
