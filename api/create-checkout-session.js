// POST { user_id, email, plan: 'monthly'|'annual' }
// Creates a Stripe checkout session for subscription billing
// Env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL, APP_URL

import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL, APP_URL } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_ANNUAL || !APP_URL) {
    console.error('Missing required env vars for checkout');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { user_id, email, plan } = req.body || {};

  if (!user_id || typeof user_id !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  if (plan !== 'monthly' && plan !== 'annual') {
    return res.status(400).json({ error: 'plan must be "monthly" or "annual"' });
  }

  const priceId = plan === 'monthly' ? STRIPE_PRICE_MONTHLY : STRIPE_PRICE_ANNUAL;

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email.toLowerCase().trim(),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        user_id,
      },
      subscription_data: {
        metadata: {
          user_id,
        },
      },
      success_url: `${APP_URL}/app?upgraded=true`,
      cancel_url: `${APP_URL}/`,
    });

    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
