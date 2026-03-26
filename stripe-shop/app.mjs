import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { Resend } from 'resend';

const APP_DEEPLINK_SCHEME = (process.env.APP_DEEPLINK_SCHEME || 'petrone').trim();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const SHIPPING_FEE_CENTS = parseInt(process.env.SHIPPING_FEE_CENTS || '800', 10);
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const CONTACT_EMAIL_TO = (process.env.CONTACT_EMAIL_TO || '').trim();
const CONTACT_EMAIL_FROM = (process.env.CONTACT_EMAIL_FROM || '').trim();
const CONTACT_API_SECRET = (process.env.CONTACT_API_SECRET || '').trim();

if (!STRIPE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-shop] Missing STRIPE_SECRET_KEY. /create-checkout-session will fail.');
}
if (!Number.isFinite(SHIPPING_FEE_CENTS) || SHIPPING_FEE_CENTS < 0) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-shop] Invalid SHIPPING_FEE_CENTS. Falling back to 800 cents.');
}
const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy', {});
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

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

function ensureText(v, maxLen = 3000) {
  return String(v || '').trim().slice(0, maxLen);
}

function escapeHtml(v) {
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function requireBearerSecret(req) {
  if (!CONTACT_API_SECRET) return true;
  const auth = String(req.headers.authorization || '');
  const expected = `Bearer ${CONTACT_API_SECRET}`;
  return auth === expected;
}

app.post('/stripe-shop/contact-us', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!requireBearerSecret(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (!resend || !CONTACT_EMAIL_TO || !CONTACT_EMAIL_FROM) {
      res.status(500).json({
        error: 'server_misconfigured',
        detail: 'Missing RESEND_API_KEY, CONTACT_EMAIL_TO, or CONTACT_EMAIL_FROM',
      });
      return;
    }

    const firstName = ensureText(req.body?.firstName, 100);
    const lastName = ensureText(req.body?.lastName, 100);
    const email = ensureText(req.body?.email, 200);
    const phone = ensureText(req.body?.phone, 40);
    const projectType = ensureText(req.body?.projectType, 120);
    const referralSource = ensureText(req.body?.referralSource, 180);
    const comment = ensureText(req.body?.comment, 6000);

    if (!firstName || !lastName || !email || !phone || !projectType || !referralSource || !comment) {
      res.status(400).json({ error: 'missing_required_fields' });
      return;
    }

    const subject = `Project Inquiry: ${projectType}`;
    const firstNameHtml = escapeHtml(firstName);
    const lastNameHtml = escapeHtml(lastName);
    const emailHtml = escapeHtml(email);
    const phoneHtml = escapeHtml(phone);
    const projectTypeHtml = escapeHtml(projectType);
    const referralSourceHtml = escapeHtml(referralSource);
    const commentHtml = escapeHtml(comment).replace(/\n/g, '<br />');
    const text = [
      `First Name: ${firstName}`,
      `Last Name: ${lastName}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Project Type: ${projectType}`,
      `How did you hear about us: ${referralSource}`,
      '',
      `Comment: ${comment}`,
    ].join('\n');

    const html = `
      <h2>New Contact Us Inquiry</h2>
      <p><strong>First Name:</strong> ${firstNameHtml}</p>
      <p><strong>Last Name:</strong> ${lastNameHtml}</p>
      <p><strong>Email:</strong> ${emailHtml}</p>
      <p><strong>Phone:</strong> ${phoneHtml}</p>
      <p><strong>Project Type:</strong> ${projectTypeHtml}</p>
      <p><strong>How did you hear about us:</strong> ${referralSourceHtml}</p>
      <p><strong>Comment:</strong></p>
      <p>${commentHtml}</p>
    `;

    await resend.emails.send({
      from: CONTACT_EMAIL_FROM,
      to: CONTACT_EMAIL_TO,
      replyTo: email,
      subject,
      text,
      html,
    });

    res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[stripe-shop] contact-us failed', e);
    res.status(500).json({ error: 'contact_submit_failed', detail: String(e) });
  }
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

    const shippingAmountCents = Number.isFinite(SHIPPING_FEE_CENTS) && SHIPPING_FEE_CENTS >= 0
      ? SHIPPING_FEE_CENTS
      : 800;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Keep checkout options limited to card and Link.
      // This prevents showing methods like Cash App Pay and Klarna.
      payment_method_types: ['card', 'link'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: product.unitAmountCents,
            product_data: {
              name: product.productName,
              description: 'Hat only.',
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: shippingAmountCents,
            product_data: {
              name: 'Shipping',
              description: 'UPS shipping fee.',
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

