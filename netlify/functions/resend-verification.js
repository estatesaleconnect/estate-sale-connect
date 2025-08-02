// netlify/functions/resend-verification.js
exports.handler = async (event, context) => {
  console.log('🔄 Resend verification function called');
  console.log('Method:', event.httpMethod);

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
      console.log('✅ Request data parsed:', { email: requestData.email });
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

    const { email } = requestData;

    // Validate email
    if (!email || typeof email !== 'string') {
      console.log('❌ Missing email');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Email address is required'
        })
      };
    }

    // Sanitize and validate email format
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail) || cleanEmail.length > 254) {
      console.log('❌ Invalid email format:', cleanEmail);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid email address format'
        })
      };
    }

    console.log('🔍 Looking up company with email...');

    // Find company with this email
    const company = await findCompanyByEmail(cleanEmail);
    if (!company) {
      console.log('❌ No company found with email');
      // For security, don't reveal if email exists or not
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true,
          message: 'If an account with this email exists, a verification email has been sent.'
        })
      };
    }

    console.log('✅ Company found:', company.company_name);

    // Check if already verified
    if (company.email_verified) {
      console.log('⚠️ Email already verified');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true,
          message: 'Your email is already verified. You can sign in to your account.',
          alreadyVerified: true
        })
      };
    }

    // Rate limiting check - prevent spam
    const rateLimitResult = await checkRateLimit(cleanEmail);
    if (!rateLimitResult.allowed) {
      console.log('❌ Rate limit exceeded');
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Too many verification emails sent. Please wait before requesting another.',
          retryAfter: rateLimitResult.retryAfter
        })
      };
    }

    console.log('✅ Rate limit check passed');

    // Generate new verification token
    const newVerificationToken = generateVerificationToken();
    console.log('🎫 New verification token generated');

    // Update company with new token
    console.log('💾 Updating verification token...');
    const updateResult = await updateVerificationToken(company.id, newVerificationToken);
    
    if (!updateResult.success) {
      throw new Error('Failed to update verification token: ' + updateResult.error);
    }

    console.log('✅ Verification token updated');

    // Send verification email
    console.log('📧 Sending verification email...');
    const emailResult = await sendVerificationEmail(
      cleanEmail,
      company.first_name,
      company.company_name,
      newVerificationToken
    );

    if (!emailResult.success) {
      console.log('❌ Email sending failed:', emailResult.error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Failed to send verification email. Please try again later.'
        })
      };
    }

    console.log('✅ Verification email sent successfully');

    // Record the rate limit attempt
    await recordRateLimitAttempt(cleanEmail);

    // Prepare success response
    const response = {
      success: true,
      message: 'Verification email sent successfully! Please check your inbox and spam folder.',
      verificationUrl: emailResult.verificationUrl
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('💥 Resend verification error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

// Find company by email
async function findCompanyByEmail(email) {
  try {
    console.log('Querying database for email...');

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/Companies?email=eq.${email}&select=*`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Database query failed: ${response.status}`);
    }

    const companies = await response.json();
    
    if (companies.length === 0) {
      console.log('No company found with email');
      return null;
    }

    return companies[0];

  } catch (error) {
    console.error('Error finding company by email:', error);
    throw error;
  }
}

// Update verification token
async function updateVerificationToken(companyId, newToken) {
  try {
    console.log('Updating verification token for company ID:', companyId);

    const updateData = {
      verification_token: newToken,
      updated_at: new Date().toISOString()
    };

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/Companies?id=eq.${companyId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updateData)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Database update failed: ${response.status} - ${errorText}`);
    }

    console.log('✅ Verification token updated successfully');

    return {
      success: true
    };

  } catch (error) {
    console.error('Error updating verification token:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Generate verification token
function generateVerificationToken() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Send verification email
async function sendVerificationEmail(email, firstName, companyName, verificationToken) {
  try {
    console.log('📧 Sending verification email to:', email);

    const verificationUrl = `${process.env.URL}/company-verify-email.html?token=${verificationToken}`;
    
    // TODO: Implement actual email sending with your email service
    // For now, just log what would be sent
    
    const emailContent = {
      to: email,
      subject: 'Verify Your Estate Sale Connect Account',
      body: `
        Hi ${firstName},

        Thank you for registering ${companyName} with Estate Sale Connect!

        Please verify your email address by clicking the link below:
        ${verificationUrl}

        This verification link will expire in 24 hours.

        If you didn't create this account, please ignore this email.

        Best regards,
        The Estate Sale Connect Team

        ---
        If the link doesn't work, copy and paste this URL into your browser:
        ${verificationUrl}
      `
    };

    console.log('Verification email prepared for:', email);
    console.log('Verification URL:', verificationUrl);

    // In production, replace this with actual email service call
    // Examples: SendGrid, Mailgun, AWS SES, etc.

    return {
      success: true,
      verificationUrl: verificationUrl
    };

  } catch (error) {
    console.error('Email sending error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Simple rate limiting (in production, use Redis or proper rate limiting service)
const rateLimitStore = new Map();

async function checkRateLimit(email) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 3; // Max 3 emails per 15 minutes

  const key = `resend_${email}`;
  const attempts = rateLimitStore.get(key) || [];
  
  // Remove old attempts outside the window
  const recentAttempts = attempts.filter(timestamp => now - timestamp < windowMs);
  
  if (recentAttempts.length >= maxAttempts) {
    const oldestAttempt = Math.min(...recentAttempts);
    const retryAfter = Math.ceil((windowMs - (now - oldestAttempt)) / 1000);
    
    return {
      allowed: false,
      retryAfter: retryAfter
    };
  }

  return {
    allowed: true
  };
}

async function recordRateLimitAttempt(email) {
  const now = Date.now();
  const key = `resend_${email}`;
  const attempts = rateLimitStore.get(key) || [];
  
  attempts.push(now);
  rateLimitStore.set(key, attempts);
  
  // Clean up old entries periodically
  if (Math.random() < 0.1) { // 10% chance to clean up
    cleanupRateLimit();
  }
}

function cleanupRateLimit() {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  
  for (const [key, attempts] of rateLimitStore.entries()) {
    const recentAttempts = attempts.filter(timestamp => now - timestamp < windowMs);
    
    if (recentAttempts.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, recentAttempts);
    }
  }
}
