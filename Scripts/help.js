document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('search-bar');
  const results = document.getElementById('suggestions');
  const status = document.getElementById('search-status');
  let activeModal = null;
  let returnFocus = null;

  function closeModal() {
    if (!activeModal) return;
    activeModal.hidden = true;
    activeModal = null;
    document.body.style.overflow = '';
    returnFocus?.focus();
  }

  function openModal(id, trigger) {
    if (activeModal) closeModal();
    activeModal = document.getElementById(id);
    if (!activeModal) return;
    returnFocus = trigger;
    activeModal.hidden = false;
    document.body.style.overflow = 'hidden';
    activeModal.querySelector('.modal-close').focus();
  }

  function setExpanded(button, expanded) {
    button.setAttribute('aria-expanded', String(expanded));
    button.classList.toggle('active', expanded);
    document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
  }

  document.querySelectorAll('.accordion').forEach((button, index) => {
    const panel = button.nextElementSibling;
    button.id ||= `faq-question-${index}`;
    panel.id ||= `faq-answer-${index}`;
    button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', button.id);
    panel.setAttribute('role', 'region');
    setExpanded(button, false);
    button.addEventListener('click', () => setExpanded(button, button.getAttribute('aria-expanded') !== 'true'));
  });

  document.querySelectorAll('[data-help-topic]').forEach(button => {
    button.addEventListener('click', () => openModal(button.dataset.helpTopic, button));
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  });
  document.addEventListener('keydown', event => {
    if (!activeModal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key !== 'Tab') return;
    const controls = [...activeModal.querySelectorAll('button, a[href], input, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  const entries = [...document.querySelectorAll('.accordion')].map(button => ({
    button, panel: button.nextElementSibling, modal: button.closest('.modal'),
    question: button.textContent.trim(), answer: button.nextElementSibling.textContent.trim()
  }));

  function searchHelp() {
    const query = search.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = !query;
    if (!query) { status.textContent = ''; return; }
    const matches = entries.filter(entry => `${entry.question} ${entry.answer}`.toLowerCase().includes(query));
    status.textContent = matches.length ? `${matches.length} answers found` : 'No answers found. Try another word or contact us below.';
    matches.forEach(entry => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      const title = document.createElement('strong');
      title.textContent = entry.question;
      const excerpt = document.createElement('span');
      const position = entry.answer.toLowerCase().indexOf(query);
      const start = Math.max(0, position - 35);
      excerpt.textContent = (start ? '…' : '') + entry.answer.slice(start, start + 160) + (entry.answer.length > start + 160 ? '…' : '');
      button.append(title, excerpt);
      button.addEventListener('click', () => {
        results.hidden = true;
        if (entry.modal) openModal(entry.modal.id, search);
        setExpanded(entry.button, true);
        entry.button.focus();
        entry.button.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      });
      li.append(button);
      results.append(li);
    });
    results.hidden = !matches.length;
  }
  search.addEventListener('input', searchHelp);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { results.hidden = true; }
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search')) results.hidden = true;
  });
});
