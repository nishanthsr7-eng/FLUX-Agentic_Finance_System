export function setupTiltCards() {
  const cards = document.querySelectorAll('.tilt-card');
  
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth <= 900) {
    return; // disable on mobile or explicit preference
  }

  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      
      const rotateX = (y - 0.5) * -20;  // ±10 degrees max
      const rotateY = (x - 0.5) * 20;

      card.style.transform = `
        perspective(800px)
        rotateX(${rotateX}deg)
        rotateY(${rotateY}deg)
        translateZ(10px)
      `;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) translateZ(0)';
      // Let the CSS transition handle the smooth return
    });
  });
}
