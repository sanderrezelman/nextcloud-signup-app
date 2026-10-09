'use strict';
(() => {
  const form = document.getElementById('signup-form');
  const errorBox = document.getElementById('form-error');
  const submitButton = document.getElementById('submit-button');
  const panels = [...document.querySelectorAll('[data-panel]')];
  const progressSteps = [...document.querySelectorAll('[data-progress]')];
  let currentStep = 1;

  document.getElementById('year').textContent = new Date().getFullYear();

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
    form.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
  }
  function showStep(step) {
    currentStep = step;
    panels.forEach(panel => panel.classList.toggle('is-visible', Number(panel.dataset.panel) === step));
    progressSteps.forEach(item => {
      const n = Number(item.dataset.progress);
      item.classList.toggle('is-active', n === step);
      item.classList.toggle('is-complete', n < step);
      item.querySelector('span').textContent = n < step ? '✓' : String(n);
    });
    clearError();
  }
  function validatePanel(step) {
    clearError();
    const panel = panels.find(item => Number(item.dataset.panel) === step);
    const fields = [...panel.querySelectorAll('input[required]')].filter(input => input.type !== 'checkbox' || input.checked);
    for (const input of fields) {
      if (!input.checkValidity() || !input.value.trim()) {
        input.setAttribute('aria-invalid', 'true');
        input.reportValidity();
        input.focus();
        return false;
      }
    }
    const unchecked = panel.querySelector('input[type="checkbox"][required]:not(:checked)');
    if (unchecked) {
      showError('Accepteer de voorwaarden en privacyverklaring om verder te gaan.');
      unchecked.focus();
      return false;
    }
    if (step === 2) {
      const password = document.getElementById('password');
      const confirm = document.getElementById('passwordConfirm');
      if (password.value.length < 12) {
        password.setAttribute('aria-invalid', 'true');
        showError('Kies een wachtwoord van minimaal 12 tekens.');
        password.focus();
        return false;
      }
      if (password.value !== confirm.value) {
        confirm.setAttribute('aria-invalid', 'true');
        showError('De wachtwoorden komen niet overeen.');
        confirm.focus();
        return false;
      }
    }
    return true;
  }

  document.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => {
    if (validatePanel(1)) showStep(2);
  }));
  document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => showStep(1)));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (currentStep !== 2 || !validatePanel(2)) return;
    clearError();
    submitButton.disabled = true;
    submitButton.textContent = 'Bezig met aanmelden…';

    const payload = {
      customer: {
        firstName: document.getElementById('firstName').value.trim(),
        lastName: document.getElementById('lastName').value.trim(),
        company: document.getElementById('company').value.trim(),
        postalCode: document.getElementById('postalCode').value.trim(),
        houseNumber: document.getElementById('houseNumber').value.trim(),
        address: document.getElementById('address').value.trim(),
        phone: document.getElementById('phone').value.trim()
      },
      account: {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      },
      acceptedTerms: document.getElementById('terms').checked
    };

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Aanmelden is niet gelukt. Probeer het opnieuw.');

      document.getElementById('result-icon').textContent = '✓';
      document.getElementById('result-icon').classList.remove('is-error');
      document.getElementById('result-kicker').textContent = 'AANVRAAG VERWERKT';
      document.getElementById('result-title').textContent = 'Uw account is aangemaakt';
      document.getElementById('result-copy').textContent = result.message || 'Uw Nextcloud-account is aangemaakt en uw klantregistratie is verzonden.';
      const reference = document.getElementById('account-reference');
      if (result.account?.username) {
        reference.textContent = `Uw gebruikersnaam: ${result.account.username}`;
        reference.hidden = false;
      }
      form.querySelectorAll('.form-panel').forEach(panel => panel.classList.remove('is-visible'));
      document.querySelector('[data-panel="3"]').classList.add('is-visible');
      currentStep = 3;
      progressSteps.forEach(item => {
        const n = Number(item.dataset.progress);
        item.classList.toggle('is-active', n === 3);
        item.classList.toggle('is-complete', n < 3);
        item.querySelector('span').textContent = n < 3 ? '✓' : String(n);
      });
      // Clear password fields from the live DOM after submission.
      document.getElementById('password').value = '';
      document.getElementById('passwordConfirm').value = '';
    } catch (error) {
      showError(error.message || 'Er is iets misgegaan. Probeer het later opnieuw.');
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Account aanmaken <span>→</span>';
    }
  });
})();
