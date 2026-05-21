/**
 * 水墨粒子 — 墨滴入纸
 * 使用 #cosmos canvas（在 #time-portal 内）
 */
const Starfield = {
    canvas: null,
    ctx: null,
    particles: [],
    mouseX: 0, mouseY: 0,
    mouseActive: false,
    mouseTimeout: null,
    animId: null,
    W: 0, H: 0,
    time: 0,

    init() {
        this.canvas = document.getElementById('cosmos');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.createParticles();
        this.animate();

        window.addEventListener('resize', () => this.resize());
        document.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
            this.mouseActive = true;
            clearTimeout(this.mouseTimeout);
            this.mouseTimeout = setTimeout(() => { this.mouseActive = false; }, 2000);
        });
    },

    resize() {
        this.W = this.canvas.width = window.innerWidth;
        this.H = this.canvas.height = window.innerHeight;
    },

    createParticles() {
        const count = Math.floor((this.W * this.H) / 2800);
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push(new CosmicParticle(this.W, this.H));
        }
    },

    animate() {
        this.ctx.fillStyle = 'rgba(245,240,230,0.025)';
        this.ctx.fillRect(0, 0, this.W, this.H);

        const cx = this.W / 2, cy = this.H / 2;
        const t = this.time * 0.012;

        this.particles.forEach(p => {
            if (this.mouseActive) {
                const dx = p.x - this.mouseX, dy = p.y - this.mouseY;
                const dist = Math.sqrt(dx * dx + dy * dy) + 1;
                if (dist < 120) {
                    const force = (120 - dist) / 120 * 0.018;
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
            }
            p.update(this.W, this.H);
            p.draw(this.ctx);
        });

        this.drawConstellations();

        const corners = [
            { x: this.W * 0.15, y: this.H * 0.15 },
            { x: this.W * 0.85, y: this.H * 0.15 },
            { x: this.W * 0.15, y: this.H * 0.85 },
            { x: this.W * 0.85, y: this.H * 0.85 }
        ];
        corners.forEach((c, i) => {
            this.ctx.beginPath();
            this.ctx.moveTo(c.x, c.y);
            const cpX = cx + Math.sin(t + i * 1.5) * 100;
            const cpY = cy + Math.cos(t + i * 1.5) * 100;
            this.ctx.quadraticCurveTo(cpX, cpY, cx, cy);
            const a = 0.025 + Math.sin(t * 1.5 + i) * 0.015;
            this.ctx.strokeStyle = `rgba(58,54,50,${a})`;
            this.ctx.lineWidth = 0.6;
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(58,54,50,${0.08 + Math.sin(t * 2 + i) * 0.05})`;
            this.ctx.fill();
        });

        const hubPulse = 0.02 + Math.sin(t * 2) * 0.01;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 90, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(58,54,50,${hubPulse})`;
        this.ctx.lineWidth = 0.8;
        this.ctx.stroke();

        this.time++;
        this.animId = requestAnimationFrame(() => this.animate());
    },

    drawConstellations() {
        const maxDist = 90;
        for (let i = 0; i < this.particles.length; i++) {
            let connections = 0;
            for (let j = i + 1; j < this.particles.length && connections < 2; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < maxDist) {
                    const alpha = (1 - dist / maxDist) * 0.05;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.strokeStyle = `rgba(58,54,50,${alpha})`;
                    this.ctx.lineWidth = 0.4;
                    this.ctx.stroke();
                    connections++;
                }
            }
        }
    },

    burst(cx, cy, strength) {
        this.particles.forEach(p => {
            const dx = p.x - cx, dy = p.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1;
            p.vx += (dx / dist) * (Math.random() * strength + strength * 0.3);
            p.vy += (dy / dist) * (Math.random() * strength + strength * 0.3);
            p.spin *= 2;
        });
    },
};

class CosmicParticle {
    constructor(W, H) {
        this.W = W; this.H = H;
        this.reset();
    }
    reset() {
        this.x = Math.random() * this.W;
        this.y = Math.random() * this.H;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.life = Math.random() * 500 + 250;
        this.maxLife = this.life;
        this.size = Math.random() * 3 + 0.5;
        this.gray = Math.random() * 60 + 20;
        this.angle = Math.random() * Math.PI * 2;
        this.spin = (Math.random() - 0.5) * 0.01;
        this.pulse = Math.random() * Math.PI * 2;
        this.pulseSpeed = 0.015 + Math.random() * 0.025;
    }
    update() {
        const cx = this.W / 2, cy = this.H / 2;
        const dx = this.x - cx, dy = this.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const angle = Math.atan2(dy, dx);

        const corners = [
            { x: this.W * 0.15, y: this.H * 0.15, strength: 0.0002 },
            { x: this.W * 0.85, y: this.H * 0.15, strength: 0.0002 },
            { x: this.W * 0.15, y: this.H * 0.85, strength: 0.0002 },
            { x: this.W * 0.85, y: this.H * 0.85, strength: 0.0002 }
        ];
        corners.forEach(c => {
            const cdx = c.x - this.x, cdy = c.y - this.y;
            const cdist = Math.sqrt(cdx * cdx + cdy * cdy) + 140;
            this.vx += (cdx / cdist) * c.strength * dist;
            this.vy += (cdy / cdist) * c.strength * dist;
        });

        const centerForce = 0.0006 * (160 / (dist + 60));
        this.vx -= (dx / dist) * centerForce;
        this.vy -= (dy / dist) * centerForce;

        this.vx += -Math.sin(angle) * 0.0002 * dist;
        this.vy += Math.cos(angle) * 0.0002 * dist;

        this.vx *= 0.993; this.vy *= 0.993;
        this.x += this.vx; this.y += this.vy;
        this.angle += this.spin;
        this.pulse += this.pulseSpeed;
        this.life--;

        if (this.life <= 0 || this.x < -60 || this.x > this.W + 60 || this.y < -60 || this.y > this.H + 60) {
            this.reset();
        }
    }
    draw(ctx) {
        const lifeRatio = this.life / this.maxLife;
        const alpha = lifeRatio * (0.3 + Math.sin(this.pulse) * 0.1);
        const currentSize = this.size * (0.7 + Math.sin(this.pulse) * 0.15);

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.beginPath();
        ctx.moveTo(-currentSize, 0);
        ctx.lineTo(currentSize, 0);
        ctx.moveTo(0, -currentSize);
        ctx.lineTo(0, currentSize);
        ctx.strokeStyle = `rgba(${this.gray + 20},${this.gray + 18},${this.gray + 15},${alpha * 0.6})`;
        ctx.lineWidth = currentSize * 0.3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, currentSize * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${this.gray + 30},${this.gray + 28},${this.gray + 25},${alpha})`;
        ctx.fill();

        ctx.restore();
    }
}
