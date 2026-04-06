import * as THREE from 'three';

export function initParticles() {
  const container = document.getElementById('hero-canvas');
  if (!container) return;

  const w = container.clientWidth;
  const h = container.clientHeight;

  const scene = new THREE.Scene();
  // Lift camera up and look down at an angle
  const camera = new THREE.PerspectiveCamera(50, w / h, 1, 1000);
  camera.position.set(0, 20, 40);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Waving Grid Settings
  const SEPARATION = 1.5;
  const AMOUNTX = 120; // width of the grid
  const AMOUNTY = 60;  // depth of the grid
  const numParticles = AMOUNTX * AMOUNTY;

  const positions = new Float32Array(numParticles * 3);
  const colors = new Float32Array(numParticles * 3);

  let i = 0;
  for (let ix = 0; ix < AMOUNTX; ix++) {
    for (let iy = 0; iy < AMOUNTY; iy++) {
      // Center the grid on X and Z axes
      positions[i] = ix * SEPARATION - ((AMOUNTX * SEPARATION) / 2);
      positions[i + 1] = 0; 
      positions[i + 2] = iy * SEPARATION - ((AMOUNTY * SEPARATION) / 2);
      
      // Beautiful FLUX tech blue/cyan colors
      const depthRatio = iy / AMOUNTY; // fade out far away
      colors[i] = 0.1; 
      colors[i + 1] = 0.5 + (Math.random() * 0.5); 
      colors[i + 2] = 0.9 + (Math.random() * 0.1); 
      
      i += 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.6,
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  // Mouse tracking to tilt the camera dynamically
  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX - window.innerWidth / 2) * 0.05;
    mouseY = (e.clientY - window.innerHeight / 2) * 0.05;
  });

  window.addEventListener('resize', () => {
    const nw = container.clientWidth;
    const nh = container.clientHeight;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });

  // Animated Wave Logic
  let count = 0;
  function animate() {
    // Smooth camera drift based on mouse
    camera.position.x += (mouseX - camera.position.x) * 0.05;
    camera.position.y += (-mouseY + 20 - camera.position.y) * 0.05;
    camera.lookAt(scene.position);

    const positions = geo.attributes.position.array;
    const colors = geo.attributes.color.array;
    
    let i = 0;
    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        // Create an organic oscillating kinetic wave
        const waveX = Math.sin((ix + count) * 0.3) * 2;
        const waveY = Math.sin((iy + count) * 0.5) * 2;
        const wave = waveX + waveY;
        
        positions[i + 1] = wave;

        // Dynamic vertex color based on wave height (brighter when higher)
        colors[i + 1] = 0.3 + (wave * 0.15); // Adjust Green channel
        colors[i + 2] = 0.7 + (wave * 0.1);  // Adjust Blue channel

        i += 3;
      }
    }
    
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    count += 0.04; // Speed of the wave
    
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(animate);
}
