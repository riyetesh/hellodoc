document.addEventListener('DOMContentLoaded', () => {
  const title = document.querySelector('#title');
  const status = document.querySelector('#status');
  const details = document.querySelector('#details');
  const logout = document.querySelector('#logout');
  async function load() {
    details.replaceChildren();
    try {
      const response = await fetch('/api/doctor/application-status', { credentials: 'same-origin' });
      const data = await response.json();
      logout.hidden = response.status === 401;
      if (response.status === 401) {
        title.textContent = 'Sign in to the doctor portal';
        status.textContent = 'Use your doctor application email and password.';
        const link = document.createElement('a');
        link.href = '/index.html?login=doctor'; link.textContent = 'Doctor sign in'; link.className = 'btn btn-primary';
        details.append(link);
        return;
      }
      if (!response.ok) {
        title.textContent = data.code === 'ACCOUNT_SUSPENDED' ? 'Account restricted' : 'Application unavailable';
        status.textContent = data.message || 'Retry or contact support.';
        const retry = document.createElement('button');
        retry.textContent = 'Retry'; retry.className = 'btn btn-outline'; retry.addEventListener('click', load);
        details.append(retry);
        return;
      }
      if (data.role === 'doctor' && data.approved === true) { window.location.replace('/doctor.html'); return; }
      const application = data.application;
      if (!application || !['pending','rejected'].includes(application.status)) throw new Error('Incomplete status');
      title.textContent = application.status === 'pending' ? 'Your application is under review' : 'Your application was not approved';
      status.textContent = application.status === 'pending' ? 'Pending independent verification. Doctor tools remain locked until approval.' : 'Doctor tools remain locked. Contact support with questions about your review.';
      for (const text of ['Specialty: ' + application.specialty, 'Submitted: ' + new Date(application.created_at).toLocaleDateString(), application.review_reason && 'Review note: ' + application.review_reason].filter(Boolean)) {
        const paragraph = document.createElement('p'); paragraph.textContent = text; details.append(paragraph);
      }
    } catch {
      title.textContent = 'Could not load your application';
      status.textContent = 'Check your connection and reload this page, or contact support.';
    }
  }
  logout.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' });
      if (!response.ok) throw new Error('Logout failed');
      window.location.assign('/index.html');
    } catch { status.textContent = 'Could not complete logout. Please retry.'; }
  });
  load();
});
