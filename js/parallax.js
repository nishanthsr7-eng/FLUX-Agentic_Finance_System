export function setupParallax() {
  const card1 = document.getElementById('hero-card-1');
  const card2 = document.getElementById('hero-card-2');
  const card3 = document.getElementById('hero-card-3');

  if (!card1 || !card2 || !card3) return;

  document.addEventListener('mousemove', (e) => {
    // Disable on small screens
    if(window.innerWidth <= 900) return;

    const x = (e.clientX / window.innerWidth - 0.5) * 2;   // -1 to 1
    const y = (e.clientY / window.innerHeight - 0.5) * 2;

    requestAnimationFrame(() => {
      card1.style.transform = `
        perspective(1000px)
        rotateY(${x * 8}deg)
        rotateX(${-y * 5}deg)
        translateZ(40px)
        translate(${x * 15}px, ${y * 10}px)
      `;
      
      card2.style.transform = `
        perspective(1000px)
        rotateY(${x * 4}deg)
        rotateX(${-y * 3}deg)
        translateZ(0px)
      `;
      
      card3.style.transform = `
        perspective(1000px)
        rotateY(${x * 6}deg)
        rotateX(${-y * 4}deg)
        translateZ(20px)
        translate(${x * -10}px, ${y * -8}px)
      `;
    });
  });

  // Reset transforms on mouse leave window
  document.addEventListener('mouseleave', () => {
    const defaultTransform = 'perspective(1000px) rotateY(0) rotateX(0) translateZ(0) translate(0,0)';
    card1.style.transform = defaultTransform;
    card2.style.transform = defaultTransform;
    card3.style.transform = defaultTransform;
  });
}
