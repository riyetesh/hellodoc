document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#doctorApplicationForm');
  const message = document.querySelector('#applicationMessage');
  if (!form || !message) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const fields = new FormData(form);
    const body = Object.fromEntries(['firstName','lastName','email','password','specialty','licenseNumber','qualifications','evidenceReference'].map((key) => [key, fields.get(key)]));
    button.disabled = true;
    message.textContent = 'Creating your separate doctor applicant account…';
    try {
      const response = await fetch('/api/auth/doctor-signup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Doctor registration could not be completed.');
      message.textContent = result.message;
      form.reset();
      if (result.authenticated) window.location.assign('/doctor-portal.html');
      else {
        const link = document.createElement('a');
        link.href = '/index.html?login=doctor';
        link.textContent = ' Sign in after confirming your email';
        message.append(link);
      }
    } catch (error) {
      message.textContent = error.message || 'Could not reach HelloDoc. Please try again.';
      button.disabled = false;
    }
  });
});