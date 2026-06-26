document.addEventListener('DOMContentLoaded', () => {
    // 1. Educational Tips Rotation
    const tips = [
        "Did you know? Binary 1010 equals 10.",
        "Quick Revision: CPU stands for Central Processing Unit.",
        "Pro Tip: Taking short breaks improves retention.",
        "Fact: The first computer bug was an actual moth.",
        "Study Hack: Teaching a concept helps you learn it better.",
        "Remember: Hydration is key for peak brain performance."
    ];

    const tipElement = document.getElementById('edu-tip');
    let currentTipIndex = 0;

    function rotateTip() {
        tipElement.style.opacity = '0';
        
        setTimeout(() => {
            currentTipIndex = (currentTipIndex + 1) % tips.length;
            tipElement.textContent = tips[currentTipIndex];
            tipElement.style.opacity = '1';
        }, 500);
    }

    // Set initial tip
    tipElement.textContent = tips[0];
    
    // Rotate every 5 seconds
    setInterval(rotateTip, 5000);

    // 2. Easter Egg Logic
    const errorCodeElement = document.getElementById('error-code');
    const toast = document.getElementById('easter-egg-toast');
    let clickCount = 0;
    let clickTimer;

    errorCodeElement.addEventListener('click', () => {
        clickCount++;
        
        // Reset count if they don't click fast enough
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
            clickCount = 0;
        }, 2000);

        if (clickCount === 5) {
            triggerEasterEgg();
            clickCount = 0;
        }
    });

    function triggerEasterEgg() {
        // Add glitch effect
        errorCodeElement.classList.add('easter-egg-active');
        
        // Show toast
        toast.classList.add('show');
        
        // Create confetti particles specifically for easter egg
        createConfetti();

        // Remove effects after a few seconds
        setTimeout(() => {
            errorCodeElement.classList.remove('easter-egg-active');
            toast.classList.remove('show');
        }, 4000);
    }

    function createConfetti() {
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'absolute';
            confetti.style.width = '10px';
            confetti.style.height = '10px';
            confetti.style.backgroundColor = ['#7C3AED', '#A855F7', '#22D3EE', '#FCD34D'][Math.floor(Math.random() * 4)];
            confetti.style.left = '50%';
            confetti.style.top = '30%';
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            confetti.style.zIndex = '99';
            confetti.style.pointerEvents = 'none';
            
            document.body.appendChild(confetti);

            const angle = Math.random() * Math.PI * 2;
            const velocity = 10 + Math.random() * 20;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity - 10;
            
            let x = window.innerWidth / 2;
            let y = window.innerHeight * 0.3;
            let time = 0;

            const animateConfetti = () => {
                time += 0.1;
                x += vx;
                y += vy + (time * 2); // gravity
                
                confetti.style.transform = `translate(${x - window.innerWidth/2}px, ${y - window.innerHeight*0.3}px) rotate(${time * 50}deg)`;
                
                if (y < window.innerHeight) {
                    requestAnimationFrame(animateConfetti);
                } else {
                    confetti.remove();
                }
            };
            
            requestAnimationFrame(animateConfetti);
        }
    }

    // 3. Ripple Effect for Buttons
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            let x = e.clientX - e.target.getBoundingClientRect().left;
            let y = e.clientY - e.target.getBoundingClientRect().top;
            
            let ripple = document.createElement('span');
            ripple.classList.add('ripple');
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });

    // 4. Interactive Particles Background
    const canvas = document.getElementById('particles-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    let particlesArray = [];
    const numberOfParticles = window.innerWidth < 768 ? 40 : 80;
    
    let mouse = {
        x: null,
        y: null,
        radius: 150
    };
    
    window.addEventListener('mousemove', function(event) {
        mouse.x = event.x;
        mouse.y = event.y;
    });

    window.addEventListener('mouseout', function() {
        mouse.x = undefined;
        mouse.y = undefined;
    });
    
    class Particle {
        constructor(x, y, directionX, directionY, size, color) {
            this.x = x;
            this.y = y;
            this.directionX = directionX;
            this.directionY = directionY;
            this.size = size;
            this.color = color;
            this.baseX = this.x;
            this.baseY = this.y;
            this.density = (Math.random() * 30) + 1;
        }
        
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false);
            ctx.fillStyle = this.color;
            ctx.fill();
        }
        
        update() {
            // Check boundaries
            if (this.x > canvas.width || this.x < 0) {
                this.directionX = -this.directionX;
            }
            if (this.y > canvas.height || this.y < 0) {
                this.directionY = -this.directionY;
            }
            
            // Mouse interaction
            let dx = mouse.x - this.x;
            let dy = mouse.y - this.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < mouse.radius) {
                const forceDirectionX = dx / distance;
                const forceDirectionY = dy / distance;
                const force = (mouse.radius - distance) / mouse.radius;
                const directionX = forceDirectionX * force * this.density * 0.6;
                const directionY = forceDirectionY * force * this.density * 0.6;
                
                this.x -= directionX;
                this.y -= directionY;
            } else {
                // Return to original behavior slowly
                if (this.x !== this.baseX) {
                    let dx = this.x - this.baseX;
                    this.x -= dx / 100;
                }
                if (this.y !== this.baseY) {
                    let dy = this.y - this.baseY;
                    this.y -= dy / 100;
                }
            }
            
            // Move particle
            this.x += this.directionX;
            this.y += this.directionY;
            this.baseX += this.directionX;
            this.baseY += this.directionY;
            
            this.draw();
        }
    }
    
    function init() {
        particlesArray = [];
        for (let i = 0; i < numberOfParticles; i++) {
            let size = (Math.random() * 2) + 1;
            let x = (Math.random() * ((innerWidth - size * 2) - (size * 2)) + size * 2);
            let y = (Math.random() * ((innerHeight - size * 2) - (size * 2)) + size * 2);
            let directionX = (Math.random() * 0.4) - 0.2;
            let directionY = (Math.random() * 0.4) - 0.2;
            
            // Assign colors matching the theme
            const colors = ['rgba(124, 58, 237, 0.4)', 'rgba(34, 211, 238, 0.4)', 'rgba(168, 85, 247, 0.4)'];
            let color = colors[Math.floor(Math.random() * colors.length)];
            
            particlesArray.push(new Particle(x, y, directionX, directionY, size, color));
        }
    }
    
    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        
        for (let i = 0; i < particlesArray.length; i++) {
            particlesArray[i].update();
        }
        connect();
    }

    // Draw lines between particles close to each other
    function connect() {
        let opacityValue = 1;
        for (let a = 0; a < particlesArray.length; a++) {
            for (let b = a; b < particlesArray.length; b++) {
                let distance = ((particlesArray[a].x - particlesArray[b].x) * (particlesArray[a].x - particlesArray[b].x))
                + ((particlesArray[a].y - particlesArray[b].y) * (particlesArray[a].y - particlesArray[b].y));
                
                if (distance < (canvas.width/7) * (canvas.height/7)) {
                    opacityValue = 1 - (distance / 20000);
                    ctx.strokeStyle = `rgba(124, 58, 237, ${opacityValue * 0.15})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(particlesArray[a].x, particlesArray[a].y);
                    ctx.lineTo(particlesArray[b].x, particlesArray[b].y);
                    ctx.stroke();
                }
            }
        }
    }
    
    window.addEventListener('resize', function() {
        canvas.width = innerWidth;
        canvas.height = innerHeight;
        init();
    });
    
    init();
    animate();
});
