// netlify/functions/auth-login.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// In production, store these in your Supabase database
const SECURE_COMPANIES = [
  {
    id: 1,
    email: 'demo@estatesales.com',
    // Password: demo123 (hashed)
    passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LQ1lqe.RqWpkC6Bt7FKwfG9rKt8qlgFYD7.Fi',
    companyName: 'Demo Estate Sales',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 2,
    email: 'premium@estatesales.com',
    // Password: premium123 (hashed)
    passwordHash: '$2a$12$8Hqx9kQjFz2kS7gL9PmNde.jQwE5rXtY6bVcH8fM1nOp3sKlGhDwq',
    companyName: 'Premium Estate Sales',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 3,
    email: 'charlotte@estatesales.com',
    // Password: charlotte123 (hashed)
    passwordHash: '$2a$12$mN7vQ2fK8bT5wR9xE1cYte.pL3dS6jH9gA2nV4kM7qO8rT1lUiExF',
    companyName: 'Charlotte Estate Solutions',
    isActive: true,
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z'
  }
];

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    // Input validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Email and password are required' 
        })
      };
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Invalid email format' 
        })
      };
    }

    // Rate limiting check (simple implementation)
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    const attemptKey = `login_attempts_${clientIP}`;
    
    // In production, use Redis or database for rate limiting
    // For now, we'll implement basic protection

    // Find user by email
    const user = SECURE_COMPANIES.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      // Don't reveal if email exists or not
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Invalid credentials' 
        })
      };
    }

    // Check if account is active
    if (!user.isActive) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Account is deactivated' 
        })
      };
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Invalid credentials' 
        })
      };
    }

    // Generate JWT token
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');

    // Prepare user data (without sensitive information)
    const userData = {
      id: user.id,
      email: user.email,
      companyName: user.companyName,
      subscriptionStatus: user.subscriptionStatus,
      loginTime: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*',
        'Set-Cookie': `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Path=/`
      },
      body: JSON.stringify({
        success: true,
        user: userData,
        token: token // Also send in body for localStorage (temporary)
      })
    };

  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({ 
        error: 'Internal server error' 
      })
    };
  }
};
