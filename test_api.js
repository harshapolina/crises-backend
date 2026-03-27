const axios = require('axios');
(async () => {
    try {
        const res = await axios.post('http://localhost:5005/api/auth/request-otp', { email: 'harshapolinax@gmail.com' });
        console.log('Response:', res.data);
    } catch (err) {
        console.error('Error:', err.response ? err.response.status : err.message);
    }
})();
