import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';

const APP_DEEPLINK_SCHEME = (process.env.APP_DEEPLINK_SCHEME || 'petrone').trim();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();

if (!STRIPE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-shop] Missing STRIPE_SECRET_KEY. /create-checkout-session will fail.');
}
const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy', {});

const app = express();
app.use(cors({ origin: true }));

const PRODUCTS = {
  black: {
    productName: 'Sport-Tek® Club Trucker Cap Black/Black',
    // UPS fee included in total (32 USD).
    unitAmountCents: 3200,
  },
  orange: {
    productName: 'Richardson Snapback Trucker Cap - 112 Orange',
    // UPS fee included in total (36 USD).
    unitAmountCents: 3600,
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

    const productId = req.body?.productId;
    if (productId !== 'black' && productId !== 'orange') {
      res.status(400).json({ error: 'invalid_product', detail: 'productId must be black or orange' });
      return;
    }

    const product = PRODUCTS[productId];
    // Redirect directly back to the app deep links after Checkout.
    const successUrl = `${APP_DEEPLINK_SCHEME}://shop/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${APP_DEEPLINK_SCHEME}://shop/cancel`;

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
      metadata: { productId },
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

export default app;

