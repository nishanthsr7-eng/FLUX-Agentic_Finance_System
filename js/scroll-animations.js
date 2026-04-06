export function initScrollAnimations() {
  const options = {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');

        // Check if there's a progress bar to animate
        const progressBar = entry.target.querySelector('.precision-fill');
        if (progressBar) {
          setTimeout(() => {
            progressBar.style.width = '87.3%';
          }, 300);
        }

        // We can optionally unobserve if we only want it to animate once
        // observer.unobserve(entry.target);
      }
    });
  }, options);

  const elementsToAnimate = document.querySelectorAll('.animate-on-scroll');
  elementsToAnimate.forEach((el) => {
    observer.observe(el);
  });
}
