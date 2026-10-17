document.addEventListener('DOMContentLoaded', async () => {
  const $ = (selector) => document.querySelector(selector);
  const date = (value) => new Date(value).toLocaleString();
  function list(selector, records, render, empty) {
    const node = $(selector); node.replaceChildren();
    if (!records.length) { node.textContent = empty; return; }
    for (const record of records) {
      const article = document.createElement('article');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      const [heading, description] = render(record);
      title.textContent = heading; detail.textContent = description;
      article.append(title,detail); node.append(article);
    }
  }
  try {
    const response = await fetch('/api/patient/overview', { credentials:'same-origin' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Log in to view your health portal.' : response.status === 403 ? 'This portal is for patients only.' : 'Health information is unavailable. Please try again later.');
    const data = await response.json();
    $('#greeting').textContent = `Hello, ${data.profile.firstName}`;
    $('#profile').textContent = `${data.profile.firstName} ${data.profile.lastName} · ${data.profile.email}`;
    const upcoming = data.appointments.filter((a) => ['pending','confirmed'].includes(a.status)).sort((a,b) => new Date(a.startsAt)-new Date(b.startsAt));
    $('#nextVisit').textContent = upcoming.length ? `Next visit: ${upcoming[0].doctorName} on ${date(upcoming[0].startsAt)} (${upcoming[0].status}).` : 'No upcoming visits. Find a doctor to request an appointment.';
    const metrics = data.metrics;
    $('#visitMetrics').textContent = metrics ? `Your appointments: ${metrics.upcoming} upcoming, ${metrics.completed} completed, ${metrics.cancelled} cancelled.` : 'Appointment metrics unavailable.';
    $('#tasks').textContent = 'No tasks available during migration.';
    list('#visits',upcoming,(a) => [a.doctorName,`${date(a.startsAt)} · ${a.status}`],'No upcoming appointments.');
    list('#history',data.appointments.filter((a) => !upcoming.includes(a)),(a) => [a.doctorName,`${date(a.startsAt)} · ${a.status}`],'No past visits yet.');
    $('#portal').hidden = false; $('#portalMessage').hidden = true;
  } catch (error) {
    $('#portalMessage').textContent = error.message;
  }
  $('#logout').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' });
      if (!response.ok) throw new Error('Could not log out. Please retry.');
      window.location.href = '/index.html';
    } catch (error) { $('#portalMessage').hidden = false; $('#portalMessage').textContent = error.message; }
  });
});
