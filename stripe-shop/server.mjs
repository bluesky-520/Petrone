import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8787', 10);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim();
const APP_DEEPLINK_SCHEME = (process.env.APP_DEEPLINK_SCHEME || 'petrone').trim();

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

if (!STRIPE_SECRET_KEY) {
  // Fail fast so misconfiguration is obvious on startup.
  // eslint-disable-next-line no-console
  console.warn('[stripe-shop] Missing STRIPE_SECRET_KEY. /create-checkout-session will fail.');
}
if (!PUBLIC_BASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-shop] Missing PUBLIC_BASE_URL. Redirect pages may not work correctly.');
}

const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy', {});

const app = express();
app.use(cors({ origin: true }));

const PRODUCTS = {
  black: {
    productName: 'Sport-Tek® Club Trucker Cap Black/Black',
    hatName: 'Sport-Tek Club Trucker Cap',
    // UPS fee included in total (32 USD).
    unitAmountCents: 3200,
    descriptionLabel: 'Hat description',
    descriptionText: 'Sport-Tek® Club Trucker Cap Black/Black',
  },
  orange: {
    productName: 'Richardson Snapback Trucker Cap - 112 Orange',
    hatName: 'Richardson Snapback Trucker Cap',
    // UPS fee included in total (36 USD).
    unitAmountCents: 3600,
    descriptionLabel: 'Hat description',
    descriptionText: 'Richardson Snapback Trucker Cap - 112 Orange',
  },
};

function buildDeepLinkSuccessUrl(sessionId) {
  const sid = encodeURIComponent(sessionId || '');
  return `${APP_DEEPLINK_SCHEME}://shop/success?session_id=${sid}`;
}

function buildDeepLinkCancelUrl() {
  return `${APP_DEEPLINK_SCHEME}://shop/cancel`;
}

app.get('/stripe-shop/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/stripe-shop/create-checkout-session', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      res.status(500).json({ error: 'server_misconfigured', detail: 'Missing STRIPE_SECRET_KEY' });
      return;
    }
    if (!PUBLIC_BASE_URL) {
      res.status(500).json({ error: 'server_misconfigured', detail: 'Missing PUBLIC_BASE_URL' });
      return;
    }

    const productId = req.body?.productId;
    if (productId !== 'black' && productId !== 'orange') {
      res.status(400).json({ error: 'invalid_product', detail: 'productId must be black or orange' });
      return;
    }

    const product = PRODUCTS[productId];

    const successUrl = `${PUBLIC_BASE_URL}/stripe-shop/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${PUBLIC_BASE_URL}/stripe-shop/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: product.unitAmountCents,
            product_data: {
              name: product.productName,
              description: 'UPS shipping included.',
            },
          },
        },
      ],
      // Lets you identify the purchased item server-side later (webhooks).
      metadata: {
        productId,
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[stripe-shop] create-checkout-session failed', e);
    res.status(500).json({ error: 'create_checkout_failed', detail: String(e) });
  }
});

app.get('/stripe-shop/success', (req, res) => {
  const sessionId = String(req.query.session_id || '');
  const deepLink = buildDeepLinkSuccessUrl(sessionId);
  res.status(200).type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta http-equiv="refresh" content="0; url=${deepLink}" />
        <title>Redirecting...</title>
      </head>
      <body style="font-family: -apple-system, system-ui, Helvetica, Arial, sans-serif; padding: 24px;">
        <p>Redirecting to the app...</p>
        <p>If nothing happens, <a href="${deepLink}">tap here</a>.</p>
        <script>window.location.href = ${JSON.stringify(deepLink)};</script>
      </body>
    </html>
  `);
});

app.get('/stripe-shop/cancel', (_req, res) => {
  const deepLink = buildDeepLinkCancelUrl();
  res.status(200).type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta http-equiv="refresh" content="0; url=${deepLink}" />
        <title>Checkout cancelled</title>
      </head>
      <body style="font-family: -apple-system, system-ui, Helvetica, Arial, sans-serif; padding: 24px;">
        <p>Redirecting to the app...</p>
        <p>If nothing happens, <a href="${deepLink}">tap here</a>.</p>
        <script>window.location.href = ${JSON.stringify(deepLink)};</script>
      </body>
    </html>
  `);
});

// Optional: Stripe will call this to confirm payment on the server.
// This repo does not persist orders, but verifying the event is still important.
app.post(
  '/stripe-shop/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!STRIPE_WEBHOOK_SECRET) {
      res.status(400).json({ error: 'server_misconfigured', detail: 'Missing STRIPE_WEBHOOK_SECRET' });
      return;
    }

    try {
      const event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
      // You can inspect event.type and event.data.object here.
      // eslint-disable-next-line no-console
      console.log('[stripe-shop] webhook received:', event.type);
      res.json({ received: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stripe-shop] webhook signature verification failed', err);
      res.status(400).json({ error: 'invalid_signature', detail: String(err) });
    }
  },
);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[stripe-shop] listening on :${PORT}`);
});

