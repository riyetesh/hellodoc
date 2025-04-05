document.getElementById('signupForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    // Get form data
    const formData = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        dob: document.getElementById('dob').value,
        sex: document.querySelector('input[name="sex"]:checked').value
    };

    try {
        // Send to backend
        const response = await fetch('http://localhost:3000/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();
        
        if (response.ok) {
            alert('Account created successfully!');
            document.getElementById('signupForm').reset();
        } else {
            alert(data.message || 'Error creating account');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error connecting to server');
    }
});