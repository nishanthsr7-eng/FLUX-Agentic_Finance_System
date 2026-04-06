export function animateCounter(element, target, duration = 1500) {
  const start = performance.now();
  const initial = 0;

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);  // ease-out cubic
    const current = initial + (target - initial) * eased;
    
    element.textContent = current.toFixed(1) + '%';
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = target.toFixed(1) + '%';
    }
  }

  requestAnimationFrame(update);
}

// Hook it up to scroll entries for any elements marked data-counter
export function setupCounters() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.hasAttribute('data-counted')) {
        const targetValue = parseFloat(entry.target.dataset.targetValue) || 100;
        animateCounter(entry.target, targetValue, 1500);
        entry.target.setAttribute('data-counted', 'true');
      }
    });
  });

  document.querySelectorAll('.number-counter').forEach(el => observer.observe(el));
}
