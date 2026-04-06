/**
 * Final visual and animation refinements for the FLUX landing page.
 */
document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.querySelector('.navbar');
  const bgText = document.querySelector('.bg-text');
  const sideInfos = document.querySelectorAll('.side-info');
  const topCard = document.querySelector('.card-top');
  const bottomCard = document.querySelector('.card-bottom');

  // --- 1. SET INITIAL STATES ---
  if (topCard && bottomCard) {
    topCard.style.transform = 'rotate(0deg) translateX(0) translateY(0)';
    bottomCard.style.transform = 'rotate(0deg) translateX(0) translateY(0)';
  }

  // --- 2. ENTRANCE SEQUENCE ---
  const startEntrance = () => {
    // Step 1: Card Spread (Immediate)
    if (topCard && bottomCard) {
      topCard.style.transform = 'rotate(4deg) translateX(80px) translateY(-20px)';
      bottomCard.style.transform = 'rotate(-8deg) translateX(-40px) translateY(40px)';
    }

    // Step 2: Background Scramble and Rise (Delayed)
    setTimeout(() => {
      if (bgText) {
        bgText.classList.add('visible');
        scrambleText(bgText, 'flux');
      }
    }, 600);

    // Step 3: Side Info and Nav Fade (Further Delayed)
    setTimeout(() => {
      if (navbar) navbar.classList.add('visible');
      sideInfos.forEach(info => info.classList.add('visible'));
    }, 1000);

    // Step 4: Start Looping Animation (After entrance completes)
    setTimeout(() => {
      if (topCard && bottomCard) {
        topCard.classList.add('animate-loop');
        bottomCard.classList.add('animate-loop');
      }
    }, 1800);
  };

  // Trigger sequence after a short initial load delay
  setTimeout(startEntrance, 300);

  // --- 3. UTILITIES ---

  // Text Scramble Effect
  function scrambleText(element, finalValue) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let iteration = 0;
    const interval = setInterval(() => {
      element.innerText = finalValue.split('')
        .map((letter, index) => {
          if (index < iteration) return finalValue[index];
          return chars[Math.floor(Math.random() * 26)];
        })
        .join('');

      if (iteration >= finalValue.length) clearInterval(interval);
      iteration += 1 / 3;
    }, 60);
  }

  // Navigation Scroll Effect
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        navbar.style.background = 'rgba(11, 11, 11, 0.8)';
        navbar.style.backdropFilter = 'blur(10px)';
      } else {
        navbar.style.background = 'transparent';
        navbar.style.backdropFilter = 'none';
      }
    });
  }

  // Segmented Control Interactivity (Phone Mockup Switching)
  const segButtons = document.querySelectorAll('.seg-btn');
  const segIndicator = document.querySelector('.seg-indicator');
  const slides = document.querySelectorAll('.screen-slide');

  if (segButtons.length > 0 && segIndicator) {
    segButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        // Update active class
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Move indicator
        const rect = btn.getBoundingClientRect();
        const parentRect = btn.parentElement.getBoundingClientRect();
        const offsetLeft = rect.left - parentRect.left;
        segIndicator.style.width = `${rect.width}px`;
        segIndicator.style.transform = `translateX(${offsetLeft - 4}px)`;

        // Switch slides
        if (slides.length > 0) {
          slides.forEach(slide => {
            slide.style.opacity = '0';
            slide.style.pointerEvents = 'none';
          });
          const activeSlide = slides[index];
          if (activeSlide) {
            activeSlide.style.opacity = '1';
            activeSlide.style.pointerEvents = 'auto';
          }
        }
      });
    });

    // Initial positioning
    const activeBtn = document.querySelector('.seg-btn.active');
    if (activeBtn) {
      const rect = activeBtn.getBoundingClientRect();
      segIndicator.style.width = `${rect.width}px`;
    }
  }

  // --- 4. SCROLL TO FEATURES ---
  const exploreBtn = document.querySelector('.pill-btn.outline-teal');
  const appSection = document.querySelector('.app-section');

  if (exploreBtn && appSection) {
    exploreBtn.addEventListener('click', () => {
      appSection.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // --- 5. INTERSECTION OBSERVER ---
  const observerOptions = { threshold: 0.15 };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
});
