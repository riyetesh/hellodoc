document.addEventListener('DOMContentLoaded', () => {
  const patientTab = document.querySelector('#patientTab');
  const doctorTab = document.querySelector('#doctorTab');
  const patientView = document.querySelector('#patientDemo');
  const doctorView = document.querySelector('#doctorDemo');
  const feedback = document.querySelector('#demoFeedback');
  function choose(role) {
    const patient = role === 'patient';
    patientTab.classList.toggle('active', patient);
    doctorTab.classList.toggle('active', !patient);
    patientTab.setAttribute('aria-selected', String(patient));
    doctorTab.setAttribute('aria-selected', String(!patient));
    patientTab.tabIndex = patient ? 0 : -1;
    doctorTab.tabIndex = patient ? -1 : 0;
    patientView.hidden = !patient;
    doctorView.hidden = patient;
    feedback.textContent = patient ? 'Patient demo selected. All information and actions are fictional.' : 'Doctor demo selected. All information and actions are fictional.';
  }
  doctorTab.tabIndex = -1;
  [patientTab, doctorTab].forEach((tab) => tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? patientTab : event.key === 'End' ? doctorTab : tab === patientTab ? doctorTab : patientTab;
    choose(next === patientTab ? 'patient' : 'doctor'); next.focus();
  }));
  patientTab.addEventListener('click', () => choose('patient'));
  doctorTab.addEventListener('click', () => choose('doctor'));
  document.querySelectorAll('[data-demo-action]').forEach((button) => button.addEventListener('click', () => {
    feedback.textContent = button.dataset.demoAction + ' Demo only. Nothing was saved; no production API was called.';
    if (button.dataset.demoAction.includes('slot')) {
      const slot = document.querySelector('.demo-slots li:last-child span');
      slot.textContent = slot.textContent === 'Available' ? 'Unavailable (demo)' : 'Available';
    }
  }));
  const specialty = document.querySelector('#specialtyFilter');
  specialty.addEventListener('change', () => {
    const results = document.querySelector('#doctorResults');
    const cards = {
      'All specialties': [['Dr. Maya Patel','General practice · €35 (sample)'],['Dr. Elias Korhonen','Dermatology · €45 (sample)']],
      'General practice': [['Dr. Maya Patel','General practice · €35 (sample)']],
      'Dermatology': [['Dr. Elias Korhonen','Dermatology · €45 (sample)']],
      'Cardiology': [['Dr. Nia Williams','Cardiology · €60 (sample)']]
    };
    results.replaceChildren(...cards[specialty.value].map(([name,detail]) => {
      const p = document.createElement('p');
      const strong = document.createElement('strong'); strong.textContent = name;
      p.append(strong, document.createElement('br'), document.createTextNode(detail));
      return p;
    }));
    feedback.textContent = 'Filtered fictional doctors by ' + specialty.value + '. Nothing was saved.';
  });
});