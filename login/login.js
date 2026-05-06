// Handles the login form submission. Sends credentials to the Flask API and reacts to the response.
// On success, it tells the parent window (map.js) the user is now logged in and closes the modal.
// On failure, it shows the error from the server and re-enables the button so the user can try again.
// No direct input — reads values from the form fields. No return value.
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const btn      = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMsg');

    // Disable immediately so the user can't hit submit twice while waiting for the server.
    btn.textContent = 'Signing in...';
    btn.disabled    = true;
    errorMsg.style.display = 'none';

    const payload = {
        username_or_email: document.getElementById('username_or_email').value.trim(),
        password:  document.getElementById('password').value
    };

    try {
        const res  = await fetch('/api/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            // The login page runs inside an iframe. Calling window.parent reaches the main
            // map.js context so the top-level page updates its login state and avatar.
            if (window.parent && window.parent.setLoggedIn) {
                window.parent.setLoggedIn(true, data.username);
            }
            if (window.parent && window.parent.checkAdmin) {
                window.parent.checkAdmin();
            }
            window.parent.closeModalPage();
        } else {
            errorMsg.textContent   = data.error || 'Login failed';
            errorMsg.style.display = 'block';
            btn.textContent        = 'Sign In';
            btn.disabled           = false;
        }

    } catch (err) {
        // Catches network-level failures (server unreachable, no connection) separately
        // from server-returned errors handled above.
        errorMsg.textContent   = 'Network error – please try again';
        errorMsg.style.display = 'block';
        btn.textContent        = 'Sign In';
        btn.disabled           = false;
    }
});
