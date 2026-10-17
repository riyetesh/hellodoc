(() => {
  const status = document.querySelector('#status');
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token_hash');
  const access = params.get('access_token'), refresh = params.get('refresh_token');
  history.replaceState(null, '', window.location.pathname);
  const complete = document.querySelector('#complete');
  const request = document.querySelector('#request');
  if (token || (params.get('type') === 'recovery' && access && refresh)) { complete.hidden = false; request.hidden = true; }
  async function submit(form, path, values) {
    const button = form.querySelector('button'); button.disabled = true;
    status.textContent = 'Please wait…';
    try {
      const response = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Request failed');
      status.textContent = result.message;
      form.reset();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  request.addEventListener('submit',(event) => { event.preventDefault(); submit(request,'/api/auth/recover',{email:new FormData(request).get('email')}); });
  complete.addEventListener('submit',(event) => { event.preventDefault(); submit(complete,'/api/auth/recover/complete',{token_hash:token,access_token:access,refresh_token:refresh,password:new FormData(complete).get('password')}); });
})();
