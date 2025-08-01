// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  console.log('Stripe webhook event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {
      
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripeEvent.data.object);
        break;
        
      case 'customer.subscription.created':
        await handleSubscriptionCreated(stripeEvent.data.object);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripeEvent.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(stripeEvent.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(stripeEvent.data.object);
        break;
        
      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Webhook handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook handler failed' })
    };
  }
};

// Handle completed checkout sessions
async function handleCheckoutCompleted(session) {
  console.log('Checkout completed:', session.id);
  
  const { type, companyName, leadId } = session.metadata;
  
  if (type === 'exclusive' && leadId) {
    // Update lead as exclusively purchased
    await updateLeadExclusivePurchase(leadId, companyName, session);
  } else if (type === 'subscription') {
    // Create or update company subscription
    await updateCompanySubscription(session.customer_email, companyName, session);
  }
}

// Handle subscription creation
async function handleSubscriptionCreated(subscription) {
  console.log('Subscription created:', subscription.id);
  
  // Update company subscription status in database
  await updateCompanySubscriptionStatus(
    subscription.customer,
    'active',
    subscription.id
  );
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id);
  
  await updateCompanySubscriptionStatus(
    subscription.customer,
    subscription.status,
    subscription.id
  );
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted:', subscription.id);
  
  await updateCompanySubscriptionStatus(
    subscription.customer,
    'cancelled',
    subscription.id
  );
}

// Handle successful payments
async function handlePaymentSucceeded(invoice) {
  console.log('Payment succeeded:', invoice.id);
  
  // Update payment records, send confirmation emails, etc.
}

// Handle failed payments
async function handlePaymentFailed(invoice) {
  console.log('Payment failed:', invoice.id);
  
  // Send payment failure notifications, update subscription status
}

// Database update functions
async function updateLeadExclusivePurchase(leadId, companyName, session) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/Leads?id=eq.${leadId}`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        exclusive_purchased_by: companyName,
        exclusive_purchase_date: new Date().toISOString(),
        stripe_session_id: session.id
      })
    });

    if (!response.ok) {
      throw new Error('Failed to update lead exclusive purchase');
    }

    console.log(`Lead ${leadId} exclusively purchased by ${companyName}`);
  } catch (error) {
    console.error('Error updating exclusive purchase:', error);
  }
}

async function updateCompanySubscription(email, companyName, session) {
  try {
    // First check if company exists
    const checkResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/Companies?email=eq.${email}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        }
      }
    );

    const existingCompanies = await checkResponse.json();

    if (existingCompanies.length > 0) {
      // Update existing company
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/Companies?email=eq.${email}`, {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          subscription_status: 'active',
          stripe_customer_id: session.customer,
          updated_at: new Date().toISOString()
        })
      });
    } else {
      // Create new company
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/Companies`, {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          company_name: companyName,
          email: email,
          subscription_status: 'active',
          subscription_tier: 'basic',
          stripe_customer_id: session.customer,
          created_at: new Date().toISOString()
        })
      });
    }

    console.log(`Company subscription updated for ${email}`);
  } catch (error) {
    console.error('Error updating company subscription:', error);
  }
}

async function updateCompanySubscriptionStatus(customerId, status, subscriptionId) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Companies?stripe_customer_id=eq.${customerId}`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        subscription_status: status,
        stripe_subscription_id: subscriptionId,
        updated_at: new Date().toISOString()
      })
    });

    console.log(`Company subscription status updated: ${status}`);
  } catch (error) {
    console.error('Error updating subscription status:', error);
  }
}
