document.addEventListener('DOMContentLoaded', async () => {
  const title = document.querySelector('#title');
  const status = document.querySelector('#status');
  const details = document.querySelector('#details');
  try {
    const response = await fetch('/api/doctor/application-status', { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to check your doctor application.' : data.message || 'Application status is unavailable.');
    if (data.role === 'doctor') { window.location.replace('/doctor.html'); return; }
    title.textContent = 'Your application is under review';
    const application = data.application;
    status.textContent = application.status === 'pending' ? 'Status: Pending review. You can sign in here again to check for updates. Doctor tools remain locked until approval.' : application.status === 'rejected' ? 'Status: Not approved. Contact HelloDoc support if you need clarification.' : 'Status: ' + application.status;
    const specialty = document.createElement('p'); specialty.textContent = 'Specialty: ' + application.specialty;
    const submitted = document.createElement('p'); submitted.textContent = 'Submitted: ' + new Date(application.created_at).toLocaleDateString();
    details.replaceChildren(specialty, submitted);
    if (application.review_reason) { const reason = document.createElement('p'); reason.textContent = 'Review note: ' + application.review_reason; details.append(reason); }
  } catch (error) {
    title.textContent = 'Sign in to the doctor portal';
    status.textContent = error.message;
    const link = document.createElement('a'); link.className = 'btn btn-primary'; link.href = '/index.html?login=doctor'; link.textContent = 'Sign in';
    details.replaceChildren(link);
  }
  document.querySelector('#logout').addEventListener('click', async () => {
    const response = await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' });
    if (response.ok) window.location.assign('/index.html');
    else status.textContent = 'Could not log out. Please retry.';
  });
});