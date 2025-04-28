
class MusicPlayer {
    config = {
        selectors: {
            nowPlaying: '.now-playing',
            trackArt: '.track-art',
            trackName: '.track-name',
            trackArtist: '.track-artist',
            playPauseBtn: '.playpause-track',
            nextBtn: '.next-track',
            prevBtn: '.prev-track',
            seekSlider: '.seek_slider',
            volumeSlider: '.volume_slider',
            currentTime: '.current-time',
            totalDuration: '.total-duration',
            randomIcon: '.fa-random',
            repeatIcon: '.fa-repeat',
            playlist: '#playlist',
            hamburger: '.hamburger',
            menuItems: '.menu-items',
            gainSlider: '#gainSlider',
            eqSliders: '.eq-band input[type="range"]',
            eqValues: '.eq-band span',
            presetButtons: '.eq-preset',
            compressorToggle: '#compressorToggle',
            ancToggle: '#ancToggle',
            ancStatus: '#ancStatus',
            sliderContainer: '.slider-container',
            prevSlide: '.prev-slide',
            nextSlide: '.next-slide',
            visualizer: '.eq-visualizer',
            toggleBorder: '.toggle-border',
            toggleCheckbox: '#one',
            playPauseTop: '.play-pause-top',
            upload: '#upload',
            panelHeaders: '.panel-header',
            panelContents: '.panel-content'
        },
        eqFrequencies: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
        presets: {
            thrash: [2, 4, 6, -2, -4, 0, 4, 2, 0, 0],
            death: [4, 8, 4, 0, -2, -6, 2, 6, 2, 0],
            black: [0, 2, 0, -4, -2, 0, 2, 4, 6, 4],
            doom: [10, 6, 4, 0, -2, -4, -2, 0, 0, 0],
            flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        },
        defaultTrack: {
            img: 'images/placeholder.jpg',
            name: 'Sample Track',
            artist: 'Test Artist',
            music: 'music/sample.mp3'
        },
        fallbackTrack: {
            music: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
            img: 'https://via.placeholder.com/120'
        }
    };

    constructor() {
        this.elements = this.cacheElements();
        this.state = {
            audio: new Audio(),
            index: 0,
            isPlaying: false,
            isRandom: false,
            isRepeat: false,
            timer: null,
            sourceNode: null,
            slideIndex: 0,
            isANCActive: false,
            micStream: null,
            ancNode: null
        };
        this.audioContext = null;
        this.gainNode = null;
        this.eqNodes = [];
        this.compressor = null;
        this.limiter = null;
        this.analyser = null;
        this.musicList = JSON.parse(localStorage.getItem('musicList')) || [this.config.defaultTrack];
    }

    cacheElements() {
        const elements = {};
        for (const [key, selector] of Object.entries(this.config.selectors)) {
            if (key === 'eqSliders' || key === 'eqValues' || key === 'presetButtons' || key === 'panelHeaders' || key === 'panelContents') {
                elements[key] = document.querySelectorAll(selector);
            } else {
                elements[key] = document.querySelector(selector);
                if (!elements[key]) console.warn(`Element not found: ${selector}`);
            }
        }
        return elements;
    }

    async init() {
        if (!this.elements.playPauseBtn) {
            console.error('Player UI not found');
            alert('Player failed to load: UI missing');
            return;
        }
        await this.checkFiles();
        this.setupAudioContext();
        this.loadTrack(this.state.index);
        this.renderPlaylist();
        this.setupVisualizer();
        this.setupSlider();
        this.bindEvents();
    }

    async checkFiles() {
        const testFile = async url => {
            if (url.startsWith('blob:')) return true;
            try {
                const response = await fetch(url, { method: 'HEAD' });
                return response.ok;
            } catch {
                return false;
            }
        };

        for (const track of this.musicList) {
            if (!(await testFile(track.music)) || !(await testFile(track.img))) {
                Object.assign(track, this.config.fallbackTrack);
            }
        }
        localStorage.setItem('musicList', JSON.stringify(this.musicList));
    }

    setupAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.gainNode = this.audioContext.createGain();
            this.setupEQ();
            this.setupCompressor();
            this.setupLimiter();
            this.setupAnalyser();
            this.connectAudioNodes();
        } catch (e) {
            console.error('AudioContext error:', e);
            alert('Advanced EQ and ANC not supported; using basic playback');
            this.audioContext = null;
        }
    }

    setupEQ() {
        this.eqNodes = this.config.eqFrequencies.map(freq => {
            const eq = this.audioContext.createBiquadFilter();
            eq.type = 'peaking';
            eq.frequency.value = freq;
            eq.Q.value = 1.4;
            eq.gain.value = 0;
            return eq;
        });
    }

    setupCompressor() {
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.005;
        this.compressor.release.value = 0.1;
    }

    setupLimiter() {
        this.limiter = this.audioContext.createGain();
        this.limiter.gain.value = 1;
    }

    setupAnalyser() {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
    }

    connectAudioNodes() {
        let prev = this.state.sourceNode;
        this.eqNodes.forEach(node => {
            if (prev) prev.connect(node);
            prev = node;
        });
        prev.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(this.analyser);
        if (this.state.ancNode) {
            this.analyser.connect(this.state.ancNode);
            this.state.ancNode.connect(this.audioContext.destination);
        } else {
            this.analyser.connect(this.audioContext.destination);
        }
    }

    async setupANC() {
        if (this.state.isANCActive) {
            this.stopANC();
            return;
        }

        try {
            this.state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micSource = this.audioContext.createMediaStreamSource(this.state.micStream);

            // Low-pass filter for <800 Hz (ANC is best for low frequencies)
            const lowPass = this.audioContext.createBiquadFilter();
            lowPass.type = 'lowpass';
            lowPass.frequency.value = 800;

            // Invert phase for destructive interference
            const inverter = this.audioContext.createGain();
            inverter.gain.value = -1;

            // Gain to balance ANC signal
            const ancGain = this.audioContext.createGain();
            ancGain.gain.value = 0.5; // Adjustable for tuning

            micSource.connect(lowPass);
            lowPass.connect(inverter);
            inverter.connect(ancGain);

            this.state.ancNode = ancGain;
            this.connectAudioNodes();

            this.state.isANCActive = true;
            this.elements.ancToggle.classList.add('active');
            this.elements.ancToggle.textContent = 'Disable ANC';
            this.elements.ancStatus.textContent = 'ANC: On';
        } catch (e) {
            console.error('ANC setup error:', e);
            this.elements.ancStatus.textContent = 'ANC: Permission denied or unavailable';
            alert('ANC failed: Microphone access denied or unavailable');
        }
    }

    stopANC() {
        if (this.state.micStream) {
            this.state.micStream.getTracks().forEach(track => track.stop());
            this.state.micStream = null;
        }
        if (this.state.ancNode) {
            this.state.ancNode.disconnect();
            this.state.ancNode = null;
        }
        this.connectAudioNodes();
        this.state.isANCActive = false;
        this.elements.ancToggle.classList.remove('active');
        this.elements.ancToggle.textContent = 'Enable ANC';
        this.elements.ancStatus.textContent = 'ANC: Off';
    }

    setupVisualizer() {
        if (!this.analyser || !this.elements.visualizer) return;
        const canvas = this.elements.visualizer;
        canvas.width = 300;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        const draw = () => {
            const data = new Float32Array(this.analyser.frequencyBinCount);
            this.analyser.getFloatFrequencyData(data);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'var(--red)';
            const binWidth = canvas.width / this.config.eqFrequencies.length;
            this.config.eqFrequencies.forEach((freq, i) => {
                const bin = Math.round((freq / 22050) * this.analyser.frequencyBinCount);
                const value = data[bin] + 100;
                const height = (value / 100) * canvas.height;
                ctx.fillRect(i * binWidth, canvas.height - height, binWidth - 2, height);
            });
            requestAnimationFrame(draw);
        };
        draw();
    }

    setupSlider() {
        if (!this.elements.sliderContainer) return;
        this.updateSlider();
        setInterval(() => {
            this.state.slideIndex = (this.state.slideIndex + 1) % this.elements.sliderContainer.children.length;
            this.updateSlider();
        }, 3000);
    }

    updateSlider() {
        this.elements.sliderContainer.style.transform = `translateX(-${this.state.slideIndex * 125}px)`;
    }

    loadTrack(index) {
        clearInterval(this.state.timer);
        this.resetUI();

        const track = this.musicList[index];
        if (!track || !track.music || !track.img) {
            console.error('Invalid track:', track);
            alert('Track load failed');
            return;
        }

        try {
            this.state.audio.src = track.music;
            this.state.audio.load();
        } catch (e) {
            console.error('Audio load error:', e);
            alert('Audio file error: ' + track.name);
            return;
        }

        if (this.state.sourceNode) this.state.sourceNode.disconnect();
        if (this.audioContext) {
            this.state.sourceNode = this.audioContext.createMediaElementSource(this.state.audio);
            this.state.sourceNode.connect(this.eqNodes[0]);
        }

        this.elements.trackArt.style.backgroundImage = `url(${track.img})`;
        this.elements.trackName.textContent = track.name;
        this.elements.trackArtist.textContent = track.artist;
        this.elements.nowPlaying.textContent = `Playing ${index + 1} of ${this.musicList.length}`;

        this.state.timer = setInterval(() => this.updateProgress(), 1000);
        this.state.audio.addEventListener('ended', () => this.nextTrack(), { once: true });
    }

    renderPlaylist() {
        const playlist = this.elements.playlist;
        if (!playlist) return;
        playlist.innerHTML = this.musicList.map((track, index) => `
            <li class="loader" data-index="${index}" role="button" aria-label="Play ${track.name}">
                <div class="song">
                    <p class="name">${track.name}</p>
                    <p class="artist">${track.artist}</p>
                </div>
                <div class="albumcover" style="background-image: url(${track.img})"></div>
                <div class="${this.state.index === index ? 'loading' : 'play'}">
                    ${this.state.index === index ? '<div class="load"></div>'.repeat(4) : ''}
                </div>
            </li>
        `).join('');
        playlist.querySelectorAll('.loader').forEach(item => {
            item.addEventListener('click', () => {
                this.state.index = parseInt(item.dataset.index);
                this.loadTrack(this.state.index);
                this.playTrack();
            });
        });
    }

    resetUI() {
        this.elements.currentTime.textContent = '00:00';
        this.elements.totalDuration.textContent = '00:00';
        this.elements.seekSlider.value = 0;
    }

    playTrack() {
        try {
            this.state.audio.play().catch(e => {
                console.error('Play error:', e);
                alert('Playback failed');
            });
            this.state.isPlaying = true;
            this.elements.trackArt.classList.add('rotate');
            this.elements.playPauseBtn.innerHTML = '<i class="fa fa-pause-circle fa-3x"></i>';
            this.renderPlaylist();
            this.updateToggleState();
        } catch (e) {
            console.error('Play failed:', e);
        }
    }

    pauseTrack() {
        try {
            this.state.audio.pause();
            this.state.isPlaying = false;
            this.elements.trackArt.classList.remove('rotate');
            this.elements.playPauseBtn.innerHTML = '<i class="fa fa-play-circle fa-3x"></i>';
            this.renderPlaylist();
            this.updateToggleState();
        } catch (e) {
            console.error('Pause failed:', e);
        }
    }

    nextTrack() {
        if (this.state.isRepeat) {
            this.loadTrack(this.state.index);
            this.playTrack();
        } else {
            this.state.index = this.state.isRandom
                ? Math.floor(Math.random() * this.musicList.length)
                : (this.state.index + 1) % this.musicList.length;
            this.loadTrack(this.state.index);
            this.playTrack();
        }
    }

    prevTrack() {
        this.state.index = (this.state.index - 1 + this.musicList.length) % this.musicList.length;
        this.loadTrack(this.state.index);
        this.playTrack();
    }

    seekTo() {
        if (!isNaN(this.state.audio.duration)) {
            this.state.audio.currentTime = this.state.audio.duration * (this.elements.seekSlider.value / 100);
        }
    }

    setVolume() {
        this.state.audio.volume = this.elements.volumeSlider.value / 100;
    }

    updateProgress() {
        if (!isNaN(this.state.audio.duration)) {
            const progress = (this.state.audio.currentTime / this.state.audio.duration) * 100;
            this.elements.seekSlider.value = progress;
            const formatTime = time => {
                const minutes = String(Math.floor(time / 60)).padStart(2, '0');
                const seconds = String(Math.floor(time % 60)).padStart(2, '0');
                return `${minutes}:${seconds}`;
            };
            this.elements.currentTime.textContent = formatTime(this.state.audio.currentTime);
            this.elements.totalDuration.textContent = formatTime(this.state.audio.duration);
        }
    }

    toggleRandom() {
        this.state.isRandom = !this.state.isRandom;
        this.updateToggleState();
    }

    toggleRepeat() {
        this.state.isRepeat = !this.state.isRepeat;
        this.updateToggleState();
    }

    updateToggleState() {
        this.elements.toggleBorder.classList.toggle('active', this.state.isPlaying);
        this.elements.toggleCheckbox.checked = this.state.isPlaying;
        this.elements.playPauseTop.classList.toggle('active', this.state.isPlaying);
        this.elements.playPauseTop.textContent = this.state.isPlaying ? 'Pause' : 'Play';
        this.elements.randomIcon.parentElement.classList.toggle('active', this.state.isRandom);
        this.elements.repeatIcon.parentElement.classList.toggle('active', this.state.isRepeat);
    }

    toggleMenu() {
        const isOpen = this.elements.menuItems.classList.toggle('active');
        this.elements.hamburger.setAttribute('aria-expanded', isOpen);
    }

    async loadTrackFromUpload(input) {
        const file = input.files[0];
        if (!file || !file.type.startsWith('audio/mp3')) {
            console.error('Invalid file');
            alert('Select a valid .mp3 file');
            return;
        }

        try {
            const url = URL.createObjectURL(file);
            const track = {
                img: 'images/placeholder.jpg',
                name: file.name,
                artist: 'Uploaded',
                music: url
            };
            this.musicList.push(track);
            localStorage.setItem('musicList', JSON.stringify(this.musicList));
            this.state.index = this.musicList.length - 1;
            this.loadTrack(this.state.index);
            this.playTrack();
            this.renderPlaylist();
            if (window.showSaveFilePicker) await this.saveToFileSystem(file);
        } catch (e) {
            console.error('Upload error:', e);
            alert('Failed to process file');
        }
    }

    async saveToFileSystem(file) {
        if (!window.showSaveFilePicker) return;
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: file.name,
                types: [{ description: 'MP3 Files', accept: { 'audio/mpeg': ['.mp3'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(file);
            await writable.close();
        } catch (e) {
            console.error('Filesystem save error:', e);
            alert('Failed to save file to filesystem');
        }
    }

    setGain(value) {
        if (this.gainNode) {
            this.gainNode.gain.value = parseFloat(value);
            this.elements.gainSlider.setAttribute('aria-valuenow', value);
        }
    }

    setEQ(value, index) {
        if (this.eqNodes[index]) {
            this.eqNodes[index].gain.value = parseFloat(value);
            this.elements.eqSliders[index].setAttribute('aria-valuenow', value);
            this.elements.eqValues[index].textContent = value;
        }
    }

    toggleCompressor() {
        if (!this.compressor) return;
        if (this.elements.compressorToggle.checked) {
            this.eqNodes[this.eqNodes.length - 1].disconnect();
            this.eqNodes[this.eqNodes.length - 1].connect(this.compressor);
        } else {
            this.eqNodes[this.eqNodes.length - 1].disconnect();
            this.eqNodes[this.eqNodes.length - 1].connect(this.limiter);
        }
    }

    applyPreset(presetName) {
        const preset = this.config.presets[presetName];
        if (!preset) {
            console.error('Preset not found:', presetName);
            return;
        }
        preset.forEach((value, index) => {
            this.setEQ(value, index);
            this.elements.eqSliders[index].value = value;
        });
        this.elements.presetButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === presetName);
        });
    }

    togglePanel(index) {
        const content = this.elements.panelContents[index];
        const isActive = content.classList.toggle('active');
        content.style.display = isActive ? 'block' : 'none';
    }

    bindEvents() {
        const bind = (element, event, handler) => {
            if (element) element.addEventListener(event, handler);
        };

        bind(this.elements.playPauseBtn, 'click', () => this.state.isPlaying ? this.pauseTrack() : this.playTrack());
        bind(this.elements.nextBtn, 'click', () => this.nextTrack());
        bind(this.elements.prevBtn, 'click', () => this.prevTrack());
        bind(this.elements.seekSlider, 'input', () => this.seekTo());
        bind(this.elements.volumeSlider, 'input', () => this.setVolume());
        bind(this.elements.randomIcon, 'click', () => this.toggleRandom());
        bind(this.elements.repeatIcon, 'click', () => this.toggleRepeat());
        bind(this.elements.hamburger, 'click', () => this.toggleMenu());
        bind(this.elements.upload, 'change', e => this.loadTrackFromUpload(e.target));
        bind(this.elements.gainSlider, 'input', e => this.setGain(e.target.value));
        bind(this.elements.compressorToggle, 'change', () => this.toggleCompressor());
        bind(this.elements.ancToggle, 'click', () => this.setupANC());

        this.elements.eqSliders.forEach((slider, index) => {
            slider.addEventListener('input', () => this.setEQ(slider.value, index));
        });

        this.elements.presetButtons.forEach(button => {
            button.addEventListener('click', () => this.applyPreset(button.dataset.preset));
        });

        this.elements.panelHeaders.forEach((header, index) => {
            header.addEventListener('click', () => this.togglePanel(index));
        });

        bind(this.elements.prevSlide, 'click', () => {
            this.state.slideIndex = (this.state.slideIndex - 1 + this.elements.sliderContainer.children.length) % this.elements.sliderContainer.children.length;
            this.updateSlider();
        });

        bind(this.elements.nextSlide, 'click', () => {
            this.state.slideIndex = (this.state.slideIndex + 1) % this.elements.sliderContainer.children.length;
            this.updateSlider();
        });

        bind(this.elements.toggleBorder, 'click', () => this.state.isPlaying ? this.pauseTrack() : this.playTrack());
        bind(this.elements.playPauseTop, 'click', () => this.state.isPlaying ? this.pauseTrack() : this.playTrack());

        document.addEventListener('keydown', e => {
            if (e.code === 'Space' && !e.target.closest('.panel-content')) {
                e.preventDefault();
                this.state.isPlaying ? this.pauseTrack() : this.playTrack();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await new MusicPlayer().init();
    } catch (e) {
        console.error('Init error:', e);
        alert('Player error. Check Console.');
    }
});
