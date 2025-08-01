// netlify/functions/create-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { type, companyEmail, companyName, leadId } = JSON.parse(event.body);

    let sessionConfig = {
      payment_method_types: ['card'],
      mode: type === 'subscription' ? 'subscription' : 'payment',
      success_url: `${process.env.URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/company-portal.html`,
      customer_email: companyEmail,
      metadata: {
        companyName: companyName,
        type: type
      }
    };

    if (type === 'subscription') {
      // Monthly subscription checkout
      sessionConfig.line_items = [{
        price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
        quantity: 1,
      }];
      sessionConfig.metadata.subscriptionType = 'basic';
      
    } else if (type === 'exclusive') {
      // Exclusive lead purchase
      sessionConfig.line_items = [{
        price: process.env.STRIPE_EXCLUSIVE_PRICE_ID,
        quantity: 1,
      }];
      sessionConfig.metadata.leadId = leadId;
      sessionConfig.metadata.purchaseType = 'exclusive';
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        sessionId: session.id,
        url: session.url 
      })
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to create checkout session',
        details: error.message 
      })
    };
  }
};
