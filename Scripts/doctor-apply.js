document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#doctorApplication');
  const message = document.querySelector('#applicationMessage');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const fields = new FormData(form);
    button.disabled = true;
    message.textContent = 'Submitting application…';
    try {
      const response = await fetch('/api/doctor/apply', {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ specialty:fields.get('specialty'), licenseNumber:fields.get('licenseNumber') })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in with your patient account before applying.' : response.status === 404 ? 'Doctor application endpoint is not available on this server. Contact the site administrator.' : result.message || 'Application unavailable. Please try again later.');
      message.textContent = result.status === 'pending' ? 'Application received. Doctor access requires license review and approval.' : 'Application received.';
      form.reset();
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
});
