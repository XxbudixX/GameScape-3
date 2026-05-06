// Listens for the registration form submission, validates nothing slipped past the HTML,
// sends the data to the Flask API, and handles the response.
// On success, it tells the parent window (map.js) to update the login state and closes the modal.
// On failure, it shows the server's error message and re-enables the button.
// No direct input — reads values from the form fields. No return value.
document.getElementById('registerForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const btn      = document.getElementById('registerBtn');
    const errorMsg = document.getElementById('errorMsg');

    // Disable the button immediately to prevent double-submissions while the request is in flight.
    btn.textContent = 'Creating account...';
    btn.disabled    = true;
    errorMsg.style.display = 'none';

    // Gender uses a radio group, so we have to find the checked option manually.
    const genderInput = document.querySelector('input[name="gender"]:checked');

    const payload = {
        username:         document.getElementById('username').value.trim(),
        password:         document.getElementById('password').value,
        confirm_password: document.getElementById('confirm_password').value,
        full_name:        document.getElementById('full_name').value.trim(),
        email:            document.getElementById('email').value.trim(),
        birthday:         document.getElementById('birthday').value,
        gender:           genderInput ? genderInput.value : ''
    };

    try {
        const res  = await fetch('/api/register', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            // The register page runs inside an iframe. Calling window.parent reaches the main
            // map.js context so the top-level page knows the user is now logged in.
            if (window.parent && window.parent.setLoggedIn) {
                window.parent.setLoggedIn(true, data.username);
            }
            window.parent.closeModalPage();
        } else {
            errorMsg.textContent   = data.error || 'Registration failed';
            errorMsg.style.display = 'block';
            btn.textContent        = 'Register';
            btn.disabled           = false;
        }

    } catch (err) {
        // Network-level errors (server down, no internet) are caught here separately
        // from server-returned errors above.
        errorMsg.textContent   = 'Network error – please try again';
        errorMsg.style.display = 'block';
        btn.textContent        = 'Register';
        btn.disabled           = false;
    }
});
