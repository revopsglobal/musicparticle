// POST with raw body (Stripe signature verification)
// Handles checkout.session.completed, customer.subscription.created/updated/deleted
// Upserts to 'musicparticle_subscriptions' table in Supabase
// Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';

// Disable Vercel's default body parser so we can access the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars for webhook');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const email = session.customer_email || session.customer_details?.email;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (!userId) {
          console.warn('checkout.session.completed without user_id in metadata');
          break;
        }

        // Fetch the subscription to get plan details
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items?.data?.[0]?.price?.id;
          const plan = determinePlan(priceId);

          await upsertSubscription(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: userId,
            email: email?.toLowerCase() || null,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            status: subscription.status,
            current_period_start: toISO(subscription.current_period_start),
            current_period_end: toISO(subscription.current_period_end),
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = determinePlan(priceId);

        if (!userId) {
          console.warn(`${event.type} without user_id in metadata, subscription: ${subscription.id}`);
          break;
        }

        await upsertSubscription(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          user_id: userId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: subscription.customer,
          plan,
          status: subscription.status,
          current_period_start: toISO(subscription.current_period_start),
          current_period_end: toISO(subscription.current_period_end),
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;

        if (!userId) {
          console.warn('subscription.deleted without user_id in metadata');
          break;
        }

        await upsertSubscription(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          user_id: userId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: subscription.customer,
          plan: 'free',
          status: 'canceled',
          current_period_end: toISO(subscription.current_period_end),
        });
        break;
      }

      default:
        // Unhandled event type, acknowledge receipt
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

function determinePlan(priceId) {
  const { STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL } = process.env;
  if (priceId === STRIPE_PRICE_MONTHLY) return 'monthly';
  if (priceId === STRIPE_PRICE_ANNUAL) return 'annual';
  return 'unknown';
}

function toISO(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}

async function upsertSubscription(supabaseUrl, serviceKey, data) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/musicparticle_subscriptions`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        ...data,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error('Supabase upsert error:', response.status, body);
    throw new Error(`Supabase upsert failed: ${response.status}`);
  }
}
