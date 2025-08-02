// netlify/functions/company-signup.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
  console.log('🏢 Company signup function called');
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
      console.log('✅ Request data parsed:', { 
        email: requestData.email, 
        companyName: requestData.companyName,
        hasPassword: !!requestData.password 
      });
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

    // Validate and sanitize input data
    const validationResult = validateSignupData(requestData);
    if (!validationResult.isValid) {
      console.log('❌ Validation failed:', validationResult.errors);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Validation failed',
          details: validationResult.errors
        })
      };
    }

    const sanitizedData = validationResult.data;
    console.log('✅ Data validation passed');

    // Check if email already exists
    const existingUser = await checkExistingUser(sanitizedData.email);
    if (existingUser) {
      console.log('❌ Email already registered:', sanitizedData.email);
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'An account with this email already exists. Please sign in or use a different email address.'
        })
      };
    }

    console.log('✅ Email is available');

    // Hash password
    console.log('🔐 Hashing password...');
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(sanitizedData.password, saltRounds);
    console.log('✅ Password hashed successfully');

    // Generate verification token
    const verificationToken = generateVerificationToken();
    console.log('🎫 Verification token generated');

    // Prepare company data for database
    const companyData = {
      // Personal info
      first_name: sanitizedData.firstName,
      last_name: sanitizedData.lastName,
      email: sanitizedData.email,
      phone: sanitizedData.phone,
      password_hash: hashedPassword,
      
      // Company info
      company_name: sanitizedData.companyName,
      business_address: sanitizedData.businessAddress,
      business_type: sanitizedData.businessType,
      years_in_business: sanitizedData.yearsInBusiness,
      service_areas: sanitizedData.serviceAreas,
      license_number: sanitizedData.licenseNumber || null,
      insurance_carrier: sanitizedData.insuranceCarrier || null,
      website_url: sanitizedData.websiteUrl || null,
      
      // Status and verification
      account_status: 'pending_verification',
      email_verified: false,
      background_verified: false,
      verification_token: verificationToken,
      
      // Agreements
      terms_agreed: sanitizedData.termsAgreement,
      background_check_consent: sanitizedData.backgroundCheck,
      communication_consent: sanitizedData.communicationConsent || false,
      professional_conduct_agreed: sanitizedData.professionalConduct,
      
      // Timestamps
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('💾 Saving company to database...');

    // Save to Supabase
    const saveResult = await saveCompanyToDatabase(companyData);
    if (!saveResult.success) {
      throw new Error('Failed to save company data: ' + saveResult.error);
    }

    console.log('✅ Company saved to database with ID:', saveResult.companyId);

    // Send verification email
    console.log('📧 Sending verification email...');
    const emailResult = await sendVerificationEmail(
      sanitizedData.email,
      sanitizedData.firstName,
      sanitizedData.companyName,
      verificationToken
    );

    if (!emailResult.success) {
      console.log('⚠️ Email sending failed:', emailResult.error);
      // Don't fail the signup, just log the error
    } else {
      console.log('✅ Verification email sent successfully');
    }

    // Prepare success response
    const response = {
      success: true,
      message: 'Account created successfully! Please check your email for verification instructions.',
      companyId: saveResult.companyId,
      verificationRequired: true
    };

    console.log('✅ Company signup completed successfully');

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('💥 Company signup error:', error);
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

// Input validation and sanitization
function validateSignupData(data) {
  const errors = [];
  const sanitized = {};

  // Helper function to sanitize text
  function sanitizeText(input, maxLength = 1000) {
    if (typeof input !== 'string') return '';
    
    let cleaned = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
    
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }
    
    return cleaned;
  }

  // Validate required fields
  const requiredFields = [
    'firstName', 'lastName', 'companyName', 'email', 'phone', 'password', 
    'confirmPassword', 'businessAddress', 'businessType', 'yearsInBusiness', 
    'serviceAreas'
  ];

  for (const field of requiredFields) {
    if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
      errors.push(`${field} is required`);
    }
  }

  // First name validation
  if (data.firstName) {
    sanitized.firstName = sanitizeText(data.firstName, 50);
    if (sanitized.firstName.length < 2) {
      errors.push('First name must be at least 2 characters');
    }
  }

  // Last name validation
  if (data.lastName) {
    sanitized.lastName = sanitizeText(data.lastName, 50);
    if (sanitized.lastName.length < 2) {
      errors.push('Last name must be at least 2 characters');
    }
  }

  // Company name validation
  if (data.companyName) {
    sanitized.companyName = sanitizeText(data.companyName, 100);
    if (sanitized.companyName.length < 2) {
      errors.push('Company name must be at least 2 characters');
    }
  }

  // Email validation
  if (data.email) {
    const cleanEmail = data.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail) || cleanEmail.length > 254) {
      errors.push('Invalid email format');
    } else {
      sanitized.email = cleanEmail;
    }
  }

  // Phone validation
  if (data.phone) {
    const cleanPhone = data.phone.replace(/[^0-9+\-() ]/g, '').trim();
    const phoneRegex = /^[\+]?[1-9][\d\-\s\(\)]{8,}$/;
    if (!phoneRegex.test(cleanPhone)) {
      errors.push('Invalid phone number format');
    } else {
      sanitized.phone = cleanPhone;
    }
  }

  // Password validation
  if (data.password) {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(data.password)) {
      errors.push('Password must be at least 8 characters with uppercase, lowercase, and number');
    } else if (data.password !== data.confirmPassword) {
      errors.push('Passwords do not match');
    } else {
      sanitized.password = data.password;
    }
  }

  // Business address validation
  if (data.businessAddress) {
    sanitized.businessAddress = sanitizeText(data.businessAddress, 200);
    if (sanitized.businessAddress.length < 10) {
      errors.push('Business address must be complete');
    }
  }

  // Business type validation
  const validBusinessTypes = [
    'estate_sale_company', 'auction_house', 'liquidation_service',
    'antique_dealer', 'consignment_shop', 'other'
  ];
  if (data.businessType && !validBusinessTypes.includes(data.businessType)) {
    errors.push('Invalid business type');
  } else {
    sanitized.businessType = data.businessType;
  }

  // Years in business validation
  const validYears = ['0-1', '1-3', '3-5', '5-10', '10+'];
  if (data.yearsInBusiness && !validYears.includes(data.yearsInBusiness)) {
    errors.push('Invalid years in business');
  } else {
    sanitized.yearsInBusiness = data.yearsInBusiness;
  }

  // Service areas validation
  if (data.serviceAreas) {
    sanitized.serviceAreas = sanitizeText(data.serviceAreas, 500);
    if (sanitized.serviceAreas.length < 5) {
      errors.push('Service areas must be at least 5 characters');
    }
  }

  // Optional fields
  if (data.licenseNumber) {
    sanitized.licenseNumber = sanitizeText(data.licenseNumber, 50);
  }

  if (data.insuranceCarrier) {
    sanitized.insuranceCarrier = sanitizeText(data.insuranceCarrier, 100);
  }

  if (data.websiteUrl) {
    const urlRegex = /^https?:\/\/.+\..+$/;
    if (!urlRegex.test(data.websiteUrl)) {
      errors.push('Invalid website URL format');
    } else {
      sanitized.websiteUrl = data.websiteUrl;
    }
  }

  // Boolean validations
  sanitized.termsAgreement = data.termsAgreement === true;
  sanitized.backgroundCheck = data.backgroundCheck === true;
  sanitized.communicationConsent = data.communicationConsent === true;
  sanitized.professionalConduct = data.professionalConduct === true;

  // Check required agreements
  if (!sanitized.termsAgreement) {
    errors.push('Terms of service agreement is required');
  }
  if (!sanitized.backgroundCheck) {
    errors.push('Background check consent is required');
  }
  if (!sanitized.professionalConduct) {
    errors.push('Professional conduct agreement is required');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    data: sanitized
  };
}

