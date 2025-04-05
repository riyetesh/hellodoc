document.addEventListener('DOMContentLoaded', function() {
    // In a real app, you would check for an existing session/token
    const userInfo = document.getElementById('userInfo');
    userInfo.innerHTML = '<p>Loading user information...</p>';

    // Simple example - in a real app, you would get this from session storage
    fetch('http://localhost:3000/current-user') // You would need to implement this endpoint
        .then(response => response.json())
        .then(data => {
            if (data.user) {
                userInfo.innerHTML = `
                    <p>Name: ${data.user.firstName} ${data.user.lastName}</p>
                    <p>Email: ${data.user.email}</p>
                `;
            } else {
                window.location.href = 'login.html';
            }
        })
        .catch(() => {
            window.location.href = 'login.html';
        });

    document.getElementById('logoutBtn').addEventListener('click', function() {
        // In a real app, you would call a logout API endpoint
        alert('You have been logged out');
        window.location.href = 'login.html';
    });
});