exports.handler = async (event, context) => {
  console.log('Test function called!');
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      message: 'Test function is working!',
      timestamp: new Date().toISOString()
    })
  };
};