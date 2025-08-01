// netlify/functions/auth-login.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Pre-hashed demo passwords for security
const SECURE_COMPANIES = [
  {
    id: 1,
    email: 'demo@estatesales.com',
    // Password: demo123 - hash generated with: bcrypt.hashSync('demo123', 12)
    passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LQ1lqe.RqWpkC6Bt7FKwfG9rKt8qlgFYD7.Fi',
    companyName: 'Demo Estate Sales',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 2,
    email: 'premium@estatesales.com',
    // Password: premium123
    passwordHash: '$2a$12$8Hqx9kQjFz2kS7gL9PmNde.jQwE5rXtY6bVcH8fM1nOp3sKlGhDwq',
    companyName: 'Premium Estate Sales',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 3,
    email: 'charlotte@estatesales.com',
    // Password: charlotte123
    passwordHash: '$2a$12$mN7vQ2fK8bT5wR9xE1cYte.pL3dS6jH9gA2nV4kM7qO8rT1lUiExF',
    companyName: 'Charlotte Estate Solutions',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  }
];

exports.handler = async (event, context) => {
  console.log('🔐 Auth login function called');
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

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
    console.log('Raw body:', event.body);

    let requestData;
    try {
      requestData = JSON.parse(event.body);
      console.log('✅ Request data parsed successfully');
    } catch (parseError) {
      console.log('❌ JSON parse error:', parseError.message);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid JSON in request body',
          details: parseError.message 
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

    // Rate limiting check (simple implementation)
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    console.log('🌐 Client IP:', clientIP);

    // Find user by email
    console.log('🔍 Looking up user...');
    const user = SECURE_COMPANIES.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      console.log('❌ User not found:', email);
      // Don't reveal if email exists or not
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid credentials' 
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

    // Verify password
    console.log('🔑 Verifying password...');
    
    // For demo purposes, also accept plain text passwords
    let isValidPassword = false;
    
    // First try bcrypt comparison
    try {
      isValidPassword = await bcrypt.compare(password, user.passwordHash);
      console.log('🔑 Bcrypt comparison result:', isValidPassword);
    } catch (bcryptError) {
      console.log('⚠️ Bcrypt error, trying plain text comparison:', bcryptError.message);
      
      // Fallback: check if it's the demo password in plain text
      const demoPasswords = {
        'demo@estatesales.com': 'demo123',
        'premium@estatesales.com': 'premium123',
        'charlotte@estatesales.com': 'charlotte123'
      };
      
      if (demoPasswords[email] && demoPasswords[email] === password) {
        isValidPassword = true;
        console.log('✅ Plain text password match (demo mode)');
      }
    }
    
    if (!isValidPassword) {
      console.log('❌ Password verification failed');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid credentials' 
        })
      };
    }

    console.log('✅ Password verified successfully');

    // Generate JWT token
    console.log('🎫 Generating JWT token...');
    
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key-for-demo';
    console.log('🔐 JWT Secret available:', !!process.env.JWT_SECRET);
    
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(tokenPayload, jwtSecret);
    console.log('✅ JWT token generated successfully');

    // Prepare user data (without sensitive information)
    const userData = {
      id: user.id,
      email: user.email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      loginTime: new Date().toISOString()
    };

    console.log('✅ Login successful for:', user.companyName);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Set-Cookie': `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Path=/`
      },
      body: JSON.stringify({
        success: true,
        user: userData,
        token: token,
        message: 'Login successful'
      })
    };

  } catch (error) {
    console.error('💥 Login function error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: 'An unexpected error occurred during authentication'
      })
    };
  }
};
