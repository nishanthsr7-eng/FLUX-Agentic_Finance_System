class ScrollAnimator {
  constructor() {
    this.initObservers();
    this.initParallax();
    window.addEventListener('scroll', () => this.handleNavbar());
  }

  handleNavbar() {
    const nav = document.querySelector('.navbar');
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  initObservers() {
    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-active');
          
          // Add staggered delay for children if target is a staggered container
          if (entry.target.classList.contains('stagger-group')) {
            const children = entry.target.querySelectorAll('.stagger-item');
            children.forEach((child, index) => {
              setTimeout(() => {
                child.classList.add('reveal-active');
              }, index * 150);
            });
          }
        }
      });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll, .stagger-group').forEach((elem) => {
      observer.observe(elem);
    });
  }

  initParallax() {
    // 3D Scroll effect on cards
    document.addEventListener('mousemove', (e) => {
      document.querySelectorAll('.glass-card').forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Spotlight effect
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      });
    });

    // Suble 3D rotation on scroll
    window.addEventListener('scroll', () => {
      const scrolled = window.scrollY;
      
      document.querySelectorAll('.parallax-hero').forEach(elem => {
        const speed = elem.dataset.speed || 0.5;
        elem.style.transform = `translateY(${scrolled * speed}px)`;
      });

      document.querySelectorAll('.card-3d').forEach(elem => {
        const rect = elem.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        
        // Center of the element relative to the viewport
        const elemCenterY = rect.top + rect.height / 2;
        
        // Distance from center of screen (-1 to 1)
        const distance = (elemCenterY - (viewportHeight / 2)) / (viewportHeight / 2);
        
        // Apply transform based on distance
        if (Math.abs(distance) < 1.5) {
            const rotateX = distance * -10; // Max 10deg rotation
            const rotateY = distance * 2;
            const translateZ = Math.abs(distance) * -50;
            elem.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(${translateZ}px)`;
        }
      });
    });
  }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  new ScrollAnimator();
});
