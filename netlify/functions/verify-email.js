// netlify/functions/verify-email.js
exports.handler = async (event, context) => {
  console.log('📧 Email verification function called');
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
      console.log('✅ Request data parsed:', { hasToken: !!requestData.token });
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

    const { token } = requestData;

    // Validate token
    if (!token || typeof token !== 'string') {
      console.log('❌ Missing or invalid token');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Verification token is required'
        })
      };
    }

    // Sanitize token (remove any potential XSS)
    const sanitizedToken = token.replace(/[^a-zA-Z0-9]/g, '');
    if (sanitizedToken.length !== token.length || sanitizedToken.length < 16) {
      console.log('❌ Invalid token format');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid verification token format'
        })
      };
    }

    console.log('🔍 Looking up company with token...');

    // Find company with this verification token
    const company = await findCompanyByToken(sanitizedToken);
    if (!company) {
      console.log('❌ No company found with token');
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid or expired verification token. The link may have already been used or expired.'
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
          message: 'Email is already verified',
          company: {
            company_name: company.company_name,
            email: company.email,
            account_status: company.account_status
          },
          alreadyVerified: true
        })
      };
    }

    // Check token expiration (24 hours)
    const tokenAge = Date.now() - new Date(company.created_at).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (tokenAge > maxAge) {
      console.log('❌ Token expired');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Verification token has expired. Please request a new verification email.'
        })
      };
    }

    console.log('✅ Token is valid and not expired');

    // Update company verification status
    console.log('💾 Updating verification status...');
    const updateResult = await updateCompanyVerification(company.id);
    
    if (!updateResult.success) {
      throw new Error('Failed to update verification status: ' + updateResult.error);
    }

    console.log('✅ Email verification completed successfully');

    // Send welcome email (optional)
    try {
      await sendWelcomeEmail(company.email, company.first_name, company.company_name);
    } catch (emailError) {
      console.log('⚠️ Welcome email failed (non-critical):', emailError.message);
      // Don't fail the verification if welcome email fails
    }

    // Prepare success response
    const response = {
      success: true,
      message: 'Email verified successfully! Your account is now active.',
      company: {
        company_name: company.company_name,
        email: company.email,
        account_status: 'email_verified',
        first_name: company.first_name
      }
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('💥 Email verification error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error during verification. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};

// Find company by verification token
async function findCompanyByToken(token) {
  try {
    console.log('Querying database for token...');

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/Companies?verification_token=eq.${token}&select=*`,
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
      console.log('No company found with verification token');
      return null;
    }

    if (companies.length > 1) {
      console.log('⚠️ Multiple companies found with same token - this should not happen');
    }

    return companies[0];

  } catch (error) {
    console.error('Error finding company by token:', error);
    throw error;
  }
}

// Update company verification status
async function updateCompanyVerification(companyId) {
  try {
    console.log('Updating company verification status for ID:', companyId);

    const updateData = {
      email_verified: true,
      account_status: 'email_verified',
      verification_token: null, // Clear the token after use
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

    console.log('✅ Company verification status updated successfully');

    return {
      success: true
    };

  } catch (error) {
    console.error('Error updating company verification:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Send welcome email after verification
async function sendWelcomeEmail(email, firstName, companyName) {
  try {
    console.log('📧 Sending welcome email to:', email);

    // TODO: Implement actual email sending with your email service
    // For now, just log what would be sent
    
    const emailContent = {
      to: email,
      subject: `Welcome to Estate Sale Connect, ${companyName}!`,
      body: `
        Hi ${firstName},

        Congratulations! Your email has been successfully verified and your Estate Sale Connect account is now active.

        What's Next:
        1. Our team will review your business information within 1-2 business days
        2. Once approved, you'll receive full access to browse and purchase leads
        3. Your 7-day free trial will begin immediately upon approval
        4. You can sign in anytime at: ${process.env.URL}/company-signin.html

        While you wait for approval, feel free to:
        - Explore your dashboard
        - Update your company profile
        - Review our lead pricing and policies

        If you have any questions, our support team is here to help at info@estatesaleconnect.com

        Welcome to the Estate Sale Connect family!

        Best regards,
        The Estate Sale Connect Team
      `
    };

    console.log('Welcome email prepared:', emailContent.subject);

    // In production, replace this with actual email service call
    // Examples: SendGrid, Mailgun, AWS SES, etc.

    return {
      success: true
    };

  } catch (error) {
    console.error('Welcome email error:', error);
    throw error;
  }
}

// Helper function to sanitize input
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}
