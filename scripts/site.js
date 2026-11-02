'use strict';

/* Shared navigation and accessible motion. */
(() => {
  const menuButton = document.getElementById('menu-toggle');
  const navigation = document.getElementById('site-navigation');

  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      navigation.classList.toggle('is-open', !isOpen);
    });

    navigation.addEventListener('click', (event) => {
      if (!event.target.closest('a')) return;
      navigation.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
    });
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const observer = !reduceMotion && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 })
    : null;

  document.querySelectorAll('.module-card, .section-block, .vehicle-intro')
    .forEach((element) => {
      if (observer) {
        element.classList.add('reveal-on-scroll');
        observer.observe(element);
      } else {
        element.classList.add('is-visible');
      }
    });
})();
