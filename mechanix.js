/* ═══════════════════════════════════════════════════════
   METAL MACHINE — mechanix.js
   Full Audio Engine + Visualizers + UI Controller
   ═══════════════════════════════════════════════════════ */

class MetalMachine {
    static EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    static EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
    static PRESETS = {
        thrash: [2, 4, 6, -2, -4, 0, 4, 2, 0, 0],
        death: [4, 8, 4, 0, -2, -6, 2, 6, 2, 0],
        black: [0, 2, 0, -4, -2, 0, 2, 4, 6, 4],
        doom: [10, 6, 4, 0, -2, -4, -2, 0, 0, 0],
        flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    static TRACKS = [
        { name: 'Artcell - Pathor Bagan', artist: 'Artcell', img: 'images/Artcell.jpg', music: 'music/Artcell - Pathor Bagan.mp3' },
        { name: 'Faded', artist: 'Alan Walker', img: 'images/stay.png', music: 'music/Faded.mp3' },
        { name: 'Fear of the Dark', artist: 'Iron Maiden', img: 'images/fear-of-the-dark-wallpapers.jpg', music: 'music/Fear of the Dark.mp3' },
        { name: 'November Rain', artist: "Guns N' Roses", img: 'images/guns n roses.png', music: 'music/November Rain.mp3' },
        { name: 'Walk', artist: 'Pantera', img: 'images/Walk_(song).jpg', music: 'music/Pantera-Walk-v4.mp3' },
        { name: 'Rather Be', artist: 'Clean Bandit', img: 'images/ratherbe.jpg', music: 'music/Rather Be.mp3' }
    ];

    constructor() {
        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.volume = 0.8;

        this.trackIndex = 0;
        this.isPlaying = false;
        this.isShuffle = false;
        this.isRepeat = false;

        this.audioCtx = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.eqNodes = [];
        this.compressor = null;
        this.analyser = null;
        this.overdriveNode = null;
        this.isOverdrive = false;

        this.isANC = false;
        this.micStream = null;
        this.ancNodes = null;

        this.musicList = [...MetalMachine.TRACKS];
        this.animFrameId = null;
        this.bgAnimFrameId = null;
    }

    /* ── Init ──────────────────────────────── */
    async init() {
        this.cacheDOM();
        this.buildEQBands();
        this.loadTrack(this.trackIndex);
        this.renderPlaylist();
        this.bindEvents();
        this.startBgVisualizer();
    }

    cacheDOM() {
        const $ = s => document.querySelector(s);
        const $$ = s => document.querySelectorAll(s);

        this.dom = {
            nowPlaying: $('.now-playing-text'),
            nowIndicator: $('.now-playing-indicator'),
            vinyl: $('.vinyl-disc'),
            vinylGlow: $('.vinyl-glow'),
            trackArt: $('.track-art'),
            trackName: $('.track-name'),
            trackArtist: $('.track-artist'),
            seekSlider: $('.seek_slider'),
            progressFill: $('.progress-fill'),
            currentTime: $('.current-time'),
            totalDuration: $('.total-duration'),
            volumeSlider: $('.volume_slider'),
            volumeFill: $('.volume-fill'),
            volumeBtn: $('.volume-btn'),
            btnPlay: $('#btn-play'),
            btnPrev: $('#btn-prev'),
            btnNext: $('#btn-next'),
            btnShuffle: $('#btn-shuffle'),
            btnRepeat: $('#btn-repeat'),
            playlist: $('#playlist'),
            trackCount: $('.track-count'),
            dropZone: $('#dropZone'),
            uploadInput: $('#upload'),
            eqCanvas: $('#eqCanvas'),
            bgCanvas: $('#bg-visualizer'),
            gainSlider: $('#gainSlider'),
            gainValue: $('.gain-value'),
            compressorToggle: $('#compressorToggle'),
            overdriveToggle: $('#overdriveToggle'),
            ancToggle: $('#ancToggle'),
            ancStatus: $('#ancStatus'),
            presetBtns: $$('.eq-preset'),
            menuLinks: $$('.menu-link'),
            hamburger: $('.hamburger'),
            menuItems: $('.menu-items'),
        };
    }

    /* ── Audio Context Setup ───────────────── */
    initAudioContext() {
        if (this.audioCtx) return;
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

            // Gain
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = 1;

            // EQ
            this.eqNodes = MetalMachine.EQ_FREQS.map(freq => {
                const f = this.audioCtx.createBiquadFilter();
                f.type = 'peaking';
                f.frequency.value = freq;
                f.Q.value = 1.4;
                f.gain.value = 0;
                return f;
            });

            // Compressor
            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.value = -24;
            this.compressor.ratio.value = 4;
            this.compressor.attack.value = 0.005;
            this.compressor.release.value = 0.1;

            // Overdrive (waveshaper)
            this.overdriveNode = this.audioCtx.createWaveShaper();
            this.overdriveNode.oversample = '4x';
            this.setOverdriveCurve(0); // off by default

            // Analyser
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.82;

            this.connectChain();
            this.startEQVisualizer();
        } catch (e) {
            console.error('AudioContext init error:', e);
        }
    }