// Check if user already exists
async function checkExistingUser(email) {
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/Companies?email=eq.${email}&select=id`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        }
      }
    );

    if (!response.ok) {
      throw new Error('Database query failed');
    }

    const users = await response.json();
    return users.length > 0;

  } catch (error) {
    console.error('Error checking existing user:', error);
    // In case of error, assume user doesn't exist to allow signup
    return false;
  }
}

// Save company to database
async function saveCompanyToDatabase(companyData) {
  try {
    console.log('Saving to Supabase:', {
      email: companyData.email,
      companyName: companyData.company_name,
      businessType: companyData.business_type
    });

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/Companies`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(companyData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase save error:', response.status, errorText);
      throw new Error(`Database save failed: ${response.status}`);
    }

    const savedData = await response.json();
    const companyId = savedData[0]?.id;

    if (!companyId) {
      throw new Error('No company ID returned from database');
    }

    return {
      success: true,
      companyId: companyId
    };

  } catch (error) {
    console.error('Database save error:', error);
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
    // For now, we'll just log the email details
    // In production, you'd integrate with a service like SendGrid, Mailgun, etc.
    
    const verificationUrl = `${process.env.URL}/company-verify-email.html?token=${verificationToken}`;
    
    console.log('📧 Email Details:');
    console.log('To:', email);
    console.log('Subject: Verify Your Estate Sale Connect Account');
    console.log('Verification URL:', verificationUrl);
    
    // TODO: Implement actual email sending
    // For now, return success
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
