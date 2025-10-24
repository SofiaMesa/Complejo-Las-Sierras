// Cerrar menú si se hace click en un link del sidebar
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#sidebar a').forEach(link => {
    link.addEventListener('click', () => {
      // Asume que closeMenu() está disponible globalmente (definido en includes.js)
      if (typeof closeMenu === 'function') {
        closeMenu();
      }
    });
  });
});

// ======================================
// SLIDER AUTOMÁTICO DE RESEÑAS (INDEX)
// ======================================
(function() {
  let currentSlide = 0;
  const slides = document.querySelectorAll('.slide');

  function showNextSlide() {
    if (!slides.length) return;
    slides[currentSlide]?.classList.remove('active');
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide]?.classList.add('active');
  }

  // Cambia de reseña cada 5 segundos solo si hay más de 1 slide
  if (slides.length > 1) {
    setInterval(showNextSlide, 5000);
  }
})();


// =========================================================
// CARRUSEL GLOBAL (para Cabañas, Bungalows, etc.)
// (Movido desde cabanas.html)
// =========================================================
(function () {
  // Espera a que el DOM esté cargado para buscar los carruseles
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.carousel').forEach(initCarousel);
  });

  function initCarousel(root){
    const viewport = root.querySelector('.carousel__viewport');
    // Si no tiene viewport, no es un carrusel válido
    if (!viewport) return; 

    const slides   = Array.from(viewport.children);
    const prevBtn  = root.querySelector('[data-prev]');
    const nextBtn  = root.querySelector('[data-next]');
    const dotsWrap = root.querySelector('.carousel__dots');
    let i = 0;

    // Si no hay slides, botones o dots, salir
    if (slides.length === 0 || !prevBtn || !nextBtn || !dotsWrap) return;

    // Limpiar dots por si acaso
    dotsWrap.innerHTML = '';

    // Crear puntos
    slides.forEach((_, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'carousel__dot';
      b.setAttribute('aria-label', 'Ir a la imagen ' + (idx + 1));
      b.addEventListener('click', () => go(idx));
      dotsWrap.appendChild(b);
    });

    function update(){
      viewport.style.transform = 'translateX(' + (-i * 100) + '%)';
      dotsWrap.querySelectorAll('.carousel__dot').forEach((d, idx) => {
        d.setAttribute('aria-current', String(idx === i));
      });
    }
    
    function go(n){
      i = (n + slides.length) % slides.length;
      update();
    }

    // Controles
    prevBtn.addEventListener('click', () => go(i - 1));
    nextBtn.addEventListener('click', () => go(i + 1));

    // Teclado
    root.setAttribute('tabindex', '0');
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft')  prevBtn.click();
      if (e.key === 'ArrowRight') nextBtn.click();
    });

    // Swipe básico
    let startX = null;
    root.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend',   e => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) (dx > 0 ? prevBtn : nextBtn).click();
      startX = null;
    }, { passive: true });

    update(); // Iniciar en el primer slide
  }
})();