    connectChain() {
        // Disconnect everything first
        try { this.sourceNode.disconnect(); } catch { }

        let prev = this.sourceNode;

        // source -> gain
        prev.connect(this.gainNode);
        prev = this.gainNode;

        // gain -> EQ chain
        this.eqNodes.forEach(node => {
            prev.connect(node);
            prev = node;
        });

        // EQ -> compressor (if enabled)
        if (this.dom.compressorToggle.checked) {
            prev.connect(this.compressor);
            prev = this.compressor;
        }

        // -> overdrive (if enabled)
        if (this.isOverdrive) {
            prev.connect(this.overdriveNode);
            prev = this.overdriveNode;
        }

        // -> analyser -> destination
        prev.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
    }

    setOverdriveCurve(amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            if (amount === 0) {
                curve[i] = x;
            } else {
                curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
            }
        }
        this.overdriveNode.curve = curve;
    }

    /* ── EQ Band UI ────────────────────────── */
    buildEQBands() {
        const container = document.getElementById('eqBands');
        container.innerHTML = MetalMachine.EQ_FREQS.map((freq, i) => `
            <div class="eq-band">
                <label>${MetalMachine.EQ_LABELS[i]}</label>
                <input type="range" min="-24" max="24" value="0" step="0.5"
                    data-index="${i}" orient="vertical" aria-label="${MetalMachine.EQ_LABELS[i]} Hz">
                <span class="eq-val">0</span>
            </div>
        `).join('');
    }

    /* ── Track Loading ─────────────────────── */
    loadTrack(index) {
        const track = this.musicList[index];
        if (!track) return;

        this.audio.src = track.music;
        this.audio.load();

        this.dom.trackArt.style.backgroundImage = `url('${track.img}')`;
        this.dom.trackName.textContent = track.name;
        this.dom.trackArtist.textContent = track.artist;
        this.dom.nowPlaying.textContent = `PLAYING ${index + 1} OF ${this.musicList.length}`;
        this.dom.seekSlider.value = 0;
        this.dom.progressFill.style.width = '0%';
        this.dom.currentTime.textContent = '00:00';
        this.dom.totalDuration.textContent = '00:00';
    }

    /* ── Playback ──────────────────────────── */
    async play() {
        this.initAudioContext();
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

        try {
            await this.audio.play();
            this.isPlaying = true;
            this.dom.btnPlay.innerHTML = '<i class="fas fa-pause"></i>';
            this.dom.vinyl.classList.add('spinning');
            this.dom.nowIndicator.classList.remove('paused');
            this.renderPlaylist();
        } catch (e) {
            console.error('Playback error:', e);
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.dom.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
        this.dom.vinyl.classList.remove('spinning');
        this.dom.nowIndicator.classList.add('paused');
        this.renderPlaylist();
    }

    togglePlay() {
        this.isPlaying ? this.pause() : this.play();
    }

    next() {
        if (this.isRepeat) {
            this.loadTrack(this.trackIndex);
        } else if (this.isShuffle) {
            this.trackIndex = Math.floor(Math.random() * this.musicList.length);
            this.loadTrack(this.trackIndex);
        } else {
            this.trackIndex = (this.trackIndex + 1) % this.musicList.length;
            this.loadTrack(this.trackIndex);
        }
        this.play();
    }

    prev() {
        // If more than 3 seconds in, restart
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        this.trackIndex = (this.trackIndex - 1 + this.musicList.length) % this.musicList.length;
        this.loadTrack(this.trackIndex);
        this.play();
    }

    /* ── Progress & Volume ────────────────── */
    updateProgress() {
        if (!isNaN(this.audio.duration) && this.audio.duration > 0) {
            const pct = (this.audio.currentTime / this.audio.duration) * 100;
            this.dom.seekSlider.value = pct;
            this.dom.progressFill.style.width = pct + '%';
            this.dom.currentTime.textContent = this.fmtTime(this.audio.currentTime);
            this.dom.totalDuration.textContent = this.fmtTime(this.audio.duration);
        }
    }

    seekTo(val) {
        if (!isNaN(this.audio.duration)) {
            this.audio.currentTime = this.audio.duration * (val / 100);
        }
    }

    setVolume(val) {
        this.audio.volume = val / 100;
        this.dom.volumeFill.style.width = val + '%';
        const icon = this.dom.volumeBtn.querySelector('i');
        if (val == 0) icon.className = 'fas fa-volume-mute';
        else if (val < 50) icon.className = 'fas fa-volume-down';
        else icon.className = 'fas fa-volume-up';
    }

    fmtTime(s) {
        const m = String(Math.floor(s / 60)).padStart(2, '0');
        const sec = String(Math.floor(s % 60)).padStart(2, '0');
        return `${m}:${sec}`;
    }

    /* ── Playlist ──────────────────────────── */
    renderPlaylist() {
        const pl = this.dom.playlist;
        this.dom.trackCount.textContent = `${this.musicList.length} tracks`;

        pl.innerHTML = this.musicList.map((t, i) => {
            const isActive = i === this.trackIndex;
            return `
                <li class="playlist-item${isActive ? ' active' : ''}" data-index="${i}">
                    <span class="pl-num">${i + 1}</span>
                    <div class="pl-art" style="background-image:url('${t.img}')"></div>
                    <div class="pl-info">
                        <div class="pl-name">${t.name}</div>
                        <div class="pl-artist">${t.artist}</div>
                    </div>
                    ${isActive && this.isPlaying ? `
                        <div class="pl-bars">
                            <span></span><span></span><span></span>
                        </div>` : ''}
                </li>`;
        }).join('');

        pl.querySelectorAll('.playlist-item').forEach(item => {
            item.addEventListener('click', () => {
                this.trackIndex = parseInt(item.dataset.index);
                this.loadTrack(this.trackIndex);
                this.play();
            });
        });
    }

    /* ── File Upload / Drag-Drop ───────────── */
    handleFiles(files) {
        for (const file of files) {
            if (!file.type.startsWith('audio/')) continue;
            const url = URL.createObjectURL(file);
            const name = file.name.replace(/\.[^/.]+$/, '');
            this.musicList.push({
                name,
                artist: 'Uploaded',
                img: 'images/pngimg.com - rock_music_PNG30.png',
                music: url
            });
        }
        this.renderPlaylist();
    }

    /* ── EQ ─────────────────────────────────── */
    setEQ(index, value) {
        if (this.eqNodes[index]) {
            this.eqNodes[index].gain.value = parseFloat(value);
        }
    }

    applyPreset(name) {
        const preset = MetalMachine.PRESETS[name];
        if (!preset) return;

        const sliders = document.querySelectorAll('.eq-band input[type="range"]');
        const vals = document.querySelectorAll('.eq-band .eq-val');
        preset.forEach((v, i) => {
            if (sliders[i]) { sliders[i].value = v; }
            if (vals[i]) { vals[i].textContent = v; }
            this.setEQ(i, v);
        });

        this.dom.presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === name));
    }

    /* ── ANC ────────────────────────────────── */
    async toggleANC() {
        if (this.isANC) {
            if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
            this.isANC = false;
            this.dom.ancToggle.classList.remove('active');
            this.dom.ancStatus.textContent = 'Off';
            if (this.audioCtx) this.connectChain();
            return;
        }

        try {
            this.initAudioContext();
            this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micSrc = this.audioCtx.createMediaStreamSource(this.micStream);
            const lp = this.audioCtx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 800;
            const inv = this.audioCtx.createGain();
            inv.gain.value = -0.6;
            micSrc.connect(lp);
            lp.connect(inv);
            inv.connect(this.audioCtx.destination);

            this.isANC = true;
            this.dom.ancToggle.classList.add('active');
            this.dom.ancStatus.textContent = 'On';
        } catch (e) {
            console.error('ANC error:', e);
            this.dom.ancStatus.textContent = 'Denied';
        }
    }

    /* ── EQ Visualizer ─────────────────────── */
    startEQVisualizer() {
        if (!this.analyser || !this.dom.eqCanvas) return;
        const canvas = this.dom.eqCanvas;
        const ctx = canvas.getContext('2d');

        const resize = () => {
            canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
            canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
            ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        };
        resize();
        window.addEventListener('resize', resize);

        const data = new Uint8Array(this.analyser.frequencyBinCount);

        const draw = () => {
            this.animFrameId = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(data);

            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            ctx.clearRect(0, 0, w, h);

            const barCount = 64;
            const barW = w / barCount - 1;
            const step = Math.floor(data.length / barCount);

            for (let i = 0; i < barCount; i++) {
                const val = data[i * step] / 255;
                const barH = val * h * 0.9;

                // gradient color from red to orange
                const hue = 0 + val * 25;
                ctx.fillStyle = `hsla(${hue}, 100%, ${45 + val * 20}%, ${0.6 + val * 0.4})`;
                ctx.fillRect(i * (barW + 1), h - barH, barW, barH);

                // top glow line
                ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${val * 0.8})`;
                ctx.fillRect(i * (barW + 1), h - barH - 2, barW, 2);
            }
        };
        draw();
    }

    /* ── Background Visualizer ─────────────── */
    startBgVisualizer() {
        const canvas = this.dom.bgCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        // Particle system
        const particles = [];
        const PARTICLE_COUNT = 80;

        class Particle {
            constructor() { this.reset(); }
            reset() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.vx = (Math.random() - 0.5) * 0.3;
                this.vy = (Math.random() - 0.5) * 0.3;
                this.r = Math.random() * 2 + 0.5;
                this.life = 1;
                this.decay = Math.random() * 0.003 + 0.001;
            }
            update(energy) {
                this.x += this.vx + (Math.random() - 0.5) * energy * 2;
                this.y += this.vy + (Math.random() - 0.5) * energy * 2;
                this.life -= this.decay;
                if (this.life <= 0 || this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
                    this.reset();
                }
            }
            draw(ctx, energy) {
                const alpha = this.life * (0.3 + energy * 0.5);
                const hue = energy > 0.4 ? 15 : 0;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r + energy * 3, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${alpha})`;
                ctx.fill();
            }
        }

        for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

        const drawBg = () => {
            this.bgAnimFrameId = requestAnimationFrame(drawBg);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Get energy from analyser if available
            let energy = 0;
            if (this.analyser && this.isPlaying) {
                const d = new Uint8Array(this.analyser.frequencyBinCount);
                this.analyser.getByteFrequencyData(d);
                // Use bass energy (first 10 bins)
                let sum = 0;
                for (let i = 0; i < 10; i++) sum += d[i];
                energy = sum / (10 * 255);
            }

            particles.forEach(p => {
                p.update(energy);
                p.draw(ctx, energy);
            });

            // Draw connecting lines between nearby particles
            ctx.strokeStyle = `rgba(255, 34, 34, ${0.02 + energy * 0.04})`;
            ctx.lineWidth = 0.5;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }
            }
        };
        drawBg();
    }

    /* ── Panel Navigation ─────────────────── */
    showPanel(name) {
        document.querySelectorAll('.glass-panel').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(`panel-${name}`);
        if (target) target.classList.add('active');

        this.dom.menuLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.panel === name);
        });

        // Close mobile menu
        this.dom.menuItems.classList.remove('active');
    }

    /* ── Event Binding ─────────────────────── */
    bindEvents() {
        // Playback
        this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
        this.dom.btnNext.addEventListener('click', () => this.next());
        this.dom.btnPrev.addEventListener('click', () => this.prev());
        this.dom.btnShuffle.addEventListener('click', () => {
            this.isShuffle = !this.isShuffle;
            this.dom.btnShuffle.classList.toggle('active', this.isShuffle);
        });
        this.dom.btnRepeat.addEventListener('click', () => {
            this.isRepeat = !this.isRepeat;
            this.dom.btnRepeat.classList.toggle('active', this.isRepeat);
        });

        // Progress
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('ended', () => this.next());
        this.dom.seekSlider.addEventListener('input', e => {
            this.seekTo(e.target.value);
            this.dom.progressFill.style.width = e.target.value + '%';
        });

        // Volume
        this.dom.volumeSlider.addEventListener('input', e => this.setVolume(e.target.value));
        this.dom.volumeBtn.addEventListener('click', () => {
            if (this.audio.volume > 0) {
                this._savedVol = this.audio.volume;
                this.setVolume(0);
                this.dom.volumeSlider.value = 0;
            } else {
                const v = (this._savedVol || 0.8) * 100;
                this.setVolume(v);
                this.dom.volumeSlider.value = v;
            }
        });

        // Upload
        this.dom.uploadInput.addEventListener('change', e => this.handleFiles(e.target.files));

        // Drag and Drop
        const dz = this.dom.dropZone;
        ['dragenter', 'dragover'].forEach(evt => {
            dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('dragover'); });
        });
        ['dragleave', 'drop'].forEach(evt => {
            dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('dragover'); });
        });
        dz.addEventListener('drop', e => {
            e.preventDefault();
            this.handleFiles(e.dataTransfer.files);
        });

        // EQ sliders
        document.getElementById('eqBands').addEventListener('input', e => {
            if (e.target.type === 'range') {
                const idx = parseInt(e.target.dataset.index);
                const val = parseFloat(e.target.value);
                this.setEQ(idx, val);
                e.target.closest('.eq-band').querySelector('.eq-val').textContent = val;
                // Clear active preset
                this.dom.presetBtns.forEach(b => b.classList.remove('active'));
            }
        });

        // Presets
        this.dom.presetBtns.forEach(btn => {
            btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
        });

        // Gain
        this.dom.gainSlider.addEventListener('input', e => {
            const v = e.target.value / 100;
            if (this.gainNode) this.gainNode.gain.value = v;
            this.dom.gainValue.textContent = v.toFixed(1);
        });

        // Compressor toggle
        this.dom.compressorToggle.addEventListener('change', () => {
            if (this.audioCtx) this.connectChain();
        });

        // Overdrive toggle
        this.dom.overdriveToggle.addEventListener('change', e => {
            this.isOverdrive = e.target.checked;
            this.setOverdriveCurve(this.isOverdrive ? 50 : 0);
            if (this.audioCtx) this.connectChain();
        });

        // ANC
        this.dom.ancToggle.addEventListener('click', () => this.toggleANC());

        // Nav
        this.dom.menuLinks.forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                this.showPanel(link.dataset.panel);
            });
        });

        // Hamburger
        this.dom.hamburger.addEventListener('click', () => {
            this.dom.menuItems.classList.toggle('active');
            this.dom.hamburger.setAttribute('aria-expanded',
                this.dom.menuItems.classList.contains('active'));
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            switch (e.code) {
                case 'Space': e.preventDefault(); this.togglePlay(); break;
                case 'ArrowRight': this.next(); break;
                case 'ArrowLeft': this.prev(); break;
            }
        });
    }
}

/* ── Bootstrap ─────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const machine = new MetalMachine();
    machine.init();
});
