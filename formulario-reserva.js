function initReservaForm() {
  // --- El resto de tu código de formulario va aquí adentro ---
  const form = document.getElementById('reserva');
  
  // Si el formulario no existe en esta página, no hagas nada.
  if (!form) {
    return;
  }

  const steps = Array.from(form.querySelectorAll('.step'));
  const submitButton = form.querySelector('button[type="submit"]');
  const confirmationMessage = form.parentElement.querySelector('.confirmation');

  let i = 0; // Índice del paso actual

  function stepValid(n){
    const inputs = steps[n].querySelectorAll('input, select, textarea');
    for (const el of inputs) {
      if (!el.checkValidity()) return false;
    }
    return true;
  }

  function show(n){
    steps.forEach((s, idx) => s.classList.toggle('active', idx === n));
    i = n;
  }

  // Navegación con botones "Siguiente" y "Atrás"
  form.addEventListener('click', (e) => {
    if (e.target.classList.contains('next')) {
      e.preventDefault();
      if (!stepValid(i)) {
        const firstInvalid = steps[i].querySelector(':invalid');
        if (firstInvalid) firstInvalid.reportValidity();
        return;
      }
      show(Math.min(i + 1, steps.length - 1));
    }
    if (e.target.classList.contains('prev')) {
      e.preventDefault();
      show(Math.max(i - 1, 0));
    }
  });

  // --- PARTE 2: ENVÍO DEL FORMULARIO A GOOGLE SHEETS ---
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyxLvK87OxVsqNfwBf0B2wPvF97nczkW1l8d24p70JGiXEUa2UzQexG3R_KmIZWRuj7/exec"; // Asegúrate que tu URL esté aquí

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';

    const formData = new FormData(form);
    
    fetch(SCRIPT_URL, {
      method: 'POST',
      body: formData,
    })
    .then(response => response.json())
    .then(data => {
      if (data.result === 'success') {
        form.classList.add('hidden');
        confirmationMessage.classList.remove('hidden');
        confirmationMessage.setAttribute('tabindex', '-1');
        confirmationMessage.focus();
        window.scrollTo(0, confirmationMessage.offsetTop);
      } else {
        throw new Error(data.message || 'Ocurrió un error desconocido.');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert(`Error al enviar la reserva: ${error.message}`);
      submitButton.disabled = false;
      submitButton.textContent = 'Solicitar reserva';
    });
  });
}