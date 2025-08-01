// netlify/functions/auth-login.js
const jwt = require('jsonwebtoken');

// Simple demo credentials (for immediate testing)
const DEMO_CREDENTIALS = {
  'demo@estatesales.com': {
    id: 1,
    password: 'demo123',
    companyName: 'Demo Estate Sales',
    subscriptionStatus: 'active',
    isActive: true
  },
  'premium@estatesales.com': {
    id: 2,
    password: 'premium123',
    companyName: 'Premium Estate Sales',
    subscriptionStatus: 'active',
    isActive: true
  },
  'charlotte@estatesales.com': {
    id: 3,
    password: 'charlotte123',
    companyName: 'Charlotte Estate Solutions',
    subscriptionStatus: 'active',
    isActive: true
  }
};

exports.handler = async (event, context) => {
  console.log('🔐 Auth login function called');
  console.log('Method:', event.httpMethod);
  console.log('Body:', event.body);

  // CORS headers for all responses
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.log('❌ Method not allowed:', event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('📝 Parsing request body...');

    let requestData;
    try {
      requestData = JSON.parse(event.body);
      console.log('✅ Request data parsed:', { email: requestData.email, hasPassword: !!requestData.password });
    } catch (parseError) {
      console.log('❌ JSON parse error:', parseError.message);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid JSON in request body'
        })
      };
    }

    const { email, password } = requestData;
    console.log('📧 Login attempt for email:', email);

    // Input validation
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Email and password are required' 
        })
      };
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Invalid email format:', email);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid email format' 
        })
      };
    }

    // Find user
    console.log('🔍 Looking up user in demo credentials...');
    const user = DEMO_CREDENTIALS[email.toLowerCase()];
    
    if (!user) {
      console.log('❌ User not found:', email);
      console.log('Available emails:', Object.keys(DEMO_CREDENTIALS));
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid credentials - user not found' 
        })
      };
    }

    console.log('✅ User found:', user.companyName);

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account inactive:', email);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Account is deactivated' 
        })
      };
    }

    // Simple password check
    console.log('🔑 Checking password...');
    console.log('Expected password:', user.password);
    console.log('Provided password:', password);
    
    if (user.password !== password) {
      console.log('❌ Password mismatch');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid credentials - password mismatch' 
        })
      };
    }

    console.log('✅ Password verified successfully');

    // Generate JWT token
    console.log('🎫 Generating JWT token...');
    
    const jwtSecret = process.env.JWT_SECRET || 'demo-secret-key-12345';
    console.log('🔐 Using JWT Secret:', jwtSecret.substring(0, 10) + '...');
    
    const tokenPayload = {
      userId: user.id,
      email: email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    console.log('Token payload:', tokenPayload);

    const token = jwt.sign(tokenPayload, jwtSecret);
    console.log('✅ JWT token generated:', token.substring(0, 20) + '...');

    // Prepare user data
    const userData = {
      id: user.id,
      email: email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      loginTime: new Date().toISOString()
    };

    console.log('✅ Login successful for:', user.companyName);

    const response = {
      success: true,
      user: userData,
      token: token,
      message: 'Login successful'
    };

    console.log('📤 Sending response:', response);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('💥 Login function error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message,
        stack: error.stack
      })
    };
  }
};
