/**
 * silence_ui.js — AutoEditor Pro: High-Performance Studio Engine (Version 19)
 * 
 * 1. 🔍 CRYSTAL CLEAR MODALS (ZERO BLUR):
 *    - Removed backdrop blur completely. The background video editor, player, tracks, and waveforms remain 100% sharp and visible while dialogs/modals are open.
 * 2. 🎯 ULTRA-ACCURATE N-GRAM SPEECH-TO-TIMELINE ALIGNMENT ENGINE:
 *    - Replaced single-word lookup with 3-word suffix matching + expected word count proximity penalty.
 *    - Fixes false matches on common words (e.g. "one", "the", "in", "cycles", "is") so long sentences NEVER get cut short and maintain 100% exact spoken durations.
 * 3. 📄 UNIVERSAL SCRIPT PARSER:
 *    - Seamlessly parses mixed script blocks, standalone Voiceover lines, custom filenames, and multi-scene sequences (Scene 01... Scene 60, etc.).
 * 4. 🤖 1-CLICK TIMELINE AUTO-SYNC (Script ➔ Media Sync Toolbar):
 *    - Retimes all timeline image/video clips to exact spoken scene durations with zero gaps.
 * 5. 🎙️ DUAL WAVEFORM AUDIO EDITOR & SILENCE REMOVER:
 *    - Visual waveforms before & after with instant timeline sync.
 * 6. 🎬 FULL CAPCUT MULTI-TRACK VIDEO EDITOR & EXPORT ENGINE
 */

(function() {
    'use strict';

    const API_BASE = window.location.origin || '';
    const STORAGE_KEY = 'autoeditor_pro_project_state_v19';
    const DB_NAME = 'AutoEditorFilesDB_v19';
    const STORE_NAME = 'mediaFiles';
    const GROQ_KEY_STORAGE = 'autoeditor_groq_api_key_v19';
    const GEMINI_KEY_STORAGE = 'capcut_gemini_api_key';
    const DEFAULT_GEMINI_KEY = '';
    let userGeminiApiKey = localStorage.getItem(GEMINI_KEY_STORAGE) || DEFAULT_GEMINI_KEY;
    let lastAutoSyncPackage = null;
    const DEFAULT_GROQ_KEY = '';

    // Prevent browser navigation on drag-drop
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);

    // ── Global Shared Settings ────────────────────────────────
    let activeStudioMode = 'capcut-editor'; // 'capcut-editor' | 'auto-sync' | 'video-jumpcut' | 'audio-editor'
    let isAppFullscreen = false;
    let minSilence = 0.30, silenceThreshold = -35, silencePadding = 0.05;

    // ── Auto-Sync AI Studio State ─────────────────────────────
    let autoSyncAudioFile = null;
    let autoSyncAudioUrl = null;
    let autoSyncScriptText = '';
    let autoSyncMediaFiles = []; // [{ id, file, name, type, url }]
    let autoSyncAlignedScenes = null; // [{ sceneNumber, targetFiles, voiceover, start, end, duration, matchedFileId }]
    let autoSyncIsProcessing = false;
    let userGroqApiKey = localStorage.getItem(GROQ_KEY_STORAGE) || DEFAULT_GROQ_KEY;

    // ── Auto-Sync Session & Whisper AI Cache Engine ───────────
    const AUTOSYNC_CACHE_KEY = 'autoeditor_autosync_cache_v2';

    function computeAudioFingerprint(audioFile, audioDuration) {
        if (!audioFile && !voiceoverAudio) return '';
        const name = (audioFile && audioFile.name) || (voiceoverAudio && voiceoverAudio.name) || 'audio';
        const size = (audioFile && audioFile.size) || (voiceoverAudio && voiceoverAudio.file && voiceoverAudio.file.size) || 0;
        const dur = Math.round((audioDuration || (voiceoverAudio && voiceoverAudio.duration) || 0) * 10) / 10;
        return `${name}_${size}_${dur}`;
    }

    function saveAutoSyncCache({ audioFile, audioDuration, audioFallbackUrl, whisperResult, aligned, sceneMediaMatches, scriptText }) {
        try {
            if (!aligned || !aligned.length) return;
            const fingerprint = computeAudioFingerprint(audioFile, audioDuration);
            const cachePayload = {
                version: 2,
                timestamp: Date.now(),
                dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                audioName: (audioFile && audioFile.name) || (voiceoverAudio && voiceoverAudio.name) || 'voiceover_track',
                audioDuration: audioDuration || 0,
                audioFingerprint: fingerprint,
                scriptText: scriptText || autoSyncScriptText || '',
                whisperResult: whisperResult || null,
                aligned: aligned,
                sceneMediaMatches: (sceneMediaMatches || []).map(m => ({
                    isMissing: !!m.isMissing,
                    matchTier: m.matchTier || 'serial',
                    matchedClipId: m.matchedClip ? m.matchedClip.id : null,
                    sceneNumber: m.sceneNumber
                }))
            };
            localStorage.setItem(AUTOSYNC_CACHE_KEY, JSON.stringify(cachePayload));
            const badge = document.getElementById('autosync-matrix-save-badge');
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.innerHTML = '✓ Auto-Saved ' + cachePayload.dateStr;
            }
            const aFile = audioFile || (voiceoverAudio && voiceoverAudio.file);
            if (aFile) {
                saveBatchToDB([{ id: 'audio_voiceover_track', file: aFile }]).catch(() => {});
            }
        } catch (e) {
            console.warn('Could not save AutoSync cache to localStorage:', e);
        }
    }

    function loadAutoSyncCache() {
        try {
            const raw = localStorage.getItem(AUTOSYNC_CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.aligned || !data.aligned.length) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    function clearAutoSyncCache() {
        try {
            localStorage.removeItem(AUTOSYNC_CACHE_KEY);
        } catch (e) {}
    }

    // ── Video Jump-Cut Studio State ───────────────────────────
    let vStudioFile = null;
    let vStudioResult = null;
    let vStudioIsProcessing = false;

    // ── Audio Editor Studio State ─────────────────────────────
    let aStudioFile = null;
    let aStudioOrigUrl = null;
    let aStudioOrigPeaks = [];
    let aStudioResult = null;
    let aStudioCleanFile = null;
    let aStudioCleanBlob = null;
    let aStudioCleanUrl = null;
    let aStudioCleanPeaks = [];
    let aStudioIsProcessing = false;

    // ── CapCut Editor State ───────────────────────────────────
    let mediaClips = []; // [{ id, file, name, type, url, timestampSec, serial, duration, scale, posX, posY, motion, transition, volume, speed }]
    let audioClips = []; // [{ id, file, name, url, timestampSec, duration, audioElement, waveformPeaks: [] }]
    let voiceoverAudio = null; // { file, url, duration, name, audioElement, waveformPeaks: [] }
    let selectedClipId = null;
    let selectedAudioClipId = null;
    let isAudioTrackSelected = false;
    let currentRenderedClipId = null;
    let playheadTime = 0;
    let totalTimelineDuration = 15;
    let isPlaying = false;
    let animFrameId = null;
    let lastPlayTimestamp = null;
    let timelineZoom = 1.0;
    let aspectRatio = '16:9';
    let autoCutSilenceInSync = false;
    let captionStyle = 'yellow';
    let mediaFilter = 'all';

    let captionConfig = {
        enabled: false, // Default to false so captions only appear when user clicks ✨ Auto-Captions or enables it!
        style: 'yellow-bouncy', // 'yellow-bouncy' | 'karaoke-phrase' | 'classic-sentence' | 'boxed' | 'glass'
        fontFamily: 'Montserrat', // 'Montserrat', 'DejaVu Sans', 'The Bold Font', 'Anton', 'Roboto', 'Bangers', 'Poppins', 'Arial Black'
        fontSize: 26, // px
        textColor: '#ffffff',
        highlightColor: '#facc15', // bright yellow
        strokeColor: '#000000',
        strokeWidth: 3, // px
        shadowGlow: 4, // px
        boxBgStyle: 'none', // 'none' | 'pill' | 'ribbon' | 'glass'
        pacingMode: 'phrase', // 'word' | 'phrase' | 'sentence' | 'custom'
        wordsPerPhrase: 3, // custom word count (1 to 8 words per phrase)
        maxLines: 2, // 1 = 1 Line Only (Single), 2 = Max 2 Lines, 3 = Max 3 Lines, 0 = Auto-Wrap
        boxWidthPercent: 88, // resizable width from handles (30% to 96%)
        positionX: 50, // % from left
        positionY: 82, // % from top (lower-third)
        customWordsList: [] // [{ word, start, end }]
    };

    // ── Transitions State & Engine with (Old) Labels ──
    const TRANSITIONS_MAP = {
        cut: { id: 'cut', label: 'None', icon: '⊘', xfade: null },
        fade: { id: 'fade', label: 'Crossfade (Old)', icon: '✕', xfade: 'fade' },
        wipeleft: { id: 'wipeleft', label: 'Wipe left (Old)', icon: '◀', xfade: 'wipeleft' },
        wiperight: { id: 'wiperight', label: 'Wipe right (Old)', icon: '▶', xfade: 'wiperight' },
        slideleft: { id: 'slideleft', label: 'Slide left (Old)', icon: '⇐', xfade: 'slideleft' },
        slideright: { id: 'slideright', label: 'Slide right (Old)', icon: '⇒', xfade: 'slideright' },
        circleopen: { id: 'circleopen', label: 'Circle open (Old)', icon: '◎', xfade: 'circleopen' }
    };
    let globalTransitionType = 'fade';
    let globalTransitionDuration = 0.40;
    let isRandomTransitionMix = false;

    // ── Ken Burns Motion State ──
    let globalZoomDepth = 0.08; // 8%

    // ── Captions Preset Styles (Classic, Boxed, Yellow) with (Old) Labels ──
    const CAPTION_STYLE_PRESETS = {
        classic: { id: 'classic', label: 'Classic outline (Old)', fill: '#ffffff', stroke: '#000000', boxBgStyle: 'none', strokeWidth: 3 },
        boxed: { id: 'boxed', label: 'Boxed (Old)', fill: '#ffffff', stroke: '#000000', boxBgStyle: 'pill', strokeWidth: 0 },
        yellow: { id: 'yellow', label: 'Yellow classic (Old)', fill: '#ffd400', stroke: '#000000', boxBgStyle: 'none', strokeWidth: 3 }
    };
    const CAPTION_SIZE_PRESETS = {
        sm: { id: 'sm', label: 'Small (Old) [20px]', size: 20 },
        md: { id: 'md', label: 'Medium (Old) [26px]', size: 26 },
        lg: { id: 'lg', label: 'Large (Old) [34px]', size: 34 }
    };
    let activeCaptionStyleId = 'yellow';
    let activeCaptionSizeId = 'md';

    function parseTimestampedScript(text) {
        if (!text || !text.trim()) return [];
        const lines = text.split(/\r?\n/);
        const parseTimeSec = (str) => {
            const m = String(str).match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
            if (!m) return null;
            const h = +(m[1] || 0);
            const min = +m[2];
            const sec = +m[3];
            const ms = m[4] ? +m[4].padEnd(3, '0') : 0;
            return h * 3600 + min * 60 + sec + ms / 1000;
        };

        let cues = [];

        // 1. SRT / VTT arrow format
        const arrowRegex = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
        let srtCues = [];
        let currentSrt = null;
        for (let l of lines) {
            const m = l.match(arrowRegex);
            if (m) {
                if (currentSrt && currentSrt.text.trim()) srtCues.push(currentSrt);
                currentSrt = { start: parseTimeSec(m[1]), end: parseTimeSec(m[2]), text: '' };
            } else if (currentSrt) {
                const cleanL = l.replace(/^\d+$/, '').trim();
                if (cleanL) currentSrt.text += (currentSrt.text ? ' ' : '') + cleanL;
            }
        }
        if (currentSrt && currentSrt.text.trim()) srtCues.push(currentSrt);
        if (srtCues.length > 0) cues = srtCues;

        // 2. NoteGPT range (0:03 - 0:08 Text)
        if (cues.length === 0) {
            const rangeRegex = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—]\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/;
            const rangeCues = [];
            for (let l of lines) {
                const m = l.match(rangeRegex);
                if (m) {
                    const st = parseTimeSec(m[1]);
                    const en = parseTimeSec(m[2]);
                    const txt = (m[3] || '').trim();
                    if (st != null && en != null && txt) {
                        rangeCues.push({ start: st, end: en, text: txt });
                    }
                }
            }
            if (rangeCues.length > 0) cues = rangeCues;
        }

        // 3. Bracketed / Parenthesized inline: [0:03] or (0:03)
        if (cues.length === 0) {
            const markerRegex = /[([]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*[)\]]/g;
            const markers = [];
            let match;
            while ((match = markerRegex.exec(text)) !== null) {
                markers.push({ start: parseTimeSec(match[1]), from: markerRegex.lastIndex, at: match.index });
            }
            for (let i = 0; i < markers.length; i++) {
                const nextAt = (i + 1 < markers.length) ? markers[i + 1].at : text.length;
                const txt = text.slice(markers[i].from, nextAt).replace(/\s+/g, ' ').trim();
                if (txt && markers[i].start != null) {
                    const nextStart = (i + 1 < markers.length) ? markers[i + 1].start : (markers[i].start + 3.0);
                    cues.push({ start: markers[i].start, end: nextStart, text: txt });
                }
            }
        }

        // 4. Line start timestamp: 0:03 Text...
        if (cues.length === 0) {
            const lineTsRegex = /^\s*(?:\[|\()?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)(?:\]|\))?\s+(.*)$/;
            const lineCues = [];
            for (let l of lines) {
                const m = l.match(lineTsRegex);
                if (m) {
                    const st = parseTimeSec(m[1]);
                    const txt = (m[2] || '').trim();
                    if (st != null && txt) {
                        lineCues.push({ start: st, end: null, text: txt });
                    }
                }
            }
            for (let i = 0; i < lineCues.length; i++) {
                const nextSt = (i + 1 < lineCues.length) ? lineCues[i + 1].start : (lineCues[i].start + 3.0);
                lineCues[i].end = nextSt;
            }
            if (lineCues.length > 0) cues = lineCues;
        }

        const wordsList = [];
        for (const c of cues) {
            const words = c.text.split(/\s+/).filter(w => w.length > 0);
            if (words.length === 0) continue;
            const dur = Math.max(0.5, c.end - c.start);
            const durPerWord = dur / words.length;
            for (let i = 0; i < words.length; i++) {
                wordsList.push({
                    word: words[i],
                    start: parseFloat((c.start + i * durPerWord).toFixed(2)),
                    end: parseFloat((c.start + (i + 1) * durPerWord).toFixed(2))
                });
            }
        }

        return wordsList;
    }

    let isCaptionSelected = false;
    let isDraggingCaption = false;
    let captionDragStartX = 0, captionDragStartY = 0;
    let originalCapPosX = 50, originalCapPosY = 82;

    let hoveredTrackType = null; // 'media' | 'audio' | null for smart split

    let undoStack = [];
    let redoStack = [];
    const MAX_UNDO_HISTORY = 40;

    let isInsertAtPlayheadMode = false;
    let isScrubbingPlayhead = false;

    let isTransforming = false;
    let transformHandle = null;
    let transformStartX = 0, transformStartY = 0;
    let originalScale = 1.0, originalPosX = 0, originalPosY = 0;

    let isResizingClip = false;
    let resizeClipId = null;
    let resizeClipType = 'media'; // 'media' | 'audio'
    let resizeEdge = null;
    let resizeStartX = 0;
    let resizeOriginalStart = 0;
    let resizeOriginalDuration = 0;

    let saveTimeout = null;

    // ── Web Audio Context for Waveform Generation ─────────────
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    // ── Time Format Helpers ───────────────────────────────────
    function fmtTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        let m = Math.floor(s / 60);
        let sec = Math.floor(s % 60);
        let ms = Math.floor((s % 1) * 10);
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + ms;
    }

    function fmtTimeShort(s) {
        if (!isFinite(s) || s < 0) s = 0;
        let m = Math.floor(s / 60);
        let sec = Math.round(s % 60);
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    function parseTimestampFromName(filename) {
        const base = filename.replace(/\.[^.]+$/, '');
        const mMinSec = base.match(/(\d+)[\-_.](\d{2})/);
        if (mMinSec) return parseInt(mMinSec[1], 10) * 60 + parseFloat(mMinSec[2]);
        const mShort = base.match(/^(\d+)[\-_.](\d+)/);
        if (mShort) return parseInt(mShort[1], 10) * 60 + parseFloat(mShort[2]);
        const mNum = base.match(/(\d+(?:\.\d+)?)/);
        if (mNum) return parseFloat(mNum[1]);
        return null;
    }

    function extractFileNumber(filename) {
        if (!filename) return null;
        const clean = filename.replace(/\.[^.]+$/, '').replace(/[`*]/g, '').trim();
        // 1. Exact numeric (e.g. "01", "239")
        const mExact = clean.match(/^0*(\d+)$/);
        if (mExact) return parseInt(mExact[1], 10);
        // 2. Scene/Image prefix (e.g. "Scene 01", "Scene_239", "image-05", "frame02")
        const mScene = clean.match(/(?:scene|section|image|img|frame|clip|shot|part)[\-_.\s]*0*(\d+)/i);
        if (mScene) return parseInt(mScene[1], 10);
        // 3. Leading numeric (e.g. "01_office", "239-happy")
        const mStart = clean.match(/^0*(\d+)/);
        if (mStart) return parseInt(mStart[1], 10);
        // 4. Any numeric
        const mAny = clean.match(/(\d+)/);
        if (mAny) return parseInt(mAny[1], 10);
        return null;
    }

    function mapTimeToTrimmedSegments(oldTime, segments) {
        if (!segments || segments.length === 0) return oldTime;
        for (const seg of segments) {
            if (oldTime >= seg.original_start && oldTime <= seg.original_end) {
                const offset = oldTime - seg.original_start;
                return seg.start + offset;
            } else if (oldTime < seg.original_start) {
                return seg.start;
            }
        }
        return segments[segments.length - 1].end;
    }

    // ── Audio Cleanup & Cache Flushing ────────────────────────
    function destroyAudioElement(audioObj, urlToRevoke) {
        if (audioObj) {
            try {
                audioObj.pause();
                audioObj.removeAttribute('src');
                audioObj.src = '';
                audioObj.load();
                if (typeof audioObj.remove === 'function') audioObj.remove();
            } catch (e) {}
        }
        if (urlToRevoke && urlToRevoke.startsWith('blob:')) {
            try { URL.revokeObjectURL(urlToRevoke); } catch (e) {}
        }
    }

    // ── Audio Waveform Extraction & Buffer Engine (Sample-Accurate) ────
    async function decodeFileToAudioBuffer(fileOrBlob) {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('AudioContext not supported');
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

        const arrayBuffer = await fileOrBlob.arrayBuffer();
        return await new Promise((resolve, reject) => {
            ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (err) => reject(err || new Error('Decode error')));
        });
    }

    function generateWaveformPeaksFromBuffer(audioBuffer) {
        if (!audioBuffer) return [];
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const samplesPerPeak = Math.max(1, Math.floor(sampleRate / 40)); // Exactly 40 peaks per second fixed everywhere
        const totalPeaks = Math.max(1, Math.floor(channelData.length / samplesPerPeak));
        const peaks = [];

        for (let i = 0; i < totalPeaks; i++) {
            const start = i * samplesPerPeak;
            let max = 0;
            const end = Math.min(channelData.length, start + samplesPerPeak);
            for (let j = start; j < end; j += 4) {
                const val = Math.abs(channelData[j] || 0);
                if (val > max) max = val;
            }
            peaks.push(Math.min(1.0, Math.pow(max, 0.75) * 1.4));
        }

        return peaks;
    }

    async function extractWaveformPeaks(fileOrBlob) {
        try {
            const audioBuffer = await decodeFileToAudioBuffer(fileOrBlob);
            const peaks = generateWaveformPeaksFromBuffer(audioBuffer);
            return { peaks, duration: audioBuffer.duration, audioBuffer };
        } catch (e) {
            console.warn('Waveform decode fallback:', e);
            const fallbackPeaks = [];
            for (let i = 0; i < 200; i++) {
                fallbackPeaks.push(0.3 + 0.5 * Math.abs(Math.sin(i * 0.25)));
            }
            return { peaks: fallbackPeaks, duration: 10, audioBuffer: null };
        }
    }

    function sliceAudioBufferDirect(ctx, sourceAudioBuffer, startSec, durationSec) {
        const sampleRate = sourceAudioBuffer.sampleRate;
        const numChannels = sourceAudioBuffer.numberOfChannels;
        const totalSourceDuration = sourceAudioBuffer.duration;

        const safeStartSec = Math.max(0, Math.min(startSec, totalSourceDuration));
        const safeDurSec = Math.max(0.01, Math.min(durationSec, totalSourceDuration - safeStartSec));

        const startSample = Math.round(safeStartSec * sampleRate);
        const numSamples = Math.round(safeDurSec * sampleRate);

        const slicedBuffer = ctx.createBuffer(numChannels, Math.max(128, numSamples), sampleRate);
        for (let ch = 0; ch < numChannels; ch++) {
            const srcData = sourceAudioBuffer.getChannelData(ch);
            const dstData = slicedBuffer.getChannelData(ch);
            const copyCount = Math.min(numSamples, srcData.length - startSample);
            if (copyCount > 0) {
                dstData.set(srcData.subarray(startSample, startSample + copyCount), 0);
            }
        }
        return slicedBuffer;
    }

    function drawWaveformOnCanvas(canvasId, peaks, isClean = false) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width || 800;
        const height = canvas.height || 54;

        ctx.clearRect(0, 0, width, height);

        if (!peaks || peaks.length === 0) {
            ctx.fillStyle = isClean ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)';
            ctx.fillRect(0, height - 2, width, 2);
            return;
        }

        const numBars = Math.floor(width / 3);
        const barWidth = 2;
        const gap = 1;

        for (let i = 0; i < numBars; i++) {
            const x = i * (barWidth + gap);
            const peakIdx = Math.floor((i / numBars) * peaks.length);
            const amplitude = peaks[peakIdx] || 0;

            if (amplitude > 0.015) {
                const barHeight = Math.max(3, Math.min(height - 4, amplitude * (height - 6)));
                const y = height - barHeight;

                if (isClean) {
                    ctx.fillStyle = amplitude > 0.55 ? '#34d399' : '#10b981';
                } else {
                    ctx.fillStyle = amplitude > 0.55 ? '#38bdf8' : '#0284c7';
                }
                ctx.fillRect(x, y, barWidth, barHeight);

                if (amplitude > 0.25) {
                    ctx.fillStyle = isClean ? '#facc15' : '#f59e0b';
                    ctx.fillRect(x, y, barWidth, 2);
                }
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.fillRect(x, height - 2, barWidth, 1);
            }
        }
    }

    // ── Pure JS 16-Bit PCM WAV Blob Encoder ───────────────────
    function audioBufferToWavBlob(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const numSamples = audioBuffer.length * numChannels;
        const buffer = new ArrayBuffer(44 + numSamples * 2);
        const view = new DataView(buffer);

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + numSamples * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, numSamples * 2, true);

        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                let sample = audioBuffer.getChannelData(ch)[i];
                sample = Math.max(-1, Math.min(1, sample));
                const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, intSample, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    // ── Audio Buffer Physical Slicing Engine ─────────────────────
    async function sliceAudioBufferToFile(sourceFileOrBlob, startOffsetSec, durationSec, newName = 'sliced.wav') {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('AudioContext not supported');
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

        const arrayBuffer = await sourceFileOrBlob.arrayBuffer();
        const audioBuffer = await new Promise((resolve, reject) => {
            ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (err) => reject(err || new Error('Decode error')));
        });

        const sampleRate = audioBuffer.sampleRate;
        const numChannels = audioBuffer.numberOfChannels;
        const totalSourceDuration = audioBuffer.duration;

        const safeStartSec = Math.max(0, Math.min(startOffsetSec, totalSourceDuration));
        const safeDurSec = Math.max(0.05, Math.min(durationSec, totalSourceDuration - safeStartSec));

        const startSample = Math.floor(safeStartSec * sampleRate);
        const numSamples = Math.floor(safeDurSec * sampleRate);

        const slicedBuffer = ctx.createBuffer(numChannels, Math.max(128, numSamples), sampleRate);
        for (let ch = 0; ch < numChannels; ch++) {
            const srcChannel = audioBuffer.getChannelData(ch);
            const dstChannel = slicedBuffer.getChannelData(ch);
            const copyCount = Math.min(numSamples, srcChannel.length - startSample);
            if (copyCount > 0) {
                dstChannel.set(srcChannel.subarray(startSample, startSample + copyCount), 0);
            }
        }

        const wavBlob = audioBufferToWavBlob(slicedBuffer);
        return new File([wavBlob], newName, { type: 'audio/wav' });
    }

    // ── Multi-Part Audio Concatenation Engine (With Intentional Gap Preservation) ──
    async function concatenateAudioFiles(audioClipsOrFiles) {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('AudioContext not supported');
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

        const items = (audioClipsOrFiles || []).map(item => {
            if (item instanceof File || item instanceof Blob) {
                return { file: item, timestampSec: null };
            }
            return { file: item.file, timestampSec: (item.timestampSec != null ? item.timestampSec : null) };
        });

        if (items.length === 0) throw new Error('No audio files to concatenate');

        const decoded = [];
        for (const it of items) {
            const ab = await it.file.arrayBuffer();
            const buf = await new Promise((resolve, reject) => {
                ctx.decodeAudioData(ab.slice(0), resolve, (err) => reject(err || new Error('Decode error')));
            });
            decoded.push({ buffer: buf, timestampSec: it.timestampSec });
        }

        const sampleRate = decoded[0].buffer.sampleRate;
        const numChannels = decoded[0].buffer.numberOfChannels;
        const hasTimestamps = decoded.some(d => d.timestampSec !== null);

        let totalLength = 0;
        if (hasTimestamps) {
            let maxEndSec = 0;
            for (const d of decoded) {
                const startSec = d.timestampSec || 0;
                const endSec = startSec + d.buffer.duration;
                if (endSec > maxEndSec) maxEndSec = endSec;
            }
            totalLength = Math.ceil(maxEndSec * sampleRate);
        } else {
            for (const d of decoded) totalLength += d.buffer.length;
        }

        const combined = ctx.createBuffer(numChannels, Math.max(1024, totalLength), sampleRate);
        for (let ch = 0; ch < numChannels; ch++) {
            const combinedData = combined.getChannelData(ch);
            let offset = 0;
            for (const d of decoded) {
                const srcData = d.buffer.getChannelData(Math.min(ch, d.buffer.numberOfChannels - 1));
                if (hasTimestamps && d.timestampSec !== null) {
                    const sampleOffset = Math.floor(d.timestampSec * sampleRate);
                    combinedData.set(srcData, sampleOffset);
                } else {
                    combinedData.set(srcData, offset);
                    offset += d.buffer.length;
                }
            }
        }

        const wavBlob = audioBufferToWavBlob(combined);
        const name = items.length > 1 ? `voiceover_combined_${items.length}parts.wav` : items[0].file.name;
        return new File([wavBlob], name, { type: 'audio/wav' });
    }

    // ── Universal Script Parser Engine (With Markdown & Multi-Format Support) ──
    function parseScenesFromScript(text) {
        if (!text || typeof text !== 'string') return [];

        const lines = text.split(/\r?\n/);
        const scenes = [];
        let currentScene = null;
        let autoSceneIndex = 1;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i].trim();
            if (!rawLine) continue;

            // 1. Sanitize Markdown bold (**), italic (*), headers (###), backticks (`), and underscores (__)
            const cleanLine = rawLine
                .replace(/^#+\s*/, '')
                .replace(/\*\*/g, '')
                .replace(/\*/g, '')
                .replace(/`/g, '')
                .replace(/^__+|__+$/g, '')
                .trim();

            if (!cleanLine) continue;

            // 2. Match Scene Header: "Scene 01 | 01.png" or "Scene 01:" or "Scene 01 - 01.png" or "Scene 01"
            const sceneMatch = cleanLine.match(/^(?:Scene|Section|Shot|Cut)\s*#?\s*(\d+)(?:\s*[:|–—\-]\s*(.*))?$/i);
            if (sceneMatch) {
                if (currentScene && currentScene.voiceover) {
                    scenes.push(currentScene);
                }
                const sceneNum = parseInt(sceneMatch[1], 10);
                const rawFileStr = sceneMatch[2] ? sceneMatch[2].trim() : '';

                let targetFiles = [];
                if (rawFileStr) {
                    const parts = rawFileStr.split(/[\/,|]/).map(s => s.trim().replace(/^['"“‘]|['"”’]$/g, '')).filter(Boolean);
                    targetFiles = parts;
                }
                if (targetFiles.length === 0) {
                    targetFiles = [
                        `${sceneNum}.png`, `${sceneNum}.jpg`, `${sceneNum}.mp4`,
                        `${String(sceneNum).padStart(2, '0')}.png`, `${String(sceneNum).padStart(2, '0')}.jpg`, `${String(sceneNum).padStart(2, '0')}.mp4`,
                        `${String(sceneNum).padStart(3, '0')}.png`, `${String(sceneNum).padStart(3, '0')}.jpg`
                    ];
                }

                currentScene = {
                    sceneNumber: sceneNum,
                    targetFiles: targetFiles,
                    voiceover: ''
                };
                autoSceneIndex = sceneNum + 1;
                continue;
            }

            // 3. Match Voiceover / Narration Header: "Voiceover: ..." or "VO: ..." or "Narrator: ..."
            const voMatch = cleanLine.match(/^(?:Voiceover|VO|Voice\s*Over|Narrator|Audio|Dialogue|Speech|Script)\s*[:|–—\-]\s*(.*)$/i);
            if (voMatch) {
                const voText = voMatch[1].trim().replace(/^["“'‘]|["”'’]$/g, '').trim();
                if (currentScene && currentScene.voiceover) {
                    currentScene.voiceover += ' ' + voText;
                } else if (currentScene) {
                    currentScene.voiceover = voText;
                } else {
                    currentScene = {
                        sceneNumber: autoSceneIndex++,
                        targetFiles: [`${autoSceneIndex - 1}.png`, `${String(autoSceneIndex - 1).padStart(2, '0')}.png`],
                        voiceover: voText
                    };
                }
                continue;
            }

            // 4. Match pipe format: "01.png | text" or "image1.jpg : text"
            const pipeMatch = cleanLine.match(/^([^\s|:]+\.[a-zA-Z0-9]{3,4})\s*[:|–—\-]\s*(.*)$/);
            if (pipeMatch) {
                if (currentScene && currentScene.voiceover) scenes.push(currentScene);
                const fileNum = extractFileNumber(pipeMatch[1]) || autoSceneIndex++;
                scenes.push({
                    sceneNumber: fileNum,
                    targetFiles: [pipeMatch[1].trim()],
                    voiceover: pipeMatch[2].trim().replace(/^["“'‘]|["”'’]$/g, '')
                });
                currentScene = null;
                continue;
            }

            // 5. Match numbered lines: "1. 01.png - text" or "1. text"
            const numMatch = cleanLine.match(/^(\d+)[\.\)]\s*(?:[:|–—\-]\s*)?(.*)$/);
            if (numMatch) {
                if (currentScene && currentScene.voiceover) scenes.push(currentScene);
                const num = parseInt(numMatch[1], 10);
                const textPart = numMatch[2].trim().replace(/^["“'‘]|["”'’]$/g, '');
                scenes.push({
                    sceneNumber: num,
                    targetFiles: [`${num}.png`, `${String(num).padStart(2, '0')}.png`, `${String(num).padStart(3, '0')}.png`],
                    voiceover: textPart
                });
                autoSceneIndex = num + 1;
                currentScene = null;
                continue;
            }

            // 6. Continuation text or plain text
            const cleanText = cleanLine.replace(/^["“'‘]|["”'’]$/g, '').trim();
            if (cleanText) {
                if (currentScene) {
                    if (currentScene.voiceover) {
                        currentScene.voiceover += ' ' + cleanText;
                    } else {
                        currentScene.voiceover = cleanText;
                    }
                } else {
                    currentScene = {
                        sceneNumber: autoSceneIndex++,
                        targetFiles: [`${autoSceneIndex - 1}.png`, `${String(autoSceneIndex - 1).padStart(2, '0')}.png`],
                        voiceover: cleanText
                    };
                }
            }
        }

        if (currentScene && currentScene.voiceover) {
            scenes.push(currentScene);
        }

        return scenes;
    }

    // ── Convert AudioBuffer to 16kHz Mono WAV (Whisper native format) ──
    function encode16kMonoWavBlob(audioBuffer, startSec = 0, durationSec = null) {
        const sampleRate = audioBuffer.sampleRate;
        const targetRate = 16000;
        const totalDur = audioBuffer.duration;
        const durToEncode = durationSec ? Math.min(durationSec, totalDur - startSec) : (totalDur - startSec);
        
        const startSample = Math.floor(startSec * sampleRate);
        const endSample = Math.min(audioBuffer.length, Math.floor((startSec + durToEncode) * sampleRate));
        const numInputSamples = Math.max(0, endSample - startSample);
        
        const numOutputSamples = Math.floor(durToEncode * targetRate);
        const buffer = new ArrayBuffer(44 + numOutputSamples * 2);
        const view = new DataView(buffer);

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        // RIFF Header for 16kHz 16-bit Mono PCM
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + numOutputSamples * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // 1 channel (Mono)
        view.setUint32(24, targetRate, true); // 16000 Hz
        view.setUint32(28, targetRate * 2, true); // Byte rate (16000 * 2)
        view.setUint16(32, 2, true); // Block align
        view.setUint16(34, 16, true); // 16-bit
        writeString(view, 36, 'data');
        view.setUint32(40, numOutputSamples * 2, true);

        const numChannels = audioBuffer.numberOfChannels;
        const channelData = [];
        for (let ch = 0; ch < numChannels; ch++) {
            channelData.push(audioBuffer.getChannelData(ch));
        }

        const ratio = sampleRate / targetRate;
        let offset = 44;

        for (let i = 0; i < numOutputSamples; i++) {
            const srcIdx = startSample + (i * ratio);
            const idxFloor = Math.floor(srcIdx);
            const idxCeil = Math.min(audioBuffer.length - 1, idxFloor + 1);
            const frac = srcIdx - idxFloor;

            let sample = 0;
            for (let ch = 0; ch < numChannels; ch++) {
                const s1 = channelData[ch][idxFloor] || 0;
                const s2 = channelData[ch][idxCeil] || 0;
                sample += (s1 + frac * (s2 - s1));
            }
            sample = sample / numChannels;
            sample = Math.max(-1, Math.min(1, sample));

            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    async function sendSingleGroqWhisperRequest(audioFile, apiKey) {
        if (!apiKey || apiKey.startsWith('gsk_YOUR_')) {
            const k = prompt('Enter your free Groq Whisper API Key:', userGroqApiKey || '');
            if (!k || !k.trim()) throw new Error('Groq API Key is required for speech transcription.');
            userGroqApiKey = k.trim();
            localStorage.setItem(GROQ_KEY_STORAGE, userGroqApiKey);
            apiKey = userGroqApiKey;
        }

        const formData = new FormData();
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'word');
        formData.append('timestamp_granularities[]', 'segment');
        formData.append('file', audioFile, audioFile.name || 'part.wav');

        const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            const errMsg = (errJson.error && errJson.error.message) || `Groq API Error HTTP ${resp.status}`;
            throw new Error(errMsg);
        }

        return await resp.json();
    }

    // ── Groq Whisper Speech Transcription Engine with Auto-Chunking & Downsampling (100% Full-Track Accuracy) ──
    async function transcribeAudioWithGroq(audioFile, apiKey, onProgress = null) {
        if (!apiKey || apiKey.startsWith('gsk_YOUR_')) {
            const k = prompt('Enter your free Groq Whisper API Key:', userGroqApiKey || '');
            if (!k || !k.trim()) throw new Error('Groq API Key is required for speech transcription.');
            userGroqApiKey = k.trim();
            localStorage.setItem(GROQ_KEY_STORAGE, userGroqApiKey);
            apiKey = userGroqApiKey;
        }

        // Resolve raw audio blob/file whether passed a File, Blob, Clip object, or Array of clips
        let file = audioFile;
        if (Array.isArray(file)) {
            if (file.length === 0) {
                // Fallback to global audioClips or voiceoverAudio
                file = (audioClips && audioClips.length > 0) ? audioClips : (voiceoverAudio ? [voiceoverAudio] : null);
            }
            if (Array.isArray(file)) {
                if (file.length === 1) {
                    file = file[0];
                } else if (file.length > 1) {
                    if (onProgress) onProgress('Merging timeline audio clips for transcription...');
                    file = await concatenateAudioFiles(file);
                }
            }
        }

        if (file && !(file instanceof Blob) && typeof file === 'object') {
            if (file.file instanceof Blob) {
                file = file.file;
            } else if (file.url || (file.audioElement && file.audioElement.src)) {
                try {
                    const u = file.url || file.audioElement.src;
                    const r = await fetch(u);
                    file = await r.blob();
                } catch (e) {}
            }
        }

        if (!file || !(file instanceof Blob)) {
            // Ultimate fallback to global audio
            if (audioClips && audioClips.length > 0) {
                file = await concatenateAudioFiles(audioClips);
            } else if (voiceoverAudio) {
                if (voiceoverAudio.file instanceof Blob) {
                    file = voiceoverAudio.file;
                } else if (voiceoverAudio.url) {
                    try {
                        const r = await fetch(voiceoverAudio.url);
                        file = await r.blob();
                    } catch(e) {}
                }
            }
        }

        if (!file || !(file instanceof Blob)) {
            throw new Error('Audio data is missing or could not be loaded from memory. Please reload the audio file.');
        }

        const ctx = getAudioContext();
        if (!ctx) throw new Error('AudioContext not supported');
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await new Promise((resolve, reject) => {
            ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (err) => reject(err || new Error('Decode error')));
        });

        const totalDuration = audioBuffer.duration;
        const CHUNK_DURATION = 300; // 5-minute chunks (~9MB each, 100% within 25MB Groq limit)
        const numChunks = Math.ceil(totalDuration / CHUNK_DURATION);
        const combinedWords = [];
        const combinedSegments = [];

        for (let c = 0; c < numChunks; c++) {
            const startSec = c * CHUNK_DURATION;
            const durSec = Math.min(CHUNK_DURATION, totalDuration - startSec);

            if (onProgress) {
                onProgress(`Transcribing part ${c + 1} of ${numChunks} (${fmtTimeShort(startSec)} - ${fmtTimeShort(startSec + durSec)})...`);
            }

            const chunkBlob = encode16kMonoWavBlob(audioBuffer, startSec, durSec);
            const chunkFile = new File([chunkBlob], `part_${c + 1}.wav`, { type: 'audio/wav' });

            const res = await sendSingleGroqWhisperRequest(chunkFile, apiKey);

            if (res && res.words) {
                for (const w of res.words) {
                    combinedWords.push({
                        ...w,
                        start: parseFloat((w.start + startSec).toFixed(3)),
                        end: parseFloat((w.end + startSec).toFixed(3))
                    });
                }
            }

            if (res && res.segments) {
                for (const s of res.segments) {
                    combinedSegments.push({
                        ...s,
                        id: combinedSegments.length,
                        start: parseFloat((s.start + startSec).toFixed(3)),
                        end: parseFloat((s.end + startSec).toFixed(3))
                    });
                }
            }
        }

        combinedWords.sort((a, b) => a.start - b.start);

        return {
            text: combinedSegments.map(s => s.text).join(' '),
            words: combinedWords,
            segments: combinedSegments,
            duration: totalDuration
        };
    }

    // ── Number & Token Normalization Helpers for Spoken Speech Alignment ──
    function numberToWords(num) {
        if (isNaN(num)) return '';
        num = parseInt(num, 10);
        if (num === 0) return 'zero';
        const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                      'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
                      'seventeen', 'eighteen', 'nineteen'];
        const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        function convertLessThanThousand(n) {
            let str = '';
            if (n >= 100) {
                str += ones[Math.floor(n / 100)] + ' hundred ';
                n %= 100;
            }
            if (n >= 20) {
                str += tens[Math.floor(n / 10)] + ' ';
                n %= 10;
            }
            if (n > 0) {
                str += ones[n] + ' ';
            }
            return str.trim();
        }
        let res = '';
        if (num >= 1000000) {
            res += convertLessThanThousand(Math.floor(num / 1000000)) + ' million ';
            num %= 1000000;
        }
        if (num >= 1000) {
            res += convertLessThanThousand(Math.floor(num / 1000)) + ' thousand ';
            num %= 1000;
        }
        if (num > 0) {
            res += convertLessThanThousand(num);
        }
        return res.trim();
    }

    function expandSpokenText(text) {
        if (!text) return '';
        let s = String(text).toLowerCase();
        s = s.replace(/%/g, ' percent ');
        s = s.replace(/\$/g, ' dollars ');
        s = s.replace(/&/g, ' and ');
        s = s.replace(/\+/g, ' plus ');
        s = s.replace(/\b\d+\b/g, (match) => {
            const w = numberToWords(parseInt(match, 10));
            return w ? ' ' + w + ' ' : match;
        });
        return s.replace(/[^a-z0-9\s\u0900-\u097F]/g, ' ').trim().replace(/\s+/g, ' ');
    }

    // ── Shared Timeline Recalculator Engine (Maintains Golden Rule & 0-Gap) ──
    function recalculateAlignedTimeline(aligned, whisperWords, totalDuration) {
        if (!aligned || aligned.length === 0) return [];
        const rawWords = whisperWords || [];
        const numWords = rawWords.length;
        const totalDur = totalDuration || 10;

        for (let i = 0; i < aligned.length; i++) {
            const sc = aligned[i];
            sc.firstWordIdx = Math.max(0, Math.min(Math.max(0, numWords - 1), sc.firstWordIdx || 0));
            sc.lastWordIdx = Math.max(sc.firstWordIdx, Math.min(Math.max(0, numWords - 1), sc.lastWordIdx || 0));

            const wFirst = rawWords[sc.firstWordIdx];
            const wLast = rawWords[sc.lastWordIdx];

            sc.spokenStart = wFirst ? parseFloat((wFirst.start != null ? wFirst.start : 0).toFixed(2)) : 0;
            sc.spokenEnd = wLast ? parseFloat((wLast.end != null ? wLast.end : sc.spokenStart + 1).toFixed(2)) : (sc.spokenStart + 1);
            sc.matchedWords = rawWords.slice(sc.firstWordIdx, sc.lastWordIdx + 1);
        }

        for (let i = 0; i < aligned.length; i++) {
            const sc = aligned[i];
            const startTime = (i === 0) ? 0.0 : sc.spokenStart;
            let endTime;
            let silenceAdded = 0;

            if (i === aligned.length - 1) {
                endTime = totalDur;
                silenceAdded = Math.max(0, totalDur - sc.spokenEnd);
            } else {
                const nextSc = aligned[i + 1];
                endTime = Math.max(startTime + 0.2, nextSc.spokenStart);
                silenceAdded = Math.max(0, nextSc.spokenStart - sc.spokenEnd);
            }

            sc.start = parseFloat(startTime.toFixed(2));
            sc.end = parseFloat(endTime.toFixed(2));
            sc.duration = parseFloat(Math.max(0.2, endTime - startTime).toFixed(2));
            sc.silenceAdded = parseFloat(silenceAdded.toFixed(2));
        }

        return aligned;
    }

    // ── Re-align single scene on script edit ──
    function realignSingleScene(aligned, sceneIdx, rawWordsList, audioDuration) {
        const sc = aligned[sceneIdx];
        if (!sc) return;

        const normWords = rawWordsList.map((w, idx) => {
            const rawWord = (w.word || '').trim();
            const cleanWord = rawWord.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, '');
            const expandedTokens = expandSpokenText(rawWord).split(/\s+/).filter(Boolean);
            return {
                idx: idx,
                raw: rawWord,
                word: cleanWord,
                expanded: expandedTokens,
                start: (w.start != null) ? w.start : 0,
                end: (w.end != null) ? w.end : 0
            };
        });

        function wordMatches(wItem, sTarget) {
            if (!wItem || !sTarget) return false;
            const w = wItem.word;
            if (w === sTarget) return true;
            if (wItem.expanded && wItem.expanded.includes(sTarget)) return true;
            if (w.length >= 5 && sTarget.length >= 5 && Math.abs(w.length - sTarget.length) <= 2) {
                if (w.startsWith(sTarget.slice(0, 4)) || sTarget.startsWith(w.slice(0, 4))) return true;
            }
            return false;
        }

        const scWords = expandSpokenText(sc.voiceover).split(/\s+/).filter(w => w.length > 0);
        const numWords = Math.max(1, scWords.length);
        const p0 = scWords[0] || '';
        const p1 = scWords.length >= 2 ? scWords[1] : '';
        const p2 = scWords.length >= 3 ? scWords[2] : '';

        let wordCursor = (sceneIdx > 0 && aligned[sceneIdx - 1].lastWordIdx != null) 
            ? Math.min(normWords.length - 1, aligned[sceneIdx - 1].lastWordIdx + 1) 
            : 0;

        let bestFirstIdx = wordCursor;
        const maxStartSearch = Math.min(normWords.length - 1, wordCursor + 12);
        let bestScore = -999;

        for (let w = wordCursor; w <= maxStartSearch; w++) {
            const w0 = normWords[w];
            const w1 = (w + 1 < normWords.length) ? normWords[w + 1] : null;
            const w2 = (w + 2 < normWords.length) ? normWords[w + 2] : null;

            let score = 0;
            if (wordMatches(w0, p0)) {
                if (w === wordCursor || p0.length > 3 || (p1 && w1 && wordMatches(w1, p1))) {
                    score += 25;
                    if (p1 && w1 && wordMatches(w1, p1)) {
                        score += 35;
                        if (p2 && w2 && wordMatches(w2, p2)) score += 45;
                    }
                }
            } else if (p1 && wordMatches(w0, p1) && (!p2 || (w1 && wordMatches(w1, p2)))) {
                score += 40;
                if (p2 && w1 && wordMatches(w1, p2)) score += 20;
            }
            score -= (w - wordCursor) * 2;

            if (score > bestScore) {
                bestScore = score;
                bestFirstIdx = w;
            }
        }

        let nextBoundary = (sceneIdx < aligned.length - 1 && aligned[sceneIdx + 1].firstWordIdx != null)
            ? aligned[sceneIdx + 1].firstWordIdx
            : normWords.length;

        let expectedEndIdx = Math.min(normWords.length - 1, bestFirstIdx + numWords - 1);
        if (expectedEndIdx >= nextBoundary) {
            expectedEndIdx = Math.max(bestFirstIdx, nextBoundary - 1);
        }

        let bestLastIdx = expectedEndIdx;
        const sLast = scWords[scWords.length - 1] || '';
        const sPrev1 = scWords.length >= 2 ? scWords[scWords.length - 2] : '';

        let minEndSearch = Math.max(bestFirstIdx, expectedEndIdx - 4);
        let maxEndSearch = Math.min(nextBoundary - 1, expectedEndIdx + 4);

        let bestEndScore = -999;
        for (let wIdx = minEndSearch; wIdx <= maxEndSearch; wIdx++) {
            const wItem = normWords[wIdx];
            const wPrev = (wIdx > 0) ? normWords[wIdx - 1] : null;

            let score = 0;
            if (sLast && wordMatches(wItem, sLast)) {
                score += 25;
                if (sPrev1 && wPrev && wordMatches(wPrev, sPrev1)) score += 35;
            }
            score -= Math.abs(wIdx - expectedEndIdx) * 2;

            if (score > bestEndScore) {
                bestEndScore = score;
                bestLastIdx = wIdx;
            }
        }

        sc.firstWordIdx = bestFirstIdx;
        sc.lastWordIdx = Math.max(bestFirstIdx, bestLastIdx);
        if (sceneIdx > 0 && aligned[sceneIdx - 1].lastWordIdx >= bestFirstIdx) {
            aligned[sceneIdx - 1].lastWordIdx = Math.max(aligned[sceneIdx - 1].firstWordIdx, bestFirstIdx - 1);
        }
    }

    // ── High-Precision Strict Sequential Speech-to-Script Alignment Engine ──
    function alignScenesWithTranscription(scenes, whisperResult, audioDuration) {
        if (!scenes || scenes.length === 0) return [];
        const totalDuration = audioDuration || (whisperResult && whisperResult.duration) || 10;
        const rawWords = (whisperResult && whisperResult.words) || [];

        const aligned = [];

        // ── Tier 1: 100% Whisper Actual Speech Timestamp Alignment ──
        if (rawWords && rawWords.length > 0) {
            const normWords = rawWords.map((w, idx) => {
                const rawWord = (w.word || '').trim();
                const cleanWord = rawWord.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, '');
                const expandedTokens = expandSpokenText(rawWord).split(/\s+/).filter(Boolean);
                return {
                    idx: idx,
                    raw: rawWord,
                    word: cleanWord,
                    expanded: expandedTokens,
                    start: (w.start != null) ? w.start : 0,
                    end: (w.end != null) ? w.end : 0
                };
            });

            function wordMatches(wItem, sTarget) {
                if (!wItem || !sTarget) return false;
                const w = wItem.word;
                if (w === sTarget) return true;
                if (wItem.expanded && wItem.expanded.includes(sTarget)) return true;
                // Stem matching only for longer words (length >= 5) with similar length (diff <= 2)
                if (w.length >= 5 && sTarget.length >= 5 && Math.abs(w.length - sTarget.length) <= 2) {
                    if (w.startsWith(sTarget.slice(0, 4)) || sTarget.startsWith(w.slice(0, 4))) {
                        return true;
                    }
                }
                return false;
            }

            let wordCursor = 0;
            const sceneRanges = [];

            for (let i = 0; i < scenes.length; i++) {
                const sc = scenes[i];
                const scWords = expandSpokenText(sc.voiceover).split(/\s+/).filter(w => w.length > 0);
                const numWords = Math.max(1, scWords.length);

                const p0 = scWords[0] || '';
                const p1 = scWords.length >= 2 ? scWords[1] : '';
                const p2 = scWords.length >= 3 ? scWords[2] : '';

                // 1. Find exact first spoken word starting at wordCursor
                let bestFirstIdx = Math.min(normWords.length - 1, wordCursor);
                if (p0 && wordCursor < normWords.length) {
                    const maxStartSearch = Math.min(normWords.length - 1, wordCursor + 8);
                    let bestScore = -999;
                    for (let w = wordCursor; w <= maxStartSearch; w++) {
                        const w0 = normWords[w];
                        const w1 = (w + 1 < normWords.length) ? normWords[w + 1] : null;
                        const w2 = (w + 2 < normWords.length) ? normWords[w + 2] : null;

                        let score = 0;
                        if (wordMatches(w0, p0)) {
                            if (w === wordCursor || p0.length > 3 || (p1 && w1 && wordMatches(w1, p1))) {
                                score += 25;
                                if (p1 && w1 && wordMatches(w1, p1)) {
                                    score += 35;
                                    if (p2 && w2 && wordMatches(w2, p2)) score += 45;
                                }
                            }
                        } else if (p1 && wordMatches(w0, p1) && (!p2 || (w1 && wordMatches(w1, p2)))) {
                            score += 40;
                            if (p2 && w1 && wordMatches(w1, p2)) score += 20;
                        } else if (p0.length >= 5 && w0.word.length >= 5 && Math.abs(w0.word.length - p0.length) <= 2 && (w0.word.startsWith(p0.slice(0, 4)) || p0.startsWith(w0.word.slice(0, 4)))) {
                            score += 10;
                        }
                        score -= (w - wordCursor) * 2; // Strict proximity

                        if (score > bestScore) {
                            bestScore = score;
                            bestFirstIdx = w;
                        }
                    }
                }

                // 2. Look-Ahead Boundary Guard:
                // Locate where the NEXT scene (i + 1) begins so Scene i CANNOT overshoot or swallow it!
                let nextSceneStartIdx = -1;
                if (i < scenes.length - 1) {
                    const nextSc = scenes[i + 1];
                    const nextScWords = expandSpokenText(nextSc.voiceover).split(/\s+/).filter(w => w.length > 0);
                    const np0 = nextScWords[0] || '';
                    const np1 = nextScWords.length >= 2 ? nextScWords[1] : '';

                    const lookAheadLimit = Math.min(normWords.length - 1, bestFirstIdx + numWords + 8);
                    for (let nIdx = bestFirstIdx + 1; nIdx <= lookAheadLimit; nIdx++) {
                        if (wordMatches(normWords[nIdx], np0)) {
                            if (!np1 || (nIdx + 1 < normWords.length && wordMatches(normWords[nIdx + 1], np1))) {
                                nextSceneStartIdx = nIdx;
                                break;
                            }
                        }
                    }
                }

                // 3. Locate exact last spoken word within expected word count
                let expectedEndIdx = Math.min(normWords.length - 1, bestFirstIdx + numWords - 1);
                if (nextSceneStartIdx !== -1 && expectedEndIdx >= nextSceneStartIdx) {
                    expectedEndIdx = Math.max(bestFirstIdx, nextSceneStartIdx - 1);
                }

                let bestLastIdx = expectedEndIdx;

                if (i === scenes.length - 1) {
                    bestLastIdx = normWords.length - 1;
                } else {
                    const sLast = scWords[scWords.length - 1] || '';
                    const sPrev1 = scWords.length >= 2 ? scWords[scWords.length - 2] : '';

                    let minEndSearch = Math.max(bestFirstIdx, expectedEndIdx - 3);
                    let maxEndSearch = Math.min(normWords.length - 1, expectedEndIdx + 3);

                    // HARD CEILING: Under no circumstances can Scene i reach or pass nextSceneStartIdx!
                    if (nextSceneStartIdx !== -1) {
                        maxEndSearch = Math.min(maxEndSearch, nextSceneStartIdx - 1);
                        if (minEndSearch > maxEndSearch) minEndSearch = maxEndSearch;
                    }

                    let bestEndScore = -999;
                    for (let wIdx = minEndSearch; wIdx <= maxEndSearch; wIdx++) {
                        const wItem = normWords[wIdx];
                        const wPrev = (wIdx > 0) ? normWords[wIdx - 1] : null;

                        let score = 0;
                        if (sLast && wordMatches(wItem, sLast)) {
                            score += 25;
                            if (sPrev1 && wPrev && wordMatches(wPrev, sPrev1)) score += 35;
                        } else if (sLast && sLast.length >= 5 && wItem.word.length >= 5 && Math.abs(wItem.word.length - sLast.length) <= 2 && (wItem.word.startsWith(sLast.slice(0, 4)) || sLast.startsWith(wItem.word.slice(0, 4)))) {
                            score += 10;
                        }
                        score -= Math.abs(wIdx - expectedEndIdx) * 2;

                        if (score > bestEndScore) {
                            bestEndScore = score;
                            bestLastIdx = wIdx;
                        }
                    }
                }

                if (bestLastIdx < bestFirstIdx) bestLastIdx = bestFirstIdx;

                const spokenStart = normWords[bestFirstIdx].start;
                const spokenEnd = normWords[bestLastIdx].end;

                sceneRanges.push({
                    scene: sc,
                    firstWordIdx: bestFirstIdx,
                    lastWordIdx: bestLastIdx,
                    spokenStart: spokenStart,
                    spokenEnd: spokenEnd
                });

                // Advance word cursor strictly for the next scene
                if (nextSceneStartIdx !== -1) {
                    wordCursor = Math.max(wordCursor + 1, nextSceneStartIdx);
                } else {
                    wordCursor = Math.max(wordCursor + 1, bestLastIdx + 1);
                }
            }

            // Pass 2: Apply User's Golden Rule
            // - Scene 0 covers initial track silence from 0.0s until Scene 1 speaks.
            // - Next image (Scene i) appears on its exact first spoken word (spokenStart).
            // - Previous image (Scene i - 1) extends across the trailing silence until Scene i starts speaking.
            for (let i = 0; i < sceneRanges.length; i++) {
                const sr = sceneRanges[i];
                const startTime = (i === 0) ? 0.0 : sr.spokenStart;
                let endTime;
                let silenceAdded = 0;

                if (i === sceneRanges.length - 1) {
                    endTime = totalDuration;
                    silenceAdded = Math.max(0, totalDuration - sr.spokenEnd);
                } else {
                    const nextSr = sceneRanges[i + 1];
                    // Holds across trailing silence until the exact millisecond when the next scene speaks!
                    endTime = Math.max(startTime + 0.2, nextSr.spokenStart);
                    silenceAdded = Math.max(0, nextSr.spokenStart - sr.spokenEnd);
                }

                aligned.push({
                    ...sr.scene,
                    firstWordIdx: sr.firstWordIdx,
                    lastWordIdx: sr.lastWordIdx,
                    spokenStart: parseFloat(sr.spokenStart.toFixed(2)),
                    spokenEnd: parseFloat(sr.spokenEnd.toFixed(2)),
                    matchedWords: rawWords.slice(sr.firstWordIdx, sr.lastWordIdx + 1),
                    silenceAdded: parseFloat(silenceAdded.toFixed(2)),
                    start: parseFloat(startTime.toFixed(2)),
                    end: parseFloat(endTime.toFixed(2)),
                    duration: parseFloat(Math.max(0.2, endTime - startTime).toFixed(2))
                });
            }

            return aligned;
        }

        // ── Tier 2: Proportional Text-Length Matching ──
        let totalChars = 0;
        for (const sc of scenes) {
            totalChars += Math.max(10, sc.voiceover.length);
        }

        let runningTime = 0.0;
        for (let i = 0; i < scenes.length; i++) {
            const sc = scenes[i];
            const charCount = Math.max(10, sc.voiceover.length);
            const fraction = charCount / totalChars;
            const dur = (i === scenes.length - 1) ? (totalDuration - runningTime) : (fraction * totalDuration);

            const startTime = runningTime;
            const endTime = (i === scenes.length - 1) ? totalDuration : (runningTime + dur);

            aligned.push({
                ...sc,
                firstWordIdx: 0,
                lastWordIdx: 0,
                spokenStart: parseFloat(startTime.toFixed(2)),
                spokenEnd: parseFloat(endTime.toFixed(2)),
                matchedWords: [],
                silenceAdded: 0,
                start: parseFloat(startTime.toFixed(2)),
                end: parseFloat(endTime.toFixed(2)),
                duration: parseFloat((endTime - startTime).toFixed(2))
            });

            runningTime = endTime;
        }

        return aligned;
    }

    // ── Bulletproof IndexedDB Storage ─────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveBatchToDB(items) {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const item of items) {
                store.put({ id: item.id, file: item.file });
            }
            return new Promise((resolve) => {
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    }

    async function getAllFilesFromDB() {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    const map = {};
                    if (req.result) {
                        for (const row of req.result) {
                            map[row.id] = row.file;
                        }
                    }
                    resolve(map);
                };
                req.onerror = () => resolve({});
            });
        } catch (e) {
            return {};
        }
    }

    async function clearDB() {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
        } catch (e) {}
    }

    function syncCaptionInspectorUI() {
        const capEnableChk = document.getElementById('capcut-caption-enable-chk');
        if (capEnableChk) capEnableChk.checked = !!captionConfig.enabled;

        const capOverlay = document.getElementById('capcut-caption-overlay');
        if (capOverlay) {
            capOverlay.style.display = captionConfig.enabled ? 'block' : 'none';
            capOverlay.style.left = (captionConfig.positionX != null ? captionConfig.positionX : 50) + '%';
            capOverlay.style.top = (captionConfig.positionY != null ? captionConfig.positionY : 82) + '%';
        }

        const capFontSel = document.getElementById('capcut-font-family-sel');
        if (capFontSel && captionConfig.fontFamily) capFontSel.value = captionConfig.fontFamily;

        const capPacingSel = document.getElementById('capcut-pacing-mode-sel');
        if (capPacingSel) {
            if (captionConfig.pacingMode === 'word') {
                capPacingSel.value = 'word';
            } else if (captionConfig.pacingMode === 'sentence') {
                capPacingSel.value = 'sentence';
            } else {
                capPacingSel.value = String(captionConfig.wordsPerPhrase || 3);
            }
        }

        const capLinesSel = document.getElementById('capcut-max-lines-sel');
        if (capLinesSel && captionConfig.maxLines !== undefined) {
            capLinesSel.value = String(captionConfig.maxLines);
        }

        const capBoxWidthSlider = document.getElementById('capcut-box-width-slider');
        const capBoxWidthVal = document.getElementById('capcut-box-width-val');
        if (capBoxWidthSlider && captionConfig.boxWidthPercent != null) {
            capBoxWidthSlider.value = captionConfig.boxWidthPercent;
            if (capBoxWidthVal) capBoxWidthVal.textContent = captionConfig.boxWidthPercent + '%';
        }

        const capColorInput = document.getElementById('capcut-caption-text-color');
        if (capColorInput && captionConfig.textColor) capColorInput.value = captionConfig.textColor;

        const capHighlightInput = document.getElementById('capcut-caption-highlight-color');
        if (capHighlightInput && captionConfig.highlightColor) capHighlightInput.value = captionConfig.highlightColor;

        const capSizeSlider = document.getElementById('capcut-font-size-slider');
        const capSizeVal = document.getElementById('capcut-font-size-val');
        if (capSizeSlider && captionConfig.fontSize) {
            capSizeSlider.value = captionConfig.fontSize;
            if (capSizeVal) capSizeVal.textContent = captionConfig.fontSize + 'px';
        }

        const capStrokeSlider = document.getElementById('capcut-stroke-width-slider');
        const capStrokeVal = document.getElementById('capcut-stroke-width-val');
        if (capStrokeSlider && captionConfig.strokeWidth != null) {
            capStrokeSlider.value = captionConfig.strokeWidth;
            if (capStrokeVal) capStrokeVal.textContent = captionConfig.strokeWidth + 'px';
        }

        // Active style preset button highlight
        document.querySelectorAll('#capcut-style-presets-row .btn-caption-preset').forEach(b => {
            b.classList.toggle('is-active', b.dataset.style === (activeCaptionStyleId || captionConfig.style));
        });

        // Active size preset button highlight
        document.querySelectorAll('#capcut-size-presets-row .btn-caption-preset').forEach(b => {
            b.classList.toggle('is-active', b.dataset.size === activeCaptionSizeId);
        });

        updateCaptionOverlayDOM();
        renderCaptionForTime(playheadTime);
    }

    function persistProjectState() {
        try {
            const state = {
                aspectRatio,
                mediaClips: mediaClips.map(c => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    timestampSec: c.timestampSec,
                    serial: c.serial,
                    duration: c.duration,
                    scale: c.scale || 1.0,
                    posX: c.posX || 0,
                    posY: c.posY || 0,
                    motion: c.motion,
                    transition: (c.transition === 'fadeblack') ? 'fade' : c.transition,
                    volume: c.volume,
                    speed: c.speed
                })),
                audioClips: (audioClips || []).map(a => ({
                    id: a.id,
                    name: a.name,
                    timestampSec: a.timestampSec,
                    duration: a.duration
                })),
                voiceoverName: voiceoverAudio ? voiceoverAudio.name : null,
                voiceoverDuration: voiceoverAudio ? voiceoverAudio.duration : null,
                captionConfig: {
                    enabled: !!captionConfig.enabled,
                    fontFamily: captionConfig.fontFamily || 'Montserrat',
                    fontSize: captionConfig.fontSize || 26,
                    textColor: captionConfig.textColor || '#ffffff',
                    highlightColor: captionConfig.highlightColor || '#facc15',
                    strokeColor: captionConfig.strokeColor || '#000000',
                    strokeWidth: captionConfig.strokeWidth != null ? captionConfig.strokeWidth : 3,
                    positionX: captionConfig.positionX != null ? captionConfig.positionX : 50,
                    positionY: captionConfig.positionY != null ? captionConfig.positionY : 82,
                    boxWidthPercent: captionConfig.boxWidthPercent != null ? captionConfig.boxWidthPercent : 88,
                    maxLines: captionConfig.maxLines != null ? captionConfig.maxLines : 2,
                    wordsPerPhrase: captionConfig.wordsPerPhrase != null ? captionConfig.wordsPerPhrase : 3,
                    maxWords: captionConfig.wordsPerPhrase || captionConfig.maxWords || 4,
                    pacingMode: captionConfig.pacingMode || 'phrase',
                    boxBgStyle: captionConfig.boxBgStyle || 'none',
                    boxBgColor: captionConfig.boxBgColor || '#000000',
                    style: captionConfig.style || activeCaptionStyleId || 'classic',
                    customWordsList: (captionConfig.customWordsList || []).map(w => ({
                        word: w.word,
                        start: w.start,
                        end: w.end
                    }))
                },
                activeCaptionStyleId: activeCaptionStyleId || 'classic',
                activeCaptionSizeId: activeCaptionSizeId || 'md',
                isRandomTransitionMix: !!isRandomTransitionMix,
                globalTransitionType: globalTransitionType || 'none',
                globalTransitionDuration: globalTransitionDuration || 0.40,
                globalZoomDepth: globalZoomDepth || 0.08,
                timestamp: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {}
    }

    function debouncedAutoSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(persistProjectState, 400);
    }

    async function tryAutoRestoreProject() {
        try {
            const savedStr = localStorage.getItem(STORAGE_KEY);
            if (!savedStr) return;
            const state = JSON.parse(savedStr);
            if (!state) return;

            aspectRatio = state.aspectRatio || '16:9';

            if (state.captionConfig) {
                Object.assign(captionConfig, state.captionConfig);
                if (state.activeCaptionStyleId) activeCaptionStyleId = state.activeCaptionStyleId;
                if (state.activeCaptionSizeId) activeCaptionSizeId = state.activeCaptionSizeId;
                if (state.isRandomTransitionMix !== undefined) isRandomTransitionMix = state.isRandomTransitionMix;
                if (state.globalTransitionType) {
            globalTransitionType = (state.globalTransitionType === 'fadeblack') ? 'fade' : state.globalTransitionType;
        }
                if (state.globalTransitionDuration) globalTransitionDuration = state.globalTransitionDuration;
                if (state.globalZoomDepth) globalZoomDepth = state.globalZoomDepth;

                syncCaptionInspectorUI();
                updateCaptionOverlayDOM();
            }

            if (!state.mediaClips || state.mediaClips.length === 0) return;

            const fileMap = await getAllFilesFromDB();

            const restoredClips = [];
            for (const item of state.mediaClips) {
                const file = fileMap[item.id];
                if (file) {
                    restoredClips.push({
                        ...item,
                        file: file,
                        url: URL.createObjectURL(file)
                    });
                }
            }

            if (restoredClips.length > 0) {
                mediaClips = restoredClips;

                if (state.audioClips && state.audioClips.length > 0) {
                    const restoredAudio = [];
                    for (const aItem of state.audioClips) {
                        const aFile = fileMap[aItem.id] || (aItem.id === 'audio_voiceover_track' ? fileMap['audio_voiceover_track'] : null);
                        if (aFile) {
                            const aUrl = URL.createObjectURL(aFile);
                            const aObj = new Audio();
                            aObj.preload = 'auto';
                            aObj.src = aUrl;
                            restoredAudio.push({
                                ...aItem,
                                file: aFile,
                                url: aUrl,
                                audioElement: aObj,
                                waveformPeaks: []
                            });
                            extractWaveformPeaks(aFile).then(wf => {
                                const found = audioClips.find(c => c.id === aItem.id);
                                if (found && wf) {
                                    found.waveformPeaks = wf.peaks;
                                    renderTimeline();
                                }
                            });
                        }
                    }
                    if (restoredAudio.length > 0) {
                        audioClips = restoredAudio;
                        voiceoverAudio = audioClips[0];
                    }
                } else if (state.voiceoverName && fileMap['audio_voiceover_track']) {
                    const audioFile = fileMap['audio_voiceover_track'];
                    const audioUrl = URL.createObjectURL(audioFile);
                    const audioObj = new Audio();
                    audioObj.preload = 'auto';
                    audioObj.src = audioUrl;
                    
                    extractWaveformPeaks(audioFile).then((wf) => {
                        voiceoverAudio = {
                            id: 'audio_voiceover_track',
                            file: audioFile,
                            url: audioUrl,
                            duration: (wf && wf.duration) || state.voiceoverDuration || 10,
                            name: state.voiceoverName,
                            timestampSec: 0,
                            audioElement: audioObj,
                            waveformPeaks: wf ? wf.peaks : []
                        };
                        audioClips = [voiceoverAudio];
                        rippleRecalculateTimeline();
                        renderTimeline();
                    });
                }

                selectedClipId = mediaClips[0].id;
                rippleRecalculateTimeline();
                renderAssetList();
                renderTimeline();
                updatePlayerScreen();
                syncCaptionInspectorUI();
            }
        } catch (e) {}
    }

    function rippleRecalculateTimeline() {
        let maxMediaTime = 0;
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
            maxMediaTime = Math.max(maxMediaTime, mediaClips[i].timestampSec + mediaClips[i].duration);
        }

        let maxAudioTime = 0;
        if (audioClips && audioClips.length > 0) {
            for (const a of audioClips) {
                maxAudioTime = Math.max(maxAudioTime, (a.timestampSec || 0) + a.duration);
            }
        } else if (voiceoverAudio) {
            maxAudioTime = voiceoverAudio.duration || 0;
        }

        totalTimelineDuration = Math.max(15, maxMediaTime + 2, maxAudioTime + 2);

        debouncedAutoSave();
    }

    function ensurePlayheadVisible(forceCenter = false) {
        const tlScroll = document.getElementById('capcut-tl-scroll-area');
        if (!tlScroll) return;

        const pxPerSec = 50 * timelineZoom;
        const playheadX = (playheadTime * pxPerSec) + 60;
        const scrollLeft = tlScroll.scrollLeft;
        const clientWidth = tlScroll.clientWidth;

        if (forceCenter) {
            tlScroll.scrollLeft = Math.max(0, playheadX - (clientWidth / 2));
            return;
        }

        if (playheadX > (scrollLeft + clientWidth * 0.78)) {
            tlScroll.scrollLeft = playheadX - (clientWidth * 0.3);
        } else if (playheadX < (scrollLeft + 40)) {
            tlScroll.scrollLeft = Math.max(0, playheadX - 100);
        }
    }

    function toggleFullScreen() {
        isAppFullscreen = !isAppFullscreen;
        const appWrapper = document.getElementById('autoeditor-global-app-root');
        const fsBtns = document.querySelectorAll('.btn-fullscreen-toggle');

        if (isAppFullscreen) {
            if (appWrapper) appWrapper.classList.add('is-app-fullscreen');
            fsBtns.forEach(b => b.innerHTML = `<span>🗗</span> Exit Fullscreen`);
            try {
                if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
            } catch (e) {}
        } else {
            if (appWrapper) appWrapper.classList.remove('is-app-fullscreen');
            fsBtns.forEach(b => b.innerHTML = `<span>⛶</span> Fullscreen`);
            try {
                if (document.fullscreenElement && document.exitFullscreen) {
                    document.exitFullscreen().catch(() => {});
                }
            } catch (e) {}
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isAppFullscreen) {
            toggleFullScreen();
        }
    });

    // ── Inject Full Complete Studio CSS (NO BLUR OVERLAYS) ──
    const style = document.createElement('style');
    style.textContent = `
        .autoeditor-global-app {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100vh;
            background: #0b1120;
            color: #f1f5f9;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
            box-sizing: border-box;
        }
        .autoeditor-global-app.is-app-fullscreen {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 99999 !important;
        }

        .global-studio-header {
            height: 48px;
            background: #111a2e;
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
            padding: 0 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
            z-index: 100;
        }
        .global-studio-title {
            font-size: 1.05em;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .global-badge {
            font-size: 0.7em;
            background: #10b981;
            color: #fff;
            padding: 2px 6px;
            border-radius: 8px;
            font-weight: 700;
        }
        .global-studio-nav {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 20px;
            padding: 3px;
            gap: 3px;
        }
        .global-nav-btn {
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            padding: 5px 14px;
            border-radius: 16px;
            font-size: 0.84em;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
        }
        .global-nav-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
        .global-nav-btn.is-active {
            background: #2563eb;
            color: #fff;
            font-weight: 600;
            box-shadow: 0 2px 10px rgba(37, 99, 235, 0.45);
        }
        .global-nav-btn.ai-highlight {
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.3);
        }
        .global-nav-btn.ai-highlight.is-active {
            background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
            color: #fff;
            border-color: #38bdf8;
            box-shadow: 0 2px 12px rgba(56, 189, 248, 0.5);
        }
        .btn-fullscreen-toggle {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            padding: 6px 14px;
            border-radius: 12px;
            font-size: 0.82em;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn-fullscreen-toggle:hover {
            background: #2563eb;
            border-color: #3b82f6;
        }

        .global-studio-body {
            flex: 1;
            position: relative;
            overflow: hidden;
            display: flex;
            width: 100%;
            height: calc(100vh - 48px);
        }

        /* ── Studio Cards & Dropzones ── */
        .studio-card-view {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            background: #0f172a;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
        }
        .studio-card {
            max-width: 960px;
            width: 100%;
            margin: 0 auto;
            padding: 28px;
            background: #111827;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
            color: #f3f4f6;
            box-sizing: border-box;
        }
        .studio-card__head { text-align: center; margin-bottom: 24px; }
        .studio-card__title {
            font-size: 1.6em;
            font-weight: 700;
            margin: 0 0 6px 0;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        .studio-card__subtitle { font-size: 0.95em; color: rgba(255, 255, 255, 0.6); margin: 0; }

        .studio-dropzone {
            border: 2px dashed rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            padding: 36px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
            background: rgba(255, 255, 255, 0.02);
            margin-bottom: 20px;
        }
        .studio-dropzone:hover, .studio-dropzone.is-over {
            border-color: #38bdf8;
            background: rgba(56, 189, 248, 0.08);
        }
        .studio-dropicon { font-size: 2.8em; margin-bottom: 10px; }
        .studio-droptitle { font-size: 1.05em; font-weight: 600; color: #fff; margin-bottom: 4px; }
        .studio-drophint { font-size: 0.85em; color: rgba(255, 255, 255, 0.5); }

        .studio-config {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 16px;
            margin-bottom: 22px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 16px;
        }
        .studio-cfg-item {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .studio-cfg-item label {
            font-size: 0.82em;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.8);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .studio-cfg-item input[type="range"] {
            width: 100%;
            accent-color: #38bdf8;
            cursor: pointer;
        }
        .studio-cfg-item select {
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #fff;
            padding: 8px 10px;
            border-radius: 8px;
            font-size: 0.88em;
            outline: none;
        }

        .studio-btn-action {
            width: 100%;
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            color: #fff;
            border: none;
            padding: 14px 24px;
            border-radius: 10px;
            font-size: 1.05em;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
        }
        .studio-btn-action:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(37, 99, 235, 0.6);
        }
        .studio-btn-action:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .studio-stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin: 20px 0;
        }
        .studio-stat-card {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            padding: 12px;
            text-align: center;
        }
        .studio-stat-card__val {
            font-size: 1.3em;
            font-weight: 800;
            color: #fff;
            font-variant-numeric: tabular-nums;
        }
        .studio-stat-card__label {
            font-size: 0.75em;
            color: rgba(255, 255, 255, 0.55);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }

        .studio-players {
            display: flex;
            flex-direction: column;
            gap: 14px;
            margin: 20px 0;
        }
        .studio-player-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .studio-player-row label {
            font-size: 0.85em;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.8);
        }
        .studio-player-row video {
            width: 100%;
            max-height: 380px;
            border-radius: 10px;
            background: #000;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .studio-audio-compare-grid {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin: 20px 0;
        }
        .audio-compare-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .audio-compare-card.clean-highlight {
            background: rgba(16, 185, 129, 0.04);
            border-color: rgba(16, 185, 129, 0.35);
        }
        .audio-compare-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.88em;
            font-weight: 700;
            color: #fff;
        }
        .audio-compare-canvas-wrap {
            width: 100%;
            height: 54px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .audio-compare-canvas-wrap canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        .audio-compare-card audio {
            width: 100%;
            height: 36px;
            outline: none;
        }

        .studio-actions-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 20px;
        }
        .btn-send-to-timeline {
            flex: 2;
            min-width: 250px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #fff;
            border: none;
            padding: 14px 20px;
            border-radius: 10px;
            font-size: 1.05em;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
        }
        .btn-send-to-timeline:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(16, 185, 129, 0.6);
        }
        .btn-download-primary {
            flex: 1.5;
            min-width: 220px;
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 14px 20px;
            border-radius: 10px;
            font-size: 1.02em;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            text-decoration: none;
            transition: all 0.2s ease;
        }
        .btn-download-primary:hover { background: #1d4ed8; transform: translateY(-1px); }
        .btn-reset-studio {
            flex: 1;
            min-width: 120px;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: none;
            padding: 14px 16px;
            border-radius: 10px;
            font-size: 0.9em;
            cursor: pointer;
        }
        .btn-reset-studio:hover { background: rgba(255, 255, 255, 0.15); }

        /* ── Auto-Sync AI Studio View ── */
        .autosync-grid-inputs {
            display: grid;
            grid-template-columns: 1fr 1.3fr 1fr;
            gap: 16px;
            margin-top: 20px;
        }
        .autosync-box {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .autosync-box-title {
            font-size: 0.9em;
            font-weight: 700;
            color: #38bdf8;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .autosync-drop-small {
            border: 2px dashed rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 24px 10px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.82em;
            color: rgba(255, 255, 255, 0.6);
        }
        .autosync-drop-small:hover, .autosync-drop-small.is-over {
            border-color: #38bdf8;
            background: rgba(56, 189, 248, 0.08);
            color: #fff;
        }
        .autosync-textarea {
            width: 100%;
            height: 140px;
            background: #090e1a;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            color: #f1f5f9;
            padding: 10px;
            font-size: 0.8em;
            font-family: monospace;
            resize: vertical;
            box-sizing: border-box;
        }
        .autosync-api-status-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.3);
            padding: 8px 14px;
            border-radius: 8px;
            font-size: 0.82em;
            margin-top: 14px;
        }

        .autosync-table-wrap {
            margin-top: 24px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            overflow: hidden;
        }
        .autosync-table-head {
            background: #1e293b;
            padding: 10px 16px;
            font-size: 0.88em;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .autosync-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.84em;
        }
        .autosync-table th {
            background: rgba(255, 255, 255, 0.04);
            padding: 10px 12px;
            text-align: left;
            font-size: 0.78em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: rgba(255, 255, 255, 0.6);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .autosync-table td {
            padding: 10px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            vertical-align: middle;
        }
        .autosync-table tr:hover td {
            background: rgba(255, 255, 255, 0.03);
        }
        .autosync-scene-badge {
            background: #3b82f6;
            color: #fff;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.85em;
        }
        .autosync-file-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.06);
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .autosync-file-thumb {
            width: 36px;
            height: 26px;
            border-radius: 3px;
            object-fit: cover;
            background: #000;
        }

        /* ── Auto-Sync Verification Matrix & Audio Slicer CSS ── */
        .autosync-matrix-wrap {
            max-height: 56vh;
            overflow-y: auto;
            overflow-x: auto;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(15, 23, 42, 0.6);
            margin-top: 14px;
        }
        .autosync-matrix-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82em;
            text-align: left;
        }
        .autosync-matrix-table th {
            position: sticky;
            top: 0;
            background: #1e293b;
            padding: 10px 12px;
            font-weight: 700;
            color: #94a3b8;
            font-size: 0.76em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
            z-index: 10;
        }
        .autosync-matrix-table td {
            padding: 10px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            vertical-align: top;
        }
        .autosync-matrix-table tr:hover td {
            background: rgba(56, 189, 248, 0.04);
        }
        .whisper-words-stream {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            max-height: 120px;
            overflow-y: auto;
            padding: 4px;
            background: rgba(0, 0, 0, 0.25);
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .whisper-word-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: rgba(255, 255, 255, 0.07);
            color: #e2e8f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.88em;
            border: 1px solid rgba(255, 255, 255, 0.08);
            line-height: 1.3;
        }
        .whisper-word-chip small {
            font-size: 0.72em;
            color: #38bdf8;
            font-family: monospace;
            opacity: 0.85;
        }
        .whisper-word-chip.is-first {
            border-color: #10b981;
            background: rgba(16, 185, 129, 0.15);
            color: #a7f3d0;
            font-weight: 600;
        }
        .whisper-word-chip.is-last {
            border-color: #38bdf8;
            background: rgba(56, 189, 248, 0.15);
            color: #bae6fd;
            font-weight: 600;
        }
        .btn-scene-audio-slice {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(56, 189, 248, 0.12);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.35);
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 0.78em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        }
        .btn-word-shift {
            background: rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.76em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .btn-word-shift:hover {
            background: rgba(56, 189, 248, 0.25);
            border-color: #38bdf8;
            color: #fff;
        }
        .btn-time-tweak {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #cbd5e1;
            border-radius: 4px;
            padding: 2px 5px;
            font-size: 0.72em;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s ease;
            font-variant-numeric: tabular-nums;
        }
        .btn-time-tweak:hover {
            background: rgba(56, 189, 248, 0.25);
            border-color: #38bdf8;
            color: #fff;
            transform: scale(1.05);
        }
        .inline-script-edit {
            width: 100%;
            box-sizing: border-box;
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            color: #f1f5f9;
            font-size: 0.83em;
            line-height: 1.4;
            padding: 6px 8px;
            resize: vertical;
            font-family: inherit;
            transition: border-color 0.15s ease;
        }
        .inline-script-edit:focus {
            outline: none;
            border-color: #38bdf8;
            background: rgba(15, 23, 42, 0.9);
            box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);
        }
        .btn-scene-realign {
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
            border-radius: 5px;
            padding: 3px 8px;
            font-size: 0.75em;
            font-weight: 700;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s ease;
        }
        .btn-scene-realign:hover {
            background: rgba(56, 189, 248, 0.3);
            border-color: #38bdf8;
            color: #fff;
            transform: translateY(-1px);
        }
        .whisper-word-chip.interactive-chip {
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .whisper-word-chip.interactive-chip:hover {
            border-color: #facc15 !important;
            background: rgba(250, 204, 21, 0.25) !important;
            color: #fef08a !important;
            transform: scale(1.05);
        }
        .whisper-word-chip.neighbor-chip {
            opacity: 0.45;
            border: 1px dashed rgba(255, 255, 255, 0.25);
            background: transparent;
            cursor: pointer;
            font-style: italic;
        }
        .whisper-word-chip.neighbor-chip:hover {
            opacity: 1;
            border-color: #10b981;
            background: rgba(16, 185, 129, 0.15);
            color: #6ee7b7;
        }
        .btn-scene-audio-slice:hover {
            background: rgba(56, 189, 248, 0.25);
            border-color: #38bdf8;
            color: #fff;
            transform: translateY(-1px);
        }
        .btn-scene-audio-slice.is-playing {
            background: #10b981 !important;
            color: #fff !important;
            border-color: #34d399 !important;
            animation: slice-playing-glow 1.5s infinite;
        }
        @keyframes slice-playing-glow {
            0%, 100% { box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
            50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.8); }
        }
        .badge-matched-tier {
            font-size: 0.7em;
            padding: 1px 5px;
            border-radius: 4px;
            font-weight: 600;
            display: inline-block;
        }
        .badge-tier-exact {
            background: rgba(16, 185, 129, 0.18);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.4);
        }
        .badge-tier-serial {
            background: rgba(56, 189, 248, 0.18);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
        }
        .badge-tier-missing {
            background: rgba(239, 68, 68, 0.18);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.4);
        }

        /* ── Modal Popups (NO BLUR - 100% Sharp Background) ── */
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.35); /* Crisp, unblurred background */
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            pointer-events: all;
        }
        .modal-box {
            background: #0f172a;
            border: 1px solid rgba(56, 189, 248, 0.4);
            border-radius: 14px;
            width: 100%;
            max-width: 620px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .modal-header {
            padding: 14px 18px;
            background: #18233c;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .modal-title { font-weight: 700; font-size: 1.05em; color: #fff; display: flex; align-items: center; gap: 8px; }
        .modal-close-btn { background: transparent; border: none; color: rgba(255, 255, 255, 0.5); font-size: 1.2em; cursor: pointer; }
        .modal-close-btn:hover { color: #fff; }
        .modal-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
        .modal-audio-info {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 10px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.85em;
        }
        .modal-presets-bar {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .btn-preset-opt {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #fff;
            padding: 8px 6px;
            border-radius: 8px;
            font-size: 0.8em;
            cursor: pointer;
            text-align: center;
            transition: all 0.15s;
        }
        .btn-preset-opt:hover { background: rgba(255, 255, 255, 0.12); }
        .btn-preset-opt.is-active {
            background: #2563eb;
            border-color: #3b82f6;
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
        }
        .btn-modal-preview {
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid #38bdf8;
            color: #38bdf8;
            padding: 9px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.85em;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-modal-preview:hover { background: #38bdf8; color: #000; }
        .modal-actions {
            padding: 12px 18px;
            background: #18233c;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
        .btn-modal-primary {
            background: #10b981;
            color: #fff;
            border: none;
            padding: 9px 16px;
            border-radius: 7px;
            font-weight: 700;
            font-size: 0.88em;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }
        .btn-modal-primary:hover { background: #059669; }
        .btn-modal-cancel {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: none;
            padding: 9px 14px;
            border-radius: 7px;
            font-size: 0.88em;
            cursor: pointer;
        }
        .btn-modal-cancel:hover { background: rgba(255, 255, 255, 0.15); }

        /* ── CapCut 4-Quadrant Workspace ── */
        .capcut-workspace {
            display: grid;
            grid-template-rows: 1fr 310px;
            grid-template-columns: 330px 1fr 320px;
            grid-template-areas: 
                "media player inspector"
                "timeline timeline timeline";
            width: 100%;
            height: 100%;
            background: #0f172a;
            overflow: hidden;
        }

        .capcut-media-panel {
            grid-area: media;
            background: #131d33;
            border-right: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .capcut-panel-header {
            padding: 10px 14px;
            background: #18233c;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 0.88em;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .capcut-filter-tabs {
            display: flex;
            background: rgba(0, 0, 0, 0.3);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 4px 8px;
            gap: 4px;
        }
        .capcut-filter-btn {
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.74em;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
        }
        .capcut-filter-btn.is-active {
            background: rgba(255, 255, 255, 0.15);
            color: #fff;
            font-weight: 700;
        }
        .capcut-import-bar {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .btn-autosync-trigger {
            background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
            color: #fff;
            border: 1px solid #38bdf8;
            padding: 9px 12px;
            border-radius: 7px;
            font-size: 0.84em;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
            transition: all 0.2s;
        }
        .btn-autosync-trigger:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(2, 132, 199, 0.5);
        }
        .btn-capcut-import {
            background: #1e293b;
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 12px;
            border-radius: 7px;
            font-size: 0.82em;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn-capcut-import:hover { background: #334155; }
        .btn-insert-playhead {
            background: rgba(245, 158, 11, 0.2);
            border: 1px solid #f59e0b;
            color: #fbbf24;
            padding: 7px 10px;
            border-radius: 7px;
            font-size: 0.8em;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn-insert-playhead:hover {
            background: #f59e0b;
            color: #000;
        }
        .capcut-import-row { display: flex; gap: 6px; }
        .btn-capcut-sub {
            flex: 1;
            background: rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
            border: 1px solid rgba(255, 255, 255, 0.12);
            padding: 6px 8px;
            border-radius: 6px;
            font-size: 0.78em;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }
        .btn-capcut-sub:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
        .capcut-sort-bar {
            padding: 6px 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(0, 0, 0, 0.25);
            font-size: 0.75em;
            color: rgba(255, 255, 255, 0.6);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .btn-auto-sort {
            background: #10b981;
            color: #fff;
            border: none;
            padding: 4px 8px;
            border-radius: 5px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
        }
        .btn-auto-sort:hover { background: #059669; }
        .capcut-asset-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .capcut-asset-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.1s, border-color 0.1s;
            position: relative;
        }
        .capcut-asset-item:hover {
            background: rgba(255, 255, 255, 0.09);
            border-color: rgba(255, 255, 255, 0.2);
        }
        .capcut-asset-item.is-selected {
            background: rgba(37, 99, 235, 0.25) !important;
            border-color: #3b82f6 !important;
            box-shadow: 0 0 0 1px #3b82f6;
        }
        .capcut-asset-serial {
            font-size: 0.74em;
            font-weight: 700;
            background: #3b82f6;
            color: #fff;
            padding: 2px 6px;
            border-radius: 4px;
            min-width: 24px;
            text-align: center;
        }
        .capcut-asset-thumb {
            width: 46px;
            height: 34px;
            border-radius: 4px;
            object-fit: cover;
            background: #000;
        }
        .capcut-asset-info { flex: 1; min-width: 0; }
        .capcut-asset-name {
            font-size: 0.82em;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #fff;
        }
        .capcut-asset-meta {
            font-size: 0.72em;
            color: rgba(255, 255, 255, 0.55);
            display: flex;
            gap: 6px;
            margin-top: 2px;
        }
        .capcut-asset-actions { display: flex; align-items: center; gap: 2px; }
        .btn-asset-icon {
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            cursor: pointer;
            padding: 4px;
            font-size: 0.85em;
            border-radius: 4px;
        }
        .btn-asset-icon:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
        .btn-asset-icon.del:hover { color: #ef4444; }

        /* ── Player Panel (Middle) ── */
        .capcut-player-panel {
            grid-area: player;
            background: #070c18;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            padding: 10px;
            position: relative;
        }
        .capcut-player-topbar {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.8em;
            color: rgba(255, 255, 255, 0.6);
        }
        .capcut-aspect-select {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #fff;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.9em;
        }
        .capcut-viewport {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            max-height: calc(100% - 60px);
            margin: 6px 0;
            position: relative;
            overflow: hidden;
            background: radial-gradient(circle at center, #111a2e 0%, #060a14 100%);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .capcut-screen {
            background: #000;
            box-shadow: 0 0 0 2px #06b6d4, 0 15px 40px rgba(0, 0, 0, 0.9);
            border-radius: 4px;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            user-select: none;
            transition: aspect-ratio 0.2s ease, width 0.2s ease;
        }
        .capcut-screen::before {
            content: attr(data-ratio-badge);
            position: absolute;
            top: 6px;
            left: 6px;
            background: rgba(6, 182, 212, 0.85);
            color: #000;
            font-size: 0.68em;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 4px;
            pointer-events: none;
            z-index: 20;
            letter-spacing: 0.5px;
        }
        .capcut-screen.ratio-16-9 { aspect-ratio: 16/9; width: 540px; }
        .capcut-screen.ratio-9-16 { aspect-ratio: 9/16; width: 250px; }
        .capcut-screen.ratio-1-1 { aspect-ratio: 1/1; width: 340px; }
        .capcut-screen.ratio-4-5 { aspect-ratio: 4/5; width: 280px; }
        
        .capcut-media-layer {
            width: 100%;
            height: 100%;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            transform-origin: center center;
            will-change: transform;
        }
        .capcut-media-layer img, .capcut-media-layer video {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            pointer-events: none;
        }

        .capcut-transform-box {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            border: 2px solid #3b82f6;
            box-sizing: border-box;
            cursor: move;
            pointer-events: all;
            z-index: 10;
        }
        .capcut-corner-handle {
            position: absolute;
            width: 14px;
            height: 14px;
            background: #ffffff;
            border: 2px solid #2563eb;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            z-index: 15;
            box-sizing: border-box;
            touch-action: none;
        }
        .capcut-corner-handle::after {
            content: '';
            position: absolute;
            top: -10px; left: -10px; right: -10px; bottom: -10px;
            background: transparent;
        }
        .capcut-corner-handle.tl { top: -7px; left: -7px; cursor: nwse-resize; }
        .capcut-corner-handle.tr { top: -7px; right: -7px; cursor: nesw-resize; }
        .capcut-corner-handle.bl { bottom: -7px; left: -7px; cursor: nesw-resize; }
        .capcut-corner-handle.br { bottom: -7px; right: -7px; cursor: nwse-resize; }

        .capcut-cap-handle {
            position: absolute;
            width: 10px;
            height: 10px;
            background: #38bdf8;
            border: 1.5px solid #ffffff;
            border-radius: 2px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.6);
            display: none;
            z-index: 40;
            pointer-events: auto;
        }
        .capcut-caption-overlay.is-selected .capcut-cap-handle {
            display: block !important;
        }
        .capcut-cap-handle.tl { top: -5px; left: -5px; cursor: nwse-resize; }
        .capcut-cap-handle.tr { top: -5px; right: -5px; cursor: nesw-resize; }
        .capcut-cap-handle.bl { bottom: -5px; left: -5px; cursor: nesw-resize; }
        .capcut-cap-handle.br { bottom: -5px; right: -5px; cursor: nwse-resize; }
        .capcut-cap-handle.ml { top: 50%; left: -6px; transform: translateY(-50%); width: 7px; height: 18px; cursor: ew-resize; border-radius: 3px; }
        .capcut-cap-handle.mr { top: 50%; right: -6px; transform: translateY(-50%); width: 7px; height: 18px; cursor: ew-resize; border-radius: 3px; }

        .capcut-player-controls {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding-top: 4px;
        }
        .btn-play-ctrl {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #fff;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1em;
            transition: all 0.2s;
        }
        .btn-play-ctrl.main-play {
            width: 42px;
            height: 42px;
            background: #2563eb;
            font-size: 1.3em;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
        }
        .btn-play-ctrl:hover { transform: scale(1.08); background: #3b82f6; }
        .capcut-timecode {
            font-size: 0.85em;
            font-variant-numeric: tabular-nums;
            color: rgba(255, 255, 255, 0.85);
            font-weight: 600;
            margin-left: 10px;
        }

        /* ── Inspector Panel (Right) ── */
        .capcut-inspector-panel {
            grid-area: inspector;
            background: #131d33;
            border-left: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }
        .capcut-inspector-body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .capcut-prop-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .capcut-prop-group label {
            font-size: 0.78em;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.7);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .capcut-prop-group select, .capcut-prop-group input[type="text"], .capcut-prop-group input[type="number"], .capcut-prop-group textarea {
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #fff;
            padding: 7px 10px;
            border-radius: 6px;
            font-size: 0.85em;
            font-family: inherit;
        }
        .btn-capcut-export {
            background: #10b981;
            color: #fff;
            border: none;
            padding: 13px;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 8px;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
            transition: all 0.2s;
        }
        .btn-capcut-export:hover { background: #059669; transform: translateY(-1px); }

        /* ── Timeline Panel (Bottom) ── */
        .capcut-timeline-panel {
            grid-area: timeline;
            background: #0d1526;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .capcut-timeline-toolbar {
            height: 38px;
            background: #151f38;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 14px;
        }
        .capcut-tl-tools { display: flex; align-items: center; gap: 8px; }
        .btn-tl-tool {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.8);
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 0.8em;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .btn-tl-tool:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
        .btn-tl-tool.audio-silence {
            color: #38bdf8;
            border-color: rgba(56, 189, 248, 0.4);
            background: rgba(56, 189, 248, 0.1);
            font-weight: 600;
        }
        .btn-tl-tool.audio-silence:hover {
            background: #0284c7;
            color: #fff;
        }
        .btn-tl-tool.autosync-tool {
            background: linear-gradient(135deg, rgba(2, 132, 199, 0.25) 0%, rgba(37, 99, 235, 0.25) 100%);
            border: 1px solid #38bdf8;
            color: #38bdf8;
            font-weight: 700;
        }
        .btn-tl-tool.autosync-tool:hover {
            background: #0284c7;
            color: #fff;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
        }
        .capcut-tl-zoom { display: flex; align-items: center; gap: 8px; font-size: 0.78em; color: rgba(255, 255, 255, 0.6); }
        .capcut-timeline-scroll {
            flex: 1;
            overflow-x: scroll;
            overflow-y: hidden;
            position: relative;
            background: #090e1a;
            user-select: none;
            cursor: default;
        }
        .capcut-timeline-trackbox {
            position: relative;
            min-width: 100%;
            height: 100%;
            padding-left: 60px;
        }

        .capcut-time-ruler {
            height: 28px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.15);
            position: relative;
            background: #0c1220;
            cursor: pointer;
        }
        .capcut-ruler-tick {
            position: absolute;
            top: 0;
            height: 100%;
            border-left: 2px solid #38bdf8;
            font-size: 0.72em;
            font-weight: 700;
            padding-left: 5px;
            color: #f1f5f9;
            pointer-events: none;
        }
        .capcut-ruler-microtick {
            position: absolute;
            bottom: 0;
            height: 10px;
            border-left: 1px solid rgba(255, 255, 255, 0.45);
            pointer-events: none;
        }

        .capcut-track-row {
            height: 80px;
            margin: 8px 0;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 6px;
            position: relative;
            display: flex;
            align-items: center;
        }
        .capcut-track-label {
            position: absolute;
            left: -54px;
            font-size: 0.72em;
            color: rgba(255, 255, 255, 0.5);
            width: 50px;
            text-align: right;
            font-weight: 600;
        }

        .capcut-tl-clip {
            position: absolute;
            height: 72px;
            background: #0f363b;
            border: 1px solid #14b8a6;
            border-radius: 6px;
            cursor: pointer;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
            user-select: none;
            display: flex;
            flex-direction: column;
            transition: border-color 0.1s, box-shadow 0.1s;
        }
        .capcut-tl-clip.is-selected {
            border-color: #facc15 !important;
            box-shadow: 0 0 0 2px #facc15 !important;
            z-index: 10;
        }
        .capcut-tl-clip-header {
            height: 20px;
            background: rgba(0, 0, 0, 0.6);
            padding: 0 6px;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.72em;
            color: #e2e8f0;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            pointer-events: none;
        }
        .capcut-tl-clip-filmstrip {
            flex: 1;
            background-repeat: repeat-x;
            background-size: contain;
            background-position: left center;
            opacity: 0.85;
            pointer-events: none;
        }
        .capcut-trim-handle {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 10px;
            cursor: col-resize;
            background: rgba(250, 204, 21, 0.6);
            display: none;
            z-index: 15;
            touch-action: none;
        }
        .capcut-tl-clip.is-selected .capcut-trim-handle,
        .capcut-audio-track.is-selected .capcut-trim-handle {
            display: block;
        }
        .capcut-audio-track .capcut-trim-handle {
            background: rgba(56, 189, 248, 0.6);
        }
        .capcut-audio-track .capcut-trim-handle:hover {
            background: #38bdf8;
        }
        .capcut-trim-handle.left { left: 0; border-top-left-radius: 5px; border-bottom-left-radius: 5px; }
        .capcut-trim-handle.right { right: 0; border-top-right-radius: 5px; border-bottom-right-radius: 5px; }
        .capcut-trim-handle:hover { background: #facc15; }

        .capcut-audio-track {
            position: absolute;
            height: 58px;
            left: 0;
            background: #0b1a30;
            border: 1px solid #1e40af;
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
            cursor: pointer;
        }
        .capcut-audio-track.is-selected {
            border-color: #38bdf8 !important;
            box-shadow: 0 0 0 2px #38bdf8 !important;
        }
        .capcut-audio-header {
            height: 18px;
            background: rgba(15, 23, 42, 0.85);
            padding: 0 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.72em;
            color: #93c5fd;
            font-weight: 600;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 5;
        }
        .capcut-waveform-canvas {
            flex: 1;
            width: 100%;
            height: calc(100% - 18px);
            display: block;
        }
        
        .capcut-playhead {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 60px;
            width: 2px;
            background: #ef4444;
            pointer-events: none;
            z-index: 25;
            transform: translate3d(0, 0, 0);
            will-change: transform;
        }
        .capcut-playhead-handle {
            position: absolute;
            top: 0;
            left: -8px;
            width: 18px;
            height: 18px;
            background: #ef4444;
            clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
            cursor: grab;
            pointer-events: all;
            touch-action: none;
        }
        .capcut-playhead-handle:active {
            cursor: grabbing;
        }

        /* ── Transitions & Motion & Captions Controls ── */
        .grid-transitions {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            margin-top: 6px;
        }
        .btn-trans-item {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #f1f5f9;
            border-radius: 6px;
            padding: 8px 4px;
            font-size: 0.72em;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .btn-trans-item:hover {
            background: rgba(56, 189, 248, 0.15);
            border-color: rgba(56, 189, 248, 0.4);
        }
        .btn-trans-item.is-active {
            background: #0284c7 !important;
            border-color: #38bdf8 !important;
            box-shadow: 0 0 10px rgba(2, 132, 199, 0.5);
            color: #fff;
            font-weight: 700;
        }
        .trans-icon {
            font-size: 1.3em;
            line-height: 1;
        }
        .grid-motion-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 8px;
        }
        .btn-motion-action {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #fff;
            padding: 7px 8px;
            font-size: 0.75em;
            font-weight: 600;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s;
            text-align: center;
        }
        .btn-motion-action:hover {
            background: rgba(255, 255, 255, 0.16);
            border-color: rgba(255, 255, 255, 0.25);
        }
        .caption-presets-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 8px;
        }
        .btn-caption-preset {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #fff;
            padding: 6px 4px;
            font-size: 0.72em;
            border-radius: 6px;
            cursor: pointer;
            text-align: center;
            transition: all 0.15s;
        }
        .btn-caption-preset:hover {
            background: rgba(255, 255, 255, 0.14);
        }
        .btn-caption-preset.is-active {
            background: #0284c7 !important;
            border-color: #38bdf8 !important;
            color: #fff !important;
            font-weight: 700;
        }
    `;
    document.head.appendChild(style);

    // ── Build Global App Structure ──
    function buildGlobalAppUI() {
        const body = document.body;
        
        let appRoot = document.getElementById('autoeditor-global-app-root');
        if (!appRoot) {
            appRoot = document.createElement('div');
            appRoot.id = 'autoeditor-global-app-root';
            appRoot.className = 'autoeditor-global-app';
            body.appendChild(appRoot);
        }

        if (!appRoot.querySelector('.global-studio-header')) {
            appRoot.innerHTML = `
                <!-- 🌐 GLOBAL HEADER BAR -->
                <header class="global-studio-header">
                    <div class="global-studio-title">
                        <span>🎬 AutoEditor Pro</span>
                        <span class="global-badge">AI Studio</span>
                    </div>
                    <div class="global-studio-nav">
                        <button type="button" class="global-nav-btn is-active" id="global-btn-capcut">🎬 Video Editor</button>
                        <button type="button" class="global-nav-btn ai-highlight" id="global-btn-autosync">🤖 Auto-Sync Maker</button>
                        <button type="button" class="global-nav-btn" id="global-btn-vjump">🎥 Video Jump-Cut</button>
                        <button type="button" class="global-nav-btn" id="global-btn-audio">🎙️ Audio Editor</button>
                    </div>
                    <button type="button" class="btn-fullscreen-toggle" id="global-btn-fullscreen" title="Toggle Fullscreen (Esc to exit)">
                        <span>⛶</span> Fullscreen
                    </button>
                </header>
                <!-- 📦 MAIN STUDIO VIEW AREA -->
                <main class="global-studio-body" id="global-studio-body"></main>
            `;

            const origChildren = Array.from(body.children);
            for (const child of origChildren) {
                if (child !== appRoot && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') {
                    child.style.display = 'none';
                }
            }

            const fsBtn = appRoot.querySelector('#global-btn-fullscreen');
            const capBtn = appRoot.querySelector('#global-btn-capcut');
            const autoBtn = appRoot.querySelector('#global-btn-autosync');
            const vjumpBtn = appRoot.querySelector('#global-btn-vjump');
            const audBtn = appRoot.querySelector('#global-btn-audio');

            if (fsBtn) fsBtn.addEventListener('click', toggleFullScreen);
            if (capBtn) capBtn.addEventListener('click', () => switchStudioMode('capcut-editor'));
            if (autoBtn) autoBtn.addEventListener('click', () => switchStudioMode('auto-sync'));
            if (vjumpBtn) vjumpBtn.addEventListener('click', () => switchStudioMode('video-jumpcut'));
            if (audBtn) audBtn.addEventListener('click', () => switchStudioMode('audio-editor'));
        }

        switchStudioMode(activeStudioMode);
    }

    function switchStudioMode(mode) {
        activeStudioMode = mode;
        const bCap = document.getElementById('global-btn-capcut');
        const bAuto = document.getElementById('global-btn-autosync');
        const bVJump = document.getElementById('global-btn-vjump');
        const bAudio = document.getElementById('global-btn-audio');

        if (bCap) bCap.className = 'global-nav-btn' + (mode === 'capcut-editor' ? ' is-active' : '');
        if (bAuto) bAuto.className = 'global-nav-btn ai-highlight' + (mode === 'auto-sync' ? ' is-active' : '');
        if (bVJump) bVJump.className = 'global-nav-btn' + (mode === 'video-jumpcut' ? ' is-active' : '');
        if (bAudio) bAudio.className = 'global-nav-btn' + (mode === 'audio-editor' ? ' is-active' : '');

        const container = document.getElementById('global-studio-body');
        if (!container) return;

        let capcutWS = document.getElementById('capcut-workspace-root');
        let autoSyncWS = document.getElementById('autosync-studio-container');
        let vStudio = document.getElementById('video-jumpcut-container');
        let aStudio = document.getElementById('audio-editor-container');

        if (mode === 'capcut-editor') {
            if (!capcutWS) {
                capcutWS = createCapCutWorkspace();
                container.appendChild(capcutWS);
            }
            capcutWS.style.display = 'grid';
            if (autoSyncWS) autoSyncWS.style.display = 'none';
            if (vStudio) vStudio.style.display = 'none';
            if (aStudio) aStudio.style.display = 'none';
        } else if (mode === 'auto-sync') {
            if (!autoSyncWS) {
                autoSyncWS = createAutoSyncStudio();
                container.appendChild(autoSyncWS);
            }
            autoSyncWS.style.display = 'flex';
            if (capcutWS) capcutWS.style.display = 'none';
            if (vStudio) vStudio.style.display = 'none';
            if (aStudio) aStudio.style.display = 'none';
        } else if (mode === 'video-jumpcut') {
            if (!vStudio) {
                vStudio = createVideoJumpcutStudio();
                container.appendChild(vStudio);
            }
            vStudio.style.display = 'flex';
            if (capcutWS) capcutWS.style.display = 'none';
            if (autoSyncWS) autoSyncWS.style.display = 'none';
            if (aStudio) aStudio.style.display = 'none';
        } else if (mode === 'audio-editor') {
            if (!aStudio) {
                aStudio = createAudioEditorStudio();
                container.appendChild(aStudio);
            }
            aStudio.style.display = 'flex';
            if (capcutWS) capcutWS.style.display = 'none';
            if (autoSyncWS) autoSyncWS.style.display = 'none';
            if (vStudio) vStudio.style.display = 'none';
        }
    }

    // ── Create CapCut Workspace ──
    function createCapCutWorkspace() {
        const root = document.createElement('div');
        root.id = 'capcut-workspace-root';
        root.className = 'capcut-workspace';

        root.innerHTML = `
            <!-- 📁 1. Media Asset Bin -->
            <section class="capcut-media-panel">
                <div class="capcut-panel-header">
                    <span>📁 Media Library</span>
                    <span id="capcut-media-count" style="font-size:0.8em;opacity:0.6;">0 files</span>
                </div>
                <div class="capcut-filter-tabs">
                    <button class="capcut-filter-btn is-active" data-filter="all">All</button>
                    <button class="capcut-filter-btn" data-filter="image">🖼 Images</button>
                    <button class="capcut-filter-btn" data-filter="video">🎥 Videos</button>
                    <button class="capcut-filter-btn" data-filter="audio">🎙 Audio</button>
                </div>
                <div class="capcut-import-bar">
                    <button type="button" class="btn-autosync-trigger" id="btn-capcut-autosync-open">
                        <span>🤖</span> 1-Click Auto-Sync (Script + Media)
                    </button>
                    <button type="button" class="btn-capcut-import" id="btn-import-media">
                        <span>➕</span> Import Media Files
                    </button>
                    <button type="button" class="btn-insert-playhead" id="btn-insert-at-playhead" title="Insert new clip exactly at current red playhead time">
                        <span>📍</span> Insert Clip at Playhead (Red Line)
                    </button>
                    <div class="capcut-import-row">
                        <button type="button" class="btn-capcut-sub" id="btn-import-audio">
                            <span>🎵</span> Voiceover Audio
                        </button>
                        <button type="button" class="btn-capcut-sub" id="btn-import-folder">
                            <span>📁</span> Folder
                        </button>
                    </div>
                    <input type="file" id="input-media-files" accept="image/*,video/*" multiple hidden>
                    <input type="file" id="input-audio-file" accept="audio/*" multiple hidden>
                    <input type="file" id="input-folder-files" webkitdirectory directory multiple hidden>
                </div>
                <div class="capcut-sort-bar">
                    <span>Serial Order (#1, #2, #3...)</span>
                    <button type="button" class="btn-auto-sort" id="btn-trigger-autosort" title="Auto-Arranges clips in perfect timestamp order">
                        ⚡ 1-Click Auto-Sort
                    </button>
                </div>
                <div class="capcut-asset-list" id="capcut-asset-list-box">
                    <div style="text-align:center;padding:30px 10px;font-size:0.82em;color:rgba(255,255,255,0.4);">
                        Drop timestamp-named images (0-00.png, 0-03.png) or click Auto-Sync to begin.
                    </div>
                </div>
            </section>

            <!-- 📺 2. Live Center Player -->
            <section class="capcut-player-panel">
                <div class="capcut-player-topbar">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span>Preview Monitor</span>
                        <div style="display:flex;align-items:center;gap:4px;background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:5px;font-size:0.85em;">
                            <span>🔍 Size:</span>
                            <input type="range" id="capcut-preview-scale-slider" min="0.5" max="2.5" step="0.05" value="1.0" style="width:70px;accent-color:#3b82f6;" title="Scale selected image/video">
                            <b id="capcut-scale-text" style="font-size:0.8em;min-width:32px;">100%</b>
                        </div>
                    </div>
                    <select class="capcut-aspect-select" id="capcut-aspect-ratio">
                        <option value="16:9">16:9 (YouTube Video)</option>
                        <option value="9:16">9:16 (Shorts / Reels)</option>
                        <option value="1:1">1:1 (Square Post)</option>
                        <option value="4:5">4:5 (Portrait)</option>
                    </select>
                </div>
                <div class="capcut-viewport">
                    <div class="capcut-screen ratio-16-9" id="capcut-screen-box" data-ratio-badge="16:9 (YouTube)">
                        <div id="capcut-screen-content" style="color:rgba(255,255,255,0.3);font-size:0.9em;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
                            No Media Loaded
                        </div>
                        <div id="capcut-caption-overlay" class="capcut-caption-overlay" style="position:absolute;left:50%;top:82%;transform:translate(-50%,-50%);cursor:move;user-select:none;z-index:30;text-align:center;pointer-events:auto;max-width:94%;width:88%;padding:6px 12px;border-radius:6px;border:1.5px dashed rgba(255,255,255,0.25);transition:border-color 0.2s;display:none;box-sizing:border-box;" title="Click to select / Drag to move / Drag corners to resize">
                            <span id="capcut-caption-text" style="font-family:'Montserrat',sans-serif;font-weight:900;font-size:26px;color:#fff;text-shadow:0 0 6px rgba(0,0,0,0.9);letter-spacing:0.5px;display:inline-block;line-height:1.2;">Sample Captions</span>
                            <button id="btn-del-selected-caption" style="position:absolute;top:-10px;right:-10px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:bold;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.5);" title="Delete Caption">✕</button>
                            <!-- 🎚️ Corner handles (Scale font size) -->
                            <div class="capcut-cap-handle tl" data-cap-handle="tl" title="Drag to resize text"></div>
                            <div class="capcut-cap-handle tr" data-cap-handle="tr" title="Drag to resize text"></div>
                            <div class="capcut-cap-handle bl" data-cap-handle="bl" title="Drag to resize text"></div>
                            <div class="capcut-cap-handle br" data-cap-handle="br" title="Drag to resize text"></div>
                            <!-- 📏 Side handles (Adjust box width / wrap lines) -->
                            <div class="capcut-cap-handle ml" data-cap-handle="ml" title="Drag to adjust box width"></div>
                            <div class="capcut-cap-handle mr" data-cap-handle="mr" title="Drag to adjust box width"></div>
                        </div>
                        <div id="capcut-caption-safe-guides" style="position:absolute;inset:8%;border:1.5px dashed rgba(56,189,248,0.4);pointer-events:none;display:none;border-radius:6px;"></div>
                    </div>
                </div>
                <div class="capcut-player-controls">
                    <button class="btn-play-ctrl" id="btn-prev-clip" title="Previous Clip (⏮)">⏮</button>
                    <button class="btn-play-ctrl main-play" id="btn-main-play" title="Play / Pause (Space)">▶</button>
                    <button class="btn-play-ctrl" id="btn-next-clip" title="Next Clip (⏭)">⏭</button>
                    <div class="capcut-timecode" id="capcut-timecode-text">00:00.0 / 00:00.0</div>
                </div>
            </section>

            <!-- ⚙️ 3. Clip & Auto-Captions Inspector -->
            <section class="capcut-inspector-panel">
                <div class="capcut-panel-header">
                    <span>⚙️ Inspector & Captions</span>
                </div>
                <div class="capcut-inspector-body">
                    <div id="capcut-clip-props-area">
                        <div style="font-size:0.8em;color:rgba(255,255,255,0.4);text-align:center;padding:12px 0;">
                            Select a clip on timeline to edit scale, motion, and transitions.
                        </div>
                    </div>

                    <!-- 💬 Full Auto-Captions Studio Controls (With Old Project Styles) -->
                    <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:6px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                            <label style="font-weight:700;color:#38bdf8;margin:0;display:flex;align-items:center;gap:6px;">
                                <span>💬 Animated Captions</span>
                            </label>
                            <input type="checkbox" id="capcut-caption-enable-chk" style="width:16px;height:16px;accent-color:#38bdf8;cursor:pointer;">
                        </div>

                        <!-- 🎨 3 Iconic Caption Styles (From Old Project) -->
                        <label style="font-size:0.75em;opacity:0.7;display:block;margin-bottom:4px;">Caption Style</label>
                        <div class="caption-presets-row" id="capcut-style-presets-row">
                            <button type="button" class="btn-caption-preset ${activeCaptionStyleId === 'classic' ? 'is-active' : ''}" data-style="classic">Classic outline (Old)</button>
                            <button type="button" class="btn-caption-preset ${activeCaptionStyleId === 'boxed' ? 'is-active' : ''}" data-style="boxed">Boxed (Old)</button>
                            <button type="button" class="btn-caption-preset ${activeCaptionStyleId === 'yellow' ? 'is-active' : ''}" data-style="yellow">Yellow classic (Old)</button>
                        </div>

                        <!-- 📏 3 Size Presets (From Old Project) -->
                        <label style="font-size:0.75em;opacity:0.7;display:block;margin-bottom:4px;">Font Size Presets</label>
                        <div class="caption-presets-row" id="capcut-size-presets-row">
                            <button type="button" class="btn-caption-preset ${activeCaptionSizeId === 'sm' ? 'is-active' : ''}" data-size="sm">Small (Old) [20px]</button>
                            <button type="button" class="btn-caption-preset ${activeCaptionSizeId === 'md' ? 'is-active' : ''}" data-size="md">Medium (Old) [26px]</button>
                            <button type="button" class="btn-caption-preset ${activeCaptionSizeId === 'lg' ? 'is-active' : ''}" data-size="lg">Large (Old) [34px]</button>
                        </div>

                        <!-- Font Family & Pacing Mode -->
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                            <div>
                                <label style="font-size:0.75em;opacity:0.7;">Font Family</label>
                                <select id="capcut-font-family-sel" style="width:100%;font-size:0.8em;padding:4px 6px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;">
                                    <option value="caption">DejaVu Sans Bold (Old)</option>
                                    <option value="Montserrat" selected>Montserrat Black</option>
                                    <option value="Impact">Impact / Anton</option>
                                    <option value="Arial Black">Arial Black</option>
                                    <option value="Bangers">Bangers (Comic)</option>
                                    <option value="Roboto">Roboto Bold</option>
                                    <option value="Poppins">Poppins Heavy</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size:0.75em;opacity:0.7;">Word Pacing</label>
                                <select id="capcut-pacing-mode-sel" style="width:100%;font-size:0.8em;padding:4px 6px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;">
                                    <option value="word">⚡ 1 Word (Reels/TikTok)</option>
                                    <option value="2">✌️ 2 Words per Phrase</option>
                                    <option value="3" selected>🎬 3 Words per Phrase</option>
                                    <option value="4">🎬 4 Words per Phrase</option>
                                    <option value="5">🎬 5 Words per Phrase</option>
                                    <option value="6">🎬 6 Words per Phrase</option>
                                    <option value="sentence">📄 Full Sentence</option>
                                </select>
                            </div>
                        </div>

                        <!-- Max Lines & Text Auto-Wrap -->
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                            <div>
                                <label style="font-size:0.75em;opacity:0.7;">Screen Display Lines</label>
                                <select id="capcut-max-lines-sel" style="width:100%;font-size:0.8em;padding:4px 6px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;">
                                    <option value="1">1 Line Only (Single)</option>
                                    <option value="2" selected>Max 2 Lines (Standard)</option>
                                    <option value="3">Max 3 Lines</option>
                                    <option value="0">Auto-Wrap (Box Width)</option>
                                </select>
                            </div>
                            <div>
                                <div style="display:flex;justify-content:space-between;font-size:0.75em;opacity:0.7;margin-bottom:2px;">
                                    <span>Box Width:</span>
                                    <b id="capcut-box-width-val">88%</b>
                                </div>
                                <input type="range" id="capcut-box-width-slider" min="35" max="96" step="1" value="88" style="width:100%;accent-color:#38bdf8;">
                            </div>
                        </div>

                        <!-- Colors: Text & Active Word Highlight -->
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                            <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.08);">
                                <span style="font-size:0.75em;">Text Color:</span>
                                <input type="color" id="capcut-caption-text-color" value="#ffffff" style="width:24px;height:22px;border:none;background:transparent;cursor:pointer;">
                            </div>
                            <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.08);">
                                <span style="font-size:0.75em;">Highlight:</span>
                                <input type="color" id="capcut-caption-highlight-color" value="#facc15" style="width:24px;height:22px;border:none;background:transparent;cursor:pointer;">
                            </div>
                        </div>

                        <!-- Font Size Slider & Outline Slider -->
                        <div style="margin-bottom:6px;">
                            <div style="display:flex;justify-content:space-between;font-size:0.75em;opacity:0.8;">
                                <span>Fine Font Size:</span>
                                <b id="capcut-font-size-val">26px</b>
                            </div>
                            <input type="range" id="capcut-font-size-slider" min="16" max="48" step="1" value="26" style="width:100%;accent-color:#38bdf8;">
                        </div>

                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:0.75em;opacity:0.8;">
                                <span>Outline Stroke:</span>
                                <b id="capcut-stroke-width-val">3px</b>
                            </div>
                            <input type="range" id="capcut-stroke-width-slider" min="0" max="8" step="1" value="3" style="width:100%;accent-color:#38bdf8;">
                        </div>
                    </div>

                    <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:6px;">
                        <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
                            <span>✂️ Auto-Cut Silence in Audio</span>
                            <input type="checkbox" id="sync-silence-checkbox">
                        </label>
                        <span style="font-size:0.7em;color:rgba(255,255,255,0.5);margin-top:2px;">
                            Cuts pauses in voiceover before rendering video.
                        </span>
                    </div>

                    <button class="btn-capcut-export" id="btn-render-capcut-mp4" style="margin-top:10px;">
                        🚀 EXPORT VIDEO (MP4)
                    </button>
                    <div id="capcut-export-status" style="font-size:0.8em;text-align:center;display:none;"></div>
                </div>
            </section>

            <!-- 🎛️ 4. Multi-Track Timeline -->
            <section class="capcut-timeline-panel">
                <div class="capcut-timeline-toolbar">
                    <div class="capcut-tl-tools">
                        <button class="btn-tl-tool" id="btn-tl-split" title="Split clip at playhead position">✂️ Split</button>
                        <button class="btn-tl-tool" id="btn-tl-merge-audio" title="Merge all audio parts on timeline into 1 single master voiceover track" style="color:#c084fc;background:rgba(192,132,252,0.12);border-color:rgba(192,132,252,0.35);font-weight:600;">🔗 Merge Audio</button>
                        <button class="btn-tl-tool" id="btn-tl-auto-captions" title="Auto-Generate & Style Captions" style="color:#38bdf8;background:rgba(56,189,248,0.12);border-color:rgba(56,189,248,0.35);font-weight:600;">✨ Auto-Captions</button>
                        <button class="btn-tl-tool" id="btn-tl-agent-review" title="Review timeline alignment and scene boundaries with Gemini AI" style="color:#c084fc;background:rgba(192,132,252,0.12);border-color:rgba(192,132,252,0.35);font-weight:600;">🤖 Agent Review</button>
                        <button class="btn-tl-tool" id="btn-tl-delete" title="Delete selected clip or caption">🗑️ Delete</button>
                        <button class="btn-tl-tool autosync-tool" id="btn-tl-autosync" title="Auto-Sync Script lines with Timeline Audio & Clips">
                            🤖 Auto-Sync Timeline
                        </button>
                        <button class="btn-tl-tool audio-silence" id="btn-tl-audio-silence" title="Auto-Cut Silence from Voiceover Audio Track">
                            🎙️ Auto-Cut Silence (Voiceover)
                        </button>
                        <button class="btn-tl-tool" id="btn-tl-undo" title="Undo last action (Ctrl+Z)" style="opacity:0.4;" disabled>↩️ Undo</button>
                        <button class="btn-tl-tool" id="btn-tl-redo" title="Redo last action (Ctrl+Y)" style="opacity:0.4;" disabled>↪️ Redo</button>
                        <button class="btn-tl-tool" id="btn-tl-clear-project" title="Clear options (Media / Audio / All)" style="color:#ef4444;">🗑️ Clear Project</button>
                    </div>
                    <div class="capcut-tl-zoom">
                        <span>Zoom:</span>
                        <input type="range" id="capcut-tl-zoom-slider" min="0.1" max="3" step="0.05" value="1">
                    </div>
                </div>
                <div class="capcut-timeline-scroll" id="capcut-tl-scroll-area">
                    <div class="capcut-timeline-trackbox" id="capcut-tl-trackbox">
                        <div class="capcut-time-ruler" id="capcut-time-ruler-box"></div>
                        <div class="capcut-track-row" id="capcut-video-track-row">
                            <span class="capcut-track-label">Media</span>
                        </div>
                        <div class="capcut-track-row" id="capcut-audio-track-row" style="height:65px;">
                            <span class="capcut-track-label">Audio</span>
                        </div>
                        <div class="capcut-playhead" id="capcut-tl-playhead">
                            <div class="capcut-playhead-handle" id="capcut-playhead-arrow-handle" title="Drag to Scrub Playhead"></div>
                        </div>
                    </div>
                </div>
            </section>
        `;

        setupCapCutEvents(root);
        tryAutoRestoreProject();
        return root;
    }

    // ── Setup CapCut Studio Events & Logic ──
    function setupCapCutEvents(root) {
        const inputMedia = root.querySelector('#input-media-files');
        const inputAudio = root.querySelector('#input-audio-file');
        const inputFolder = root.querySelector('#input-folder-files');
        const btnAutoSyncOpen = root.querySelector('#btn-capcut-autosync-open');
        const btnImportMedia = root.querySelector('#btn-import-media');
        const btnInsertAtPlayhead = root.querySelector('#btn-insert-at-playhead');
        const btnImportAudio = root.querySelector('#btn-import-audio');
        const btnImportFolder = root.querySelector('#btn-import-folder');
        const btnAutoSort = root.querySelector('#btn-trigger-autosort');
        const aspectSel = root.querySelector('#capcut-aspect-ratio');
        const screenBox = root.querySelector('#capcut-screen-box');
        const btnPlay = root.querySelector('#btn-main-play');
        const btnPrev = root.querySelector('#btn-prev-clip');
        const btnNext = root.querySelector('#btn-next-clip');
        const zoomSlider = root.querySelector('#capcut-tl-zoom-slider');
        const btnExport = root.querySelector('#btn-render-capcut-mp4');
        const tlScroll = root.querySelector('#capcut-tl-scroll-area');
        const rulerBox = root.querySelector('#capcut-time-ruler-box');
        const playheadHandle = root.querySelector('#capcut-playhead-arrow-handle');

        const scaleSlider = root.querySelector('#capcut-preview-scale-slider');
        const scaleText = root.querySelector('#capcut-scale-text');

        const btnSplit = root.querySelector('#btn-tl-split');
        const btnMergeAudio = root.querySelector('#btn-tl-merge-audio');
        const btnAutoCaptions = root.querySelector('#btn-tl-auto-captions');
        const btnAgentReview = root.querySelector('#btn-tl-agent-review');
        const btnDelete = root.querySelector('#btn-tl-delete');
        const btnTlAutoSync = root.querySelector('#btn-tl-autosync');
        const btnAudioSilence = root.querySelector('#btn-tl-audio-silence');
        const btnUndo = root.querySelector('#btn-tl-undo');
        const btnRedo = root.querySelector('#btn-tl-redo');
        const btnClear = root.querySelector('#btn-tl-clear-project');

        if (btnAutoSyncOpen) {
            btnAutoSyncOpen.addEventListener('click', () => switchStudioMode('auto-sync'));
        }

        if (btnTlAutoSync) {
            btnTlAutoSync.addEventListener('click', openTimelineAutoSyncModal);
        }

        if (btnAgentReview) {
            btnAgentReview.addEventListener('click', () => {
                if (!window._lastAutoSyncPackage || !window._lastAutoSyncPackage.aligned || window._lastAutoSyncPackage.aligned.length === 0) {
                    alert('Please run "🤖 Auto-Sync Timeline" first to transcribe audio and align script scenes before launching AI Agent Review.');
                    openTimelineAutoSyncModal();
                    return;
                }
                openAgentReviewModal(window._lastAutoSyncPackage);
            });
        }

        if (btnMergeAudio) {
            btnMergeAudio.addEventListener('click', mergeAllAudioParts);
        }

        if (btnAutoCaptions) {
            btnAutoCaptions.addEventListener('click', openAutoCaptionsStudioModal);
        }

        if (btnClear) {
            btnClear.addEventListener('click', showClearProjectModal);
        }

        if (btnUndo) {
            btnUndo.addEventListener('click', performUndo);
        }

        if (btnRedo) {
            btnRedo.addEventListener('click', performRedo);
        }

        // Global Keyboard Shortcuts (Undo, Redo, Delete, Split, Space Play)
        window.addEventListener('keydown', (e) => {
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
            if (isInput) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                performUndo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
                e.preventDefault();
                performRedo();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedClip();
            } else if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                splitCurrentClipAtPlayhead();
            } else if (e.code === 'Space') {
                e.preventDefault();
                togglePlayback();
            }
        });

        tlScroll.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tlScroll.scrollLeft += e.deltaY * 1.2;
            }
        }, { passive: false });

        scaleSlider.addEventListener('input', () => {
            const val = parseFloat(scaleSlider.value);
            scaleText.textContent = Math.round(val * 100) + '%';
            if (selectedClipId) {
                const clip = mediaClips.find(c => c.id === selectedClipId);
                if (clip) {
                    clip.scale = val;
                    debouncedAutoSave();
                }
            }
            applyPreviewScale(val);
        });

        root.querySelectorAll('.capcut-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                root.querySelectorAll('.capcut-filter-btn').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                mediaFilter = btn.dataset.filter;
                renderAssetList();
            });
        });

        if (btnImportMedia) {
            btnImportMedia.addEventListener('click', () => {
                isInsertAtPlayheadMode = false;
                inputMedia.click();
            });
        }

        if (btnInsertAtPlayhead) {
            btnInsertAtPlayhead.addEventListener('click', () => {
                isInsertAtPlayheadMode = true;
                inputMedia.click();
            });
        }

        if (btnImportAudio) btnImportAudio.addEventListener('click', () => inputAudio.click());
        if (btnImportFolder) {
            btnImportFolder.addEventListener('click', () => {
                isInsertAtPlayheadMode = false;
                inputFolder.click();
            });
        }

        inputMedia.addEventListener('change', (e) => handleMediaFilesAdded(e.target.files, isInsertAtPlayheadMode));
        inputFolder.addEventListener('change', (e) => handleMediaFilesAdded(e.target.files, isInsertAtPlayheadMode));
        inputAudio.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) handleAudioFileAdded(e.target.files);
        });

        btnAutoSort.addEventListener('click', () => autoSortMediaClips());

        aspectSel.addEventListener('change', () => {
            aspectRatio = aspectSel.value;
            screenBox.className = 'capcut-screen ratio-' + aspectRatio.replace(':', '-');
            const badgeMap = {
                '16:9': '16:9 (YouTube)',
                '9:16': '9:16 (Shorts / Reels)',
                '1:1': '1:1 (Square)',
                '4:5': '4:5 (Portrait)'
            };
            screenBox.setAttribute('data-ratio-badge', badgeMap[aspectRatio] || aspectRatio);
            debouncedAutoSave();
        });

        btnPlay.addEventListener('click', togglePlayback);
        btnPrev.addEventListener('click', () => jumpToClip(-1));
        btnNext.addEventListener('click', () => jumpToClip(1));

        btnSplit.addEventListener('click', splitCurrentClipAtPlayhead);
        btnDelete.addEventListener('click', deleteSelectedClip);
        btnAudioSilence.addEventListener('click', openAudioSilenceModal);

        zoomSlider.addEventListener('input', () => {
            timelineZoom = parseFloat(zoomSlider.value);
            renderTimeline();
        });

        playheadHandle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isScrubbingPlayhead = true;
            playheadHandle.setPointerCapture(e.pointerId);
        });

        const trackboxEl = root.querySelector('#capcut-tl-trackbox');
        if (trackboxEl) {
            trackboxEl.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.capcut-trim-handle')) return;
                if (e.target.closest('.btn-asset-icon')) return;
                isScrubbingPlayhead = true;
                const targetSec = getTimeFromTimelinePointerEvent(e);
                setPlayheadTime(targetSec);
                ensurePlayheadVisible();
            });
        }

        window.addEventListener('pointermove', (e) => {
            if (!isScrubbingPlayhead) return;
            const targetSec = getTimeFromTimelinePointerEvent(e);
            setPlayheadTime(targetSec);
            ensurePlayheadVisible();
        });

        window.addEventListener('pointerup', () => {
            if (isScrubbingPlayhead) {
                isScrubbingPlayhead = false;
            }
        });

        // Track hover for Smart Split Tool
        const vTrackEl = root.querySelector('#capcut-video-track-row');
        const aTrackEl = root.querySelector('#capcut-audio-track-row');
        if (vTrackEl) {
            vTrackEl.addEventListener('pointerenter', () => { hoveredTrackType = 'media'; });
            vTrackEl.addEventListener('pointerleave', () => { if (hoveredTrackType === 'media') hoveredTrackType = null; });
        }
        if (aTrackEl) {
            aTrackEl.addEventListener('pointerenter', () => { hoveredTrackType = 'audio'; });
            aTrackEl.addEventListener('pointerleave', () => { if (hoveredTrackType === 'audio') hoveredTrackType = null; });
        }

        // Auto-Captions Inspector Event Bindings
        const capEnableChk = root.querySelector('#capcut-caption-enable-chk');
        const capFontSel = root.querySelector('#capcut-font-family-sel');
        const capPacingSel = root.querySelector('#capcut-pacing-mode-sel');
        const capColorInput = root.querySelector('#capcut-caption-text-color');
        const capHighlightInput = root.querySelector('#capcut-caption-highlight-color');
        const capSizeSlider = root.querySelector('#capcut-font-size-slider');
        const capSizeVal = root.querySelector('#capcut-font-size-val');
        const capStrokeSlider = root.querySelector('#capcut-stroke-width-slider');
        const capStrokeVal = root.querySelector('#capcut-stroke-width-val');
        const capBoxBgSel = root.querySelector('#capcut-box-bg-sel');
        const btnDownloadSrt = root.querySelector('#btn-download-srt-file');
        const capOverlay = root.querySelector('#capcut-caption-overlay');
        const capSafeGuides = root.querySelector('#capcut-caption-safe-guides');

        if (capEnableChk) {
            capEnableChk.addEventListener('change', () => {
                captionConfig.enabled = capEnableChk.checked;
                if (capOverlay) capOverlay.style.display = captionConfig.enabled ? 'block' : 'none';
                updatePlayerScreen();
                debouncedAutoSave();
            });
        }

        const capLinesSel = root.querySelector('#capcut-max-lines-sel');
        const capBoxWidthSlider = root.querySelector('#capcut-box-width-slider');
        const capBoxWidthVal = root.querySelector('#capcut-box-width-val');

        if (capLinesSel) {
            capLinesSel.addEventListener('change', () => {
                captionConfig.maxLines = parseInt(capLinesSel.value, 10);
                updateCaptionOverlayDOM();
                updatePlayerScreen();
                debouncedAutoSave();
            });
        }

        if (capBoxWidthSlider && capBoxWidthVal) {
            capBoxWidthSlider.addEventListener('input', () => {
                captionConfig.boxWidthPercent = parseInt(capBoxWidthSlider.value, 10);
                capBoxWidthVal.textContent = captionConfig.boxWidthPercent + '%';
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        if (capFontSel) {
            capFontSel.addEventListener('change', () => {
                captionConfig.fontFamily = capFontSel.value;
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        if (capPacingSel) {
            capPacingSel.addEventListener('change', () => {
                const val = capPacingSel.value;
                if (val === 'word') {
                    captionConfig.pacingMode = 'word';
                    captionConfig.wordsPerPhrase = 1;
                } else if (val === 'sentence') {
                    captionConfig.pacingMode = 'sentence';
                    captionConfig.wordsPerPhrase = 12;
                } else {
                    captionConfig.pacingMode = 'phrase';
                    captionConfig.wordsPerPhrase = parseInt(val, 10) || 3;
                }
                updatePlayerScreen();
                debouncedAutoSave();
            });
        }

        if (capColorInput) {
            capColorInput.addEventListener('input', () => {
                captionConfig.textColor = capColorInput.value;
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        if (capHighlightInput) {
            capHighlightInput.addEventListener('input', () => {
                captionConfig.highlightColor = capHighlightInput.value;
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        if (capSizeSlider && capSizeVal) {
            capSizeSlider.addEventListener('input', () => {
                captionConfig.fontSize = parseInt(capSizeSlider.value, 10);
                capSizeVal.textContent = captionConfig.fontSize + 'px';
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        if (capStrokeSlider && capStrokeVal) {
            capStrokeSlider.addEventListener('input', () => {
                captionConfig.strokeWidth = parseInt(capStrokeSlider.value, 10);
                capStrokeVal.textContent = captionConfig.strokeWidth + 'px';
                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        }

        // Caption Style Presets Event Handlers (Classic, Boxed, Yellow)
        root.querySelectorAll('#capcut-style-presets-row .btn-caption-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const styleId = btn.dataset.style;
                activeCaptionStyleId = styleId;
                captionConfig.style = styleId;

                root.querySelectorAll('#capcut-style-presets-row .btn-caption-preset').forEach(b => {
                    b.classList.toggle('is-active', b.dataset.style === styleId);
                });

                if (styleId === 'classic') {
                    captionConfig.textColor = '#ffffff';
                    captionConfig.strokeWidth = 3;
                    captionConfig.boxBgStyle = 'none';
                } else if (styleId === 'boxed') {
                    captionConfig.textColor = '#ffffff';
                    captionConfig.strokeWidth = 0;
                    captionConfig.boxBgStyle = 'pill';
                } else if (styleId === 'yellow') {
                    captionConfig.textColor = '#ffd400';
                    captionConfig.strokeWidth = 3;
                    captionConfig.boxBgStyle = 'none';
                }

                if (capColorInput) capColorInput.value = captionConfig.textColor;
                if (capStrokeSlider && capStrokeVal) {
                    capStrokeSlider.value = captionConfig.strokeWidth;
                    capStrokeVal.textContent = captionConfig.strokeWidth + 'px';
                }

                updateCaptionOverlayDOM();
                debouncedAutoSave();
            });
        });

        // Caption Size Presets Event Handlers (Small, Medium, Large)
        root.querySelectorAll('#capcut-size-presets-row .btn-caption-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const szId = btn.dataset.size;
                activeCaptionSizeId = szId;
                const preset = CAPTION_SIZE_PRESETS[szId];
                if (preset) {
                    captionConfig.fontSize = preset.size;
                    if (capSizeSlider && capSizeVal) {
                        capSizeSlider.value = captionConfig.fontSize;
                        capSizeVal.textContent = captionConfig.fontSize + 'px';
                    }
                    root.querySelectorAll('#capcut-size-presets-row .btn-caption-preset').forEach(b => {
                        b.classList.toggle('is-active', b.dataset.size === szId);
                    });
                    updateCaptionOverlayDOM();
                    debouncedAutoSave();
                }
            });
        });

        const btnDelCap = root.querySelector('#btn-del-selected-caption');
        if (btnDelCap) {
            btnDelCap.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSelectedCaption();
            });
        }

        let isResizingCaption = false;
        let resizeHandleType = null;
        let captionResizeStartX = 0;
        let captionResizeStartY = 0;
        let initialCaptionFontSize = 26;
        let initialCaptionBoxWidth = 88;

        if (capOverlay) {
            capOverlay.addEventListener('click', (e) => {
                e.stopPropagation();
                isCaptionSelected = true;
                selectedClipId = null;
                selectedAudioClipId = null;
                updateCaptionOverlayDOM();
            });

            capOverlay.addEventListener('pointerdown', (e) => {
                if (e.target.closest('#btn-del-selected-caption')) return;
                e.stopPropagation();
                isCaptionSelected = true;
                selectedClipId = null;
                selectedAudioClipId = null;

                const handle = e.target.closest('.capcut-cap-handle');
                if (handle) {
                    isResizingCaption = true;
                    resizeHandleType = handle.dataset.capHandle;
                    captionResizeStartX = e.clientX;
                    captionResizeStartY = e.clientY;
                    initialCaptionFontSize = captionConfig.fontSize || 26;
                    initialCaptionBoxWidth = captionConfig.boxWidthPercent || 88;
                    capOverlay.setPointerCapture(e.pointerId);
                    return;
                }

                isDraggingCaption = true;
                captionDragStartX = e.clientX;
                captionDragStartY = e.clientY;
                originalCapPosX = captionConfig.positionX;
                originalCapPosY = captionConfig.positionY;
                if (capSafeGuides) capSafeGuides.style.display = 'block';
                capOverlay.setPointerCapture(e.pointerId);
            });
        }

        if (screenBox) {
            screenBox.addEventListener('pointerdown', (e) => {
                if (isCaptionSelected && !e.target.closest('#capcut-caption-overlay')) {
                    isCaptionSelected = false;
                    updateCaptionOverlayDOM();
                }
            });
        }

        window.addEventListener('pointermove', (e) => {
            if (isResizingCaption) {
                const dx = e.clientX - captionResizeStartX;
                const dy = e.clientY - captionResizeStartY;
                if (resizeHandleType === 'ml' || resizeHandleType === 'mr') {
                    const rect = screenBox ? screenBox.getBoundingClientRect() : { width: 640 };
                    const deltaPct = (dx / (rect.width || 640)) * 100 * (resizeHandleType === 'mr' ? 2 : -2);
                    const newW = Math.max(30, Math.min(96, Math.round(initialCaptionBoxWidth + deltaPct)));
                    captionConfig.boxWidthPercent = newW;
                    if (capBoxWidthVal) capBoxWidthVal.textContent = newW + '%';
                    if (capBoxWidthSlider) capBoxWidthSlider.value = newW;
                    updateCaptionOverlayDOM();
                } else {
                    const distDelta = (resizeHandleType === 'br' || resizeHandleType === 'tr') ? (dx + dy) : (-dx - dy);
                    const newSize = Math.max(14, Math.min(64, Math.round(initialCaptionFontSize + distDelta * 0.25)));
                    captionConfig.fontSize = newSize;
                    if (capSizeVal) capSizeVal.textContent = newSize + 'px';
                    if (capSizeSlider) capSizeSlider.value = newSize;
                    updateCaptionOverlayDOM();
                }
                return;
            }

            if (!isDraggingCaption || !screenBox) return;
            const rect = screenBox.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const dx = e.clientX - captionDragStartX;
            const dy = e.clientY - captionDragStartY;

            const dPercentX = (dx / rect.width) * 100;
            const dPercentY = (dy / rect.height) * 100;

            const newX = Math.max(12, Math.min(88, originalCapPosX + dPercentX));
            const newY = Math.max(12, Math.min(88, originalCapPosY + dPercentY));

            captionConfig.positionX = parseFloat(newX.toFixed(1));
            captionConfig.positionY = parseFloat(newY.toFixed(1));

            if (capOverlay) {
                capOverlay.style.left = captionConfig.positionX + '%';
                capOverlay.style.top = captionConfig.positionY + '%';
            }
        });

        window.addEventListener('pointerup', () => {
            if (isResizingCaption) {
                isResizingCaption = false;
                resizeHandleType = null;
                updateCaptionOverlayDOM();
                pushHistoryState();
                debouncedAutoSave();
            }
            if (isDraggingCaption) {
                isDraggingCaption = false;
                if (capSafeGuides) capSafeGuides.style.display = 'none';
                updateCaptionOverlayDOM();
                pushHistoryState();
                debouncedAutoSave();
            }
        });

        setupTimelineResizeHandlers(root);
        setupMonitorTransformHandlers(root);

        btnExport.addEventListener('click', openExportSettingsModal);
    }

    // ── Pre-Timeline Scene Audio Slicer & Verification Engine ──
    let activeSceneAudioSource = null;
    let activePlayingButton = null;
    let sharedSceneAudioPlayer = null; // Single shared HTML5 Audio instance (avoids Chrome decoder exhaustion)
    let activeSceneAudioEndTime = 0;
    let activeSceneAudioTimeUpdateHandler = null;

    function stopActiveSceneAudio() {
        if (activeSceneAudioSource) {
            try { activeSceneAudioSource.stop(); } catch (e) {}
            activeSceneAudioSource = null;
        }
        if (sharedSceneAudioPlayer) {
            if (activeSceneAudioTimeUpdateHandler) {
                sharedSceneAudioPlayer.removeEventListener('timeupdate', activeSceneAudioTimeUpdateHandler);
                activeSceneAudioTimeUpdateHandler = null;
            }
            try { sharedSceneAudioPlayer.pause(); } catch (e) {}
        }
        if (activePlayingButton) {
            activePlayingButton.innerHTML = '▶ Play Scene Audio';
            activePlayingButton.classList.remove('is-playing');
            activePlayingButton = null;
        }
    }

    function playSceneAudioSlice(audioBuffer, audioFallbackUrl, startSec, endSec, btnElement) {
        if (activePlayingButton === btnElement) {
            stopActiveSceneAudio();
            return;
        }

        stopActiveSceneAudio();

        const start = Math.max(0, parseFloat(startSec) || 0);
        const rawEnd = parseFloat(endSec);
        const end = (!isNaN(rawEnd) && rawEnd > start) ? rawEnd : (start + 1.0);
        const dur = Math.max(0.2, end - start);

        // 1. First Priority: Web Audio API AudioBuffer (Zero-Latency, Millisecond Precision)
        const ctx = getAudioContext();
        if (ctx && audioBuffer && audioBuffer.duration && start < audioBuffer.duration) {
            try {
                if (ctx.state === 'suspended') {
                    ctx.resume().catch(() => {});
                }
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);

                const safeDur = Math.min(dur, Math.max(0.1, audioBuffer.duration - start));
                source.start(0, start, safeDur);
                activeSceneAudioSource = source;
                activePlayingButton = btnElement;

                btnElement.innerHTML = '⏸ Stop Audio';
                btnElement.classList.add('is-playing');

                source.onended = () => {
                    if (activeSceneAudioSource === source) {
                        stopActiveSceneAudio();
                    }
                };
                return;
            } catch (err) {
                console.warn('Web Audio slice play error, falling back to HTML5 audio:', err);
            }
        }

        // 2. Second Priority: Shared HTML5 Audio Player (Zero Decoder Leak & Buffer-Aware)
        if (audioFallbackUrl) {
            try {
                if (!sharedSceneAudioPlayer) {
                    sharedSceneAudioPlayer = new Audio();
                    sharedSceneAudioPlayer.preload = 'auto';
                }

                const aud = sharedSceneAudioPlayer;
                // Update source if URL changed
                if (!aud.src || (aud.src !== audioFallbackUrl && !aud.src.endsWith(audioFallbackUrl))) {
                    aud.src = audioFallbackUrl;
                    aud.load();
                }

                activePlayingButton = btnElement;
                btnElement.innerHTML = '⏸ Stop Audio';
                btnElement.classList.add('is-playing');

                activeSceneAudioEndTime = end;

                // Accurate timeupdate listener (pauses exactly when audio reaches end time)
                const onTimeUpdate = () => {
                    if (activePlayingButton !== btnElement) return;
                    if (aud.currentTime >= activeSceneAudioEndTime || aud.currentTime < (start - 1.0)) {
                        stopActiveSceneAudio();
                    }
                };
                activeSceneAudioTimeUpdateHandler = onTimeUpdate;
                aud.addEventListener('timeupdate', onTimeUpdate);

                let isPlaybackStarted = false;
                const startPlayback = () => {
                    if (activePlayingButton !== btnElement || isPlaybackStarted) return;
                    isPlaybackStarted = true;

                    aud.play().then(() => {
                        if (activePlayingButton !== btnElement) {
                            aud.pause();
                        }
                    }).catch(err => {
                        console.warn('Audio slice play() error:', err);
                        stopActiveSceneAudio();
                    });
                };

                // Safe seek execution
                const performSeekAndPlay = () => {
                    if (activePlayingButton !== btnElement) return;
                    try {
                        aud.currentTime = start;
                        if (aud.readyState >= 2 && Math.abs(aud.currentTime - start) < 0.25) {
                            startPlayback();
                        } else {
                            aud.addEventListener('seeked', startPlayback, { once: true });
                            // Safety timeout in case seeked doesn't fire promptly
                            setTimeout(() => {
                                if (!isPlaybackStarted && activePlayingButton === btnElement) {
                                    startPlayback();
                                }
                            }, 400);
                        }
                    } catch (seekErr) {
                        console.warn('Audio slice seek error:', seekErr);
                        startPlayback();
                    }
                };

                if (aud.readyState >= 1) { // HAVE_METADATA or higher
                    performSeekAndPlay();
                } else {
                    aud.addEventListener('loadedmetadata', performSeekAndPlay, { once: true });
                    aud.addEventListener('error', () => {
                        console.error('Audio slice failed to load URL:', audioFallbackUrl);
                        stopActiveSceneAudio();
                    }, { once: true });
                    aud.load();
                }
            } catch (err2) {
                console.error('Audio slice playback error:', err2);
                stopActiveSceneAudio();
            }
        }
    }

    // ── Render Pre-Timeline Verification Matrix (4-Column Table) ──
    function renderTimelineAutoSyncVerificationMatrix({
        modal,
        aligned,
        sceneMediaMatches,
        sceneAudioBuffer,
        audioFallbackUrl,
        whisperResult,
        audioDuration,
        availableMedia,
        onBack
    }) {
        const modalBox = modal.querySelector('.modal-box');
        if (!modalBox) return;

        stopActiveSceneAudio();

        const persistCurrentMatrix = () => {
            saveAutoSyncCache({
                audioFile: (voiceoverAudio && voiceoverAudio.file) || autoSyncAudioFile,
                audioDuration: audioDuration,
                audioFallbackUrl: audioFallbackUrl,
                whisperResult: whisperResult,
                aligned: aligned,
                sceneMediaMatches: sceneMediaMatches,
                scriptText: autoSyncScriptText
            });
        };

        modalBox.style.maxWidth = '1120px';
        modalBox.style.width = '96vw';
        modalBox.style.transition = 'all 0.25s ease';

        const matchedCount = sceneMediaMatches.filter(m => !m.isMissing).length;
        const missingCount = sceneMediaMatches.filter(m => m.isMissing).length;

        let rowsHTML = '';
        for (let i = 0; i < aligned.length; i++) {
            const sc = aligned[i];
            const matchInfo = sceneMediaMatches[i] || { matchedClip: null, matchTier: 'missing', isMissing: true };
            const clip = matchInfo.matchedClip;

            const thumbSrc = clip ? clip.url : '';
            const fileName = clip ? clip.name : `⚠️ Missing Media #${sc.sceneNumber}`;

            let tierBadgeHTML = '';
            if (matchInfo.matchTier === 'exact') {
                tierBadgeHTML = '<span class="badge-matched-tier badge-tier-exact">✓ Exact Name</span>';
            } else if (matchInfo.matchTier === 'serial') {
                tierBadgeHTML = '<span class="badge-matched-tier badge-tier-serial">✓ Serial Match</span>';
            } else if (matchInfo.matchTier === 'sequential') {
                tierBadgeHTML = '<span class="badge-matched-tier badge-tier-serial">✓ Sequential</span>';
            } else {
                tierBadgeHTML = '<span class="badge-matched-tier badge-tier-missing">⚠️ Missing Slot</span>';
            }

            // Render Whisper Words Chips & Manual Controls
            const allWhisperWords = (whisperResult && whisperResult.words) || [];
            const sceneWords = sc.matchedWords || [];
            let wordsHTML = '';

            // Previous neighbor word preview (click to include)
            let prevNeighborHTML = '';
            if (sc.firstWordIdx > 0 && allWhisperWords[sc.firstWordIdx - 1]) {
                const pw = allWhisperWords[sc.firstWordIdx - 1];
                prevNeighborHTML = `<span class="whisper-word-chip neighbor-chip" data-scene-idx="${i}" data-target-action="expand-start-prev" title="Click to PULL previous word '${escapeHTML(pw.word)}' into Scene #${sc.sceneNumber}">+ ${escapeHTML(pw.word)}</span>`;
            }

            if (sceneWords.length > 0) {
                wordsHTML = sceneWords.map((w, wIdx) => {
                    const globalIdx = sc.firstWordIdx + wIdx;
                    const isFirst = (wIdx === 0);
                    const isLast = (wIdx === sceneWords.length - 1);
                    const chipClass = isFirst ? 'is-first' : (isLast ? 'is-last' : '');
                    const startStr = (w.start != null) ? w.start.toFixed(2) + 's' : '';
                    const endStr = (w.end != null) ? w.end.toFixed(2) + 's' : '';
                    return `<span class="whisper-word-chip interactive-chip ${chipClass}" data-scene-idx="${i}" data-global-idx="${globalIdx}" data-word="${escapeHTML(w.word)}" title="Click to set boundary: '${escapeHTML(w.word)}' (${startStr} - ${endStr})">` +
                           `${escapeHTML(w.word)} <small>${startStr}</small>` +
                           `</span>`;
                }).join('');
            } else {
                wordsHTML = '<span style="color:#94a3b8;font-style:italic;font-size:0.85em;">(No distinct speech detected / Ambient gap)</span>';
            }

            // Next neighbor word preview (click to include)
            let nextNeighborHTML = '';
            if (sc.lastWordIdx < allWhisperWords.length - 1 && allWhisperWords[sc.lastWordIdx + 1]) {
                const nw = allWhisperWords[sc.lastWordIdx + 1];
                nextNeighborHTML = `<span class="whisper-word-chip neighbor-chip" data-scene-idx="${i}" data-target-action="expand-end-next" title="Click to EXTEND last word '${escapeHTML(nw.word)}' into Scene #${sc.sceneNumber}">+ ${escapeHTML(nw.word)}</span>`;
            }

            // Duration & Silence
            const spokenDur = Math.max(0, sc.spokenEnd - sc.spokenStart);
            const silenceAdded = sc.silenceAdded || 0;

            rowsHTML += `
                <tr data-scene-index="${i}">
                    <!-- Col 1: Scene & Media Asset -->
                    <td style="width:230px;min-width:210px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span class="autosync-scene-badge">#${sc.sceneNumber}</span>
                            <div style="overflow:hidden;flex:1;">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    ${thumbSrc ? `<img src="${thumbSrc}" class="autosync-file-thumb" alt="">` : `<span style="font-size:1.4em;">🖼️</span>`}
                                    <div style="overflow:hidden;flex:1;">
                                        <select class="matrix-media-picker" data-scene-idx="${i}" style="width:100%;max-width:145px;background:#1e293b;color:#f8fafc;border:1px solid rgba(255,255,255,0.18);border-radius:4px;font-size:0.8em;padding:2px 4px;cursor:pointer;outline:none;">
                                            <option value="__missing__" ${matchInfo.isMissing ? 'selected' : ''}>⚠️ [Missing Slot]</option>
                                            ${availableMedia.map(m => `
                                                <option value="${m.id}" ${(!matchInfo.isMissing && clip && clip.id === m.id) ? 'selected' : ''}>
                                                    ${escapeHTML(m.name)}
                                                </option>
                                            `).join('')}
                                        </select>
                                        <div style="margin-top:2px;">${tierBadgeHTML}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </td>

                    <!-- Col 2: Expected Script Line (Control 2: Inline Script Editor & Re-Align) -->
                    <td style="max-width:280px;min-width:210px;">
                        <div style="display:flex;flex-direction:column;gap:5px;">
                            <textarea class="inline-script-edit custom-scrollbar" data-scene-idx="${i}" rows="3" 
                                placeholder="Scene voiceover text...">${escapeHTML(sc.voiceover || '')}</textarea>
                            <div style="display:flex;align-items:center;justify-content:flex-end;">
                                <button type="button" class="btn-scene-realign" data-scene-idx="${i}" 
                                    title="Re-align this scene against Whisper speech using the edited text">
                                    🔄 Re-Align
                                </button>
                            </div>
                        </div>
                    </td>

                    <!-- Col 3: Whisper Transcribed Words (With Manual Word Shift & Click-to-Set) -->
                    <td style="min-width:260px;max-width:360px;">
                        <!-- Shift Arrows (Option 2) -->
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:3px 6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;font-size:0.75em;">
                            <div style="display:flex;align-items:center;gap:4px;">
                                <span style="font-weight:700;color:#10b981;">START:</span>
                                <button type="button" class="btn-word-shift" data-scene-idx="${i}" data-boundary="start" data-delta="-1" title="Pull 1 word from previous scene">◀ Word</button>
                                <button type="button" class="btn-word-shift" data-scene-idx="${i}" data-boundary="start" data-delta="1" title="Push first word to previous scene">Word ▶</button>
                            </div>
                            <div style="display:flex;align-items:center;gap:4px;">
                                <span style="font-weight:700;color:#38bdf8;">END:</span>
                                <button type="button" class="btn-word-shift" data-scene-idx="${i}" data-boundary="end" data-delta="-1" title="Shrink end of this scene by 1 word">◀ Word</button>
                                <button type="button" class="btn-word-shift" data-scene-idx="${i}" data-boundary="end" data-delta="1" title="Extend end of this scene by 1 word">Word ▶</button>
                            </div>
                        </div>

                        <!-- Words Stream with Option 1 Clickable Chips -->
                        <div class="whisper-words-stream custom-scrollbar">
                            ${prevNeighborHTML}
                            ${wordsHTML}
                            ${nextNeighborHTML}
                        </div>
                    </td>

                    <!-- Col 4: Image Timeline Duration & Audio Cut Player (Control 1: Direct Seconds Tweaker) -->
                    <td style="width:230px;min-width:210px;">
                        <div style="display:flex;flex-direction:column;gap:5px;">
                            <div>
                                <span style="font-weight:700;color:#38bdf8;font-size:0.94em;font-variant-numeric:tabular-nums;">
                                    ${sc.start.toFixed(2)}s ➔ ${sc.end.toFixed(2)}s
                                </span>
                                <span style="color:#fff;font-weight:700;margin-left:4px;font-size:0.9em;">
                                    (${sc.duration.toFixed(2)}s)
                                </span>
                            </div>
                            <div style="font-size:0.77em;color:#94a3b8;">
                                Spoken: <b style="color:#e2e8f0;">${spokenDur.toFixed(2)}s</b>
                                ${silenceAdded > 0.04 
                                    ? ` | Silence: <b style="color:#38bdf8;">+${silenceAdded.toFixed(2)}s</b>` 
                                    : ` | Silence: <b style="color:#10b981;">+0.00s (Continuous)</b>`}
                            </div>

                            <!-- Control 1: Direct Seconds Tweaker Bar -->
                            <div style="display:flex;flex-direction:column;gap:3px;margin:2px 0 3px 0;padding:3px 5px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;font-size:0.75em;">
                                <div style="display:flex;align-items:center;justify-content:space-between;">
                                    <span style="font-weight:700;color:#10b981;font-size:0.82em;">CUT IN:</span>
                                    <div style="display:flex;align-items:center;gap:2px;">
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="start" data-delta="-0.5" title="Shift cut start 0.5s earlier">-0.5s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="start" data-delta="-0.1" title="Shift cut start 0.1s earlier">-0.1s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="start" data-delta="0.1" title="Shift cut start 0.1s later">+0.1s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="start" data-delta="0.5" title="Shift cut start 0.5s later">+0.5s</button>
                                    </div>
                                </div>
                                <div style="display:flex;align-items:center;justify-content:space-between;">
                                    <span style="font-weight:700;color:#38bdf8;font-size:0.82em;">CUT OUT:</span>
                                    <div style="display:flex;align-items:center;gap:2px;">
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="end" data-delta="-0.5" title="Shift cut end 0.5s earlier">-0.5s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="end" data-delta="-0.1" title="Shift cut end 0.1s earlier">-0.1s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="end" data-delta="0.1" title="Shift cut end 0.1s later">+0.1s</button>
                                        <button type="button" class="btn-time-tweak" data-scene-idx="${i}" data-boundary="end" data-delta="0.5" title="Shift cut end 0.5s later">+0.5s</button>
                                    </div>
                                </div>
                            </div>

                            <div style="margin-top:1px;">
                                <button type="button" class="btn-scene-audio-slice" data-scene-idx="${i}" data-start="${sc.spokenStart}" data-end="${sc.spokenEnd}">
                                    ▶ Play Scene Audio
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }

        modalBox.innerHTML = `
            <div class="modal-header" style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div class="modal-title" style="display:flex;align-items:center;gap:10px;">
                    <span>📋 Pre-Timeline Verification Matrix (4-Column Sync Review)</span>
                    <span id="autosync-matrix-save-badge" style="display:inline-flex;align-items:center;gap:4px;font-size:0.75em;color:#10b981;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);padding:2px 8px;border-radius:12px;font-weight:600;" title="All manual edits and timing tweaks are instantly saved to browser storage">✓ Auto-Saved</span>
                </div>
                <button type="button" class="modal-close-btn" id="btn-close-matrix-modal">✕</button>
            </div>

            <div class="modal-body" style="padding:14px 16px;">
                <!-- Summary Metrics Bar -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:10px;">
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;">
                        <span style="font-size:0.7em;color:#94a3b8;text-transform:uppercase;font-weight:700;display:block;">Total Scenes:</span>
                        <span style="font-weight:700;font-size:1.05em;color:#38bdf8;">${aligned.length} Scenes</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;">
                        <span style="font-size:0.7em;color:#94a3b8;text-transform:uppercase;font-weight:700;display:block;">Audio Duration:</span>
                        <span style="font-weight:700;font-size:1.05em;color:#10b981;">${fmtTime(audioDuration)}</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;">
                        <span style="font-size:0.7em;color:#94a3b8;text-transform:uppercase;font-weight:700;display:block;">Media Matches:</span>
                        <span style="font-weight:700;font-size:1.05em;color:${missingCount > 0 ? '#f59e0b' : '#10b981'};">${matchedCount} / ${aligned.length} Clips</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;">
                        <span style="font-size:0.7em;color:#94a3b8;text-transform:uppercase;font-weight:700;display:block;">Silence Rule:</span>
                        <span style="font-weight:700;font-size:0.88em;color:#38bdf8;">Smart Silence (Prior Image)</span>
                    </div>
                </div>

                <!-- 4-Column Table -->
                <div class="autosync-matrix-wrap custom-scrollbar">
                    <table class="autosync-matrix-table">
                        <thead>
                            <tr>
                                <th>Col 1: Scene & Media</th>
                                <th>Col 2: Expected Script Line</th>
                                <th>Col 3: Whisper Transcribed Words [Timestamps]</th>
                                <th>Col 4: Timeline Duration & Audio Slicer</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHTML}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="modal-actions" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">
                <button type="button" class="btn-modal-cancel" id="btn-matrix-back" style="display:flex;align-items:center;gap:6px;">
                    <span>← Re-edit Script / Back</span>
                </button>
                <div style="display:flex;align-items:center;gap:10px;">
                    <button type="button" class="btn-modal-cancel" id="btn-matrix-cancel">
                        Cancel
                    </button>
                    <button type="button" class="btn-modal-primary" id="btn-matrix-gemini-review" style="background:linear-gradient(135deg, #7c3aed 0%, #9333ea 100%);box-shadow:0 4px 16px rgba(124,58,237,0.4);font-size:0.9em;padding:10px 18px;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
                        🤖 AI Agent Review
                    </button>
                    <button type="button" class="btn-modal-primary" id="btn-matrix-apply" style="background:linear-gradient(135deg, #0284c7 0%, #2563eb 100%);box-shadow:0 4px 16px rgba(2,132,199,0.5);font-size:0.9em;padding:10px 20px;">
                        🚀 Apply Verified Mapping to Timeline
                    </button>
                </div>
            </div>
        `;

        // ── Control 1: Direct Seconds Tweaker Listener (±0.1s / ±0.5s) ──
        modalBox.querySelectorAll('.btn-time-tweak').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sceneIdx = parseInt(btn.getAttribute('data-scene-idx'), 10);
                const boundary = btn.getAttribute('data-boundary');
                const delta = parseFloat(btn.getAttribute('data-delta'));
                const sc = aligned[sceneIdx];
                if (!sc) return;

                const rawWordsList = (whisperResult && whisperResult.words) || [];
                const totalDur = audioDuration || (whisperResult && whisperResult.duration) || 10;

                if (boundary === 'start') {
                    let minAllowed = (sceneIdx > 0) ? (aligned[sceneIdx - 1].spokenStart + 0.2) : 0.0;
                    let maxAllowed = sc.spokenEnd - 0.2;
                    let targetStart = Math.max(minAllowed, Math.min(maxAllowed, sc.spokenStart + delta));
                    sc.spokenStart = parseFloat(targetStart.toFixed(2));

                    if (rawWordsList.length > 0) {
                        let closestIdx = 0;
                        let minDiff = Infinity;
                        for (let w = 0; w < rawWordsList.length; w++) {
                            let diff = Math.abs(rawWordsList[w].start - sc.spokenStart);
                            if (diff < minDiff) {
                                minDiff = diff;
                                closestIdx = w;
                            }
                        }
                        sc.firstWordIdx = closestIdx;
                        if (sc.lastWordIdx < sc.firstWordIdx) sc.lastWordIdx = sc.firstWordIdx;
                        if (sceneIdx > 0) {
                            aligned[sceneIdx - 1].lastWordIdx = Math.max(aligned[sceneIdx - 1].firstWordIdx, sc.firstWordIdx - 1);
                        }
                    }
                } else if (boundary === 'end') {
                    if (sceneIdx < aligned.length - 1) {
                        const nextSc = aligned[sceneIdx + 1];
                        let minAllowed = sc.spokenStart + 0.2;
                        let maxAllowed = (sceneIdx + 1 < aligned.length - 1) ? (aligned[sceneIdx + 2].spokenStart - 0.2) : totalDur;
                        let targetEnd = Math.max(minAllowed, Math.min(maxAllowed, nextSc.spokenStart + delta));
                        nextSc.spokenStart = parseFloat(targetEnd.toFixed(2));

                        if (rawWordsList.length > 0) {
                            let closestIdx = 0;
                            let minDiff = Infinity;
                            for (let w = 0; w < rawWordsList.length; w++) {
                                let diff = Math.abs(rawWordsList[w].start - nextSc.spokenStart);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    closestIdx = w;
                                }
                            }
                            nextSc.firstWordIdx = closestIdx;
                            if (nextSc.lastWordIdx < nextSc.firstWordIdx) nextSc.lastWordIdx = nextSc.firstWordIdx;
                            sc.lastWordIdx = Math.max(sc.firstWordIdx, nextSc.firstWordIdx - 1);
                        }
                    } else {
                        let targetEnd = Math.max(sc.spokenStart + 0.2, Math.min(totalDur, sc.spokenEnd + delta));
                        sc.spokenEnd = parseFloat(targetEnd.toFixed(2));
                    }
                }

                recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                persistCurrentMatrix();

                const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                const scrollPos = wrap ? wrap.scrollTop : 0;

                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack
                });

                const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                if (newWrap) newWrap.scrollTop = scrollPos;
            });
        });

        // ── Column 1: Interactive Media Dropdown Picker Listener ──
        modalBox.querySelectorAll('.matrix-media-picker').forEach(sel => {
            sel.addEventListener('change', (e) => {
                e.stopPropagation();
                const sceneIdx = parseInt(sel.getAttribute('data-scene-idx'), 10);
                const val = sel.value;
                if (val === '__missing__') {
                    sceneMediaMatches[sceneIdx] = {
                        scene: aligned[sceneIdx],
                        matchedClip: null,
                        matchTier: 'missing',
                        isMissing: true
                    };
                } else {
                    const pickedClip = availableMedia.find(c => c.id === val);
                    sceneMediaMatches[sceneIdx] = {
                        scene: aligned[sceneIdx],
                        matchedClip: pickedClip || null,
                        matchTier: 'manual',
                        isMissing: !pickedClip
                    };
                }
                persistCurrentMatrix();

                const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                const scrollPos = wrap ? wrap.scrollTop : 0;

                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack
                });

                const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                if (newWrap) newWrap.scrollTop = scrollPos;
            });
        });

        // ── Control 2: Inline Script Edit & Re-Align Listener ──
        modalBox.querySelectorAll('.inline-script-edit').forEach(ta => {
            ta.addEventListener('input', () => {
                const sceneIdx = parseInt(ta.getAttribute('data-scene-idx'), 10);
                if (aligned[sceneIdx]) {
                    aligned[sceneIdx].voiceover = ta.value;
                    persistCurrentMatrix();
                }
            });
            ta.addEventListener('blur', () => {
                persistCurrentMatrix();
            });
        });

        modalBox.querySelectorAll('.btn-scene-realign').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sceneIdx = parseInt(btn.getAttribute('data-scene-idx'), 10);
                const sc = aligned[sceneIdx];
                if (!sc) return;

                const ta = modalBox.querySelector(`.inline-script-edit[data-scene-idx="${sceneIdx}"]`);
                if (ta) {
                    sc.voiceover = ta.value.trim();
                }

                const rawWordsList = (whisperResult && whisperResult.words) || [];
                if (!rawWordsList.length) return;

                realignSingleScene(aligned, sceneIdx, rawWordsList, audioDuration);
                recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                persistCurrentMatrix();

                const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                const scrollPos = wrap ? wrap.scrollTop : 0;

                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack
                });

                const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                if (newWrap) newWrap.scrollTop = scrollPos;
            });
        });

        // ── Manual Word Shift Arrows Listener (Option 2) ──
        modalBox.querySelectorAll('.btn-word-shift').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sceneIdx = parseInt(btn.getAttribute('data-scene-idx'), 10);
                const boundary = btn.getAttribute('data-boundary');
                const delta = parseInt(btn.getAttribute('data-delta'), 10);
                const rawWordsList = (whisperResult && whisperResult.words) || [];

                const sc = aligned[sceneIdx];
                if (!sc) return;

                if (boundary === 'start') {
                    if (delta === -1 && sc.firstWordIdx > 0) {
                        sc.firstWordIdx -= 1;
                        if (sceneIdx > 0) {
                            aligned[sceneIdx - 1].lastWordIdx = sc.firstWordIdx - 1;
                        }
                    } else if (delta === 1 && sc.firstWordIdx < sc.lastWordIdx) {
                        sc.firstWordIdx += 1;
                        if (sceneIdx > 0) {
                            aligned[sceneIdx - 1].lastWordIdx = sc.firstWordIdx - 1;
                        }
                    }
                } else if (boundary === 'end') {
                    if (delta === -1 && sc.lastWordIdx > sc.firstWordIdx) {
                        sc.lastWordIdx -= 1;
                        if (sceneIdx < aligned.length - 1) {
                            aligned[sceneIdx + 1].firstWordIdx = sc.lastWordIdx + 1;
                        }
                    } else if (delta === 1 && sc.lastWordIdx < rawWordsList.length - 1) {
                        sc.lastWordIdx += 1;
                        if (sceneIdx < aligned.length - 1) {
                            aligned[sceneIdx + 1].firstWordIdx = sc.lastWordIdx + 1;
                        }
                    }
                }

                recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                persistCurrentMatrix();

                // Preserve scroll position
                const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                const scrollPos = wrap ? wrap.scrollTop : 0;

                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack
                });

                const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                if (newWrap) newWrap.scrollTop = scrollPos;
            });
        });

        // ── Neighbor Word Expand Click Listener ──
        modalBox.querySelectorAll('.neighbor-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const sceneIdx = parseInt(chip.getAttribute('data-scene-idx'), 10);
                const action = chip.getAttribute('data-target-action');
                const rawWordsList = (whisperResult && whisperResult.words) || [];
                const sc = aligned[sceneIdx];
                if (!sc) return;

                if (action === 'expand-start-prev' && sc.firstWordIdx > 0) {
                    sc.firstWordIdx -= 1;
                    if (sceneIdx > 0) aligned[sceneIdx - 1].lastWordIdx = sc.firstWordIdx - 1;
                } else if (action === 'expand-end-next' && sc.lastWordIdx < rawWordsList.length - 1) {
                    sc.lastWordIdx += 1;
                    if (sceneIdx < aligned.length - 1) aligned[sceneIdx + 1].firstWordIdx = sc.lastWordIdx + 1;
                }

                recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                persistCurrentMatrix();

                const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                const scrollPos = wrap ? wrap.scrollTop : 0;

                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack
                });

                const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                if (newWrap) newWrap.scrollTop = scrollPos;
            });
        });

        // ── Word Chip Click-to-Set Boundary Listener (Option 1) ──
        let activePopover = null;
        const removeActivePopover = () => {
            if (activePopover) {
                activePopover.remove();
                activePopover = null;
            }
        };

        modalBox.querySelectorAll('.interactive-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                removeActivePopover();

                const sceneIdx = parseInt(chip.getAttribute('data-scene-idx'), 10);
                const globalIdx = parseInt(chip.getAttribute('data-global-idx'), 10);
                const wordText = chip.getAttribute('data-word') || '';
                const rawWordsList = (whisperResult && whisperResult.words) || [];

                const popover = document.createElement('div');
                popover.className = 'word-chip-popover';
                popover.style.position = 'fixed';
                const rect = chip.getBoundingClientRect();
                popover.style.top = `${rect.bottom + 6}px`;
                popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 240, rect.left - 40))}px`;
                popover.style.zIndex = '9999999';
                popover.style.background = '#1e293b';
                popover.style.border = '1px solid rgba(56,189,248,0.45)';
                popover.style.borderRadius = '8px';
                popover.style.padding = '8px 10px';
                popover.style.boxShadow = '0 10px 25px rgba(0,0,0,0.6)';
                popover.style.display = 'flex';
                popover.style.flexDirection = 'column';
                popover.style.gap = '6px';
                popover.style.minWidth = '200px';

                popover.innerHTML = `
                    <div style="font-size:0.78em;color:#94a3b8;font-weight:600;display:flex;justify-content:space-between;align-items:center;">
                        <span>Word: "<b style="color:#fff;">${escapeHTML(wordText)}</b>"</span>
                        <button type="button" class="btn-popover-close" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:0.9em;">✕</button>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:2px;">
                        <button type="button" class="btn-popover-start" style="flex:1;background:rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.5);padding:5px 8px;border-radius:5px;font-size:0.78em;font-weight:700;cursor:pointer;transition:all 0.15s ease;">
                            🟢 Set as Start
                        </button>
                        <button type="button" class="btn-popover-end" style="flex:1;background:rgba(56,189,248,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.5);padding:5px 8px;border-radius:5px;font-size:0.78em;font-weight:700;cursor:pointer;transition:all 0.15s ease;">
                            🔵 Set as End
                        </button>
                    </div>
                `;

                document.body.appendChild(popover);
                activePopover = popover;

                popover.querySelector('.btn-popover-close').addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    removeActivePopover();
                });

                popover.querySelector('.btn-popover-start').addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    removeActivePopover();
                    const sc = aligned[sceneIdx];
                    if (!sc) return;

                    sc.firstWordIdx = globalIdx;
                    if (sc.lastWordIdx < globalIdx) sc.lastWordIdx = globalIdx;
                    if (sceneIdx > 0) aligned[sceneIdx - 1].lastWordIdx = globalIdx - 1;

                    recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                    persistCurrentMatrix();

                    const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                    const scrollPos = wrap ? wrap.scrollTop : 0;

                    renderTimelineAutoSyncVerificationMatrix({
                        modal,
                        aligned,
                        sceneMediaMatches,
                        sceneAudioBuffer,
                        audioFallbackUrl,
                        whisperResult,
                        audioDuration,
                        availableMedia,
                        onBack
                    });

                    const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                    if (newWrap) newWrap.scrollTop = scrollPos;
                });

                popover.querySelector('.btn-popover-end').addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    removeActivePopover();
                    const sc = aligned[sceneIdx];
                    if (!sc) return;

                    sc.lastWordIdx = globalIdx;
                    if (sc.firstWordIdx > globalIdx) sc.firstWordIdx = globalIdx;
                    if (sceneIdx < aligned.length - 1) aligned[sceneIdx + 1].firstWordIdx = globalIdx + 1;

                    recalculateAlignedTimeline(aligned, rawWordsList, audioDuration);
                    persistCurrentMatrix();

                    const wrap = modalBox.querySelector('.autosync-matrix-wrap');
                    const scrollPos = wrap ? wrap.scrollTop : 0;

                    renderTimelineAutoSyncVerificationMatrix({
                        modal,
                        aligned,
                        sceneMediaMatches,
                        sceneAudioBuffer,
                        audioFallbackUrl,
                        whisperResult,
                        audioDuration,
                        availableMedia,
                        onBack
                    });

                    const newWrap = modalBox.querySelector('.autosync-matrix-wrap');
                    if (newWrap) newWrap.scrollTop = scrollPos;
                });
            });
        });

        // Close popover on outside click
        modal.addEventListener('click', removeActivePopover);

        // Wire Event Listeners
        const closeBtn = modalBox.querySelector('#btn-close-matrix-modal');
        const cancelBtn = modalBox.querySelector('#btn-matrix-cancel');
        const backBtn = modalBox.querySelector('#btn-matrix-back');
        const applyBtn = modalBox.querySelector('#btn-matrix-apply');
        const geminiReviewBtn = modalBox.querySelector('#btn-matrix-gemini-review');

        // Cache last auto sync package for global Agent Review button
        window._lastAutoSyncPackage = {
            aligned,
            sceneMediaMatches,
            sceneAudioBuffer,
            audioFallbackUrl,
            whisperResult,
            audioDuration,
            availableMedia
        };

        if (geminiReviewBtn) {
            geminiReviewBtn.addEventListener('click', () => {
                openAgentReviewModal({
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onApplied: (newAligned) => {
                        renderTimelineAutoSyncVerificationMatrix({
                            modal,
                            aligned: newAligned,
                            sceneMediaMatches,
                            sceneAudioBuffer,
                            audioFallbackUrl,
                            whisperResult,
                            audioDuration,
                            availableMedia,
                            onBack
                        });
                    }
                });
            });
        }

        const onBeforeUnloadHandler = () => {
            persistCurrentMatrix();
        };
        window.addEventListener('beforeunload', onBeforeUnloadHandler);

        const doClose = () => {
            persistCurrentMatrix();
            stopActiveSceneAudio();
            window.removeEventListener('beforeunload', onBeforeUnloadHandler);
            modal.remove();
        };

        if (closeBtn) closeBtn.addEventListener('click', doClose);
        if (cancelBtn) cancelBtn.addEventListener('click', doClose);

        if (backBtn) {
            backBtn.addEventListener('click', () => {
                persistCurrentMatrix();
                stopActiveSceneAudio();
                window.removeEventListener('beforeunload', onBeforeUnloadHandler);
                if (onBack) onBack();
            });
        }

        // Audio Slice Buttons
        const sliceBtns = modalBox.querySelectorAll('.btn-scene-audio-slice');
        sliceBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const startSec = parseFloat(btn.dataset.start || '0');
                const endSec = parseFloat(btn.dataset.end || '0');
                playSceneAudioSlice(sceneAudioBuffer, audioFallbackUrl, startSec, endSec, btn);
            });
        });

        // Apply to Timeline
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                stopActiveSceneAudio();
                applyVerifiedAutoSyncToTimeline({
                    aligned,
                    sceneMediaMatches,
                    whisperResult,
                    audioDuration,
                    modal
                });
            });
        }
    }

    // ── Apply Verified Mapping to Main CapCut Timeline ────────
    function applyVerifiedAutoSyncToTimeline({
        aligned,
        sceneMediaMatches,
        whisperResult,
        audioDuration,
        modal
    }) {
        stopActiveSceneAudio();

        // Capture timeline undo history before retiming
        pushHistoryState();

        // Populate Auto-Captions word timestamps and automatically turn ON animated captions
        if (whisperResult && whisperResult.words && whisperResult.words.length > 0) {
            captionConfig.customWordsList = whisperResult.words.map(w => ({
                word: w.word,
                start: w.start,
                end: w.end
            }));
            captionConfig.enabled = true;
            const chk = document.getElementById('capcut-caption-enable-chk');
            if (chk) chk.checked = true;
            updateCaptionOverlayDOM();
            renderCaptionForTime(playheadTime);
        }

        const matchedClipIds = new Set();
        const missingSceneNumbers = [];
        let lastMatchedEndTime = audioDuration || 0;

        for (let i = 0; i < aligned.length; i++) {
            const sc = aligned[i];
            const matchInfo = sceneMediaMatches[i];
            const matchedClip = matchInfo ? matchInfo.matchedClip : null;

            if (matchedClip) {
                matchedClipIds.add(matchedClip.id);
                matchedClip.timestampSec = sc.start;
                matchedClip.duration = sc.duration;
                matchedClip.isMissing = false;
                if (sc.end > lastMatchedEndTime) lastMatchedEndTime = sc.end;
            } else {
                // Truly missing image (e.g. user uploaded fewer images than scene count)
                missingSceneNumbers.push(sc.sceneNumber);
                const placeholderClip = {
                    id: 'clip_missing_' + sc.sceneNumber + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    name: `⚠️ Missing Image #${sc.sceneNumber}`,
                    type: 'image',
                    url: '',
                    isMissing: true,
                    missingSceneNumber: sc.sceneNumber,
                    timestampSec: sc.start,
                    duration: sc.duration,
                    serial: sc.sceneNumber,
                    scale: 1.0,
                    posX: 0,
                    posY: 0,
                    motion: 'none',
                    transition: 'fade',
                    volume: 100,
                    speed: 1.0,
                    trimStart: 0,
                    trimEnd: 0
                };
                mediaClips.push(placeholderClip);
                if (sc.end > lastMatchedEndTime) lastMatchedEndTime = sc.end;
            }
        }

        // Preserve all remaining/extra clips sequentially right after the audio!
        const extraClips = mediaClips.filter(c => !matchedClipIds.has(c.id) && !c.isMissing);
        let extraCursor = lastMatchedEndTime;
        extraClips.forEach(c => {
            c.timestampSec = parseFloat(extraCursor.toFixed(2));
            c.duration = c.duration || 3.0;
            extraCursor += c.duration;
        });

        // Sort all clips by timestampSec and update serials #1, #2, ... #120
        mediaClips.sort((a, b) => a.timestampSec - b.timestampSec);
        let totalTime = 0;
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
            totalTime = Math.max(totalTime, mediaClips[i].timestampSec + mediaClips[i].duration);
        }

        const totalAudioTime = voiceoverAudio ? voiceoverAudio.duration : 0;
        totalTimelineDuration = Math.max(15, totalTime + 2, totalAudioTime + 2);

        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();

        if (modal) modal.remove();
        ensurePlayheadVisible(true);

        if (missingSceneNumbers.length > 0) {
            alert(`⚠️ Auto-Sync Alignment Completed!\n\nNotice: Image #${missingSceneNumbers.join(', #')} are missing in your uploaded files!\n\nEmpty slots with exact spoken durations have been created on the timeline so your speech timing is 100% preserved. You can drop the missing images directly onto the timeline anytime.`);
        }
    }

    // ── Open Timeline Auto-Sync Modal (Zero-Blur Overlay) ──
    function openTimelineAutoSyncModal() {
        const existingModal = document.getElementById('modal-timeline-autosync');
        if (existingModal) {
            stopActiveSceneAudio();
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'modal-timeline-autosync';
        modal.className = 'modal-overlay';

        const savedSession = loadAutoSyncCache();
        let savedBannerHTML = '';
        if (savedSession && savedSession.aligned && savedSession.aligned.length > 0) {
            savedBannerHTML = `
                <div id="autosync-resume-banner" style="background:linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,78,59,0.22) 100%);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div style="min-width:240px;flex:1;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:1.15em;">🟢</span>
                            <span style="font-weight:700;color:#34d399;font-size:0.92em;">Saved Auto-Sync Session Available</span>
                            <span style="font-size:0.75em;color:#94a3b8;margin-left:4px;">(${escapeHTML(savedSession.dateStr || 'Recent')})</span>
                        </div>
                        <div style="font-size:0.8em;color:#cbd5e1;margin-top:3px;">
                            Audio: <b style="color:#fff;">${escapeHTML(savedSession.audioName || 'voiceover')}</b> | <b style="color:#38bdf8;">${savedSession.aligned.length} Scenes</b> (All manual timing tweaks preserved)
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button type="button" id="btn-resume-autosync-cache" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:0.85em;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:0 3px 10px rgba(16,185,129,0.3);">
                            <span>▶ Resume Saved Review (0s)</span>
                        </button>
                        <button type="button" id="btn-discard-autosync-cache" style="background:rgba(255,255,255,0.06);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px 12px;font-size:0.8em;font-weight:600;cursor:pointer;" title="Clear cache and start fresh">
                            <span>🔄 Start New Project</span>
                        </button>
                    </div>
                </div>
            `;
        }

        if (!voiceoverAudio) {
            getAllFilesFromDB().then(fileMap => {
                const aFile = fileMap['audio_voiceover_track'] || Object.values(fileMap).find(f => f && f.type && (f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i)));
                if (aFile && !voiceoverAudio) {
                    const aUrl = URL.createObjectURL(aFile);
                    voiceoverAudio = {
                        id: 'audio_voiceover_track',
                        file: aFile,
                        url: aUrl,
                        duration: (savedSession && savedSession.audioDuration) || 10,
                        name: (savedSession && savedSession.audioName) || aFile.name,
                        timestampSec: 0,
                        audioElement: new Audio(aUrl),
                        waveformPeaks: []
                    };
                    const audNameEl = modal.querySelector('#modal-autosync-audio-name');
                    if (audNameEl) {
                        audNameEl.innerHTML = `✓ ${escapeHTML(voiceoverAudio.name)} (${voiceoverAudio.duration.toFixed(1)}s)`;
                    }
                }
            }).catch(() => {});
        }

        modal.innerHTML = `
            <div class="modal-box" style="max-width: 620px;">
                <div class="modal-header">
                    <div class="modal-title">
                        <span>🤖 Auto-Sync Timeline (Script ➔ Media Sync)</span>
                    </div>
                    <button type="button" class="modal-close-btn" id="btn-close-autosync-modal">✕</button>
                </div>
                <div class="modal-body">
                    ${savedBannerHTML}
                    <!-- Status of Audio & Media on Timeline -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;">
                            <div style="font-size:0.75em;color:#94a3b8;text-transform:uppercase;font-weight:700;">🎙️ Current Timeline Audio:</div>
                            <div id="modal-autosync-audio-name" style="font-weight:600;font-size:0.88em;color:#38bdf8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">
                                ${voiceoverAudio ? '✓ ' + voiceoverAudio.name + ' (' + voiceoverAudio.duration.toFixed(1) + 's)' : '<span style="color:#f59e0b;">⚠️ No Audio Loaded</span>'}
                            </div>
                        </div>
                        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;">
                            <div style="font-size:0.75em;color:#94a3b8;text-transform:uppercase;font-weight:700;">📁 Timeline Media Clips:</div>
                            <div id="modal-autosync-clips-count" style="font-weight:600;font-size:0.88em;color:#10b981;margin-top:2px;">
                                ${mediaClips.length > 0 ? '✓ ' + mediaClips.length + ' Clips Detected' : '<span style="color:#f59e0b;">⚠️ 0 Clips on Timeline</span>'}
                            </div>
                        </div>
                    </div>

                    <!-- Script Input Area -->
                    <div class="capcut-prop-group">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <label>Paste Script (Scenes & Voiceovers)</label>
                            <button type="button" id="btn-modal-upload-script" style="background:transparent;border:none;color:#38bdf8;cursor:pointer;font-size:0.8em;text-decoration:underline;">
                                📁 Upload .txt
                            </button>
                            <input type="file" id="modal-input-script-file" accept=".txt" hidden>
                        </div>
                        <textarea id="modal-autosync-script-text" class="autosync-textarea" style="height:150px;" placeholder="Scene 01 | 01.png / 01.mp4&#10;Voiceover: &quot;You get home from work, and the second your front door clicks shut,&quot;&#10;&#10;Scene 02 | 02.png / 02.mp4&#10;Voiceover: &quot;the smile drops instantly like a stage curtain being cut loose.&quot;">${autoSyncScriptText}</textarea>
                    </div>

                    <div class="autosync-api-status-bar" style="margin-top:0;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="color:#10b981;">🟢</span>
                            <span style="font-size:0.8em;"><b>AI Engine:</b> Groq Whisper Large (Instant Alignment)</span>
                        </div>
                        <button type="button" id="btn-modal-edit-groq-key" style="background:transparent;border:none;color:#38bdf8;cursor:pointer;font-size:0.75em;text-decoration:underline;">
                            ⚙️ Key
                        </button>
                    </div>

                    <div id="modal-autosync-status" style="font-size:0.82em;text-align:center;min-height:20px;color:#94a3b8;"></div>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-modal-primary" id="btn-modal-run-autosync" style="background:linear-gradient(135deg, #0284c7 0%, #2563eb 100%);box-shadow:0 4px 12px rgba(2,132,199,0.4);">
                        ⚡ Auto-Align & Retime Timeline Clips
                    </button>
                    <button type="button" class="btn-modal-cancel" id="btn-modal-cancel-autosync">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#btn-close-autosync-modal');
        const cancelBtn = modal.querySelector('#btn-modal-cancel-autosync');
        const runBtn = modal.querySelector('#btn-modal-run-autosync');
        const scriptTextarea = modal.querySelector('#modal-autosync-script-text');
        const uploadScriptBtn = modal.querySelector('#btn-modal-upload-script');
        const scriptFileInput = modal.querySelector('#modal-input-script-file');
        const editKeyBtn = modal.querySelector('#btn-modal-edit-groq-key');
        const statusText = modal.querySelector('#modal-autosync-status');

        const closeModal = () => {
            stopActiveSceneAudio();
            modal.remove();
        };

        const btnResume = modal.querySelector('#btn-resume-autosync-cache');
        if (btnResume && savedSession) {
            btnResume.addEventListener('click', async (e) => {
                e.stopPropagation();
                btnResume.disabled = true;
                const originalText = btnResume.innerHTML;
                btnResume.innerHTML = '<span>⏳ Restoring Audio & Session...</span>';

                // 1. Resolve Audio File from memory or IndexedDB
                let audioFile = (voiceoverAudio && voiceoverAudio.file) || autoSyncAudioFile || ((audioClips && audioClips[0]) ? audioClips[0].file : null);
                if (!audioFile) {
                    try {
                        const fileMap = await getAllFilesFromDB();
                        audioFile = fileMap['audio_voiceover_track'] || Object.values(fileMap).find(f => f && f.type && (f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i)));
                        if (audioFile) {
                            const aUrl = URL.createObjectURL(audioFile);
                            if (!voiceoverAudio) {
                                voiceoverAudio = {
                                    id: 'audio_voiceover_track',
                                    file: audioFile,
                                    url: aUrl,
                                    duration: savedSession.audioDuration || 10,
                                    name: savedSession.audioName || audioFile.name,
                                    timestampSec: 0,
                                    audioElement: new Audio(aUrl),
                                    waveformPeaks: []
                                };
                            }
                        }
                    } catch (dbErr) {
                        console.warn('Could not restore audio from DB on resume:', dbErr);
                    }
                }

                let audioFallbackUrl = '';
                if (audioFile) {
                    try {
                        audioFallbackUrl = URL.createObjectURL(audioFile);
                        if (voiceoverAudio) voiceoverAudio.url = audioFallbackUrl;
                    } catch (e) {}
                }
                if (!audioFallbackUrl) {
                    audioFallbackUrl = (voiceoverAudio && voiceoverAudio.url) || autoSyncAudioUrl || '';
                }

                // 2. Decode audio buffer for zero-latency slice playback
                let decodedBuffer = null;
                if (audioFile) {
                    try {
                        const ctx = getAudioContext();
                        if (ctx) {
                            const arrBuf = await audioFile.arrayBuffer();
                            decodedBuffer = await ctx.decodeAudioData(arrBuf.slice(0));
                        }
                    } catch (decodeErr) {
                        console.warn('Audio decode on resume warning:', decodeErr);
                    }
                }

                const currentMedia = (mediaClips && mediaClips.length > 0) ? mediaClips : autoSyncMediaFiles;
                const matches = (savedSession.sceneMediaMatches || []).map((mInfo, idx) => {
                    const matchedClip = currentMedia.find(c => c.id === mInfo.matchedClipId) || currentMedia[idx] || null;
                    return {
                        matchedClip: matchedClip,
                        matchTier: mInfo.matchTier || 'serial',
                        isMissing: !matchedClip
                    };
                });

                renderTimelineAutoSyncVerificationMatrix({
                    modal: modal,
                    aligned: savedSession.aligned,
                    sceneMediaMatches: matches.length ? matches : (savedSession.sceneMediaMatches || []),
                    sceneAudioBuffer: decodedBuffer,
                    audioFallbackUrl: audioFallbackUrl,
                    whisperResult: savedSession.whisperResult,
                    audioDuration: savedSession.audioDuration,
                    availableMedia: currentMedia,
                    onBack: () => {
                        openTimelineAutoSyncModal();
                    }
                });
            });
        }

        const btnDiscard = modal.querySelector('#btn-discard-autosync-cache');
        if (btnDiscard) {
            btnDiscard.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to clear the saved Auto-Sync session and start a new project?')) {
                    clearAutoSyncCache();
                    const banner = modal.querySelector('#autosync-resume-banner');
                    if (banner) banner.remove();
                }
            });
        }
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        if (editKeyBtn) {
            editKeyBtn.addEventListener('click', () => {
                const newKey = prompt('Enter your Groq Whisper API Key:', userGroqApiKey);
                if (newKey && newKey.trim()) {
                    userGroqApiKey = newKey.trim();
                    localStorage.setItem(GROQ_KEY_STORAGE, userGroqApiKey);
                    alert('✅ Groq API Key Saved Permanently!');
                }
            });
        }

        if (uploadScriptBtn && scriptFileInput) {
            uploadScriptBtn.addEventListener('click', () => scriptFileInput.click());
            scriptFileInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const txt = await e.target.files[0].text();
                    autoSyncScriptText = txt;
                    if (scriptTextarea) scriptTextarea.value = txt;
                }
            });
        }

        if (scriptTextarea) {
            scriptTextarea.addEventListener('input', (e) => {
                autoSyncScriptText = e.target.value;
            });
        }

        runBtn.addEventListener('click', async () => {
            if (!voiceoverAudio || !voiceoverAudio.file) {
                alert('Please load a Voiceover Audio track onto the timeline first (click "🎵 Voiceover Audio" on left)!');
                return;
            }

            if (!mediaClips || mediaClips.length === 0) {
                alert('Please add your image/video clips to the timeline first!');
                return;
            }

            const scriptVal = scriptTextarea ? scriptTextarea.value.trim() : '';
            if (!scriptVal) {
                alert('Please paste or upload your script (Scenes & Voiceovers)!');
                return;
            }

            const scenes = parseScenesFromScript(scriptVal);
            if (scenes.length === 0) {
                alert('Could not parse any scenes from the script. Please check the format!');
                return;
            }

            // 🛡️ Accidental Overwrite Protection Check
            if (savedSession && savedSession.aligned && savedSession.aligned.length > 0) {
                const proceed = confirm(
                    "⚠️ Notice: You already have a saved Auto-Sync Review Session with manual edits!\n\n" +
                    "• Click CANCEL to keep your edits and click '▶ Resume Saved Review (0s)' instead.\n" +
                    "• Click OK ONLY if you want to completely erase your saved edits and start from scratch."
                );
                if (!proceed) return;
            }

            // 🛡️ Smart Silence Protection Check
            const isAlreadyClean = (audioClips && audioClips.some(a => (a.name || '').toLowerCase().startsWith('clean_'))) ||
                                   (voiceoverAudio && (voiceoverAudio.name || '').toLowerCase().startsWith('clean_'));
            if (!isAlreadyClean && !window._skipSilenceWarningOnce) {
                const userChoice = confirm(
                    "⚠️ Attention: Dead air / silence pauses have not been cut from this voiceover yet!\n\n" +
                    "For the tightest audio-visual synchronization, it is highly recommended to run 'Auto-Cut Silence' first.\n\n" +
                    "• Click OK to Cut Silence First (opens Silence Cutter).\n" +
                    "• Click Cancel if your voiceover is already pre-edited or AI-generated without dead pauses."
                );
                if (userChoice) {
                    closeModal();
                    openAudioSilenceModal();
                    return;
                }
                window._skipSilenceWarningOnce = true;
            }

            runBtn.disabled = true;
            runBtn.textContent = '⏳ Transcribing Speech & Aligning Timestamps...';
            statusText.textContent = 'Listening to timeline audio and calculating scene timings...';
            statusText.style.color = '#38bdf8';

            try {
                // 1. Transcribe current timeline audio with Groq Whisper API (Merge multi-part into unified master track)
                let audioToTranscribe = voiceoverAudio ? (voiceoverAudio.file || voiceoverAudio) : null;
                if (audioClips && audioClips.length > 1) {
                    statusText.textContent = 'Merging all timeline audio parts into master track...';
                    audioToTranscribe = await concatenateAudioFiles(audioClips);
                } else if (audioClips && audioClips.length === 1) {
                    audioToTranscribe = audioClips[0].file || audioClips[0];
                }

                let audioDuration = 10;
                if (audioClips && audioClips.length > 0) {
                    const lastAud = audioClips[audioClips.length - 1];
                    audioDuration = (lastAud.timestampSec || 0) + lastAud.duration;
                } else if (voiceoverAudio && voiceoverAudio.duration) {
                    audioDuration = voiceoverAudio.duration;
                }

                const activeFingerprint = computeAudioFingerprint(audioToTranscribe, audioDuration);
                const cached = loadAutoSyncCache();
                let whisperResult = null;

                if (cached && cached.audioFingerprint === activeFingerprint && cached.whisperResult) {
                    statusText.textContent = '⚡ Using cached Whisper speech transcription (0s API call)...';
                    whisperResult = cached.whisperResult;
                } else {
                    statusText.textContent = '🎙️ Transcribing speech with Groq Whisper AI...';
                    whisperResult = await transcribeAudioWithGroq(audioToTranscribe, userGroqApiKey, (msg) => {
                        statusText.textContent = msg;
                    });
                }

                audioDuration = (whisperResult && whisperResult.duration) || audioDuration || 10;
                if (audioClips && audioClips.length > 0) {
                    const lastAud = audioClips[audioClips.length - 1];
                    audioDuration = (lastAud.timestampSec || 0) + lastAud.duration;
                } else if (voiceoverAudio && voiceoverAudio.duration) {
                    audioDuration = voiceoverAudio.duration;
                }

                // Prepare audio buffer for zero-latency scene audio slice player
                statusText.textContent = 'Decoding audio for instant scene playback...';
                let sceneAudioBuffer = null;
                let audioFallbackUrl = voiceoverAudio ? voiceoverAudio.url : null;
                try {
                    const arrayBuffer = await audioToTranscribe.arrayBuffer();
                    const ctx = getAudioContext();
                    if (ctx) {
                        sceneAudioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
                    }
                } catch (decodeErr) {
                    console.warn('Audio decode warning (fallback available):', decodeErr);
                }
                if (!audioFallbackUrl && audioToTranscribe) {
                    try {
                        audioFallbackUrl = URL.createObjectURL(audioToTranscribe);
                    } catch (e) {}
                }

                // 2. Align scenes with millisecond speech timestamps
                const aligned = alignScenesWithTranscription(scenes, whisperResult, audioDuration);
                autoSyncAlignedScenes = aligned;

                // 3. Pre-Match Media Clips to scenes for Column 1
                const matchedClipIds = new Set();
                const sceneMediaMatches = [];

                // Sort available media clips by natural number / serial before matching
                const availableMedia = mediaClips.filter(c => !c.isMissing);
                availableMedia.sort((a, b) => {
                    const numA = extractFileNumber(a.name);
                    const numB = extractFileNumber(b.name);
                    if (numA !== null && numB !== null && numA !== numB) return numA - numB;
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                });

                for (let i = 0; i < aligned.length; i++) {
                    const sc = aligned[i];
                    let matchedClip = null;
                    let matchTier = 'missing';

                    // Tier 1: Match by exact targetFiles
                    for (const targetName of sc.targetFiles) {
                        const cleanTarget = targetName.toLowerCase().replace(/[`*]/g, '').trim();
                        const baseName = cleanTarget.replace(/\.[^.]+$/, '');
                        matchedClip = availableMedia.find(c => {
                            if (matchedClipIds.has(c.id)) return false;
                            const cClean = c.name.toLowerCase().replace(/[`*]/g, '').trim();
                            const cBase = cClean.replace(/\.[^.]+$/, '');
                            return cClean === cleanTarget || cBase === baseName;
                        });
                        if (matchedClip) {
                            matchTier = 'exact';
                            break;
                        }
                    }

                    // Tier 2: Match by extracted numeric serial (e.g. 64.png, 064.jpg, etc.)
                    if (!matchedClip) {
                        matchedClip = availableMedia.find(c => {
                            if (matchedClipIds.has(c.id)) return false;
                            const fileNum = extractFileNumber(c.name);
                            if (fileNum !== null && fileNum === sc.sceneNumber) return true;
                            return false;
                        });
                        if (matchedClip) matchTier = 'serial';
                    }

                    // Strict No-Steal Rule:
                    // If an image is not found by exact name or serial number, DO NOT steal the next scene's image!
                    // Leaving matchedClip = null marks this scene as an explicit Missing Slot.
                    // This ensures Scene 2 is marked Missing without shifting Scene 3's 03.png into Scene 2.

                    if (matchedClip) {
                        matchedClipIds.add(matchedClip.id);
                        sceneMediaMatches.push({
                            scene: sc,
                            matchedClip: matchedClip,
                            matchTier: matchTier,
                            isMissing: false
                        });
                    } else {
                        sceneMediaMatches.push({
                            scene: sc,
                            matchedClip: null,
                            matchTier: 'missing',
                            isMissing: true
                        });
                    }
                }

                // Initial Save to Auto-Sync cache
                saveAutoSyncCache({
                    audioFile: audioToTranscribe,
                    audioDuration,
                    audioFallbackUrl,
                    whisperResult,
                    aligned,
                    sceneMediaMatches,
                    scriptText: autoSyncScriptText
                });

                // 4. Render Step 2: Pre-Timeline Verification Matrix (4-Column Table & Scene Audio Cut Player)
                renderTimelineAutoSyncVerificationMatrix({
                    modal,
                    aligned,
                    sceneMediaMatches,
                    sceneAudioBuffer,
                    audioFallbackUrl,
                    whisperResult,
                    audioDuration,
                    availableMedia,
                    onBack: () => {
                        openTimelineAutoSyncModal();
                    }
                });

            } catch (err) {
                runBtn.disabled = false;
                runBtn.textContent = '⚡ Auto-Align & Retime Timeline Clips';
                console.error('Auto-Sync Error:', err);
                statusText.innerHTML = `
                    <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:10px 12px;color:#ef4444;font-size:0.85em;text-align:left;line-height:1.4;margin-top:6px;word-break:break-word;">
                        <b>⚠️ Alignment Error:</b> ${err.message}
                    </div>
                `;
            }
        });
    }

    // ── Auto-Sync AI Studio View Component ────────────────────
    function createAutoSyncStudio() {
        const c = document.createElement('div');
        c.id = 'autosync-studio-container';
        c.className = 'studio-card-view';
        renderAutoSyncContent(c);
        return c;
    }

    function renderAutoSyncContent(c) {
        c.innerHTML = `
            <div class="studio-card">
                <div class="studio-card__head">
                    <h1 class="studio-card__title">🤖 AI Auto-Sync Video Maker</h1>
                    <p class="studio-card__subtitle">
                        Automatically parse scenes (Scene 01 | 01.png...), extract millisecond speech timestamps using Groq Whisper AI, and build your entire CapCut timeline in 1 click.
                    </p>
                </div>

                <div class="autosync-api-status-bar">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="color:#10b981;font-size:1.1em;">🟢</span>
                        <span><b>AI Engine:</b> Groq Whisper Large (Ultra-Fast 120h/day Free)</span>
                    </div>
                    <button type="button" class="btn-tl-tool" id="btn-edit-groq-key" style="font-size:0.75em;">
                        ⚙️ API Key Settings
                    </button>
                </div>

                <div class="autosync-grid-inputs">
                    <!-- 1. Voiceover Audio Upload -->
                    <div class="autosync-box">
                        <div class="autosync-box-title">
                            <span>🎙️ 1. Voiceover Audio</span>
                        </div>
                        <div class="autosync-drop-small" id="autosync-audio-drop">
                            ${autoSyncAudioFile ? '<b>' + autoSyncAudioFile.name + '</b><br><span style="color:#38bdf8;font-weight:700;">Loaded (' + (autoSyncAudioFile.size / 1024).toFixed(0) + ' KB)</span>' : 'Drop <b>voiceover.mp3</b> / <b>.wav</b><br>or Click to Browse'}
                        </div>
                        <input type="file" id="autosync-audio-input" accept="audio/*" hidden>
                    </div>

                    <!-- 2. Script Text / File -->
                    <div class="autosync-box">
                        <div class="autosync-box-title" style="justify-content:space-between;">
                            <span>📄 2. Script (Scenes)</span>
                            <button type="button" id="btn-upload-script-file" style="background:transparent;border:none;color:#38bdf8;cursor:pointer;font-size:0.8em;text-decoration:underline;">
                                📁 Upload .txt
                            </button>
                            <input type="file" id="input-script-file" accept=".txt" hidden>
                        </div>
                        <textarea class="autosync-textarea" id="autosync-script-text" placeholder="Scene 01 | 01.png / 01.mp4&#10;Voiceover: &quot;You get home from work, and the second your front door clicks shut,&quot;&#10;&#10;Scene 02 | 02.png / 02.mp4&#10;Voiceover: &quot;the smile drops instantly like a stage curtain being cut loose.&quot;">${autoSyncScriptText}</textarea>
                    </div>

                    <!-- 3. Media Assets Folder/Files -->
                    <div class="autosync-box">
                        <div class="autosync-box-title">
                            <span>📁 3. Media Assets</span>
                        </div>
                        <div class="autosync-drop-small" id="autosync-media-drop">
                            ${autoSyncMediaFiles.length > 0 ? '<b>' + autoSyncMediaFiles.length + ' files loaded</b><br><span style="color:#10b981;font-weight:700;">(01.png, 02.mp4...)</span>' : 'Drop <b>01.png, 02.mp4...</b><br>or Click to Select Folder'}
                        </div>
                        <input type="file" id="autosync-media-input" accept="image/*,video/*" multiple hidden>
                        <input type="file" id="autosync-folder-input" webkitdirectory directory multiple hidden>
                    </div>
                </div>

                <button class="studio-btn-action" id="btn-start-autosync" ${autoSyncIsProcessing ? 'disabled' : ''} style="margin-top:18px;">
                    ${autoSyncIsProcessing ? '⏳ Transcribing Speech & Aligning Timestamps with AI...' : '⚡ 1-Click Auto-Sync with AI'}
                </button>

                <!-- Alignment Results Table -->
                <div id="autosync-results-box" style="${autoSyncAlignedScenes ? '' : 'display:none;'}">
                    ${autoSyncAlignedScenes ? renderAutoSyncResultsHTML(autoSyncAlignedScenes) : ''}
                </div>
            </div>
        `;

        setupAutoSyncEvents(c);
    }

    function renderAutoSyncResultsHTML(scenes) {
        if (!scenes || scenes.length === 0) return '';

        let totalTime = scenes[scenes.length - 1].end;

        let rowsHTML = '';
        for (let i = 0; i < scenes.length; i++) {
            const sc = scenes[i];
            const matchedMedia = autoSyncMediaFiles.find(f => f.id === sc.matchedFileId) || autoSyncMediaFiles[i] || null;
            const thumbSrc = matchedMedia ? matchedMedia.url : '';
            const fileName = matchedMedia ? matchedMedia.name : (sc.targetFiles[0] || `Scene ${sc.sceneNumber}`);

            // Render Whisper Words Chips
            let wordsHTML = '';
            const rawWords = sc.matchedWords || [];
            if (rawWords.length > 0) {
                wordsHTML = rawWords.map((w, wIdx) => {
                    const isFirst = (wIdx === 0);
                    const isLast = (wIdx === rawWords.length - 1);
                    const chipClass = isFirst ? 'is-first' : (isLast ? 'is-last' : '');
                    const startStr = (w.start != null) ? w.start.toFixed(2) + 's' : '';
                    const endStr = (w.end != null) ? w.end.toFixed(2) + 's' : '';
                    return `<span class="whisper-word-chip ${chipClass}" title="${escapeHTML(w.word)}: ${startStr} - ${endStr}">` +
                           `${escapeHTML(w.word)} <small>${startStr}</small>` +
                           `</span>`;
                }).join('');
            } else {
                wordsHTML = '<span style="color:#94a3b8;font-style:italic;font-size:0.85em;">(Speech synchronized)</span>';
            }

            const spokenDur = Math.max(0, sc.spokenEnd - sc.spokenStart);
            const silenceAdded = sc.silenceAdded || 0;

            rowsHTML += `
                <tr>
                    <!-- Col 1: Scene & Media Asset -->
                    <td style="width:220px;min-width:200px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span class="autosync-scene-badge">#${sc.sceneNumber}</span>
                            <div class="autosync-file-pill" style="flex:1;overflow:hidden;">
                                ${thumbSrc ? `<img src="${thumbSrc}" class="autosync-file-thumb" alt="">` : `<span style="font-size:1.2em;">🖼️</span>`}
                                <span style="font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;" title="${escapeHTML(fileName)}">${escapeHTML(fileName)}</span>
                            </div>
                        </div>
                    </td>

                    <!-- Col 2: Expected Script Line -->
                    <td style="max-width:260px;min-width:200px;">
                        <div style="font-weight:600;color:#e2e8f0;line-height:1.4;font-size:0.86em;max-height:100px;overflow-y:auto;padding-right:4px;" title="${escapeHTML(sc.voiceover)}">
                            "${escapeHTML(sc.voiceover)}"
                        </div>
                    </td>

                    <!-- Col 3: Whisper Transcribed Words -->
                    <td style="min-width:240px;max-width:320px;">
                        <div class="whisper-words-stream custom-scrollbar">
                            ${wordsHTML}
                        </div>
                    </td>

                    <!-- Col 4: Image Timeline Duration & Audio Cut Player -->
                    <td style="width:220px;min-width:200px;">
                        <div style="display:flex;flex-direction:column;gap:5px;">
                            <div>
                                <span style="color:#38bdf8;font-weight:700;font-variant-numeric:tabular-nums;font-size:0.92em;">
                                    ${sc.start.toFixed(2)}s ➔ ${sc.end.toFixed(2)}s
                                </span>
                                <span style="color:#fff;font-weight:700;margin-left:4px;font-size:0.88em;">(${sc.duration.toFixed(2)}s)</span>
                            </div>
                            <div style="font-size:0.77em;color:#94a3b8;">
                                Spoken: <b style="color:#e2e8f0;">${spokenDur.toFixed(2)}s</b>
                                ${silenceAdded > 0.04 
                                    ? ` | Silence: <b style="color:#38bdf8;">+${silenceAdded.toFixed(2)}s</b>` 
                                    : ` | Silence: <b style="color:#10b981;">+0.00s (Continuous)</b>`}
                            </div>
                            <div>
                                <button type="button" class="btn-scene-audio-slice" data-scene-idx="${i}" data-start="${sc.spokenStart}" data-end="${sc.spokenEnd}">
                                    ▶ Play Scene Audio
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }

        return `
            <div class="autosync-table-wrap">
                <div class="autosync-table-head">
                    <span>🎯 Pre-Timeline Verification Matrix (${scenes.length} Scenes)</span>
                    <span style="color:#10b981;font-weight:700;">Total Duration: ${fmtTimeShort(totalTime)} (100% Zero-Gap Sync)</span>
                </div>
                <table class="autosync-table">
                    <thead>
                        <tr>
                            <th>Col 1: Scene & Media</th>
                            <th>Col 2: Expected Script Line</th>
                            <th>Col 3: Whisper Transcribed Words [Timestamps]</th>
                            <th>Col 4: Timeline Duration & Audio Slicer</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHTML}
                    </tbody>
                </table>
            </div>

            <div class="studio-actions-row">
                <button type="button" class="btn-send-to-timeline" id="btn-apply-autosync-timeline">
                    🚀 Load into CapCut Video Editor Timeline & Start Editing
                </button>
                <button type="button" class="btn-reset-studio" id="btn-reset-autosync">
                    ✕ Reset
                </button>
            </div>
        `;
    }

    function setupAutoSyncEvents(c) {
        const audioDrop = c.querySelector('#autosync-audio-drop');
        const audioInput = c.querySelector('#autosync-audio-input');
        const mediaDrop = c.querySelector('#autosync-media-drop');
        const mediaInput = c.querySelector('#autosync-media-input');
        const folderInput = c.querySelector('#autosync-folder-input');
        const scriptTextarea = c.querySelector('#autosync-script-text');
        const uploadScriptBtn = c.querySelector('#btn-upload-script-file');
        const scriptFileInput = c.querySelector('#input-script-file');
        const startSyncBtn = c.querySelector('#btn-start-autosync');
        const editKeyBtn = c.querySelector('#btn-edit-groq-key');

        if (editKeyBtn) {
            editKeyBtn.addEventListener('click', () => {
                const newKey = prompt('Enter your Groq Whisper API Key:', userGroqApiKey);
                if (newKey && newKey.trim()) {
                    userGroqApiKey = newKey.trim();
                    localStorage.setItem(GROQ_KEY_STORAGE, userGroqApiKey);
                    alert('✅ Groq API Key Saved Permanently!');
                }
            });
        }

        if (audioDrop && audioInput) {
            audioDrop.addEventListener('click', () => audioInput.click());
            audioInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    autoSyncAudioFile = e.target.files[0];
                    autoSyncAudioUrl = URL.createObjectURL(autoSyncAudioFile);
                    renderAutoSyncContent(c);
                }
            });
            audioDrop.addEventListener('dragover', (e) => { e.preventDefault(); audioDrop.classList.add('is-over'); });
            audioDrop.addEventListener('dragleave', () => audioDrop.classList.remove('is-over'));
            audioDrop.addEventListener('drop', (e) => {
                e.preventDefault();
                audioDrop.classList.remove('is-over');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    autoSyncAudioFile = e.dataTransfer.files[0];
                    autoSyncAudioUrl = URL.createObjectURL(autoSyncAudioFile);
                    renderAutoSyncContent(c);
                }
            });
        }

        if (uploadScriptBtn && scriptFileInput) {
            uploadScriptBtn.addEventListener('click', () => scriptFileInput.click());
            scriptFileInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const txt = await e.target.files[0].text();
                    autoSyncScriptText = txt;
                    if (scriptTextarea) scriptTextarea.value = txt;
                }
            });
        }

        if (scriptTextarea) {
            scriptTextarea.addEventListener('input', (e) => {
                autoSyncScriptText = e.target.value;
            });
        }

        if (mediaDrop && mediaInput) {
            mediaDrop.addEventListener('click', () => mediaInput.click());
            mediaInput.addEventListener('change', (e) => handleAutoSyncMediaAdded(e.target.files, c));
            mediaDrop.addEventListener('dragover', (e) => { e.preventDefault(); mediaDrop.classList.add('is-over'); });
            mediaDrop.addEventListener('dragleave', () => mediaDrop.classList.remove('is-over'));
            mediaDrop.addEventListener('drop', (e) => {
                e.preventDefault();
                mediaDrop.classList.remove('is-over');
                if (e.dataTransfer && e.dataTransfer.files) {
                    handleAutoSyncMediaAdded(e.dataTransfer.files, c);
                }
            });
        }

        if (startSyncBtn) {
            startSyncBtn.addEventListener('click', async () => {
                if (!autoSyncAudioFile) {
                    alert('Please upload your Voiceover Audio file (voiceover.mp3) first!');
                    return;
                }

                const scriptVal = scriptTextarea ? scriptTextarea.value.trim() : autoSyncScriptText.trim();
                if (!scriptVal) {
                    alert('Please enter or upload your script (Scenes & Voiceovers)!');
                    return;
                }

                const scenes = parseScenesFromScript(scriptVal);
                if (scenes.length === 0) {
                    alert('Could not parse any scenes from the script. Please check the format!');
                    return;
                }

                autoSyncIsProcessing = true;
                renderAutoSyncContent(c);

                try {
                    // Transcribe with Groq Whisper API
                    const whisperResult = await transcribeAudioWithGroq(autoSyncAudioFile, userGroqApiKey);

                    // Extract actual audio duration via Web Audio
                    const wf = await extractWaveformPeaks(autoSyncAudioFile);
                    const audioDuration = (wf && wf.duration) || whisperResult.duration || 10;

                    // Align scenes with speech timestamps
                    const aligned = alignScenesWithTranscription(scenes, whisperResult, audioDuration);

                    // Match each scene with uploaded media files
                    for (let i = 0; i < aligned.length; i++) {
                        const sc = aligned[i];
                        let matched = null;

                        // Check targetFiles list
                        for (const targetName of sc.targetFiles) {
                            const baseName = targetName.toLowerCase().replace(/\.[^.]+$/, '');
                            matched = autoSyncMediaFiles.find(f => {
                                const fBase = f.name.toLowerCase().replace(/\.[^.]+$/, '');
                                return f.name.toLowerCase() === targetName.toLowerCase() || fBase === baseName;
                            });
                            if (matched) break;
                        }

                        // Number match in filename
                        if (!matched) {
                            matched = autoSyncMediaFiles.find(f => {
                                const fBase = f.name.toLowerCase().replace(/\.[^.]+$/, '');
                                const m = fBase.match(/(\d+)/);
                                if (m) return parseInt(m[1], 10) === sc.sceneNumber;
                                return fBase === String(sc.sceneNumber) || fBase === String(sc.sceneNumber).padStart(2, '0');
                            });
                        }

                        // Fallback to i-th file
                        if (!matched && autoSyncMediaFiles[i]) {
                            matched = autoSyncMediaFiles[i];
                        }

                        sc.matchedFileId = matched ? matched.id : null;
                    }

                    autoSyncAlignedScenes = aligned;
                    autoSyncIsProcessing = false;
                    renderAutoSyncContent(c);

                } catch (err) {
                    alert('AI Auto-Sync Error: ' + err.message);
                    autoSyncIsProcessing = false;
                    renderAutoSyncContent(c);
                }
            });
        }

        const sliceBtns = c.querySelectorAll('.btn-scene-audio-slice');
        sliceBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const startSec = parseFloat(btn.dataset.start || '0');
                const endSec = parseFloat(btn.dataset.end || '0');
                playSceneAudioSlice(null, autoSyncAudioUrl, startSec, endSec, btn);
            });
        });

        const applyTimelineBtn = c.querySelector('#btn-apply-autosync-timeline');
        if (applyTimelineBtn) {
            applyTimelineBtn.addEventListener('click', async () => {
                stopActiveSceneAudio();
                if (!autoSyncAlignedScenes || autoSyncAlignedScenes.length === 0) return;

                // 1. Build media clips for CapCut Timeline
                const newClips = [];
                const dbBatch = [];

                const matchedMediaIds = new Set();
                let lastAlignedEnd = 0;

                for (let i = 0; i < autoSyncAlignedScenes.length; i++) {
                    const sc = autoSyncAlignedScenes[i];
                    const matchedMedia = autoSyncMediaFiles.find(f => f.id === sc.matchedFileId) || autoSyncMediaFiles[i] || null;

                    const clipId = 'clip_sync_' + Date.now() + '_' + i;
                    const isVid = matchedMedia ? (matchedMedia.type === 'video') : false;

                    if (matchedMedia && matchedMedia.file) {
                        matchedMediaIds.add(matchedMedia.id);
                        dbBatch.push({ id: clipId, file: matchedMedia.file });
                    }

                    if (sc.end > lastAlignedEnd) lastAlignedEnd = sc.end;

                    newClips.push({
                        id: clipId,
                        file: matchedMedia ? matchedMedia.file : null,
                        name: matchedMedia ? matchedMedia.name : `Scene ${sc.sceneNumber}`,
                        type: isVid ? 'video' : 'image',
                        url: matchedMedia ? matchedMedia.url : '',
                        timestampSec: sc.start,
                        serial: i + 1,
                        duration: sc.duration,
                        scale: 1.0,
                        posX: 0,
                        posY: 0,
                        motion: 'zoom_in',
                        transition: 'fade',
                        volume: 100,
                        speed: 1.0,
                        trimStart: 0,
                        trimEnd: 0
                    });
                }

                // Preserve extra/unmatched media files sequentially after audio
                const extraMediaFiles = autoSyncMediaFiles.filter(f => !matchedMediaIds.has(f.id));
                let extraCursor = lastAlignedEnd;
                for (let i = 0; i < extraMediaFiles.length; i++) {
                    const extraF = extraMediaFiles[i];
                    const clipId = 'clip_extra_' + Date.now() + '_' + i;
                    const isVid = extraF.type === 'video';

                    if (extraF.file) {
                        dbBatch.push({ id: clipId, file: extraF.file });
                    }

                    newClips.push({
                        id: clipId,
                        file: extraF.file,
                        name: extraF.name,
                        type: isVid ? 'video' : 'image',
                        url: extraF.url,
                        timestampSec: parseFloat(extraCursor.toFixed(2)),
                        serial: newClips.length + 1,
                        duration: 3.0,
                        scale: 1.0,
                        posX: 0,
                        posY: 0,
                        motion: 'zoom_in',
                        transition: 'fade',
                        volume: 100,
                        speed: 1.0,
                        trimStart: 0,
                        trimEnd: 0
                    });

                    extraCursor += 3.0;
                }

                if (dbBatch.length > 0) {
                    await saveBatchToDB(dbBatch);
                }

                mediaClips = newClips;

                // 2. Load Voiceover Audio into Timeline Track
                if (autoSyncAudioFile) {
                    if (voiceoverAudio) {
                        destroyAudioElement(voiceoverAudio.audioElement, voiceoverAudio.url);
                    }

                    await saveBatchToDB([{ id: 'audio_voiceover_track', file: autoSyncAudioFile }]);
                    const aUrl = URL.createObjectURL(autoSyncAudioFile);
                    const aObj = new Audio();
                    aObj.preload = 'auto';
                    aObj.src = aUrl;
                    aObj.load();

                    const wf = await extractWaveformPeaks(autoSyncAudioFile);

                    voiceoverAudio = {
                        id: 'audio_voiceover_track',
                        file: autoSyncAudioFile,
                        url: aUrl,
                        duration: (wf && wf.duration) || 10,
                        name: autoSyncAudioFile.name,
                        timestampSec: 0,
                        audioElement: aObj,
                        waveformPeaks: wf ? wf.peaks : []
                    };
                    audioClips = [voiceoverAudio];
                }

                if (mediaClips.length > 0) {
                    selectedClipId = mediaClips[0].id;
                }

                isPlaying = false;
                if (animFrameId) cancelAnimationFrame(animFrameId);
                setPlayheadTime(0);
                
                // Calculate total duration without overwriting synced timestamps
                let totalTime = 0;
                for (let i = 0; i < mediaClips.length; i++) {
                    mediaClips[i].serial = i + 1;
                    totalTime = Math.max(totalTime, mediaClips[i].timestampSec + mediaClips[i].duration);
                }
                const totalAudioTime = voiceoverAudio ? voiceoverAudio.duration : 0;
                totalTimelineDuration = Math.max(15, totalTime + 2, totalAudioTime + 2);

                renderAssetList();
                renderTimeline();
                renderInspector();
                updatePlayerScreen();
                persistProjectState();

                // Switch to CapCut Video Editor
                switchStudioMode('capcut-editor');
                ensurePlayheadVisible(true);
            });
        }

        const resetBtn = c.querySelector('#btn-reset-autosync');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                stopActiveSceneAudio();
                autoSyncAudioFile = null;
                autoSyncAudioUrl = null;
                autoSyncScriptText = '';
                autoSyncMediaFiles = [];
                autoSyncAlignedScenes = null;
                renderAutoSyncContent(c);
            });
        }
    }

    async function handleAutoSyncMediaAdded(files, container) {
        if (!files || !files.length) return;

        const newFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isVid = file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|mkv|webm)$/i);
            const isImg = file.type.startsWith('image/') || file.name.match(/\.(png|jpg|jpeg|webp)$/i);
            if (!isVid && !isImg) continue;

            const id = 'media_sync_' + Date.now() + '_' + i;
            newFiles.push({
                id: id,
                file: file,
                name: file.name,
                type: isVid ? 'video' : 'image',
                url: URL.createObjectURL(file)
            });
        }

        // Auto sort by numeric name
        newFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        autoSyncMediaFiles = newFiles;
        renderAutoSyncContent(container);
    }

    // ── Open Audio Silence Cutter Modal (Zero Blur Overlay) ──
    async function openAudioSilenceModal() {
        let targetAudio = null;
        let isMultiPartMergeRequired = false;

        if (selectedAudioClipId) {
            targetAudio = audioClips.find(a => a.id === selectedAudioClipId);
        }

        if (!targetAudio && audioClips && audioClips.length > 0) {
            if (audioClips.length === 1) {
                targetAudio = audioClips[0];
            } else {
                // If multiple audio parts exist and no specific one is selected, merge them into 1 master audio track
                isMultiPartMergeRequired = true;
            }
        }

        if (!targetAudio && !isMultiPartMergeRequired && voiceoverAudio) {
            targetAudio = voiceoverAudio;
        }

        if (isMultiPartMergeRequired) {
            try {
                const audioFilesToMerge = audioClips.map(a => a.file).filter(Boolean);
                if (audioFilesToMerge.length < audioClips.length) {
                    alert('Please wait for all audio parts to finish loading or re-import voiceover audio.');
                    return;
                }
                const mergedFile = await concatenateAudioFiles(audioFilesToMerge);
                const wf = await extractWaveformPeaks(mergedFile);
                targetAudio = {
                    id: 'audio_voiceover_track',
                    file: mergedFile,
                    name: `merged_voiceover_${audioFilesToMerge.length}parts.wav`,
                    url: URL.createObjectURL(mergedFile),
                    timestampSec: 0,
                    duration: (wf && wf.duration) || 10,
                    audioElement: new Audio(URL.createObjectURL(mergedFile)),
                    waveformPeaks: wf ? wf.peaks : []
                };
            } catch (err) {
                alert('Audio prepare error: ' + err.message);
                return;
            }
        }

        if (!targetAudio || !targetAudio.file) {
            alert('Please load a Voiceover Audio track first by clicking "🎵 Voiceover Audio" in the left panel!');
            return;
        }

        const existingModal = document.getElementById('modal-audio-silence-cut');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-audio-silence-cut';
        modal.className = 'modal-overlay';

        modal.innerHTML = `
            <div class="modal-box">
                <div class="modal-header">
                    <div class="modal-title">
                        <span>🎙️ Voiceover Silence Cutter & Auto-Sync</span>
                    </div>
                    <button type="button" class="modal-close-btn" id="btn-close-modal">✕</button>
                </div>
                <div class="modal-body">
                    <div class="modal-audio-info">
                        <span style="overflow:hidden;text-overflow:ellipsis;max-width:260px;"><b>File:</b> ${targetAudio.name}</span>
                        <span style="color:#38bdf8;font-weight:700;">⏱ ${targetAudio.duration.toFixed(1)}s</span>
                    </div>

                    <!-- ⚡ 1-Click Pacing Presets -->
                    <div class="capcut-prop-group">
                        <label>Pacing Presets</label>
                        <div class="modal-presets-bar">
                            <button type="button" class="btn-preset-opt" data-preset="reels">
                                ⚡ Ultra-Fast<br><span style="opacity:0.7;font-size:0.85em;">(0s pauses - Reels)</span>
                            </button>
                            <button type="button" class="btn-preset-opt is-active" data-preset="youtube">
                                🎬 YouTube<br><span style="opacity:0.7;font-size:0.85em;">(Natural pacing)</span>
                            </button>
                            <button type="button" class="btn-preset-opt" data-preset="podcast">
                                🎙️ Gentle<br><span style="opacity:0.7;font-size:0.85em;">(Podcast flow)</span>
                            </button>
                        </div>
                    </div>

                    <!-- Min Pause Duration Slider -->
                    <div class="capcut-prop-group">
                        <label>Min Pause Duration: <b id="modal-min-val" style="color:#38bdf8;">${minSilence.toFixed(2)}s</b></label>
                        <input type="range" id="modal-min-dur" min="0.08" max="1.50" step="0.02" value="${minSilence}">
                    </div>

                    <!-- Sensitivity (dB Threshold) Dropdown -->
                    <div class="capcut-prop-group">
                        <label>Sensitivity (dB Threshold)</label>
                        <select id="modal-threshold">
                            <option value="-20" ${silenceThreshold === -20 ? 'selected' : ''}>Ultra Aggressive (-20 dB - Zero Pauses)</option>
                            <option value="-25" ${silenceThreshold === -25 ? 'selected' : ''}>Low (-25 dB)</option>
                            <option value="-30" ${silenceThreshold === -30 ? 'selected' : ''}>Medium (-30 dB)</option>
                            <option value="-35" ${silenceThreshold === -35 ? 'selected' : ''}>High (-35 dB - Recommended)</option>
                            <option value="-40" ${silenceThreshold === -40 ? 'selected' : ''}>Very High (-40 dB)</option>
                            <option value="-50" ${silenceThreshold === -50 ? 'selected' : ''}>Max (-50 dB)</option>
                        </select>
                    </div>

                    <!-- Edge Padding (Buffer) Dropdown -->
                    <div class="capcut-prop-group">
                        <label>Edge Padding (Buffer)</label>
                        <select id="modal-padding">
                            <option value="0.01" ${silencePadding === 0.01 ? 'selected' : ''}>Zero Gap (10ms)</option>
                            <option value="0.02" ${silencePadding === 0.02 ? 'selected' : ''}>Tight (20ms)</option>
                            <option value="0.05" ${silencePadding === 0.05 ? 'selected' : ''}>Smooth (50ms - Best)</option>
                            <option value="0.10" ${silencePadding === 0.10 ? 'selected' : ''}>Gentle (100ms)</option>
                        </select>
                    </div>

                    <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;">
                            <input type="checkbox" id="modal-sync-clips" style="width:16px;height:16px;accent-color:#10b981;">
                            <span style="font-weight:600;color:#fff;">Auto-retime timeline media clips (Zero Gaps)</span>
                        </label>
                        <span style="font-size:0.75em;color:rgba(255,255,255,0.5);margin-top:4px;display:block;">
                            Automatically pulls all images/video clips forward to match speech with no blank space!
                        </span>
                    </div>

                    <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:6px;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;">
                            <input type="checkbox" id="modal-audio-pull-next" checked style="width:16px;height:16px;accent-color:#10b981;">
                            <span style="font-weight:600;color:#fff;">Auto-pull following audio parts (Close Gap)</span>
                        </label>
                        <span style="font-size:0.75em;color:rgba(255,255,255,0.5);margin-top:4px;display:block;">
                            Pulls subsequent audio parts forward to start immediately when this part finishes!
                        </span>
                    </div>

                    <button type="button" class="btn-modal-preview" id="btn-modal-detect-preview">
                        🔍 Scan Silence Gaps (Live Preview)
                    </button>

                    <div id="modal-status-text" style="font-size:0.82em;text-align:center;min-height:20px;color:#94a3b8;"></div>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-modal-primary" id="btn-modal-apply-cut">
                        ✂️ Cut Silence & Apply to Timeline
                    </button>
                    <button type="button" class="btn-modal-cancel" id="btn-modal-cancel">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#btn-close-modal');
        const cancelBtn = modal.querySelector('#btn-modal-cancel');
        const applyBtn = modal.querySelector('#btn-modal-apply-cut');
        const previewBtn = modal.querySelector('#btn-modal-detect-preview');
        const minSlider = modal.querySelector('#modal-min-dur');
        const minVal = modal.querySelector('#modal-min-val');
        const thresholdSel = modal.querySelector('#modal-threshold');
        const paddingSel = modal.querySelector('#modal-padding');
        const syncClipsBox = modal.querySelector('#modal-sync-clips');
        const pullNextBox = modal.querySelector('#modal-audio-pull-next');
        const statusText = modal.querySelector('#modal-status-text');

        modal.querySelectorAll('.btn-preset-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.btn-preset-opt').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                const p = btn.dataset.preset;
                if (p === 'reels') {
                    minSilence = 0.12;
                    silenceThreshold = -20;
                    silencePadding = 0.01;
                } else if (p === 'youtube') {
                    minSilence = 0.30;
                    silenceThreshold = -35;
                    silencePadding = 0.05;
                } else if (p === 'podcast') {
                    minSilence = 0.50;
                    silenceThreshold = -40;
                    silencePadding = 0.10;
                }
                minSlider.value = minSilence;
                minVal.textContent = minSilence.toFixed(2) + 's';
                thresholdSel.value = String(silenceThreshold);
                paddingSel.value = String(silencePadding);
            });
        });

        const closeModal = () => modal.remove();
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        minSlider.addEventListener('input', () => {
            minSilence = parseFloat(minSlider.value);
            minVal.textContent = minSilence.toFixed(2) + 's';
        });
        thresholdSel.addEventListener('change', () => silenceThreshold = parseFloat(thresholdSel.value));
        paddingSel.addEventListener('change', () => silencePadding = parseFloat(paddingSel.value));

        previewBtn.addEventListener('click', async () => {
            previewBtn.disabled = true;
            previewBtn.textContent = '⏳ Scanning pauses...';
            statusText.textContent = 'Analyzing audio waveform for pauses...';
            statusText.style.color = '#38bdf8';

            try {
                const formData = new FormData();
                formData.append('audio', targetAudio.file, targetAudio.name);

                let url = `${API_BASE}/silence-detect?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                let resp = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
                
                if (!resp.ok && API_BASE.includes(':4000')) {
                    const altUrl = `http://127.0.0.1:4001/silence-detect?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                    resp = await fetch(altUrl, { method: 'POST', body: formData, cache: 'no-store' });
                }

                const res = await resp.json();
                previewBtn.disabled = false;
                previewBtn.textContent = '🔍 Scan Silence Gaps (Live Preview)';

                if (res.success) {
                    if (res.silence_count > 0) {
                        statusText.innerHTML = `<span style="color:#10b981;font-weight:700;">Found ${res.silence_count} silent pauses (-${res.silence_removed.toFixed(1)}s dead air to cut)!</span>`;
                    } else {
                        statusText.innerHTML = `<span style="color:#f59e0b;font-weight:600;">0 pauses found with ${silenceThreshold} dB. Select "Medium (-30 dB)" or "Low (-25 dB)"!</span>`;
                    }
                } else {
                    statusText.innerHTML = `<span style="color:#ef4444;">Scan failed: ${res.error || 'Unknown error'}</span>`;
                }
            } catch (err) {
                previewBtn.disabled = false;
                previewBtn.textContent = '🔍 Scan Silence Gaps (Live Preview)';
                statusText.innerHTML = `<span style="color:#ef4444;">Connection error: ${err.message}</span>`;
            }
        });

        applyBtn.addEventListener('click', async () => {
            pushHistoryState();
            applyBtn.disabled = true;
            applyBtn.textContent = '⏳ Trimming Silence with FFmpeg...';
            statusText.textContent = 'Cutting dead air and clearing audio cache...';
            statusText.style.color = '#38bdf8';

            try {
                const formData = new FormData();
                formData.append('audio', targetAudio.file, targetAudio.name);

                let url = `${API_BASE}/silence-trim?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                let resp = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
                
                if (!resp.ok && API_BASE.includes(':4000')) {
                    const altUrl = `http://127.0.0.1:4001/silence-trim?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                    resp = await fetch(altUrl, { method: 'POST', body: formData, cache: 'no-store' });
                }

                const res = await resp.json();

                if (res.success) {
                    if (res.silence_count === 0) {
                        applyBtn.disabled = false;
                        applyBtn.textContent = '✂️ Cut Silence & Apply to Timeline';
                        statusText.innerHTML = `<span style="color:#f59e0b;font-weight:700;">No silence gaps detected at ${silenceThreshold} dB. Try Medium (-30 dB) or Low (-25 dB).</span>`;
                        return;
                    }

                    statusText.innerHTML = `<span style="color:#10b981;font-weight:700;">✅ Cut ${res.silence_count} pauses (-${res.silence_removed.toFixed(1)}s dead air)!</span>`;
                    
                    const dlUrl = (res.download_url.startsWith('http') ? res.download_url : `${API_BASE}${res.download_url}`) + '?nocache=' + Date.now();
                    let blobResp = await fetch(dlUrl, { cache: 'no-store' });
                    if (!blobResp.ok && dlUrl.includes(':4000')) {
                        blobResp = await fetch(`http://127.0.0.1:4001${res.download_url}?nocache=` + Date.now(), { cache: 'no-store' });
                    }
                    const cleanBlob = await blobResp.blob();
                    const cleanFile = new File([cleanBlob], 'clean_' + targetAudio.name, { type: 'audio/mp3' });

                    // Auto-retime media clips with silence removal segments safely
                    if (syncClipsBox && syncClipsBox.checked && res.segments && mediaClips.length > 0) {
                        const targetAudioStart = targetAudio.timestampSec || 0;
                        const targetAudioEnd = targetAudioStart + targetAudio.duration;
                        const silenceRemoved = (res.silence_removed != null) ? res.silence_removed : 0;

                        for (let i = 0; i < mediaClips.length; i++) {
                            const c = mediaClips[i];
                            // Clips before targetAudio (e.g. Part 1 clips) are 100% untouched!
                            if (c.timestampSec < targetAudioStart - 0.05) {
                                continue;
                            }
                            // Clips falling inside targetAudio's time range
                            if (c.timestampSec >= targetAudioStart - 0.05 && c.timestampSec < targetAudioEnd) {
                                const relStart = Math.max(0, c.timestampSec - targetAudioStart);
                                const newRelStart = mapTimeToTrimmedSegments(relStart, res.segments);
                                c.timestampSec = parseFloat((targetAudioStart + newRelStart).toFixed(2));
                            } else {
                                // Clips occurring AFTER targetAudio: cleanly ripple-shift backward by silenceRemoved (preserve duration!)
                                if (silenceRemoved > 0) {
                                    c.timestampSec = parseFloat(Math.max(targetAudioStart, c.timestampSec - silenceRemoved).toFixed(2));
                                }
                            }
                        }
                    }

                    // Complete buffer & cache flush
                    if (targetAudio.audioElement) {
                        destroyAudioElement(targetAudio.audioElement, targetAudio.url);
                    }
                    if (voiceoverAudio && voiceoverAudio.audioElement) {
                        destroyAudioElement(voiceoverAudio.audioElement, voiceoverAudio.url);
                    }

                    const newAudioUrl = URL.createObjectURL(cleanBlob);
                    const newAudioObj = new Audio();
                    newAudioObj.preload = 'auto';
                    newAudioObj.src = newAudioUrl;
                    newAudioObj.load();

                    const cleanAudioId = targetAudio.id || 'audio_voiceover_track';
                    await saveBatchToDB([{ id: cleanAudioId, file: cleanFile }]);

                    const wf = await extractWaveformPeaks(cleanFile);

                    const cleanAudioClip = {
                        id: cleanAudioId,
                        file: cleanFile,
                        url: newAudioUrl,
                        duration: (wf && wf.duration) || res.trimmed_duration,
                        name: 'clean_' + targetAudio.name,
                        timestampSec: targetAudio.timestampSec || 0,
                        audioElement: newAudioObj,
                        waveformPeaks: wf ? wf.peaks : []
                    };

                    // Update both audioClips array AND voiceoverAudio reference!
                    if (audioClips && audioClips.length > 0) {
                        const idx = audioClips.findIndex(a => a.id === targetAudio.id);
                        if (idx !== -1) {
                            audioClips[idx] = cleanAudioClip;
                            // Ripple pull subsequent audio clips forward if checked
                            if (pullNextBox && pullNextBox.checked) {
                                let currentEnd = cleanAudioClip.timestampSec + cleanAudioClip.duration;
                                for (let k = idx + 1; k < audioClips.length; k++) {
                                    audioClips[k].timestampSec = parseFloat(currentEnd.toFixed(2));
                                    currentEnd += audioClips[k].duration;
                                }
                            }
                        } else {
                            // If merged or whole timeline audio
                            audioClips = [cleanAudioClip];
                            voiceoverAudio = cleanAudioClip;
                        }
                    } else {
                        audioClips = [cleanAudioClip];
                    }
                    voiceoverAudio = cleanAudioClip;
                    selectedAudioClipId = cleanAudioClip.id;

                    pushHistoryState();

                    isPlaying = false;
                    if (animFrameId) cancelAnimationFrame(animFrameId);
                    setPlayheadTime(0);
                    rippleRecalculateTimeline();
                    renderAssetList();
                    renderTimeline();
                    renderInspector();
                    persistProjectState();

                    setTimeout(() => {
                        closeModal();
                    }, 800);

                } else {
                    applyBtn.disabled = false;
                    applyBtn.textContent = '✂️ Cut Silence & Apply to Timeline';
                    statusText.innerHTML = `<span style="color:#ef4444;">Error: ${res.error || 'Trim failed'}</span>`;
                }
            } catch (err) {
                applyBtn.disabled = false;
                applyBtn.textContent = '✂️ Cut Silence & Apply to Timeline';
                statusText.innerHTML = `<span style="color:#ef4444;">Connection error: ${err.message}</span>`;
            }
        });
    }

    function applyPreviewScale(scaleVal, posX = 0, posY = 0) {
        const layer = document.querySelector('.capcut-media-layer');
        if (layer) {
            layer.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${scaleVal})`;
        }
    }

    function setupMonitorTransformHandlers(root) {
        window.addEventListener('pointermove', (e) => {
            if (!isTransforming) return;
            const clip = mediaClips.find(c => c.id === selectedClipId);
            if (!clip) return;

            const dx = e.clientX - transformStartX;
            const dy = e.clientY - transformStartY;

            if (transformHandle === 'drag-move') {
                clip.posX = originalPosX + dx;
                clip.posY = originalPosY + dy;
            } else if (transformHandle && transformHandle.startsWith('corner-')) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                const sign = (dx + dy) > 0 ? 1 : -1;
                const newScale = Math.max(0.3, Math.min(3.0, originalScale + (sign * dist * 0.005)));
                clip.scale = newScale;

                const scaleSlider = document.getElementById('capcut-preview-scale-slider');
                const scaleText = document.getElementById('capcut-scale-text');
                if (scaleSlider && scaleText) {
                    scaleSlider.value = newScale;
                    scaleText.textContent = Math.round(newScale * 100) + '%';
                }
            }

            applyPreviewScale(clip.scale || 1.0, clip.posX || 0, clip.posY || 0);
        });

        window.addEventListener('pointerup', () => {
            if (isTransforming) {
                isTransforming = false;
                transformHandle = null;
                pushHistoryState();
                debouncedAutoSave();
            }
        });
    }

    function setupTimelineResizeHandlers(root) {
        window.addEventListener('pointermove', (e) => {
            if (!isResizingClip) return;
            const pxPerSec = 50 * timelineZoom;
            const dx = e.clientX - resizeStartX;
            const dTime = dx / pxPerSec;

            if (resizeClipType === 'audio') {
                const aClip = audioClips.find(c => c.id === resizeClipId);
                if (!aClip) return;

                if (resizeEdge === 'move') {
                    let newStart = Math.max(0, resizeOriginalStart + dTime);
                    const aIdx = audioClips.findIndex(c => c.id === aClip.id);

                    // Magnetic Snap to previous audio clip end
                    if (aIdx > 0) {
                        const prevEnd = audioClips[aIdx - 1].timestampSec + audioClips[aIdx - 1].duration;
                        if (Math.abs(newStart - prevEnd) < 0.35) {
                            newStart = prevEnd;
                        }
                    } else {
                        if (newStart < 0.25) newStart = 0.0;
                    }

                    // Magnetic Snap to next audio clip start
                    if (aIdx < audioClips.length - 1) {
                        const nextStart = audioClips[aIdx + 1].timestampSec;
                        if (Math.abs((newStart + aClip.duration) - nextStart) < 0.35) {
                            newStart = Math.max(0, nextStart - aClip.duration);
                        }
                    }

                    aClip.timestampSec = parseFloat(newStart.toFixed(2));
                } else if (resizeEdge === 'right') {
                    let newDuration = Math.max(0.2, resizeOriginalDuration + dTime);
                    const aIdx = audioClips.findIndex(c => c.id === aClip.id);
                    if (aIdx < audioClips.length - 1) {
                        const nextStart = audioClips[aIdx + 1].timestampSec;
                        // Magnetic snap to next audio part start
                        if (Math.abs((aClip.timestampSec + newDuration) - nextStart) < 0.25) {
                            newDuration = Math.max(0.2, nextStart - aClip.timestampSec);
                        }
                    }
                    aClip.duration = parseFloat(newDuration.toFixed(2));
                } else if (resizeEdge === 'left') {
                    let newStart = Math.max(0, resizeOriginalStart + dTime);
                    const aIdx = audioClips.findIndex(c => c.id === aClip.id);
                    if (aIdx > 0) {
                        const prevEnd = audioClips[aIdx - 1].timestampSec + audioClips[aIdx - 1].duration;
                        // Magnetic snap to previous audio part end
                        if (Math.abs(newStart - prevEnd) < 0.25) {
                            newStart = prevEnd;
                        }
                    }
                    const maxStart = resizeOriginalStart + resizeOriginalDuration - 0.2;
                    if (newStart <= maxStart) {
                        aClip.timestampSec = parseFloat(newStart.toFixed(2));
                        aClip.duration = parseFloat((resizeOriginalDuration - (newStart - resizeOriginalStart)).toFixed(2));
                    }
                }

                // Ripple shift any following audio clips if trimming
                if (resizeEdge === 'left' || resizeEdge === 'right') {
                    const aIdx = audioClips.findIndex(c => c.id === aClip.id);
                    if (aIdx !== -1) {
                        let nextStart = aClip.timestampSec + aClip.duration;
                        for (let i = aIdx + 1; i < audioClips.length; i++) {
                            audioClips[i].timestampSec = parseFloat(nextStart.toFixed(2));
                            nextStart += audioClips[i].duration;
                            const nextEl = document.querySelector(`.capcut-audio-track[data-id="${audioClips[i].id}"]`);
                            if (nextEl) {
                                nextEl.style.left = (audioClips[i].timestampSec * pxPerSec) + 'px';
                            }
                        }
                    }
                }

                const clipEl = document.querySelector(`.capcut-audio-track[data-id="${aClip.id}"]`);
                if (clipEl) {
                    clipEl.style.left = (aClip.timestampSec * pxPerSec) + 'px';
                    clipEl.style.width = Math.max(60, (aClip.duration * pxPerSec)) + 'px';
                    const canvas = clipEl.querySelector('canvas');
                    if (canvas) {
                        const newW = Math.max(60, (aClip.duration * pxPerSec));
                        canvas.width = Math.floor(newW);
                        drawAudioClipWaveformCanvas(canvas.id, aClip.waveformPeaks, newW, 38);
                    }
                    const durLabel = clipEl.querySelector('.capcut-audio-header span:last-child');
                    if (durLabel) durLabel.textContent = '⏱ ' + aClip.duration.toFixed(1) + 's';
                }

                const propDur = document.getElementById('prop-audio-duration');
                const propStart = document.getElementById('prop-audio-start');
                if (propDur) propDur.value = aClip.duration.toFixed(1);
                if (propStart) propStart.value = aClip.timestampSec.toFixed(1);
                return;
            }

            const clip = mediaClips.find(c => c.id === resizeClipId);
            if (!clip) return;

            if (resizeEdge === 'right') {
                const newDuration = Math.max(0.2, resizeOriginalDuration + dTime);
                clip.duration = parseFloat(newDuration.toFixed(2));
            } else if (resizeEdge === 'left') {
                const newStart = Math.max(0, resizeOriginalStart + dTime);
                const maxStart = resizeOriginalStart + resizeOriginalDuration - 0.2;
                if (newStart <= maxStart) {
                    clip.timestampSec = parseFloat(newStart.toFixed(2));
                    clip.duration = parseFloat((resizeOriginalDuration - (newStart - resizeOriginalStart)).toFixed(2));
                }
            }

            const idx = mediaClips.findIndex(c => c.id === clip.id);
            if (idx !== -1) {
                let curr = clip.timestampSec + clip.duration;
                for (let i = idx + 1; i < mediaClips.length; i++) {
                    mediaClips[i].timestampSec = parseFloat(curr.toFixed(2));
                    curr += mediaClips[i].duration;
                    const nextEl = document.querySelector(`.capcut-tl-clip[data-id="${mediaClips[i].id}"]`);
                    if (nextEl) {
                        nextEl.style.left = (mediaClips[i].timestampSec * pxPerSec) + 'px';
                    }
                }
            }

            const clipEl = document.querySelector(`.capcut-tl-clip[data-id="${clip.id}"]`);
            if (clipEl) {
                clipEl.style.left = (clip.timestampSec * pxPerSec) + 'px';
                clipEl.style.width = Math.max(30, (clip.duration * pxPerSec)) + 'px';
            }

            const propDur = document.getElementById('prop-duration');
            const propStart = document.getElementById('prop-start-time');
            if (propDur) propDur.value = clip.duration.toFixed(1);
            if (propStart) propStart.value = clip.timestampSec.toFixed(1);
        });

        window.addEventListener('pointerup', () => {
            if (isResizingClip) {
                isResizingClip = false;
                resizeClipId = null;
                resizeClipType = 'media';
                resizeEdge = null;
                rippleRecalculateTimeline();
                renderTimeline();
                persistProjectState();
            }
        });
    }

    async function handleMediaFilesAdded(files, insertAtPlayhead = false) {
        if (!files || !files.length) return;

        // Sort incoming files numerically by file number first
        const rawFiles = Array.from(files).sort((a, b) => {
            const numA = extractFileNumber(a.name);
            const numB = extractFileNumber(b.name);
            if (numA !== null && numB !== null && numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        const newClipsList = [];
        const dbItemsToSave = [];

        // Determine starting timestamp for new non-overlapping media clips
        let cursorTime = 0;
        if (insertAtPlayhead) {
            cursorTime = playheadTime;
        } else if (mediaClips.length > 0) {
            const lastClip = mediaClips[mediaClips.length - 1];
            cursorTime = lastClip.timestampSec + lastClip.duration;
        }

        for (let i = 0; i < rawFiles.length; i++) {
            const file = rawFiles[i];
            const isVid = file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|mkv|webm)$/i);
            const isImg = file.type.startsWith('image/') || file.name.match(/\.(png|jpg|jpeg|webp)$/i);
            const isAud = file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|ogg)$/i);

            if (isAud) {
                handleAudioFileAdded(file);
                continue;
            }

            if (!isVid && !isImg) continue;

            const fileNum = extractFileNumber(file.name);

            // Check if this file replaces an existing missing placeholder clip
            const missingPlaceholder = fileNum !== null ? mediaClips.find(c => c.isMissing && c.missingSceneNumber === fileNum) : null;
            if (missingPlaceholder) {
                missingPlaceholder.file = file;
                missingPlaceholder.name = file.name;
                missingPlaceholder.url = URL.createObjectURL(file);
                missingPlaceholder.type = isVid ? 'video' : 'image';
                missingPlaceholder.isMissing = false;
                dbItemsToSave.push({ id: missingPlaceholder.id, file: file });
                continue;
            }

            const parsedSec = parseTimestampFromName(file.name);
            const clipId = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

            dbItemsToSave.push({ id: clipId, file: file });

            const assignedStartSec = parsedSec != null ? parsedSec : cursorTime;
            const clipDuration = 3.0;

            newClipsList.push({
                id: clipId,
                file: file,
                name: file.name,
                type: isVid ? 'video' : 'image',
                url: URL.createObjectURL(file),
                timestampSec: parseFloat(assignedStartSec.toFixed(2)),
                serial: mediaClips.length + newClipsList.length + 1,
                duration: clipDuration,
                scale: 1.0,
                posX: 0,
                posY: 0,
                motion: 'zoom_in',
                transition: 'fade',
                volume: 100,
                speed: 1.0,
                trimStart: 0,
                trimEnd: 0
            });

            if (parsedSec == null) {
                cursorTime += clipDuration;
            }
        }

        // Fast asynchronous non-blocking IndexedDB persistence
        if (dbItemsToSave.length > 0) {
            saveBatchToDB(dbItemsToSave).catch(e => console.warn('DB async save:', e));
        }

        if (insertAtPlayhead && newClipsList.length > 0) {
            let insertIdx = mediaClips.findIndex(c => c.timestampSec > playheadTime);
            if (insertIdx === -1) insertIdx = mediaClips.length;

            mediaClips.splice(insertIdx, 0, ...newClipsList);
            rippleRecalculateTimeline();
            selectClip(newClipsList[0].id);
            setPlayheadTime(newClipsList[0].timestampSec);
            renderAssetList();
            renderTimeline();
            updatePlayerScreen();
            ensurePlayheadVisible(true);
        } else if (newClipsList.length > 0) {
            mediaClips.push(...newClipsList);
            autoSortMediaClips();
            setPlayheadTime(newClipsList[0].timestampSec);
            selectClip(newClipsList[0].id);
            ensurePlayheadVisible(true);
        } else {
            rippleRecalculateTimeline();
            renderAssetList();
            renderTimeline();
            updatePlayerScreen();
        }

        persistProjectState();
    }

    async function handleAudioFileAdded(files) {
        const rawList = (files instanceof FileList || Array.isArray(files)) ? Array.from(files) : [files];
        const newAudioFiles = rawList.filter(f => f && (f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|m4a|ogg|aac|flac)$/i)));
        if (newAudioFiles.length === 0) return;

        // Sort selected audio files by number (part 1, part 2, etc.)
        newAudioFiles.sort((a, b) => {
            const numA = extractFileNumber(a.name);
            const numB = extractFileNumber(b.name);
            if (numA !== null && numB !== null && numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        const dbBatch = [];
        let firstNewAudioStart = null;
        let firstNewAudioId = null;

        for (let i = 0; i < newAudioFiles.length; i++) {
            const file = newAudioFiles[i];
            const clipId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            dbBatch.push({ id: clipId, file: file });

            const audioUrl = URL.createObjectURL(file);
            const audioObj = new Audio();
            audioObj.preload = 'auto';
            audioObj.src = audioUrl;
            audioObj.load();

            const wf = await extractWaveformPeaks(file);
            const duration = (wf && wf.duration) || 10;

            let startSec = 0.0;
            if (audioClips.length > 0) {
                const lastClip = audioClips[audioClips.length - 1];
                startSec = lastClip.timestampSec + lastClip.duration;
            }

            if (firstNewAudioStart === null) {
                firstNewAudioStart = parseFloat(startSec.toFixed(2));
                firstNewAudioId = clipId;
            }

            audioClips.push({
                id: clipId,
                file: file,
                name: file.name,
                url: audioUrl,
                timestampSec: parseFloat(startSec.toFixed(2)),
                duration: parseFloat(duration.toFixed(2)),
                audioElement: audioObj,
                waveformPeaks: wf ? wf.peaks : []
            });
        }

        if (dbBatch.length > 0) {
            saveBatchToDB(dbBatch).catch(e => console.warn('DB audio save:', e));
        }

        voiceoverAudio = audioClips[0];
        if (firstNewAudioId) {
            selectedAudioClipId = firstNewAudioId;
            isAudioTrackSelected = true;
            selectedClipId = null;
        }

        rippleRecalculateTimeline();
        renderTimeline();
        renderInspector();
        persistProjectState();

        if (firstNewAudioStart !== null) {
            setPlayheadTime(firstNewAudioStart);
            ensurePlayheadVisible(true);
        }
    }

    async function mergeAllAudioParts() {
        if (!audioClips || audioClips.length <= 1) {
            alert('You have ' + (audioClips ? audioClips.length : 0) + ' audio clip on the timeline. Upload 2 or more audio parts first to merge them!');
            return;
        }

        const btnMerge = document.getElementById('btn-tl-merge-audio');
        if (btnMerge) {
            btnMerge.disabled = true;
            btnMerge.textContent = '⏳ Merging Audio...';
        }

        try {
            const count = audioClips.length;
            const mergedFile = await concatenateAudioFiles(audioClips);
            const mergedUrl = URL.createObjectURL(mergedFile);
            const mergedAudioObj = new Audio(mergedUrl);
            mergedAudioObj.preload = 'auto';
            mergedAudioObj.load();

            const wf = await extractWaveformPeaks(mergedFile);

            // Destroy previous audio objects
            audioClips.forEach(a => destroyAudioElement(a.audioElement, a.url));

            const dbBatch = [{ id: 'audio_voiceover_track', file: mergedFile }];
            await saveBatchToDB(dbBatch);

            const newAudioClip = {
                id: 'audio_merged_' + Date.now(),
                file: mergedFile,
                name: `merged_voiceover_${count}parts.wav`,
                url: mergedUrl,
                timestampSec: 0,
                duration: (wf && wf.duration) || 10,
                audioElement: mergedAudioObj,
                waveformPeaks: wf ? wf.peaks : []
            };

            audioClips = [newAudioClip];
            voiceoverAudio = newAudioClip;

            rippleRecalculateTimeline();
            renderTimeline();
            persistProjectState();

            alert(`✅ Successfully merged ${audioFilesToMerge.length} audio parts into 1 master track (${fmtTimeShort(newAudioClip.duration)})!`);
        } catch (err) {
            alert('Merge error: ' + err.message);
        } finally {
            if (btnMerge) {
                btnMerge.disabled = false;
                btnMerge.textContent = '🔗 Merge Audio';
            }
        }
    }

    function rippleRecalculateTimeline() {
        let maxMediaTime = 0;
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
            maxMediaTime = Math.max(maxMediaTime, mediaClips[i].timestampSec + mediaClips[i].duration);
        }

        let maxAudioTime = 0;
        if (audioClips && audioClips.length > 0) {
            for (const a of audioClips) {
                maxAudioTime = Math.max(maxAudioTime, a.timestampSec + a.duration);
            }
        } else if (voiceoverAudio) {
            maxAudioTime = voiceoverAudio.duration || 0;
        }

        totalTimelineDuration = Math.max(15, maxMediaTime + 2, maxAudioTime + 2);
    }

    function autoSortMediaClips() {
        mediaClips.sort((a, b) => {
            const numA = extractFileNumber(a.name);
            const numB = extractFileNumber(b.name);
            if (numA !== null && numB !== null && numA !== numB) {
                return numA - numB;
            }
            if (a.timestampSec !== null && b.timestampSec !== null && a.timestampSec !== b.timestampSec) {
                return a.timestampSec - b.timestampSec;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        // Ensure sequential non-overlapping timeline timestamps for all clips
        let curr = 0;
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
            mediaClips[i].timestampSec = parseFloat(curr.toFixed(2));
            curr += (mediaClips[i].duration || 3.0);
        }

        rippleRecalculateTimeline();

        if (mediaClips.length > 0 && !selectedClipId) {
            selectedClipId = mediaClips[0].id;
        }

        renderAssetList();
        renderTimeline();
        updatePlayerScreen();
        persistProjectState();
    }

    function renderAssetList() {
        const box = document.getElementById('capcut-asset-list-box');
        const countBox = document.getElementById('capcut-media-count');
        if (!box) return;

        if (countBox) countBox.textContent = mediaClips.length + ' clips';

        let displayClips = mediaClips;
        if (mediaFilter === 'image') displayClips = mediaClips.filter(c => c.type === 'image');
        if (mediaFilter === 'video') displayClips = mediaClips.filter(c => c.type === 'video');

        if (displayClips.length === 0) {
            box.innerHTML = `
                <div style="text-align:center;padding:30px 10px;font-size:0.82em;color:rgba(255,255,255,0.4);">
                    ${mediaClips.length === 0 ? 'Drop timestamp-named images (0-00.png, 0-03.png) or click Auto-Sync to begin.' : 'No clips matching this filter.'}
                </div>
            `;
            return;
        }

        let html = '';
        for (const clip of displayClips) {
            const isSel = clip.id === selectedClipId;
            const fileNum = extractFileNumber(clip.name);
            const badgeLabel = fileNum !== null ? '#' + fileNum : '#' + clip.serial;

            if (clip.isMissing) {
                html += `
                    <div class="capcut-asset-item is-missing ${isSel ? 'is-selected' : ''}" data-id="${clip.id}" style="border:1px dashed #f59e0b;background:rgba(245,158,11,0.08);">
                        <span class="capcut-asset-serial" style="background:#f59e0b;">⚠️</span>
                        <div class="capcut-asset-thumb" style="display:flex;align-items:center;justify-content:center;color:#f59e0b;font-size:0.7em;background:rgba(0,0,0,0.5);">MISSING</div>
                        <div class="capcut-asset-info">
                            <div class="capcut-asset-name" style="color:#f59e0b;font-weight:700;">Missing Image #${clip.missingSceneNumber || badgeLabel}</div>
                            <div class="capcut-asset-meta">
                                <span>⏱ ${fmtTimeShort(clip.timestampSec)}</span>
                                <span>⏳ ${clip.duration.toFixed(1)}s</span>
                                <span>⚠️ Needs File</span>
                            </div>
                        </div>
                        <div class="capcut-asset-actions">
                            <button type="button" class="btn-asset-icon del" data-del="${clip.id}" title="Remove Placeholder">✕</button>
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="capcut-asset-item ${isSel ? 'is-selected' : ''}" data-id="${clip.id}">
                        <span class="capcut-asset-serial">${badgeLabel}</span>
                        <img src="${clip.url}" class="capcut-asset-thumb" alt="" loading="lazy">
                        <div class="capcut-asset-info">
                            <div class="capcut-asset-name" title="${clip.name}">${clip.name}</div>
                            <div class="capcut-asset-meta">
                                <span>⏱ ${fmtTimeShort(clip.timestampSec)}</span>
                                <span>⏳ ${clip.duration.toFixed(1)}s</span>
                                <span>${clip.type === 'video' ? '🎥 Video' : '🖼 Image'}</span>
                            </div>
                        </div>
                        <div class="capcut-asset-actions">
                            <button type="button" class="btn-asset-icon del" data-del="${clip.id}" title="Remove Clip">✕</button>
                        </div>
                    </div>
                `;
            }
        }

        box.innerHTML = html;

        box.onclick = (e) => {
            const delBtn = e.target.closest('[data-del]');
            if (delBtn) {
                e.stopPropagation();
                removeClip(delBtn.dataset.del);
                return;
            }
            const item = e.target.closest('.capcut-asset-item');
            if (item && item.dataset.id) {
                selectClip(item.dataset.id);
            }
        };
    }

    // ── Undo & Redo History Management ────────────────────────
    function getProjectSnapshot() {
        return {
            mediaClips: mediaClips.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                url: c.url,
                file: c.file,
                timestampSec: c.timestampSec,
                serial: c.serial,
                duration: c.duration,
                scale: c.scale || 1.0,
                posX: c.posX || 0,
                posY: c.posY || 0,
                motion: c.motion,
                transition: c.transition,
                volume: c.volume,
                speed: c.speed,
                trimStart: c.trimStart || 0,
                trimEnd: c.trimEnd || 0
            })),
            audioClips: audioClips.map(a => ({
                id: a.id,
                name: a.name,
                url: a.url,
                file: a.file,
                timestampSec: a.timestampSec,
                duration: a.duration,
                waveformPeaks: a.waveformPeaks ? [...a.waveformPeaks] : []
            })),
            aspectRatio,
            selectedClipId,
            selectedAudioClipId,
            isAudioTrackSelected,
            playheadTime,
            captionConfig: JSON.parse(JSON.stringify(captionConfig))
        };
    }

    function pushHistoryState() {
        try {
            undoStack.push(getProjectSnapshot());
            if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
            redoStack = [];
            updateUndoRedoButtons();
        } catch (e) {}
    }

    function updateUndoRedoButtons() {
        const btnUndo = document.getElementById('btn-tl-undo');
        const btnRedo = document.getElementById('btn-tl-redo');
        if (btnUndo) {
            btnUndo.disabled = undoStack.length === 0;
            btnUndo.style.opacity = undoStack.length > 0 ? '1' : '0.4';
        }
        if (btnRedo) {
            btnRedo.disabled = redoStack.length === 0;
            btnRedo.style.opacity = redoStack.length > 0 ? '1' : '0.4';
        }
    }

    function performUndo() {
        if (undoStack.length === 0) return;
        try {
            redoStack.push(getProjectSnapshot());
            const snap = undoStack.pop();
            restoreFromSnapshot(snap);
        } catch (e) {
            console.error('Undo error:', e);
        }
    }

    function performRedo() {
        if (redoStack.length === 0) return;
        try {
            undoStack.push(getProjectSnapshot());
            const snap = redoStack.pop();
            restoreFromSnapshot(snap);
        } catch (e) {
            console.error('Redo error:', e);
        }
    }

    function restoreFromSnapshot(snap) {
        if (!snap) return;

        // Restore Media Clips
        mediaClips = (snap.mediaClips || []).map(c => ({
            ...c,
            url: c.url || (c.file ? URL.createObjectURL(c.file) : '')
        }));

        // Restore Audio Clips with HTML5 Audio elements
        const oldAudioMap = new Map();
        audioClips.forEach(a => oldAudioMap.set(a.id, a.audioElement));

        audioClips = (snap.audioClips || []).map(a => {
            let audObj = oldAudioMap.get(a.id);
            if (!audObj) {
                audObj = new Audio();
                audObj.preload = 'auto';
                if (a.url) audObj.src = a.url;
                else if (a.file) audObj.src = URL.createObjectURL(a.file);
                audObj.load();
            }
            return {
                ...a,
                url: a.url || (a.file ? URL.createObjectURL(a.file) : ''),
                audioElement: audObj
            };
        });

        voiceoverAudio = audioClips.length > 0 ? audioClips[0] : null;
        aspectRatio = snap.aspectRatio || '16:9';
        selectedClipId = snap.selectedClipId || (mediaClips.length > 0 ? mediaClips[0].id : null);
        selectedAudioClipId = snap.selectedAudioClipId || null;
        isAudioTrackSelected = snap.isAudioTrackSelected || false;
        playheadTime = snap.playheadTime || 0;

        if (snap.captionConfig) {
            captionConfig = JSON.parse(JSON.stringify(snap.captionConfig));
            updateCaptionOverlayDOM();
        }

        updateUndoRedoButtons();
        rippleRecalculateTimeline();
        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();
    }

    function updateCaptionOverlayDOM() {
        const overlay = document.getElementById('capcut-caption-overlay');
        const textEl = document.getElementById('capcut-caption-text');
        if (!overlay || !textEl) return;

        overlay.style.display = captionConfig.enabled ? 'block' : 'none';
        overlay.style.left = captionConfig.positionX + '%';
        overlay.style.top = captionConfig.positionY + '%';

        textEl.style.fontFamily = `'${captionConfig.fontFamily}', 'Montserrat', sans-serif`;
        textEl.style.fontSize = captionConfig.fontSize + 'px';
        textEl.style.color = captionConfig.textColor;

        if (captionConfig.strokeWidth > 0) {
            textEl.style.webkitTextStroke = `${captionConfig.strokeWidth}px ${captionConfig.strokeColor || '#000000'}`;
        } else {
            textEl.style.webkitTextStroke = '0px transparent';
        }

        if (captionConfig.boxBgStyle === 'pill') {
            overlay.style.background = 'rgba(0, 0, 0, 0.75)';
            overlay.style.backdropFilter = 'blur(4px)';
            overlay.style.borderRadius = '24px';
            overlay.style.padding = '6px 16px';
        } else if (captionConfig.boxBgStyle === 'ribbon') {
            overlay.style.background = '#000000';
            overlay.style.backdropFilter = 'none';
            overlay.style.borderRadius = '0px';
            overlay.style.padding = '8px 20px';
        } else if (captionConfig.boxBgStyle === 'glass') {
            overlay.style.background = 'rgba(255, 255, 255, 0.15)';
            overlay.style.backdropFilter = 'blur(10px)';
            overlay.style.borderRadius = '12px';
            overlay.style.padding = '6px 14px';
        } else {
            overlay.style.background = 'transparent';
            overlay.style.backdropFilter = 'none';
            overlay.style.borderRadius = '6px';
            overlay.style.padding = '4px 8px';
        }

        renderCaptionForTime(playheadTime);
    }

    function renderCaptionForTime(currentTime) {
        const overlay = document.getElementById('capcut-caption-overlay');
        const textEl = document.getElementById('capcut-caption-text');
        if (!overlay || !textEl || !captionConfig.enabled) return;

        const words = captionConfig.customWordsList || [];
        if (words.length === 0) {
            textEl.textContent = isPlaying ? '' : 'Sample Captions';
            return;
        }

        const activeIdx = words.findIndex(w => currentTime >= (w.start - 0.05) && currentTime <= (w.end + 0.15));

        if (activeIdx === -1) {
            const lastSpoken = words.slice().reverse().find(w => w.end <= currentTime && (currentTime - w.end) < 0.4);
            if (!lastSpoken && isPlaying) {
                textEl.innerHTML = '';
                return;
            }
        }

        const idx = activeIdx !== -1 ? activeIdx : (words.findIndex(w => w.end > currentTime) !== -1 ? words.findIndex(w => w.end > currentTime) : 0);
        
        let windowWords = [];
        if (captionConfig.pacingMode === 'word') {
            windowWords = [words[idx]];
        } else if (captionConfig.pacingMode === 'sentence') {
            const startGroup = Math.max(0, Math.floor(idx / 8) * 8);
            windowWords = words.slice(startGroup, startGroup + 8);
        } else {
            const chunkSize = captionConfig.maxWords || 4;
            const startGroup = Math.floor(idx / chunkSize) * chunkSize;
            windowWords = words.slice(startGroup, startGroup + chunkSize);
        }

        let html = '';
        windowWords.forEach(w => {
            if (!w) return;
            const isWordActive = (currentTime >= (w.start - 0.05) && currentTime <= (w.end + 0.15));
            if (isWordActive) {
                html += `<span style="color:${captionConfig.highlightColor};transform:scale(1.08);display:inline-block;font-weight:900;text-shadow:0 0 10px ${captionConfig.highlightColor}88;margin:0 4px;transition:transform 0.1s ease;">${w.word}</span> `;
            } else {
                html += `<span style="color:${captionConfig.textColor};display:inline-block;margin:0 4px;opacity:0.9;">${w.word}</span> `;
            }
        });

        textEl.innerHTML = html.trim();
    }

    function downloadSrtFile() {
        const words = captionConfig.customWordsList || [];
        if (!words || words.length === 0) {
            alert('No transcription timestamps available yet! Please click "🤖 1-Click Auto-Sync" or "🤖 Auto-Sync Timeline" first to generate millisecond subtitle timings.');
            return;
        }

        let srtContent = '';
        let srtIndex = 1;
        const chunkSize = captionConfig.maxWords || 5;

        for (let i = 0; i < words.length; i += chunkSize) {
            const chunk = words.slice(i, i + chunkSize);
            if (chunk.length === 0) continue;

            const startSec = chunk[0].start;
            const endSec = chunk[chunk.length - 1].end;
            const text = chunk.map(c => c.word).join(' ');

            const formatSrtTime = (sec) => {
                const totalMs = Math.floor(sec * 1000);
                const hrs = Math.floor(totalMs / 3600000);
                const mins = Math.floor((totalMs % 3600000) / 60000);
                const secs = Math.floor((totalMs % 60000) / 1000);
                const ms = totalMs % 1000;
                return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
            };

            srtContent += `${srtIndex}\n`;
            srtContent += `${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n`;
            srtContent += `${text}\n\n`;
            srtIndex++;
        }

        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `subtitles_${Date.now()}.srt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function selectClip(clipId, updatePlayhead = true) {
        if (selectedClipId === clipId && !isAudioTrackSelected) return;
        selectedClipId = clipId;
        selectedAudioClipId = null;
        isAudioTrackSelected = false;

        document.querySelectorAll('.capcut-asset-item').forEach(el => {
            if (el.dataset.id === clipId) el.classList.add('is-selected');
            else el.classList.remove('is-selected');
        });

        document.querySelectorAll('.capcut-tl-clip').forEach(el => {
            if (el.dataset.id === clipId) el.classList.add('is-selected');
            else el.classList.remove('is-selected');
        });

        document.querySelectorAll('.capcut-audio-track').forEach(el => el.classList.remove('is-selected'));

        renderInspector();
        
        const clip = mediaClips.find(c => c.id === clipId);
        if (clip) {
            const scaleSlider = document.getElementById('capcut-preview-scale-slider');
            const scaleText = document.getElementById('capcut-scale-text');
            if (scaleSlider && scaleText) {
                scaleSlider.value = clip.scale || 1.0;
                scaleText.textContent = Math.round((clip.scale || 1.0) * 100) + '%';
            }
            if (updatePlayhead) {
                setPlayheadTime(clip.timestampSec);
                ensurePlayheadVisible();
            }
        }
    }

    function selectAudioClip(audioId, updatePlayhead = true) {
        selectedAudioClipId = audioId;
        isAudioTrackSelected = true;
        selectedClipId = null;

        document.querySelectorAll('.capcut-asset-item').forEach(el => el.classList.remove('is-selected'));
        document.querySelectorAll('.capcut-tl-clip').forEach(el => el.classList.remove('is-selected'));

        document.querySelectorAll('.capcut-audio-track').forEach(el => {
            if (el.dataset.id === audioId) el.classList.add('is-selected');
            else el.classList.remove('is-selected');
        });

        renderInspector();

        const aClip = audioClips.find(c => c.id === audioId);
        if (aClip && updatePlayhead) {
            setPlayheadTime(aClip.timestampSec || 0);
            ensurePlayheadVisible();
        }
    }

    function selectAudioTrack(audioId) {
        if (audioId) {
            selectAudioClip(audioId);
        } else if (audioClips && audioClips.length > 0) {
            selectAudioClip(audioClips[0].id);
        } else {
            isAudioTrackSelected = true;
            selectedClipId = null;
            selectedAudioClipId = null;
            renderInspector();
        }
    }

    function removeClip(clipId) {
        pushHistoryState();
        const targetClip = mediaClips.find(c => c.id === clipId);
        if (!targetClip) return;

        const deletedTime = targetClip.timestampSec;
        const deletedDuration = targetClip.duration || 0;

        // Remove the clip
        mediaClips = mediaClips.filter(c => c.id !== clipId);

        // Instant Magnetic Ripple: Shift all subsequent clips backward by deletedDuration
        if (deletedDuration > 0) {
            mediaClips.forEach(c => {
                if (c.timestampSec > deletedTime) {
                    c.timestampSec = Math.max(0, parseFloat((c.timestampSec - deletedDuration).toFixed(2)));
                }
            });
        }

        // Re-sort and update serial numbers
        mediaClips.sort((a, b) => a.timestampSec - b.timestampSec);
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
        }

        if (selectedClipId === clipId) {
            selectedClipId = mediaClips.length > 0 ? mediaClips[0].id : null;
        }

        rippleRecalculateTimeline();
        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();
    }

    // ── Smart Context-Aware Split Razor Tool with Physical Audio Slicing ──
    async function splitCurrentClipAtPlayhead() {
        pushHistoryState();

        const isTargetingAudio = (hoveredTrackType === 'audio') || 
            (hoveredTrackType !== 'media' && isAudioTrackSelected && selectedAudioClipId);

        if (isTargetingAudio) {
            let activeAud = audioClips.find(a => a.id === selectedAudioClipId);
            if (!activeAud || !(playheadTime > activeAud.timestampSec && playheadTime < (activeAud.timestampSec + activeAud.duration))) {
                activeAud = audioClips.find(a => playheadTime > a.timestampSec && playheadTime < (a.timestampSec + a.duration));
            }

            if (activeAud && playheadTime > activeAud.timestampSec && playheadTime < (activeAud.timestampSec + activeAud.duration)) {
                const originalDuration = activeAud.duration;
                const splitOffset = parseFloat((playheadTime - activeAud.timestampSec).toFixed(3));
                const secondPartDuration = parseFloat((originalDuration - splitOffset).toFixed(3));

                if (splitOffset < 0.1 || secondPartDuration < 0.1) {
                    alert('Split point too close to the audio clip boundary (min 0.1s required).');
                    return;
                }

                try {
                    const ctx = getAudioContext();
                    if (!ctx) throw new Error('AudioContext not available');
                    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

                    // Ensure activeAud has decoded AudioBuffer
                    if (!activeAud.audioBuffer && activeAud.file) {
                        activeAud.audioBuffer = await decodeFileToAudioBuffer(activeAud.file);
                    }

                    if (!activeAud.audioBuffer) {
                        throw new Error('Could not decode audio buffer for split');
                    }

                    // Direct Sample-Accurate Buffer Slicing (Zero drift / Zero bleed)
                    const buf1 = sliceAudioBufferDirect(ctx, activeAud.audioBuffer, 0, splitOffset);
                    const buf2 = sliceAudioBufferDirect(ctx, activeAud.audioBuffer, splitOffset, secondPartDuration);

                    // Generate peaks directly from the pristine sliced buffers
                    const pt1Peaks = generateWaveformPeaksFromBuffer(buf1);
                    const pt2Peaks = generateWaveformPeaksFromBuffer(buf2);

                    // Encode independent WAV files
                    const pt1Blob = audioBufferToWavBlob(buf1);
                    const pt2Blob = audioBufferToWavBlob(buf2);

                    const baseName = (activeAud.name || 'audio').replace(/\.[^.]+$/, '').replace(/ \(part \d+\)/g, '');
                    const pt1File = new File([pt1Blob], `${baseName}_pt1.wav`, { type: 'audio/wav' });
                    const pt2File = new File([pt2Blob], `${baseName}_pt2.wav`, { type: 'audio/wav' });

                    // Update Part 1
                    destroyAudioElement(activeAud.audioElement, activeAud.url);
                    activeAud.audioBuffer = buf1;
                    activeAud.file = pt1File;
                    activeAud.url = URL.createObjectURL(pt1Blob);
                    activeAud.duration = parseFloat(buf1.duration.toFixed(2));
                    activeAud.waveformPeaks = pt1Peaks;
                    const firstAudObj = new Audio(activeAud.url);
                    firstAudObj.preload = 'auto';
                    firstAudObj.load();
                    activeAud.audioElement = firstAudObj;

                    // Create Part 2
                    const newAudId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                    const secondAudUrl = URL.createObjectURL(pt2Blob);
                    const secondAudObj = new Audio(secondAudUrl);
                    secondAudObj.preload = 'auto';
                    secondAudObj.load();

                    const newAudClip = {
                        id: newAudId,
                        audioBuffer: buf2,
                        file: pt2File,
                        name: `${baseName} (part 2)`,
                        url: secondAudUrl,
                        timestampSec: parseFloat((activeAud.timestampSec + activeAud.duration).toFixed(2)),
                        duration: parseFloat(buf2.duration.toFixed(2)),
                        audioElement: secondAudObj,
                        waveformPeaks: pt2Peaks
                    };

                    await saveBatchToDB([
                        { id: activeAud.id, file: pt1File },
                        { id: newAudId, file: pt2File }
                    ]);

                    const idx = audioClips.findIndex(a => a.id === activeAud.id);
                    audioClips.splice(idx + 1, 0, newAudClip);

                    rippleRecalculateTimeline();
                    renderTimeline();
                    selectAudioClip(newAudId);
                    persistProjectState();
                    return;
                } catch (err) {
                    console.error('Audio physical slice error:', err);
                }
            }
        }

        // 2. Video / Media Clip Split
        const activeClip = mediaClips.find(c => playheadTime > c.timestampSec && playheadTime < (c.timestampSec + c.duration));
        if (activeClip) {
            const originalDuration = activeClip.duration;
            const firstPartDuration = parseFloat((playheadTime - activeClip.timestampSec).toFixed(2));
            const secondPartDuration = parseFloat((originalDuration - firstPartDuration).toFixed(2));

            if (firstPartDuration < 0.2 || secondPartDuration < 0.2) {
                alert('Split point too close to the clip boundary (min 0.2s required).');
                return;
            }

            activeClip.duration = firstPartDuration;

            const newClipId = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            const newClip = {
                id: newClipId,
                file: activeClip.file,
                name: activeClip.name + ' (part 2)',
                type: activeClip.type,
                url: activeClip.url,
                timestampSec: parseFloat(playheadTime.toFixed(2)),
                serial: activeClip.serial + 1,
                duration: secondPartDuration,
                scale: activeClip.scale || 1.0,
                posX: activeClip.posX || 0,
                posY: activeClip.posY || 0,
                motion: activeClip.motion,
                transition: activeClip.transition,
                volume: activeClip.volume,
                speed: activeClip.speed,
                trimStart: activeClip.trimStart,
                trimEnd: activeClip.trimEnd
            };

            if (activeClip.file) saveBatchToDB([{ id: newClipId, file: activeClip.file }]);

            const idx = mediaClips.findIndex(c => c.id === activeClip.id);
            mediaClips.splice(idx + 1, 0, newClip);

            rippleRecalculateTimeline();
            renderAssetList();
            renderTimeline();
            selectClip(newClipId);
            persistProjectState();
            return;
        }

        // 3. Fallback: If no media was found under playhead, check if audio is under playhead
        const fallbackAud = audioClips.find(a => playheadTime > a.timestampSec && playheadTime < (a.timestampSec + a.duration));
        if (fallbackAud) {
            const originalDuration = fallbackAud.duration;
            const splitOffset = parseFloat((playheadTime - fallbackAud.timestampSec).toFixed(3));
            const secondPartDuration = parseFloat((originalDuration - splitOffset).toFixed(3));

            if (splitOffset < 0.1 || secondPartDuration < 0.1) {
                alert('Split point too close to the audio clip boundary (min 0.1s required).');
                return;
            }

            try {
                const ctx = getAudioContext();
                if (!ctx) throw new Error('AudioContext not available');
                if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

                if (!fallbackAud.audioBuffer && fallbackAud.file) {
                    fallbackAud.audioBuffer = await decodeFileToAudioBuffer(fallbackAud.file);
                }

                if (!fallbackAud.audioBuffer) {
                    throw new Error('Could not decode fallback audio buffer for split');
                }

                const buf1 = sliceAudioBufferDirect(ctx, fallbackAud.audioBuffer, 0, splitOffset);
                const buf2 = sliceAudioBufferDirect(ctx, fallbackAud.audioBuffer, splitOffset, secondPartDuration);

                const pt1Peaks = generateWaveformPeaksFromBuffer(buf1);
                const pt2Peaks = generateWaveformPeaksFromBuffer(buf2);

                const pt1Blob = audioBufferToWavBlob(buf1);
                const pt2Blob = audioBufferToWavBlob(buf2);

                const baseName = (fallbackAud.name || 'audio').replace(/\.[^.]+$/, '').replace(/ \(part \d+\)/g, '');
                const pt1File = new File([pt1Blob], `${baseName}_pt1.wav`, { type: 'audio/wav' });
                const pt2File = new File([pt2Blob], `${baseName}_pt2.wav`, { type: 'audio/wav' });

                destroyAudioElement(fallbackAud.audioElement, fallbackAud.url);
                fallbackAud.audioBuffer = buf1;
                fallbackAud.file = pt1File;
                fallbackAud.url = URL.createObjectURL(pt1Blob);
                fallbackAud.duration = parseFloat(buf1.duration.toFixed(2));
                fallbackAud.waveformPeaks = pt1Peaks;
                const firstAudObj = new Audio(fallbackAud.url);
                firstAudObj.preload = 'auto';
                firstAudObj.load();
                fallbackAud.audioElement = firstAudObj;

                const newAudId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                const secondAudUrl = URL.createObjectURL(pt2Blob);
                const secondAudObj = new Audio(secondAudUrl);
                secondAudObj.preload = 'auto';
                secondAudObj.load();

                const newAudClip = {
                    id: newAudId,
                    audioBuffer: buf2,
                    file: pt2File,
                    name: `${baseName} (part 2)`,
                    url: secondAudUrl,
                    timestampSec: parseFloat((fallbackAud.timestampSec + fallbackAud.duration).toFixed(2)),
                    duration: parseFloat(buf2.duration.toFixed(2)),
                    audioElement: secondAudObj,
                    waveformPeaks: pt2Peaks
                };

                await saveBatchToDB([
                    { id: fallbackAud.id, file: pt1File },
                    { id: newAudId, file: pt2File }
                ]);

                const idx = audioClips.findIndex(a => a.id === fallbackAud.id);
                audioClips.splice(idx + 1, 0, newAudClip);

                rippleRecalculateTimeline();
                renderTimeline();
                selectAudioClip(newAudId);
                persistProjectState();
                return;
            } catch (err) {
                console.error('Fallback audio slice error:', err);
            }
        }

        alert('Position the playhead (red line) inside a video, image, or audio clip to split it!');
    }

    function deleteSelectedClip() {
        if (isCaptionSelected) {
            deleteSelectedCaption();
            return;
        }

        if (selectedAudioClipId || isAudioTrackSelected) {
            const targetAudId = selectedAudioClipId || (audioClips.length > 0 ? audioClips[0].id : null);
            if (!targetAudId) {
                alert('Please select an audio clip or media clip to delete.');
                return;
            }

            pushHistoryState();

            const delIdx = audioClips.findIndex(a => a.id === targetAudId);
            if (delIdx !== -1) {
                const deletedClip = audioClips[delIdx];
                destroyAudioElement(deletedClip.audioElement, deletedClip.url);
                audioClips.splice(delIdx, 1);

                // ── Audio Ripple Delete (Auto-Join Gap Closure) ──
                // Shift all subsequent audio parts left to seamlessly close the gap!
                for (let i = delIdx; i < audioClips.length; i++) {
                    const prevEnd = (i === 0) ? 0 : (audioClips[i - 1].timestampSec + audioClips[i - 1].duration);
                    audioClips[i].timestampSec = parseFloat(prevEnd.toFixed(2));
                }
            }

            if (audioClips.length > 0) {
                const nextIdx = Math.min(Math.max(0, delIdx), audioClips.length - 1);
                selectedAudioClipId = audioClips[nextIdx].id;
                voiceoverAudio = audioClips[0];
            } else {
                selectedAudioClipId = null;
                voiceoverAudio = null;
                isAudioTrackSelected = false;
            }

            rippleRecalculateTimeline();
            renderTimeline();
            renderInspector();
            persistProjectState();
            return;
        }

        if (!selectedClipId) {
            alert('Please click on a clip in the timeline or media bin first to delete it.');
            return;
        }

        removeClip(selectedClipId);
    }

    function moveClipOrder(direction) {
        if (!selectedClipId) return;
        const idx = mediaClips.findIndex(c => c.id === selectedClipId);
        if (idx === -1) return;

        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= mediaClips.length) return;

        pushHistoryState();

        const temp = mediaClips[idx];
        mediaClips[idx] = mediaClips[targetIdx];
        mediaClips[targetIdx] = temp;

        rippleRecalculateTimeline();
        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();
    }

    function renderInspector() {
        const area = document.getElementById('capcut-clip-props-area');
        if (!area) return;

        if (selectedAudioClipId || (isAudioTrackSelected && !selectedClipId)) {
            const aClip = audioClips.find(c => c.id === selectedAudioClipId) || audioClips[0] || voiceoverAudio;
            if (!aClip) {
                area.innerHTML = `<div style="font-size:0.8em;color:rgba(255,255,255,0.4);text-align:center;padding:20px 0;">No audio clip selected.</div>`;
                return;
            }

            const partIdx = audioClips.findIndex(c => c.id === aClip.id);
            const partNum = partIdx !== -1 ? (partIdx + 1) : 1;

            area.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <span class="capcut-asset-serial" style="background:#0284c7;">🎙️</span>
                    <b style="font-size:0.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Part ${partNum}: ${aClip.name}</b>
                </div>

                <div class="capcut-prop-group">
                    <label>Start Time on Timeline (Sec)</label>
                    <input type="number" id="prop-audio-start" min="0" step="0.1" value="${(aClip.timestampSec || 0).toFixed(1)}">
                </div>

                <div class="capcut-prop-group">
                    <label>Audio Duration / Length (Sec)</label>
                    <input type="number" id="prop-audio-duration" min="0.1" step="0.1" value="${aClip.duration.toFixed(1)}">
                </div>

                <div class="capcut-prop-group" style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
                    <button type="button" class="btn-tl-tool audio-silence" id="btn-inspector-silence-cut" style="width:100%;padding:9px;font-size:0.85em;justify-content:center;">
                        🎙️ Auto-Cut Silence from Audio
                    </button>
                    <button type="button" class="btn-tl-tool" id="btn-inspector-delete-audio" style="width:100%;padding:9px;font-size:0.85em;justify-content:center;color:#ef4444;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);">
                        🗑️ Delete This Audio Clip
                    </button>
                </div>
            `;

            const btnCut = area.querySelector('#btn-inspector-silence-cut');
            if (btnCut) btnCut.addEventListener('click', openAudioSilenceModal);

            const btnDelAud = area.querySelector('#btn-inspector-delete-audio');
            if (btnDelAud) btnDelAud.addEventListener('click', deleteSelectedClip);

            const inpStart = area.querySelector('#prop-audio-start');
            if (inpStart) {
                inpStart.addEventListener('change', () => {
                    pushHistoryState();
                    aClip.timestampSec = Math.max(0, parseFloat(inpStart.value) || 0);
                    rippleRecalculateTimeline();
                    renderTimeline();
                    persistProjectState();
                });
            }

            const inpDur = area.querySelector('#prop-audio-duration');
            if (inpDur) {
                inpDur.addEventListener('change', () => {
                    pushHistoryState();
                    aClip.duration = Math.max(0.2, parseFloat(inpDur.value) || 1);
                    rippleRecalculateTimeline();
                    renderTimeline();
                    persistProjectState();
                });
            }
            return;
        }

        const clip = mediaClips.find(c => c.id === selectedClipId);
        if (!clip) {
            area.innerHTML = `
                <div style="font-size:0.8em;color:rgba(255,255,255,0.4);text-align:center;padding:20px 0;">
                    Select a clip on timeline to edit scale, motion, and transitions.
                </div>
            `;
            return;
        }

        const isVideo = clip.type === 'video';
        const fileNum = extractFileNumber(clip.name);
        const badgeLabel = fileNum !== null ? '#' + fileNum : '#' + clip.serial;

        area.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
                    <span class="capcut-asset-serial" style="${isVideo ? 'background:#8b5cf6;' : ''}">${isVideo ? '🎥' : badgeLabel}</span>
                    <b style="font-size:0.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${clip.name}</b>
                </div>
                <span style="font-size:0.75em;padding:2px 8px;border-radius:4px;background:${isVideo ? 'rgba(139,92,246,0.2)' : 'rgba(56,189,248,0.2)'};color:${isVideo ? '#c084fc' : '#38bdf8'};font-weight:700;">
                    ${isVideo ? '🎥 Video' : '🖼️ Image'}
                </span>
            </div>

            <!-- Timing Controls -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                <div class="capcut-prop-group" style="margin:0;">
                    <label style="font-size:0.75em;opacity:0.8;">Start Time (Sec)</label>
                    <input type="number" id="prop-start-time" min="0" step="0.1" value="${clip.timestampSec.toFixed(1)}" style="width:100%;box-sizing:border-box;">
                </div>
                <div class="capcut-prop-group" style="margin:0;">
                    <label style="font-size:0.75em;opacity:0.8;">Duration (Sec)</label>
                    <input type="number" id="prop-duration" min="0.1" step="0.1" value="${clip.duration.toFixed(1)}" style="width:100%;box-sizing:border-box;">
                </div>
            </div>

            <!-- Video Situation Controls: Speed, Trim Start, Loop/Freeze, Audio Volume -->
            ${isVideo ? `
                <!-- ⚡ Speed Control (Situation 2: Slow Mo / Fast Stretch) -->
                <div class="capcut-prop-group" style="background:rgba(139,92,246,0.06);padding:10px;border-radius:8px;border:1px solid rgba(139,92,246,0.2);margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <label style="color:#c084fc;font-weight:700;margin:0;font-size:0.82em;">⚡ Video Speed</label>
                        <b id="prop-speed-val" style="font-size:0.82em;color:#fff;">${clip.speed || 1.0}x</b>
                    </div>
                    <input type="range" id="prop-speed" min="0.25" max="3.0" step="0.05" value="${clip.speed || 1.0}" style="width:100%;accent-color:#c084fc;">
                    <div style="display:flex;justify-content:space-between;gap:4px;margin-top:6px;">
                        <button type="button" class="btn-speed-preset" data-speed="0.5" style="flex:1;font-size:0.7em;padding:4px 2px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:4px;cursor:pointer;">0.5x Slow</button>
                        <button type="button" class="btn-speed-preset" data-speed="1.0" style="flex:1;font-size:0.7em;padding:4px 2px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:4px;cursor:pointer;">1.0x Normal</button>
                        <button type="button" class="btn-speed-preset" data-speed="1.5" style="flex:1;font-size:0.7em;padding:4px 2px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:4px;cursor:pointer;">1.5x Fast</button>
                        <button type="button" class="btn-speed-preset" data-speed="2.0" style="flex:1;font-size:0.7em;padding:4px 2px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:4px;cursor:pointer;">2.0x</button>
                    </div>
                    <button type="button" id="btn-speed-autofit" style="width:100%;margin-top:6px;font-size:0.72em;padding:5px;background:rgba(192,132,252,0.15);border:1px solid #c084fc;color:#c084fc;border-radius:4px;cursor:pointer;font-weight:700;">
                        ⚡ Fit Speed to Scene Duration
                    </button>
                </div>

                <!-- ⏱️ Trim Start / Offset (Situation 1: Longer Video Part Selection) -->
                <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <label style="font-size:0.8em;margin:0;">⏱️ Trim Start Point</label>
                        <b id="prop-trim-start-val" style="font-size:0.8em;color:#38bdf8;">${(clip.trimStart || 0).toFixed(1)}s</b>
                    </div>
                    <input type="number" id="prop-trim-start" min="0" step="0.1" value="${(clip.trimStart || 0).toFixed(1)}" style="width:100%;box-sizing:border-box;">
                    <span style="font-size:0.7em;color:rgba(255,255,255,0.4);display:block;margin-top:3px;">Sets which second of the video begins playing.</span>
                </div>

                <!-- 🔁 Shorter Video Behavior (Situation 2: Loop vs Freeze) -->
                <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                    <label style="font-size:0.8em;margin-bottom:4px;display:block;">🔁 Shorter Video Fill</label>
                    <select id="prop-loop-mode" style="width:100%;box-sizing:border-box;font-size:0.8em;padding:5px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;">
                        <option value="loop" ${clip.loopMode !== 'freeze' ? 'selected' : ''}>🔁 Auto-Loop (Repeat to fill scene)</option>
                        <option value="freeze" ${clip.loopMode === 'freeze' ? 'selected' : ''}>❄️ Freeze Frame (Hold last video frame)</option>
                    </select>
                </div>

                <!-- 🔊 Original Video Audio / Sound (Situation 3: Sound Clash Control) -->
                <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <label style="font-size:0.8em;margin:0;">🔊 Original Video Audio</label>
                        <button type="button" id="btn-toggle-video-mute" style="font-size:0.72em;padding:2px 8px;background:${(clip.volume || 0) > 0 ? '#10b981' : '#ef4444'};color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;">
                            ${(clip.volume || 0) > 0 ? '🔊 Unmuted' : '🔇 Muted (0%)'}
                        </button>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="range" id="prop-video-volume" min="0" max="100" step="5" value="${clip.volume != null ? clip.volume : 0}" style="flex:1;accent-color:#10b981;">
                        <span id="prop-video-volume-val" style="font-size:0.8em;font-weight:600;width:38px;text-align:right;">${clip.volume != null ? clip.volume : 0}%</span>
                    </div>
                    <span style="font-size:0.7em;color:rgba(255,255,255,0.4);display:block;margin-top:3px;">Default is 0% Muted so voiceover is 100% clean.</span>
                </div>
            ` : ''}

            <!-- Situation 4: Scale, Fit Mode & Ken Burns -->
            <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <label style="font-size:0.8em;margin:0;">📐 Scale & Fit Mode</label>
                    <span id="prop-scale-text" style="font-size:0.8em;font-weight:700;color:#38bdf8;">${Math.round((clip.scale || 1.0) * 100)}%</span>
                </div>
                <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <button type="button" class="btn-fit-mode ${clip.fitMode !== 'cover' ? 'active' : ''}" data-fit="contain" style="flex:1;font-size:0.75em;padding:5px;background:${clip.fitMode !== 'cover' ? '#0284c7' : 'rgba(255,255,255,0.08)'};border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;cursor:pointer;">
                        Fit (Full View)
                    </button>
                    <button type="button" class="btn-fit-mode ${clip.fitMode === 'cover' ? 'active' : ''}" data-fit="cover" style="flex:1;font-size:0.75em;padding:5px;background:${clip.fitMode === 'cover' ? '#0284c7' : 'rgba(255,255,255,0.08)'};border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;cursor:pointer;">
                        Fill / Cover Screen
                    </button>
                </div>
                <input type="range" id="prop-scale" min="0.5" max="2.5" step="0.05" value="${clip.scale || 1.0}" style="width:100%;accent-color:#38bdf8;">
            </div>

            <!-- 🎞️ TRANSITIONS (From Old Project) -->
            <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <label style="font-size:0.82em;font-weight:700;color:#38bdf8;margin:0;">🎞️ TRANSITIONS</label>
                    <label style="display:flex;align-items:center;gap:5px;font-size:0.75em;cursor:pointer;">
                        <span>Random mix</span>
                        <input type="checkbox" id="prop-trans-random" ${isRandomTransitionMix ? 'checked' : ''} style="width:14px;height:14px;accent-color:#38bdf8;">
                    </label>
                </div>
                <span style="font-size:0.7em;color:rgba(255,255,255,0.45);display:block;margin-bottom:6px;">Tap a cut above to set its transition</span>
                
                <div class="grid-transitions" id="prop-trans-grid">
                    ${Object.keys(TRANSITIONS_MAP).map(k => {
                        const tr = TRANSITIONS_MAP[k];
                        const isActive = (clip.transition || globalTransitionType) === tr.id;
                        return `
                            <button type="button" class="btn-trans-item ${isActive ? 'is-active' : ''}" data-trans="${tr.id}">
                                <span class="trans-icon">${tr.icon}</span>
                                <span>${tr.label}</span>
                            </button>
                        `;
                    }).join('')}
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:0.75em;">
                    <span>Duration:</span>
                    <b id="prop-trans-dur-val" style="color:#38bdf8;">${globalTransitionDuration.toFixed(2)}s</b>
                </div>
                <input type="range" id="prop-trans-duration" min="0.10" max="1.50" step="0.05" value="${globalTransitionDuration}" style="width:100%;accent-color:#38bdf8;margin-top:2px;">

                <button type="button" id="btn-apply-trans-all" style="width:100%;margin-top:8px;padding:6px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer;">
                    Apply "${TRANSITIONS_MAP[clip.transition || globalTransitionType]?.label || 'Crossfade'}" to all cuts
                </button>
            </div>

            <!-- 🔍 MOTION — KEN BURNS ZOOM (From Old Project) -->
            ${!isVideo ? `
                <div class="capcut-prop-group" style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);margin-top:8px;">
                    <label style="font-size:0.82em;font-weight:700;color:#facc15;margin:0;display:block;">MOTION — KEN BURNS ZOOM</label>
                    <span style="font-size:0.7em;color:rgba(255,255,255,0.45);display:block;margin-top:2px;margin-bottom:6px;">Click an image on the timeline to set its zoom. Set the depth, or apply to all here.</span>

                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.75em;">
                        <span>Zoom depth</span>
                        <b id="prop-zoom-depth-val" style="color:#facc15;">${Math.round(globalZoomDepth * 100)}%</b>
                    </div>
                    <input type="range" id="prop-zoom-depth" min="0.02" max="0.20" step="0.01" value="${globalZoomDepth}" style="width:100%;accent-color:#facc15;margin-top:2px;">

                    <div class="grid-motion-actions">
                        <button type="button" class="btn-motion-action" id="btn-motion-zoomin-all">Zoom in all</button>
                        <button type="button" class="btn-motion-action" id="btn-motion-zoomout-all">Zoom out all</button>
                        <button type="button" class="btn-motion-action" id="btn-motion-alternate">Alternate</button>
                        <button type="button" class="btn-motion-action" id="btn-motion-clear">Clear</button>
                    </div>
                </div>
            ` : ''}

            <!-- Delete Clip Button -->
            <div style="margin-top:12px;">
                <button type="button" id="btn-inspector-delete-media" style="width:100%;padding:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:6px;font-size:0.82em;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                    <span>🗑️ Delete Clip from Timeline</span>
                </button>
            </div>
        `;

        area.querySelector('#prop-start-time').addEventListener('input', (e) => {
            pushHistoryState();
            clip.timestampSec = Math.max(0, parseFloat(e.target.value) || 0);
            rippleRecalculateTimeline();
            renderTimeline();
            persistProjectState();
        });
        area.querySelector('#prop-duration').addEventListener('input', (e) => {
            pushHistoryState();
            clip.duration = Math.max(0.1, parseFloat(e.target.value) || 0.1);
            rippleRecalculateTimeline();
            renderTimeline();
            persistProjectState();
        });
        area.querySelector('#prop-scale').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            clip.scale = val;
            area.querySelector('#prop-scale-text').textContent = Math.round(val * 100) + '%';
            applyPreviewScale(val, clip.posX || 0, clip.posY || 0);
            debouncedAutoSave();
        });

        // Transitions Event Handlers
        const transRandomChk = area.querySelector('#prop-trans-random');
        if (transRandomChk) {
            transRandomChk.addEventListener('change', (e) => {
                isRandomTransitionMix = e.target.checked;
                debouncedAutoSave();
            });
        }

        area.querySelectorAll('.btn-trans-item').forEach(btn => {
            btn.addEventListener('click', () => {
                pushHistoryState();
                const trId = btn.dataset.trans;
                clip.transition = trId;
                globalTransitionType = trId;
                area.querySelectorAll('.btn-trans-item').forEach(b => {
                    b.classList.toggle('is-active', b.dataset.trans === trId);
                });
                const applyBtn = area.querySelector('#btn-apply-trans-all');
                if (applyBtn) {
                    applyBtn.textContent = `Apply "${TRANSITIONS_MAP[trId]?.label || trId}" to all cuts`;
                }
                debouncedAutoSave();
            });
        });

        const transDurSlider = area.querySelector('#prop-trans-duration');
        const transDurVal = area.querySelector('#prop-trans-dur-val');
        if (transDurSlider && transDurVal) {
            transDurSlider.addEventListener('input', (e) => {
                globalTransitionDuration = parseFloat(e.target.value);
                transDurVal.textContent = globalTransitionDuration.toFixed(2) + 's';
                debouncedAutoSave();
            });
        }

        const btnApplyTransAll = area.querySelector('#btn-apply-trans-all');
        if (btnApplyTransAll) {
            btnApplyTransAll.addEventListener('click', () => {
                pushHistoryState();
                const targetTr = clip.transition || globalTransitionType || 'fade';
                for (const c of mediaClips) {
                    c.transition = targetTr;
                }
                alert(`✅ Applied "${TRANSITIONS_MAP[targetTr]?.label || targetTr}" transition to all timeline cuts!`);
                debouncedAutoSave();
            });
        }

        // Motion Event Handlers
        if (!isVideo) {
            const zoomSlider = area.querySelector('#prop-zoom-depth');
            const zoomVal = area.querySelector('#prop-zoom-depth-val');
            if (zoomSlider && zoomVal) {
                zoomSlider.addEventListener('input', (e) => {
                    globalZoomDepth = parseFloat(e.target.value);
                    zoomVal.textContent = Math.round(globalZoomDepth * 100) + '%';
                    updatePlayerScreen();
                    debouncedAutoSave();
                });
            }

            const btnZoomInAll = area.querySelector('#btn-motion-zoomin-all');
            if (btnZoomInAll) {
                btnZoomInAll.addEventListener('click', () => {
                    pushHistoryState();
                    for (const c of mediaClips) {
                        if (c.type !== 'video') c.motion = 'zoomin';
                    }
                    alert('✅ Applied Zoom In to all image clips!');
                    updatePlayerScreen();
                    debouncedAutoSave();
                });
            }

            const btnZoomOutAll = area.querySelector('#btn-motion-zoomout-all');
            if (btnZoomOutAll) {
                btnZoomOutAll.addEventListener('click', () => {
                    pushHistoryState();
                    for (const c of mediaClips) {
                        if (c.type !== 'video') c.motion = 'zoomout';
                    }
                    alert('✅ Applied Zoom Out to all image clips!');
                    updatePlayerScreen();
                    debouncedAutoSave();
                });
            }

            const btnAlternate = area.querySelector('#btn-motion-alternate');
            if (btnAlternate) {
                btnAlternate.addEventListener('click', () => {
                    pushHistoryState();
                    let toggle = true;
                    for (const c of mediaClips) {
                        if (c.type !== 'video') {
                            c.motion = toggle ? 'zoomin' : 'zoomout';
                            toggle = !toggle;
                        }
                    }
                    alert('✅ Alternated Zoom In & Zoom Out across timeline clips!');
                    updatePlayerScreen();
                    debouncedAutoSave();
                });
            }

            const btnClearMotion = area.querySelector('#btn-motion-clear');
            if (btnClearMotion) {
                btnClearMotion.addEventListener('click', () => {
                    pushHistoryState();
                    for (const c of mediaClips) {
                        c.motion = 'none';
                    }
                    alert('✅ Cleared motion zoom on all clips.');
                    updatePlayerScreen();
                    debouncedAutoSave();
                });
            }
        }

        // Fit Mode Handlers
        area.querySelectorAll('.btn-fit-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                pushHistoryState();
                clip.fitMode = btn.dataset.fit;
                area.querySelectorAll('.btn-fit-mode').forEach(b => {
                    const isActive = b.dataset.fit === clip.fitMode;
                    b.style.background = isActive ? '#0284c7' : 'rgba(255,255,255,0.08)';
                });
                updatePlayerScreen();
                debouncedAutoSave();
            });
        });

        // Video Specific Tool Handlers
        if (isVideo) {
            const speedSlider = area.querySelector('#prop-speed');
            const speedVal = area.querySelector('#prop-speed-val');
            if (speedSlider && speedVal) {
                speedSlider.addEventListener('input', (e) => {
                    const spd = parseFloat(e.target.value);
                    clip.speed = spd;
                    speedVal.textContent = spd.toFixed(2) + 'x';
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) activeVid.playbackRate = spd;
                    debouncedAutoSave();
                });
            }

            const btnAutoFit = area.querySelector('#btn-speed-autofit');
            if (btnAutoFit) {
                btnAutoFit.addEventListener('click', () => {
                    const getDurAndApply = (natDur) => {
                        if (natDur && clip.duration > 0) {
                            pushHistoryState();
                            const newSpeed = parseFloat(Math.min(3.0, Math.max(0.25, natDur / clip.duration)).toFixed(2));
                            clip.speed = newSpeed;
                            if (speedSlider) speedSlider.value = newSpeed;
                            if (speedVal) speedVal.textContent = newSpeed.toFixed(2) + 'x';
                            const activeVid = document.getElementById('capcut-active-video-element');
                            if (activeVid) activeVid.playbackRate = newSpeed;
                            renderInspector();
                            renderTimeline();
                            updatePlayerScreen();
                            persistProjectState();
                        }
                    };

                    let detectedDur = clip.naturalDuration || clip.origFileDuration;
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (!detectedDur && activeVid && activeVid.duration && isFinite(activeVid.duration) && activeVid.duration > 0) {
                        detectedDur = activeVid.duration;
                        clip.naturalDuration = detectedDur;
                    }

                    if (detectedDur && detectedDur > 0) {
                        getDurAndApply(detectedDur);
                    } else if (clip.url) {
                        const tempVid = document.createElement('video');
                        tempVid.src = clip.url;
                        tempVid.preload = 'metadata';
                        tempVid.onloadedmetadata = () => {
                            if (tempVid.duration && isFinite(tempVid.duration) && tempVid.duration > 0) {
                                clip.naturalDuration = tempVid.duration;
                                getDurAndApply(tempVid.duration);
                            } else {
                                alert('Could not automatically determine video length.');
                            }
                        };
                        tempVid.onerror = () => {
                            alert('Could not read video metadata.');
                        };
                    } else {
                        alert('Current clip duration: ' + (clip.duration ? clip.duration.toFixed(1) : 0) + 's.');
                    }
                });
            }

            area.querySelectorAll('.btn-speed-preset').forEach(btn => {
                btn.addEventListener('click', () => {
                    pushHistoryState();
                    const spd = parseFloat(btn.dataset.speed);
                    clip.speed = spd;
                    if (speedSlider) speedSlider.value = spd;
                    if (speedVal) speedVal.textContent = spd.toFixed(2) + 'x';
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) activeVid.playbackRate = spd;
                    debouncedAutoSave();
                });
            });

            const trimInp = area.querySelector('#prop-trim-start');
            const trimVal = area.querySelector('#prop-trim-start-val');
            if (trimInp && trimVal) {
                trimInp.addEventListener('input', (e) => {
                    const t = Math.max(0, parseFloat(e.target.value) || 0);
                    clip.trimStart = t;
                    trimVal.textContent = t.toFixed(1) + 's';
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) {
                        try { activeVid.currentTime = t; } catch(err){}
                    }
                    debouncedAutoSave();
                });
            }

            const loopSel = area.querySelector('#prop-loop-mode');
            if (loopSel) {
                loopSel.addEventListener('change', (e) => {
                    pushHistoryState();
                    clip.loopMode = e.target.value;
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) activeVid.loop = (clip.loopMode !== 'freeze');
                    debouncedAutoSave();
                });
            }

            const volSlider = area.querySelector('#prop-video-volume');
            const volVal = area.querySelector('#prop-video-volume-val');
            const muteBtn = area.querySelector('#btn-toggle-video-mute');

            if (volSlider && volVal) {
                volSlider.addEventListener('input', (e) => {
                    const v = parseInt(e.target.value, 10);
                    clip.volume = v;
                    volVal.textContent = v + '%';
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) {
                        activeVid.volume = v / 100;
                        activeVid.muted = (v === 0);
                    }
                    if (muteBtn) {
                        muteBtn.textContent = v > 0 ? '🔊 Unmuted' : '🔇 Muted (0%)';
                        muteBtn.style.background = v > 0 ? '#10b981' : '#ef4444';
                    }
                    debouncedAutoSave();
                });
            }

            if (muteBtn) {
                muteBtn.addEventListener('click', () => {
                    pushHistoryState();
                    if ((clip.volume || 0) > 0) {
                        clip.volume = 0;
                    } else {
                        clip.volume = 100;
                    }
                    if (volSlider) volSlider.value = clip.volume;
                    if (volVal) volVal.textContent = clip.volume + '%';
                    const activeVid = document.getElementById('capcut-active-video-element');
                    if (activeVid) {
                        activeVid.volume = clip.volume / 100;
                        activeVid.muted = (clip.volume === 0);
                    }
                    muteBtn.textContent = clip.volume > 0 ? '🔊 Unmuted' : '🔇 Muted (0%)';
                    muteBtn.style.background = clip.volume > 0 ? '#10b981' : '#ef4444';
                    debouncedAutoSave();
                });
            }
        }

        const delMediaBtn = area.querySelector('#btn-inspector-delete-media');
        if (delMediaBtn) {
            delMediaBtn.addEventListener('click', deleteSelectedClip);
        }
    }

    function renderTimeline() {
        const trackbox = document.getElementById('capcut-tl-trackbox');
        const ruler = document.getElementById('capcut-time-ruler-box');
        const vTrack = document.getElementById('capcut-video-track-row');
        const aTrack = document.getElementById('capcut-audio-track-row');
        if (!trackbox || !ruler || !vTrack || !aTrack) return;

        const pxPerSec = 50 * timelineZoom;
        const maxDuration = Math.max(15, totalTimelineDuration);

        trackbox.style.width = Math.max(1400, (maxDuration * pxPerSec) + 300) + 'px';

        let majorSec = 3;
        if (timelineZoom < 0.3) majorSec = 15;
        else if (timelineZoom < 0.6) majorSec = 6;
        else if (timelineZoom >= 1.5) majorSec = 2;

        let rulerHTML = '';
        for (let sec = 0; sec <= maxDuration; sec += majorSec) {
            const majorX = (sec * pxPerSec) + 60;
            rulerHTML += `
                <div class="capcut-ruler-tick" style="left:${majorX}px;">
                    ${fmtTimeShort(sec)}
                </div>
            `;
            for (let sub = 1; sub < majorSec; sub++) {
                const subSec = sec + sub;
                if (subSec <= maxDuration) {
                    const subX = (subSec * pxPerSec) + 60;
                    rulerHTML += `<div class="capcut-ruler-microtick" style="left:${subX}px;"></div>`;
                }
            }
        }
        ruler.innerHTML = rulerHTML;

        let vHTML = '<span class="capcut-track-label">Media</span>';
        for (const clip of mediaClips) {
            const left = (clip.timestampSec * pxPerSec);
            const width = Math.max(30, (clip.duration * pxPerSec));
            const isSel = clip.id === selectedClipId;
            const fileNum = extractFileNumber(clip.name);
            const badgeLabel = fileNum !== null ? '#' + fileNum : '#' + clip.serial;

            if (clip.isMissing) {
                vHTML += `
                    <div class="capcut-tl-clip is-missing ${isSel ? 'is-selected' : ''}" style="left:${left}px;width:${width}px;background:rgba(245,158,11,0.15);border:1.5px dashed #f59e0b;" data-id="${clip.id}">
                        <div class="capcut-tl-clip-header">
                            <span style="color:#f59e0b;">⚠️</span>
                            <span style="overflow:hidden;text-overflow:ellipsis;color:#f59e0b;font-weight:700;">Missing #${clip.missingSceneNumber || badgeLabel}</span>
                            <span style="opacity:0.6;margin-left:auto;">${clip.duration.toFixed(1)}s</span>
                        </div>
                        <div class="capcut-tl-clip-filmstrip" style="display:flex;align-items:center;justify-content:center;color:#f59e0b;font-size:0.75em;background:rgba(0,0,0,0.4);font-weight:600;">
                            Drop #${clip.missingSceneNumber || badgeLabel} here
                        </div>
                    </div>
                `;
            } else {
                vHTML += `
                    <div class="capcut-tl-clip ${isSel ? 'is-selected' : ''}" style="left:${left}px;width:${width}px;" data-id="${clip.id}">
                        <div class="capcut-trim-handle left" data-trim="left" data-id="${clip.id}"></div>
                        <div class="capcut-tl-clip-header">
                            <span>${badgeLabel}</span>
                            <span style="overflow:hidden;text-overflow:ellipsis;">${clip.name}</span>
                            <span style="opacity:0.6;margin-left:auto;">${clip.duration.toFixed(1)}s</span>
                        </div>
                        <div class="capcut-tl-clip-filmstrip" style="background-image:url('${clip.url}');"></div>
                        <div class="capcut-trim-handle right" data-trim="right" data-id="${clip.id}"></div>
                    </div>
                `;
            }
        }
        vTrack.innerHTML = vHTML;

        vTrack.querySelectorAll('.capcut-tl-clip').forEach(el => {
            el.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.capcut-trim-handle')) return;
                const targetSec = getTimeFromTimelinePointerEvent(e);
                setPlayheadTime(targetSec);
                selectClip(el.dataset.id, false);
                isScrubbingPlayhead = true;
            });
        });

        vTrack.querySelectorAll('.capcut-trim-handle').forEach(handle => {
            handle.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                isResizingClip = true;
                resizeClipId = handle.dataset.id;
                resizeEdge = handle.dataset.trim;
                resizeStartX = e.clientX;
                const clip = mediaClips.find(c => c.id === resizeClipId);
                if (clip) {
                    resizeOriginalStart = clip.timestampSec;
                    resizeOriginalDuration = clip.duration;
                }
            });
        });

        const activeAudioList = (audioClips && audioClips.length > 0) ? audioClips : (voiceoverAudio ? [voiceoverAudio] : []);

        if (activeAudioList.length > 0) {
            let aHTML = '<span class="capcut-track-label">Audio</span>';
            for (let i = 0; i < activeAudioList.length; i++) {
                const aClip = activeAudioList[i];
                const aLeft = (aClip.timestampSec || 0) * pxPerSec;
                const aWidth = Math.max(60, (aClip.duration * pxPerSec));
                const isSelAudio = isAudioTrackSelected && (selectedAudioClipId === aClip.id || (!selectedAudioClipId && i === 0));
                const partLabel = activeAudioList.length > 1 ? `Part ${i+1}: ` : '';

                aHTML += `
                    <div class="capcut-audio-track ${isSelAudio ? 'is-selected' : ''}" style="left:${aLeft}px;width:${aWidth}px;" data-id="${aClip.id}">
                        <div class="capcut-trim-handle left" data-trim="left" data-type="audio" data-id="${aClip.id}"></div>
                        <div class="capcut-audio-header">
                            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🎙️ ${partLabel}${aClip.name}</span>
                            <span style="opacity:0.8;font-weight:700;margin-left:auto;">⏱ ${aClip.duration.toFixed(1)}s</span>
                        </div>
                        <canvas class="capcut-waveform-canvas" id="canvas_aud_${aClip.id}" width="${Math.floor(aWidth)}" height="38"></canvas>
                        <div class="capcut-trim-handle right" data-trim="right" data-type="audio" data-id="${aClip.id}"></div>
                    </div>
                `;
            }
            aTrack.innerHTML = aHTML;

            aTrack.querySelectorAll('.capcut-audio-track').forEach(el => {
                el.addEventListener('pointerdown', (e) => {
                    if (e.target.closest('.capcut-trim-handle')) return;
                    const targetSec = getTimeFromTimelinePointerEvent(e);
                    setPlayheadTime(targetSec);
                    selectAudioClip(el.dataset.id, false);

                    isResizingClip = true;
                    resizeClipId = el.dataset.id;
                    resizeClipType = 'audio';
                    resizeEdge = 'move';
                    resizeStartX = e.clientX;
                    const clip = audioClips.find(c => c.id === resizeClipId);
                    if (clip) {
                        pushHistoryState();
                        resizeOriginalStart = clip.timestampSec || 0;
                        resizeOriginalDuration = clip.duration;
                    }
                });
            });

            aTrack.querySelectorAll('.capcut-trim-handle').forEach(handle => {
                handle.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    isResizingClip = true;
                    resizeClipId = handle.dataset.id;
                    resizeClipType = 'audio';
                    resizeEdge = handle.dataset.trim;
                    resizeStartX = e.clientX;
                    const clip = audioClips.find(c => c.id === resizeClipId);
                    if (clip) {
                        pushHistoryState();
                        resizeOriginalStart = clip.timestampSec || 0;
                        resizeOriginalDuration = clip.duration;
                    }
                });
            });

            activeAudioList.forEach(aClip => {
                const aWidth = Math.max(60, (aClip.duration * pxPerSec));
                drawAudioClipWaveformCanvas(`canvas_aud_${aClip.id}`, aClip.waveformPeaks, aWidth, 38);
            });
        } else {
            aTrack.innerHTML = `<span class="capcut-track-label">Audio</span><div style="font-size:0.75em;color:rgba(255,255,255,0.3);padding-left:10px;">No voiceover audio loaded</div>`;
        }

        updatePlayheadDOM();
    }

    function drawAudioClipWaveformCanvas(canvasId, peaks, width, height) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        if (!peaks || peaks.length === 0) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
            ctx.fillRect(0, height - 2, width, 2);
            return;
        }

        const numBars = Math.floor(width / 3);
        const barWidth = 2;
        const gap = 1;

        for (let i = 0; i < numBars; i++) {
            const x = i * (barWidth + gap);
            const peakIdx = Math.floor((i / numBars) * peaks.length);
            const amplitude = peaks[peakIdx] || 0;

            if (amplitude > 0.015) {
                const barHeight = Math.max(3, Math.min(height - 4, amplitude * (height - 6)));
                const y = height - barHeight;

                ctx.fillStyle = amplitude > 0.55 ? '#38bdf8' : '#0284c7';
                ctx.fillRect(x, y, barWidth, barHeight);

                if (amplitude > 0.25) {
                    ctx.fillStyle = '#f59e0b';
                    ctx.fillRect(x, y, barWidth, 2);
                }
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.fillRect(x, height - 2, barWidth, 1);
            }
        }
    }

    function drawAudioWaveformCanvas(width, height) {
        if (voiceoverAudio) {
            drawAudioClipWaveformCanvas(`canvas_aud_${voiceoverAudio.id || 'main'}`, voiceoverAudio.waveformPeaks, width, height);
        }
    }

    function getTimeFromTimelinePointerEvent(e) {
        const trackbox = document.getElementById('capcut-tl-trackbox');
        if (!trackbox) return 0;
        const rect = trackbox.getBoundingClientRect();
        const clickX = e.clientX - (rect.left + 60);
        const pxPerSec = 50 * timelineZoom;
        const targetSec = Math.max(0, Math.min(totalTimelineDuration, clickX / pxPerSec));
        return parseFloat(targetSec.toFixed(2));
    }

    function setPlayheadTime(sec) {
        playheadTime = Math.max(0, Math.min(totalTimelineDuration, sec));
        
        const activeAudList = (audioClips && audioClips.length > 0) ? audioClips : (voiceoverAudio ? [voiceoverAudio] : []);
        const activeAud = activeAudList.find(a => playheadTime >= (a.timestampSec || 0) && playheadTime < ((a.timestampSec || 0) + a.duration));

        activeAudList.forEach(a => {
            if (a !== activeAud && a.audioElement && !a.audioElement.paused) {
                a.audioElement.pause();
            }
        });

        if (activeAud && activeAud.audioElement) {
            const offset = playheadTime - (activeAud.timestampSec || 0);
            if (!isPlaying || Math.abs(activeAud.audioElement.currentTime - offset) > 0.05) {
                activeAud.audioElement.currentTime = offset;
            }
        }

        const activeClip = mediaClips.find(c => playheadTime >= c.timestampSec && playheadTime < (c.timestampSec + c.duration));
        if (activeClip && activeClip.type === 'video') {
            const vidEl = document.getElementById('capcut-active-video-element');
            if (vidEl) {
                const clipOffset = (playheadTime - activeClip.timestampSec) * (activeClip.speed || 1.0) + (activeClip.trimStart || 0);
                if (Number.isFinite(clipOffset) && clipOffset >= 0 && Math.abs(vidEl.currentTime - clipOffset) > 0.1) {
                    try { vidEl.currentTime = clipOffset; } catch(err){}
                }
            }
        }

        updatePlayheadDOM();
        updatePlayerScreen();
        renderCaptionForTime(playheadTime);
    }

    function updatePlayheadDOM() {
        const ph = document.getElementById('capcut-tl-playhead');
        const tc = document.getElementById('capcut-timecode-text');
        if (ph) {
            const pxPerSec = 50 * timelineZoom;
            const xOffset = playheadTime * pxPerSec;
            ph.style.transform = `translate3d(${xOffset}px, 0, 0)`;
        }
        if (tc) {
            tc.textContent = fmtTime(playheadTime) + ' / ' + fmtTime(totalTimelineDuration);
        }
    }

    function updatePlayerScreen() {
        const screenContent = document.getElementById('capcut-screen-content');
        if (!screenContent) return;

        if (!mediaClips || mediaClips.length === 0) {
            currentRenderedClipId = null;
            screenContent.innerHTML = `<div style="color:rgba(255,255,255,0.3);font-size:0.9em;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">No Media Loaded</div>`;
            return;
        }

        const activeIdx = mediaClips.findIndex(c => playheadTime >= c.timestampSec && playheadTime < (c.timestampSec + c.duration));
        const clipIdx = activeIdx !== -1 ? activeIdx : 0;
        const activeClip = mediaClips[clipIdx] || mediaClips[0];

        // 🎬 Live Transition Engine
        const trans = (activeClip.transition === 'fadeblack' ? 'fade' : activeClip.transition) || globalTransitionType || 'fade';
        const transDur = Math.min(activeClip.duration * 0.5, globalTransitionDuration || 0.40);
        const inTrans = (clipIdx > 0 && trans !== 'cut' && playheadTime < (activeClip.timestampSec + transDur));

        const targetId = inTrans ? `trans_${clipIdx}_${Math.floor(playheadTime * 20)}` : activeClip.id;

        if (!inTrans && targetId === currentRenderedClipId && screenContent.querySelector('.capcut-media-layer')) {
            if (activeClip && activeClip.type !== 'video' && activeClip.motion && activeClip.motion !== 'none') {
                const layer = screenContent.querySelector('.capcut-media-layer');
                if (layer) {
                    const dur = Math.max(0.1, activeClip.duration || 1);
                    const p = Math.max(0, Math.min(1, (playheadTime - activeClip.timestampSec) / dur));
                    const depth = globalZoomDepth || 0.08;
                    let mScale = 1.0;
                    if (activeClip.motion === 'zoomin') {
                        mScale = 1.0 + p * depth;
                    } else if (activeClip.motion === 'zoomout') {
                        mScale = (1.0 + depth) - p * depth;
                    }
                    const posX = activeClip.posX || 0;
                    const posY = activeClip.posY || 0;
                    const finalScale = (activeClip.scale || 1.0) * mScale;
                    layer.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${finalScale})`;
                }
            }
            return;
        }

        currentRenderedClipId = targetId;

        const getClipScale = (clip) => {
            let mScale = 1.0;
            if (clip.type !== 'video' && clip.motion && clip.motion !== 'none') {
                const dur = Math.max(0.1, clip.duration || 1);
                const p = Math.max(0, Math.min(1, (playheadTime - clip.timestampSec) / dur));
                const depth = globalZoomDepth || 0.08;
                if (clip.motion === 'zoomin') {
                    mScale = 1.0 + p * depth;
                } else if (clip.motion === 'zoomout') {
                    mScale = (1.0 + depth) - p * depth;
                }
            }
            return (clip.scale || 1.0) * mScale;
        };

        const renderLayerTag = (clip, isTop) => {
            const objFit = clip.fitMode === 'cover' ? 'cover' : 'contain';
            const isLoop = clip.loopMode !== 'freeze';
            const vidVol = (clip.volume != null ? clip.volume : 0) / 100;
            const isMuted = vidVol <= 0;
            return clip.type === 'video'
                ? `<video ${isTop ? 'id="capcut-active-video-element"' : ''} src="${clip.url}" autoplay ${isMuted ? 'muted' : ''} ${isLoop ? 'loop' : ''} playsinline style="width:100%;height:100%;object-fit:${objFit};"></video>`
                : `<img src="${clip.url}" alt="" style="width:100%;height:100%;object-fit:${objFit};">`;
        };

        if (inTrans) {
            const prevClip = mediaClips[clipIdx - 1];
            const p = Math.max(0, Math.min(1, (playheadTime - activeClip.timestampSec) / transDur));
            let prevOpacity = 1;
            let activeOpacity = 1;
            let prevTransform = `translate3d(${prevClip.posX || 0}px, ${prevClip.posY || 0}px, 0) scale(${getClipScale(prevClip)})`;
            let activeTransform = `translate3d(${activeClip.posX || 0}px, ${activeClip.posY || 0}px, 0) scale(${getClipScale(activeClip)})`;
            let activeClipPath = 'none';

            if (trans === 'fade' || trans === 'fadeblack') {
                screenContent.style.backgroundColor = '#000000';
                prevOpacity = 1 - p;
                activeOpacity = p;
            } else if (trans === 'wipeleft') {
                prevOpacity = 1;
                activeOpacity = 1;
                activeClipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
            } else if (trans === 'wiperight') {
                prevOpacity = 1;
                activeOpacity = 1;
                activeClipPath = `inset(0 0 0 ${(1 - p) * 100}%)`;
            } else if (trans === 'slideleft') {
                prevOpacity = 1;
                activeOpacity = 1;
                prevTransform += ` translate3d(${-p * 100}%, 0, 0)`;
                activeTransform += ` translate3d(${(1 - p) * 100}%, 0, 0)`;
            } else if (trans === 'circleopen') {
                prevOpacity = 1;
                activeOpacity = 1;
                activeClipPath = `circle(${p * 75}% at 50% 50%)`;
            }

            screenContent.innerHTML = `
                <div style="position:absolute;inset:0;opacity:${prevOpacity};transform:${prevTransform};pointer-events:none;">
                    ${renderLayerTag(prevClip, false)}
                </div>
                <div class="capcut-media-layer" style="position:absolute;inset:0;opacity:${activeOpacity};transform:${activeTransform};clip-path:${activeClipPath};">
                    ${renderLayerTag(activeClip, true)}
                </div>
            `;
            return;
        }

        // Single Active Clip Mode
        const scale = getClipScale(activeClip);
        const posX = activeClip.posX || 0;
        const posY = activeClip.posY || 0;

        screenContent.innerHTML = `
            <div class="capcut-media-layer" style="transform: translate3d(${posX}px, ${posY}px, 0) scale(${scale});">
                ${renderLayerTag(activeClip, true)}
                <div class="capcut-transform-box" id="capcut-active-transform-box">
                    <div class="capcut-corner-handle tl" data-handle="corner-tl"></div>
                    <div class="capcut-corner-handle tr" data-handle="corner-tr"></div>
                    <div class="capcut-corner-handle bl" data-handle="corner-bl"></div>
                    <div class="capcut-corner-handle br" data-handle="corner-br"></div>
                </div>
            </div>
        `;

        if (activeClip.type === 'video') {
            const vidEl = screenContent.querySelector('#capcut-active-video-element');
            if (vidEl) {
                if (vidEl.duration && isFinite(vidEl.duration) && vidEl.duration > 0) {
                    activeClip.naturalDuration = vidEl.duration;
                } else {
                    vidEl.addEventListener('loadedmetadata', () => {
                        if (vidEl.duration && isFinite(vidEl.duration)) {
                            activeClip.naturalDuration = vidEl.duration;
                        }
                    }, { once: true });
                }
                const vidVol = (activeClip.volume != null ? activeClip.volume : 0) / 100;
                vidEl.volume = vidVol;
                vidEl.muted = vidVol <= 0;
                vidEl.playbackRate = activeClip.speed || 1.0;
                const clipOffset = (playheadTime - activeClip.timestampSec) * (activeClip.speed || 1.0) + (activeClip.trimStart || 0);
                if (Number.isFinite(clipOffset) && clipOffset >= 0) {
                    try { vidEl.currentTime = clipOffset; } catch(err){}
                }
                if (isPlaying) {
                    vidEl.play().catch(()=>{});
                } else {
                    vidEl.pause();
                }
            }
        }

        const tBox = screenContent.querySelector('#capcut-active-transform-box');
        if (tBox) {
            tBox.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                isTransforming = true;
                transformHandle = e.target.dataset.handle || 'drag-move';
                transformStartX = e.clientX;
                transformStartY = e.clientY;
                originalScale = activeClip.scale || 1.0;
                originalPosX = activeClip.posX || 0;
                originalPosY = activeClip.posY || 0;
                tBox.setPointerCapture(e.pointerId);
            });
        }
    }

    function togglePlayback() {
        isPlaying = !isPlaying;
        const btnPlay = document.getElementById('btn-main-play');
        if (btnPlay) btnPlay.textContent = isPlaying ? '⏸' : '▶';

        const activeAudList = (audioClips && audioClips.length > 0) ? audioClips : (voiceoverAudio ? [voiceoverAudio] : []);

        if (isPlaying) {
            const currentAud = activeAudList.find(a => playheadTime >= (a.timestampSec || 0) && playheadTime < ((a.timestampSec || 0) + a.duration));
            if (currentAud && currentAud.audioElement) {
                currentAud.audioElement.currentTime = playheadTime - (currentAud.timestampSec || 0);
                currentAud.audioElement.play().catch(() => {});
            }

            const curClip = mediaClips.find(c => playheadTime >= c.timestampSec && playheadTime < (c.timestampSec + c.duration));
            if (curClip && curClip.type === 'video') {
                const vidEl = document.getElementById('capcut-active-video-element');
                if (vidEl && vidEl.paused) vidEl.play().catch(()=>{});
            }

            lastPlayTimestamp = performance.now();

            function loop(now) {
                if (!isPlaying) return;
                const dt = (now - lastPlayTimestamp) / 1000;
                lastPlayTimestamp = now;

                const curAud = activeAudList.find(a => playheadTime >= (a.timestampSec || 0) && playheadTime < ((a.timestampSec || 0) + a.duration));
                
                // Pause other audio clips
                activeAudList.forEach(a => {
                    if (a !== curAud && a.audioElement && !a.audioElement.paused) {
                        a.audioElement.pause();
                    }
                });

                let nextTime;
                if (curAud && curAud.audioElement && !curAud.audioElement.paused) {
                    nextTime = (curAud.timestampSec || 0) + curAud.audioElement.currentTime;
                } else {
                    if (curAud && curAud.audioElement && curAud.audioElement.paused) {
                        curAud.audioElement.currentTime = playheadTime - (curAud.timestampSec || 0);
                        curAud.audioElement.play().catch(() => {});
                    }
                    nextTime = playheadTime + dt;
                }

                if (nextTime >= totalTimelineDuration) {
                    setPlayheadTime(0);
                    togglePlayback();
                    return;
                }

                playheadTime = nextTime;
                updatePlayheadDOM();
                updatePlayerScreen();
                renderCaptionForTime(playheadTime);
                ensurePlayheadVisible();

                animFrameId = requestAnimationFrame(loop);
            }

            animFrameId = requestAnimationFrame(loop);
        } else {
            if (animFrameId) cancelAnimationFrame(animFrameId);
            activeAudList.forEach(a => {
                if (a.audioElement) a.audioElement.pause();
            });
            const vidEl = document.getElementById('capcut-active-video-element');
            if (vidEl && !vidEl.paused) vidEl.pause();
        }
    }

    function jumpToClip(direction) {
        if (!mediaClips.length) return;
        const currIdx = mediaClips.findIndex(c => c.id === selectedClipId);
        let nextIdx = (currIdx === -1 ? 0 : currIdx + direction);
        if (nextIdx < 0) nextIdx = mediaClips.length - 1;
        if (nextIdx >= mediaClips.length) nextIdx = 0;
        selectClip(mediaClips[nextIdx].id);
        ensurePlayheadVisible(true);
    }

    // ── Caption Management & Rendering Engine ──────────────────
    function updateCaptionOverlayDOM() {
        const overlay = document.getElementById('capcut-caption-overlay');
        const textSpan = document.getElementById('capcut-caption-text');
        const delBtn = document.getElementById('btn-del-selected-caption');
        if (!overlay || !textSpan) return;

        if (!captionConfig.enabled) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';
        overlay.style.left = (captionConfig.positionX || 50) + '%';
        overlay.style.top = (captionConfig.positionY || 82) + '%';
        overlay.style.width = (captionConfig.boxWidthPercent || 88) + '%';
        overlay.style.maxWidth = '94%';
        overlay.style.boxSizing = 'border-box';

        textSpan.style.fontFamily = (captionConfig.fontFamily === 'caption')
            ? `'caption', 'DejaVu Sans', 'Montserrat', sans-serif`
            : `'${captionConfig.fontFamily || 'Montserrat'}', sans-serif`;
        textSpan.style.fontSize = `${captionConfig.fontSize || 26}px`;
        textSpan.style.color = captionConfig.textColor || '#ffffff';

        // Line formatting
        if (captionConfig.maxLines === 1) {
            textSpan.style.whiteSpace = 'nowrap';
            textSpan.style.overflow = 'hidden';
            textSpan.style.textOverflow = 'ellipsis';
            textSpan.style.display = 'inline-block';
        } else {
            textSpan.style.whiteSpace = 'normal';
            textSpan.style.display = 'inline-block';
            textSpan.style.wordBreak = 'break-word';
        }

        const strokeW = captionConfig.strokeWidth || 3;
        if (strokeW > 0) {
            textSpan.style.textShadow = `
                -${strokeW}px -${strokeW}px 0 #000,
                 ${strokeW}px -${strokeW}px 0 #000,
                -${strokeW}px  ${strokeW}px 0 #000,
                 ${strokeW}px  ${strokeW}px 0 #000,
                 0 0 8px rgba(0,0,0,0.9)
            `;
        } else {
            textSpan.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
        }

        if (captionConfig.boxBgStyle === 'pill') {
            overlay.style.background = 'rgba(0,0,0,0.65)';
            overlay.style.backdropFilter = 'none';
            overlay.style.borderRadius = '20px';
            overlay.style.padding = '6px 16px';
            textSpan.style.lineHeight = '1.45';
        } else if (captionConfig.boxBgStyle === 'ribbon') {
            overlay.style.background = '#000000';
            overlay.style.backdropFilter = 'none';
            overlay.style.borderRadius = '4px';
            overlay.style.padding = '8px 20px';
            textSpan.style.lineHeight = '1.25';
        } else if (captionConfig.boxBgStyle === 'glass') {
            overlay.style.background = 'rgba(15,23,42,0.65)';
            overlay.style.backdropFilter = 'blur(8px)';
            overlay.style.borderRadius = '10px';
            overlay.style.padding = '8px 16px';
            textSpan.style.lineHeight = '1.3';
        } else {
            overlay.style.background = 'transparent';
            overlay.style.backdropFilter = 'none';
            overlay.style.borderRadius = '6px';
            overlay.style.padding = '4px 8px';
            textSpan.style.lineHeight = '1.18';
        }

        if (isCaptionSelected) {
            overlay.classList.add('is-selected');
            overlay.style.border = '2px dashed #38bdf8';
            overlay.style.boxShadow = '0 0 14px rgba(56, 189, 248, 0.45)';
            if (delBtn) delBtn.style.display = 'flex';
        } else {
            overlay.classList.remove('is-selected');
            overlay.style.border = '1.5px dashed rgba(255,255,255,0.25)';
            overlay.style.boxShadow = 'none';
            if (delBtn) delBtn.style.display = 'none';
        }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderCaptionForTime(timeSec) {
        const overlay = document.getElementById('capcut-caption-overlay');
        const textSpan = document.getElementById('capcut-caption-text');
        if (!overlay || !textSpan) return;

        if (!captionConfig.enabled) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        const wordsList = captionConfig.customWordsList;
        if (wordsList && wordsList.length > 0) {
            const activeIdx = wordsList.findIndex(w => timeSec >= w.start && timeSec <= w.end);
            if (activeIdx !== -1) {
                if (captionConfig.pacingMode === 'word') {
                    const activeW = wordsList[activeIdx];
                    textSpan.innerHTML = `<span style="color:${captionConfig.highlightColor || '#facc15'};display:inline-block;transform:scale(1.1);transition:transform 0.1s;">${escapeHTML(activeW.word)}</span>`;
                } else {
                    const phraseSize = Math.max(1, captionConfig.wordsPerPhrase || 3);
                    const phraseStartIdx = Math.floor(activeIdx / phraseSize) * phraseSize;
                    const phraseWords = wordsList.slice(phraseStartIdx, phraseStartIdx + phraseSize);

                    const maxLines = (captionConfig.maxLines != null) ? captionConfig.maxLines : 2;
                    const breakIndices = new Set();
                    if (maxLines === 2 && phraseWords.length >= 4) {
                        breakIndices.add(Math.ceil(phraseWords.length / 2));
                    } else if (maxLines === 3 && phraseWords.length >= 6) {
                        const step = Math.ceil(phraseWords.length / 3);
                        breakIndices.add(step);
                        breakIndices.add(step * 2);
                    }

                    const phraseHTML = phraseWords.map((w, idx) => {
                        const isCurrentWord = (phraseStartIdx + idx) === activeIdx;
                        const wordColor = isCurrentWord ? (captionConfig.highlightColor || '#facc15') : (captionConfig.textColor || '#ffffff');
                        const wordTransform = isCurrentWord ? 'scale(1.08)' : 'scale(1)';
                        const brTag = breakIndices.has(idx) ? '<br>' : '';
                        return `${brTag}<span style="color:${wordColor};display:inline-block;transform:${wordTransform};transition:transform 0.08s;margin:0 3px;">${escapeHTML(w.word)}</span>`;
                    }).join('');
                    textSpan.innerHTML = phraseHTML;
                }
                return;
            }

            const isBetweenWords = wordsList.some((w, i) => {
                if (i === 0 && timeSec < w.start) return false;
                const nextW = wordsList[i + 1];
                return nextW && timeSec > w.end && timeSec < nextW.start;
            });

            if (isBetweenWords) {
                const nearestIdx = wordsList.findIndex(w => w.start > timeSec);
                if (nearestIdx > 0) {
                    const prevWord = wordsList[nearestIdx - 1];
                    if (timeSec - prevWord.end < 0.4) {
                        return; // keep displaying previous phrase for a brief pause
                    }
                }
                textSpan.innerHTML = '';
                return;
            }
        }

        if (mediaClips && mediaClips.length > 0) {
            const curClip = mediaClips.find(c => timeSec >= c.timestampSec && timeSec < (c.timestampSec + c.duration));
            if (curClip && curClip.voiceoverText) {
                textSpan.textContent = curClip.voiceoverText;
                return;
            }
        }

        if (isCaptionSelected) {
            textSpan.textContent = 'Sample Captions';
        } else if (!isPlaying) {
            textSpan.textContent = '';
        }
    }

    function deleteSelectedCaption() {
        pushHistoryState();
        captionConfig.enabled = false;
        isCaptionSelected = false;
        const chk = document.getElementById('capcut-caption-enable-chk');
        if (chk) chk.checked = false;
        updateCaptionOverlayDOM();
        debouncedAutoSave();
    }

    function downloadSrtFile() {
        if (!captionConfig.customWordsList || captionConfig.customWordsList.length === 0) {
            alert('No transcribed captions available to export as SRT yet!');
            return;
        }

        function formatSrtTimestamp(seconds) {
            const pad = (num, size) => ('000' + num).slice(-size);
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
        }

        const words = captionConfig.customWordsList;
        let srtContent = '';
        let index = 1;
        const wordsPerSubtitle = captionConfig.pacingMode === 'word' ? 1 : 4;

        for (let i = 0; i < words.length; i += wordsPerSubtitle) {
            const chunk = words.slice(i, i + wordsPerSubtitle);
            const start = chunk[0].start;
            const end = chunk[chunk.length - 1].end;
            const text = chunk.map(w => w.word).join(' ');

            srtContent += `${index}\n`;
            srtContent += `${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n`;
            srtContent += `${text}\n\n`;
            index++;
        }

        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'subtitles.srt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ── Gemini AI Timeline Reviewer Agent Engine ───────────────────────
    async function callGeminiTimelineReview(reviewPackage, apiKey) {
        const key = apiKey || userGeminiApiKey || DEFAULT_GEMINI_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(key)}`;

        const whisperWords = (reviewPackage.whisperResult && reviewPackage.whisperResult.words) || [];
        const whisperCompact = whisperWords.map((w, idx) => ({
            i: idx,
            w: (w.word || '').trim(),
            s: (w.start != null) ? parseFloat(w.start.toFixed(2)) : 0,
            e: (w.end != null) ? parseFloat(w.end.toFixed(2)) : 0
        }));

        const scenesCompact = (reviewPackage.aligned || []).map(sc => ({
            scene_number: sc.sceneNumber,
            script_line: sc.voiceover,
            current_first_word_idx: sc.firstWordIdx,
            current_last_word_idx: sc.lastWordIdx,
            current_start: sc.start,
            current_end: sc.end
        }));

        const promptText = `
You are the authoritative Audio-Visual Timeline Synchronization Inspector.
Your goal is to inspect the mapping between expected script scenes and the actual Whisper transcribed words.
Verify whether each scene correctly captures its intended spoken voiceover.

CRITICAL CHECKS:
1. Scene Swallowing / Collision: Check if an earlier scene (e.g. Scene 3) extended too far and captured words belonging to Scene 4 ("Not two hundred percent.").
2. Short Scene Retention: Ensure short punchy scenes (e.g. "Not two hundred percent." or "Two thousand.") are NOT skipped, merged, or lost. Each must have its own accurate first_word_index and last_word_index.
3. Strict Monotonic Order: Scene N's first_word_index must be strictly >= Scene (N-1)'s last_word_index + 1.

INPUT DATA:
"scenes": ${JSON.stringify(scenesCompact, null, 2)}
"whisper_words": ${JSON.stringify(whisperCompact)}

Return ONLY valid JSON matching this schema:
{
  "overall_status": "PERFECT" or "NEEDS_CORRECTION",
  "summary": "Detailed explanation of findings and boundary verification",
  "scenes": [
    {
      "scene_number": 1,
      "status": "CORRECT" or "NEEDS_CORRECTION",
      "detected_speech": "whisper text for this scene",
      "first_word_index": 0,
      "last_word_index": 8,
      "reasoning": "Why this boundary is correct or what was adjusted"
    }
  ]
}
`;

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    temperature: 0.1,
                    response_mime_type: 'application/json'
                }
            })
        });

        if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            const msg = (errJson.error && errJson.error.message) || `Gemini API HTTP ${resp.status}`;
            throw new Error(msg);
        }

        const data = await resp.json();
        const candidate = data.candidates && data.candidates[0];
        const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
        if (!text) throw new Error('Gemini returned an empty response.');

        try {
            return JSON.parse(text);
        } catch (e) {
            const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        }
    }

    function validateGeminiReview(reviewResult, originalAligned, rawWhisperWords, totalDuration) {
        if (!reviewResult || !reviewResult.scenes || !Array.isArray(reviewResult.scenes)) {
            throw new Error('Invalid response structure from Gemini Reviewer.');
        }

        const numWords = rawWhisperWords.length;
        const totalDur = totalDuration || 10;
        const validatedScenes = [];
        let hasChanges = false;
        let lastEndIdx = -1;

        for (let i = 0; i < originalAligned.length; i++) {
            const orig = originalAligned[i];
            const aiSc = reviewResult.scenes.find(s => s.scene_number === orig.sceneNumber) || reviewResult.scenes[i];

            let fIdx = orig.firstWordIdx;
            let lIdx = orig.lastWordIdx;
            let reasoning = (aiSc && aiSc.reasoning) || 'Verified with deterministic Whisper timestamps.';
            let status = (aiSc && aiSc.status) || 'CORRECT';

            if (aiSc && typeof aiSc.first_word_index === 'number' && typeof aiSc.last_word_index === 'number') {
                const candF = Math.max(0, Math.min(numWords - 1, aiSc.first_word_index));
                const candL = Math.max(candF, Math.min(numWords - 1, aiSc.last_word_index));

                // Monotonic boundary check: must be after previous scene's end
                if (candF > lastEndIdx && candL >= candF) {
                    if (candF !== orig.firstWordIdx || candL !== orig.lastWordIdx) {
                        hasChanges = true;
                        status = 'NEEDS_CORRECTION';
                    }
                    fIdx = candF;
                    lIdx = candL;
                }
            }

            lastEndIdx = lIdx;
            const spkStart = rawWhisperWords[fIdx] ? rawWhisperWords[fIdx].start : orig.spokenStart;
            const spkEnd = rawWhisperWords[lIdx] ? rawWhisperWords[lIdx].end : orig.spokenEnd;

            validatedScenes.push({
                ...orig,
                firstWordIdx: fIdx,
                lastWordIdx: lIdx,
                spokenStart: parseFloat(spkStart.toFixed(2)),
                spokenEnd: parseFloat(spkEnd.toFixed(2)),
                matchedWords: rawWhisperWords.slice(fIdx, lIdx + 1),
                aiStatus: status,
                aiReasoning: reasoning,
                detectedSpeech: (aiSc && aiSc.detected_speech) || ''
            });
        }

        // Apply Golden Rule for timeline boundaries (contiguous, 0-gap, holds image over silence)
        const correctedAligned = [];
        for (let i = 0; i < validatedScenes.length; i++) {
            const sc = validatedScenes[i];
            const startTime = (i === 0) ? 0.0 : sc.spokenStart;
            let endTime;
            let silenceAdded = 0;

            if (i === validatedScenes.length - 1) {
                endTime = totalDur;
                silenceAdded = Math.max(0, totalDur - sc.spokenEnd);
            } else {
                const nextSc = validatedScenes[i + 1];
                endTime = Math.max(startTime + 0.2, nextSc.spokenStart);
                silenceAdded = Math.max(0, nextSc.spokenStart - sc.spokenEnd);
            }

            correctedAligned.push({
                ...sc,
                start: parseFloat(startTime.toFixed(2)),
                end: parseFloat(endTime.toFixed(2)),
                duration: parseFloat(Math.max(0.2, endTime - startTime).toFixed(2)),
                silenceAdded: parseFloat(silenceAdded.toFixed(2))
            });
        }

        return {
            hasChanges: hasChanges,
            overallStatus: reviewResult.overall_status || (hasChanges ? 'NEEDS_CORRECTION' : 'PERFECT'),
            summary: reviewResult.summary || (hasChanges ? 'Gemini adjusted scene boundaries to prevent overlapping speech.' : 'All scenes are verified and accurately aligned.'),
            correctedAligned: correctedAligned
        };
    }

    function applyGeminiVerifiedCorrections({ correctedAligned, sceneMediaMatches, whisperResult, audioDuration, modalToClose, onApplied }) {
        pushHistoryState();

        // Update timeline mediaClips
        let lastMatchedEndTime = audioDuration || 0;
        for (let i = 0; i < correctedAligned.length; i++) {
            const sc = correctedAligned[i];
            const matchInfo = sceneMediaMatches && sceneMediaMatches[i];
            const clip = matchInfo ? matchInfo.matchedClip : mediaClips.find(c => c.serial === sc.sceneNumber);

            if (clip) {
                clip.timestampSec = sc.start;
                clip.duration = sc.duration;
                if (sc.end > lastMatchedEndTime) lastMatchedEndTime = sc.end;
            }
        }

        // Sort media clips
        mediaClips.sort((a, b) => a.timestampSec - b.timestampSec);
        let totalTime = 0;
        for (let i = 0; i < mediaClips.length; i++) {
            mediaClips[i].serial = i + 1;
            totalTime = Math.max(totalTime, mediaClips[i].timestampSec + mediaClips[i].duration);
        }

        const totalAudioTime = voiceoverAudio ? voiceoverAudio.duration : 0;
        totalTimelineDuration = Math.max(15, totalTime + 2, totalAudioTime + 2);

        // Populate captions words
        if (whisperResult && whisperResult.words && whisperResult.words.length > 0) {
            captionConfig.customWordsList = whisperResult.words.map(w => ({
                word: w.word,
                start: w.start,
                end: w.end
            }));
            captionConfig.enabled = true;
            const chk = document.getElementById('capcut-caption-enable-chk');
            if (chk) chk.checked = true;
            updateCaptionOverlayDOM();
            renderCaptionForTime(playheadTime);
        }

        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();
        ensurePlayheadVisible(true);

        if (modalToClose) modalToClose.remove();

        if (onApplied) {
            onApplied(correctedAligned);
        }

        // Update cached package
        if (window._lastAutoSyncPackage) {
            window._lastAutoSyncPackage.aligned = correctedAligned;
        }

        showSuccessNotification('⚡ Gemini AI Review Applied: Scene boundaries and timeline clips retimed with 100% precision!');
    }

    function openAgentReviewModal(customPackage) {
        const reviewPackage = customPackage || window._lastAutoSyncPackage;
        if (!reviewPackage || !reviewPackage.aligned || reviewPackage.aligned.length === 0) {
            alert('No aligned scenes found. Please run "🤖 Auto-Sync Timeline" first to transcribe audio and align script scenes.');
            return;
        }

        const existing = document.getElementById('modal-agent-review');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-agent-review';
        modal.className = 'modal-overlay';

        modal.innerHTML = `
            <div class="modal-box" style="max-width: 1060px; width: 95vw; transition: all 0.25s ease;">
                <div class="modal-header" style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div class="modal-title" style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:1.3em;">🤖</span>
                        <div>
                            <div style="font-weight:700;font-size:1.1em;color:#f8fafc;">Gemini AI Timeline Reviewer Agent</div>
                            <div style="font-size:0.75em;color:#c084fc;font-weight:600;">Powered by gemini-flash-latest — Deep Speech & Script Alignment Verification</div>
                        </div>
                    </div>
                    <button type="button" class="modal-close-btn" id="btn-close-agent-modal">✕</button>
                </div>

                <div class="modal-body" id="agent-modal-body" style="padding: 20px 16px;">
                    <div style="text-align:center;padding:40px 20px;">
                        <div class="agent-review-spinner" style="margin:0 auto 20px auto;width:44px;height:44px;border:3px solid rgba(192,132,252,0.2);border-top-color:#c084fc;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
                        <div style="font-size:1.1em;font-weight:700;color:#f8fafc;">Analyzing Timeline Synchronization...</div>
                        <div style="font-size:0.85em;color:#94a3b8;margin-top:8px;max-width:520px;margin-left:auto;margin-right:auto;line-height:1.5;">
                            Gemini is inspecting script sentences, Whisper word indices, and scene boundary ranges to detect collisions, swallowed scenes, or short-sentence timing mismatches.
                        </div>
                    </div>
                </div>

                <div class="modal-actions" id="agent-modal-actions" style="display:none;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <button type="button" class="btn-modal-cancel" id="btn-agent-change-key" style="font-size:0.82em;color:#94a3b8;">
                            🔑 Edit API Key
                        </button>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <button type="button" class="btn-modal-cancel" id="btn-agent-cancel">
                            Close
                        </button>
                        <button type="button" class="btn-modal-primary" id="btn-agent-apply-corrections" style="background:linear-gradient(135deg, #7c3aed 0%, #9333ea 100%);box-shadow:0 4px 16px rgba(124,58,237,0.5);font-size:0.9em;padding:10px 22px;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;">
                            ⚡ Apply Verified AI Corrections
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#btn-close-agent-modal');
        const cancelBtn = modal.querySelector('#btn-agent-cancel');
        const doClose = () => modal.remove();
        if (closeBtn) closeBtn.addEventListener('click', doClose);
        if (cancelBtn) cancelBtn.addEventListener('click', doClose);

        const keyBtn = modal.querySelector('#btn-agent-change-key');
        if (keyBtn) {
            keyBtn.addEventListener('click', () => {
                const k = prompt('Enter your Google Gemini API Key:', userGeminiApiKey || DEFAULT_GEMINI_KEY);
                if (k && k.trim()) {
                    userGeminiApiKey = k.trim();
                    localStorage.setItem(GEMINI_KEY_STORAGE, userGeminiApiKey);
                    openAgentReviewModal(reviewPackage);
                }
            });
        }

        // Execute Review
        (async () => {
            const bodyEl = modal.querySelector('#agent-modal-body');
            const actionsEl = modal.querySelector('#agent-modal-actions');

            try {
                const aiResult = await callGeminiTimelineReview(reviewPackage, userGeminiApiKey);
                const validated = validateGeminiReview(
                    aiResult,
                    reviewPackage.aligned,
                    (reviewPackage.whisperResult && reviewPackage.whisperResult.words) || [],
                    reviewPackage.audioDuration
                );

                // Render Results
                let rowsHTML = '';
                const orig = reviewPackage.aligned;
                const corr = validated.correctedAligned;

                for (let i = 0; i < orig.length; i++) {
                    const o = orig[i];
                    const c = corr[i];
                    const matchInfo = reviewPackage.sceneMediaMatches ? reviewPackage.sceneMediaMatches[i] : null;
                    const clip = matchInfo ? matchInfo.matchedClip : mediaClips.find(m => m.serial === o.sceneNumber);
                    const thumbSrc = clip ? clip.url : '';
                    const isChanged = (o.firstWordIdx !== c.firstWordIdx || o.lastWordIdx !== c.lastWordIdx || Math.abs(o.start - c.start) > 0.05 || Math.abs(o.end - c.end) > 0.05);

                    let statusBadge = '';
                    if (isChanged) {
                        statusBadge = '<span style="background:rgba(168,85,247,0.2);color:#d8b4fe;border:1px solid rgba(168,85,247,0.45);padding:2px 8px;border-radius:4px;font-weight:700;font-size:0.75em;text-transform:uppercase;">⚡ ADJUSTED</span>';
                    } else {
                        statusBadge = '<span style="background:rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.45);padding:2px 8px;border-radius:4px;font-weight:700;font-size:0.75em;text-transform:uppercase;">✓ CORRECT</span>';
                    }

                    rowsHTML += `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.06);background:${isChanged ? 'rgba(168,85,247,0.05)' : 'transparent'};">
                            <!-- Col 1: Scene & Media -->
                            <td style="padding:10px 12px;vertical-align:top;width:170px;">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="autosync-scene-badge" style="background:${isChanged ? 'rgba(168,85,247,0.3)' : 'rgba(56,189,248,0.2)'};color:${isChanged ? '#e9d5ff' : '#38bdf8'};">#${o.sceneNumber}</span>
                                    ${thumbSrc ? `<img src="${thumbSrc}" style="width:38px;height:38px;border-radius:4px;object-fit:cover;border:1px solid rgba(255,255,255,0.1);" alt="">` : `<span style="font-size:1.3em;">🖼️</span>`}
                                    <div style="font-weight:600;font-size:0.82em;color:#f8fafc;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                                        ${clip ? escapeHTML(clip.name) : 'Scene ' + o.sceneNumber}
                                    </div>
                                </div>
                            </td>

                            <!-- Col 2: Voiceover Line -->
                            <td style="padding:10px 12px;vertical-align:top;max-width:240px;">
                                <div style="font-size:0.84em;color:#e2e8f0;line-height:1.35;font-weight:600;">
                                    "${escapeHTML(o.voiceover)}"
                                </div>
                                ${c.detectedSpeech ? `<div style="font-size:0.75em;color:#38bdf8;margin-top:4px;"><b>Detected:</b> ${escapeHTML(c.detectedSpeech)}</div>` : ''}
                            </td>

                            <!-- Col 3: Boundary Timing Diff -->
                            <td style="padding:10px 12px;vertical-align:top;width:260px;">
                                <div style="font-size:0.78em;color:#94a3b8;">
                                    Current: <span style="color:#cbd5e1;font-family:monospace;">${o.start.toFixed(2)}s ➔ ${o.end.toFixed(2)}s (${o.duration.toFixed(2)}s)</span>
                                    <span style="font-size:0.9em;opacity:0.7;">[words #${o.firstWordIdx}-#${o.lastWordIdx}]</span>
                                </div>
                                <div style="font-size:0.82em;font-weight:700;color:${isChanged ? '#c084fc' : '#10b981'};margin-top:4px;">
                                    Verified: <span style="font-family:monospace;">${c.start.toFixed(2)}s ➔ ${c.end.toFixed(2)}s (${c.duration.toFixed(2)}s)</span>
                                    <span style="font-size:0.88em;opacity:0.9;">[words #${c.firstWordIdx}-#${c.lastWordIdx}]</span>
                                </div>
                            </td>

                            <!-- Col 4: AI Analysis & Reason -->
                            <td style="padding:10px 12px;vertical-align:top;min-width:220px;">
                                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                                    ${statusBadge}
                                </div>
                                <div style="font-size:0.78em;color:#cbd5e1;line-height:1.4;">
                                    ${escapeHTML(c.aiReasoning)}
                                </div>
                            </td>
                        </tr>
                    `;
                }

                const summaryBanner = validated.hasChanges ? `
                    <div style="display:flex;align-items:center;gap:12px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.35);border-radius:8px;padding:12px 16px;margin-bottom:14px;">
                        <span style="font-size:1.8em;">⚡</span>
                        <div style="flex:1;">
                            <div style="font-weight:700;color:#e9d5ff;font-size:0.95em;">AI Boundary Adjustments Recommended</div>
                            <div style="font-size:0.82em;color:#cbd5e1;margin-top:2px;">${escapeHTML(validated.summary)}</div>
                        </div>
                    </div>
                ` : `
                    <div style="display:flex;align-items:center;gap:12px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:8px;padding:12px 16px;margin-bottom:14px;">
                        <span style="font-size:1.8em;">✅</span>
                        <div style="flex:1;">
                            <div style="font-weight:700;color:#6ee7b7;font-size:0.95em;">All Scenes Perfectly Aligned & Verified</div>
                            <div style="font-size:0.82em;color:#cbd5e1;margin-top:2px;">${escapeHTML(validated.summary)}</div>
                        </div>
                    </div>
                `;

                bodyEl.innerHTML = `
                    ${summaryBanner}
                    <div class="autosync-matrix-wrap custom-scrollbar" style="max-height:50vh;margin-top:0;">
                        <table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.85em;">
                            <thead>
                                <tr style="background:#1e293b;position:sticky;top:0;z-index:10;">
                                    <th style="padding:10px 12px;color:#94a3b8;font-size:0.74em;text-transform:uppercase;">Scene & Media</th>
                                    <th style="padding:10px 12px;color:#94a3b8;font-size:0.74em;text-transform:uppercase;">Voiceover & Speech</th>
                                    <th style="padding:10px 12px;color:#94a3b8;font-size:0.74em;text-transform:uppercase;">Current vs AI Verified Timing</th>
                                    <th style="padding:10px 12px;color:#94a3b8;font-size:0.74em;text-transform:uppercase;">Status & AI Reasoning</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHTML}
                            </tbody>
                        </table>
                    </div>
                `;

                actionsEl.style.display = 'flex';

                const applyBtn = modal.querySelector('#btn-agent-apply-corrections');
                if (applyBtn) {
                    applyBtn.addEventListener('click', () => {
                        applyGeminiVerifiedCorrections({
                            correctedAligned: validated.correctedAligned,
                            sceneMediaMatches: reviewPackage.sceneMediaMatches,
                            whisperResult: reviewPackage.whisperResult,
                            audioDuration: reviewPackage.audioDuration,
                            modalToClose: modal,
                            onApplied: customPackage && customPackage.onApplied
                        });
                    });
                }

            } catch (err) {
                console.error('Gemini Agent Review Error:', err);
                bodyEl.innerHTML = `
                    <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:16px;color:#ef4444;font-size:0.88em;line-height:1.5;">
                        <div style="font-weight:700;font-size:1.05em;margin-bottom:6px;">⚠️ Gemini AI Review Error</div>
                        <div>${escapeHTML(err.message)}</div>
                        <div style="margin-top:14px;display:flex;gap:10px;">
                            <button type="button" class="btn-modal-primary" id="btn-agent-retry" style="background:#ef4444;border:none;padding:6px 14px;border-radius:6px;color:#fff;cursor:pointer;font-weight:600;">
                                🔄 Retry Review
                            </button>
                            <button type="button" class="btn-modal-cancel" id="btn-agent-change-key-err" style="border-color:#ef4444;color:#fca5a5;">
                                🔑 Update API Key
                            </button>
                        </div>
                    </div>
                `;

                const retryBtn = bodyEl.querySelector('#btn-agent-retry');
                if (retryBtn) retryBtn.addEventListener('click', () => openAgentReviewModal(reviewPackage));

                const errKeyBtn = bodyEl.querySelector('#btn-agent-change-key-err');
                if (errKeyBtn) {
                    errKeyBtn.addEventListener('click', () => {
                        const k = prompt('Enter your Google Gemini API Key:', userGeminiApiKey || DEFAULT_GEMINI_KEY);
                        if (k && k.trim()) {
                            userGeminiApiKey = k.trim();
                            localStorage.setItem(GEMINI_KEY_STORAGE, userGeminiApiKey);
                            openAgentReviewModal(reviewPackage);
                        }
                    });
                }
            }
        })();
    }

    function showSuccessNotification(message) {
        const existing = document.getElementById('capcut-success-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'capcut-success-toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        toast.style.color = '#ffffff';
        toast.style.padding = '12px 20px';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
        toast.style.fontWeight = '600';
        toast.style.fontSize = '0.9em';
        toast.style.zIndex = '9999999';
        toast.style.transition = 'all 0.3s ease';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '8px';
        toast.innerHTML = `<span>✓</span> <span>${escapeHTML(message)}</span>`;

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ── Dedicated Auto-Captions Studio Modal (Whisper AI / Custom) ──
    function openAutoCaptionsStudioModal() {
        const existing = document.getElementById('capcut-auto-captions-modal');
        if (existing) existing.remove();

        const m = document.createElement('div');
        m.id = 'capcut-auto-captions-modal';
        m.className = 'capcut-modal-backdrop';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;';
        m.innerHTML = `
            <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:24px;width:520px;max-width:94vw;box-shadow:0 20px 50px rgba(0,0,0,0.8);color:#fff;font-family:sans-serif;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">
                    <h3 style="margin:0;font-size:1.2em;display:flex;align-items:center;gap:8px;color:#38bdf8;">
                        <span>✨ Auto-Captions Studio</span>
                    </h3>
                    <button id="btn-close-caption-modal" style="background:transparent;border:none;color:#94a3b8;font-size:1.4em;cursor:pointer;">✕</button>
                </div>

                <p style="font-size:0.85em;color:#94a3b8;margin-bottom:16px;">
                    Generate animated, synchronized subtitles from your timeline voiceover audio or customize styles.
                </p>

                <!-- Action 1: Transcribe with AI -->
                <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:14px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <b style="color:#38bdf8;font-size:0.95em;">🤖 AI Speech-to-Text Transcription</b>
                        <span style="font-size:0.75em;background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 8px;border-radius:4px;">Whisper AI</span>
                    </div>
                    <p style="font-size:0.8em;color:#cbd5e1;margin-bottom:10px;">
                        Transcribes current voiceover audio track into exact word-level animated captions.
                    </p>
                    <button id="btn-modal-ai-transcribe" style="width:100%;padding:10px;background:#0284c7;border:none;border-radius:6px;color:#fff;font-weight:700;font-size:0.9em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                        <span>🎙️ Transcribe Timeline Audio Now</span>
                    </button>
                    <div id="modal-caption-ai-status" style="font-size:0.8em;color:#38bdf8;margin-top:6px;display:none;text-align:center;"></div>
                </div>

                <!-- Action 2: Enable / Turn Off Toggle -->
                <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;margin-bottom:16px;">
                    <div>
                        <b style="font-size:0.9em;color:#fff;">Show Captions on Video</b>
                        <span style="display:block;font-size:0.75em;color:#94a3b8;">Turn captions on or off on the preview screen</span>
                    </div>
                    <button id="btn-modal-toggle-captions" style="padding:6px 14px;background:${captionConfig.enabled ? '#ef4444' : '#10b981'};border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;">
                        ${captionConfig.enabled ? '🗑️ Turn Off Captions' : '✅ Enable Captions'}
                    </button>
                </div>

                <div style="display:flex;justify-content:flex-end;gap:10px;">
                    <button id="btn-done-caption-modal" style="padding:8px 18px;background:#3b82f6;border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;">Done</button>
                </div>
            </div>
        `;
        document.body.appendChild(m);

        const closeModal = () => m.remove();
        m.querySelector('#btn-close-caption-modal').addEventListener('click', closeModal);
        m.querySelector('#btn-done-caption-modal').addEventListener('click', closeModal);

        const toggleBtn = m.querySelector('#btn-modal-toggle-captions');
        toggleBtn.addEventListener('click', () => {
            pushHistoryState();
            captionConfig.enabled = !captionConfig.enabled;
            const chk = document.getElementById('capcut-caption-enable-chk');
            if (chk) chk.checked = captionConfig.enabled;
            updateCaptionOverlayDOM();
            toggleBtn.textContent = captionConfig.enabled ? '🗑️ Turn Off Captions' : '✅ Enable Captions';
            toggleBtn.style.background = captionConfig.enabled ? '#ef4444' : '#10b981';
            debouncedAutoSave();
        });

        const btnAiTranscribe = m.querySelector('#btn-modal-ai-transcribe');
        const aiStatus = m.querySelector('#modal-caption-ai-status');

        btnAiTranscribe.addEventListener('click', async () => {
            const hasAudio = (audioClips && audioClips.length > 0) || (voiceoverAudio && (voiceoverAudio.file || voiceoverAudio.url));
            if (!hasAudio) {
                alert('Please import a voiceover audio file into the timeline first!');
                return;
            }

            btnAiTranscribe.disabled = true;
            aiStatus.style.display = 'block';
            aiStatus.textContent = 'Transcribing audio with Whisper AI...';

            try {
                if (autoSyncAlignedScenes && autoSyncAlignedScenes.length > 0) {
                    const words = [];
                    for (const sc of autoSyncAlignedScenes) {
                        if (sc.voiceover) {
                            const scWords = sc.voiceover.split(/\s+/).filter(w => w.trim());
                            const wDur = sc.duration / Math.max(1, scWords.length);
                            for (let i = 0; i < scWords.length; i++) {
                                words.push({
                                    word: scWords[i],
                                    start: parseFloat((sc.start + i * wDur).toFixed(2)),
                                    end: parseFloat((sc.start + (i + 1) * wDur).toFixed(2))
                                });
                            }
                        }
                    }
                    if (words.length > 0) {
                        pushHistoryState();
                        captionConfig.customWordsList = words;
                        captionConfig.enabled = true;
                        const chk = document.getElementById('capcut-caption-enable-chk');
                        if (chk) chk.checked = true;
                        updateCaptionOverlayDOM();
                        renderCaptionForTime(playheadTime);
                        aiStatus.innerHTML = `<span style="color:#10b981;">✅ Synchronized ${words.length} words from script!</span>`;
                        btnAiTranscribe.disabled = false;
                        debouncedAutoSave();
                        return;
                    }
                }

                if (!userGroqApiKey || userGroqApiKey.startsWith('gsk_YOUR_')) {
                    const newKey = prompt('Enter your free Groq Whisper API Key:', userGroqApiKey || '');
                    if (!newKey || !newKey.trim()) {
                        aiStatus.innerHTML = `<span style="color:#f59e0b;">Groq API Key is required to transcribe audio.</span>`;
                        btnAiTranscribe.disabled = false;
                        return;
                    }
                    userGroqApiKey = newKey.trim();
                    localStorage.setItem(GROQ_KEY_STORAGE, userGroqApiKey);
                }

                const audioSources = (audioClips && audioClips.length > 0) ? audioClips : (activeAud ? [activeAud] : []);
                const whisperResult = await transcribeAudioWithGroq(audioSources, userGroqApiKey, (msg) => {
                    aiStatus.textContent = msg;
                });

                if (whisperResult && whisperResult.words && whisperResult.words.length > 0) {
                    pushHistoryState();
                    captionConfig.customWordsList = whisperResult.words.map(w => ({
                        word: w.word,
                        start: w.start,
                        end: w.end
                    }));
                    captionConfig.enabled = true;
                    const chk = document.getElementById('capcut-caption-enable-chk');
                    if (chk) chk.checked = true;
                    updateCaptionOverlayDOM();
                    renderCaptionForTime(playheadTime);
                    aiStatus.innerHTML = `<span style="color:#10b981;">✅ Transcribed ${whisperResult.words.length} words with Whisper AI!</span>`;
                    debouncedAutoSave();
                } else {
                    aiStatus.innerHTML = `<span style="color:#ef4444;">Could not extract words from audio.</span>`;
                }
            } catch (err) {
                aiStatus.innerHTML = `<span style="color:#ef4444;">Transcription error: ${err.message}</span>`;
            } finally {
                btnAiTranscribe.disabled = false;
            }
        });
    }

    // ── 3-Option Clear Project Functions (With Full Undo/Redo) ──
    function clearAllMedia() {
        if (!mediaClips || mediaClips.length === 0) return;
        pushHistoryState();
        mediaClips = [];
        selectedClipId = null;
        currentRenderedClipId = null;
        rippleRecalculateTimeline();
        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        persistProjectState();
    }

    function clearAllAudio() {
        const hasAudio = (audioClips && audioClips.length > 0) || voiceoverAudio;
        if (!hasAudio) return;
        pushHistoryState();
        if (audioClips && audioClips.length > 0) {
            audioClips.forEach(a => destroyAudioElement(a.audioElement, a.url));
        }
        if (voiceoverAudio && voiceoverAudio.audioElement) {
            destroyAudioElement(voiceoverAudio.audioElement, voiceoverAudio.url);
        }
        audioClips = [];
        voiceoverAudio = null;
        selectedAudioClipId = null;
        isAudioTrackSelected = false;
        rippleRecalculateTimeline();
        renderTimeline();
        renderInspector();
        persistProjectState();
    }

    function clearEntireProject() {
        pushHistoryState();
        mediaClips = [];
        selectedClipId = null;
        currentRenderedClipId = null;
        if (audioClips && audioClips.length > 0) {
            audioClips.forEach(a => destroyAudioElement(a.audioElement, a.url));
        }
        if (voiceoverAudio && voiceoverAudio.audioElement) {
            destroyAudioElement(voiceoverAudio.audioElement, voiceoverAudio.url);
        }
        audioClips = [];
        voiceoverAudio = null;
        selectedAudioClipId = null;
        isAudioTrackSelected = false;
        captionConfig.enabled = false;
        captionConfig.customWordsList = [];
        isCaptionSelected = false;
        playheadTime = 0;
        const chk = document.getElementById('capcut-caption-enable-chk');
        if (chk) chk.checked = false;

        rippleRecalculateTimeline();
        renderAssetList();
        renderTimeline();
        renderInspector();
        updatePlayerScreen();
        updateCaptionOverlayDOM();
        persistProjectState();
    }

    function showClearProjectModal() {
        const existing = document.getElementById('capcut-clear-project-modal');
        if (existing) existing.remove();

        const m = document.createElement('div');
        m.id = 'capcut-clear-project-modal';
        m.className = 'capcut-modal-backdrop';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;';
        m.innerHTML = `
            <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:24px;width:440px;max-width:92vw;box-shadow:0 20px 50px rgba(0,0,0,0.8);color:#fff;font-family:sans-serif;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <h3 style="margin:0;font-size:1.15em;display:flex;align-items:center;gap:8px;color:#ef4444;">
                        <span>🗑️ Clear Project Options</span>
                    </h3>
                    <button id="btn-close-clear-modal" style="background:transparent;border:none;color:#94a3b8;font-size:1.4em;cursor:pointer;">✕</button>
                </div>
                <p style="font-size:0.85em;color:#94a3b8;margin-bottom:18px;line-height:1.4;">
                    Choose what you want to remove. You can always press <b>Ctrl+Z (Undo)</b> to restore.
                </p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="btn-clear-media-only" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);border-radius:8px;color:#93c5fd;cursor:pointer;text-align:left;transition:background 0.2s;">
                        <div>
                            <b style="display:block;font-size:0.95em;color:#fff;margin-bottom:2px;">🖼️ Clear All Media</b>
                            <span style="font-size:0.75em;color:#94a3b8;">Removes images & videos only. Audio & voiceover remain 100% safe.</span>
                        </div>
                        <span style="font-size:1.2em;color:#38bdf8;">➔</span>
                    </button>
                    <button id="btn-clear-audio-only" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(192,132,252,0.12);border:1px solid rgba(192,132,252,0.3);border-radius:8px;color:#d8b4fe;cursor:pointer;text-align:left;transition:background 0.2s;">
                        <div>
                            <b style="display:block;font-size:0.95em;color:#fff;margin-bottom:2px;">🎙️ Clear All Audio</b>
                            <span style="font-size:0.75em;color:#94a3b8;">Removes voiceover audio tracks only. Images & video timing stay safe.</span>
                        </div>
                        <span style="font-size:1.2em;color:#c084fc;">➔</span>
                    </button>
                    <button id="btn-clear-full-project" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;cursor:pointer;text-align:left;transition:background 0.2s;">
                        <div>
                            <b style="display:block;font-size:0.95em;color:#fff;margin-bottom:2px;">💥 Clear Full Project</b>
                            <span style="font-size:0.75em;color:#94a3b8;">Clears everything (media, audio, captions) & resets timeline.</span>
                        </div>
                        <span style="font-size:1.2em;color:#ef4444;">➔</span>
                    </button>
                </div>
                <div style="margin-top:18px;text-align:right;">
                    <button id="btn-cancel-clear-modal" style="padding:8px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;cursor:pointer;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(m);

        const closeModal = () => m.remove();
        m.querySelector('#btn-close-clear-modal').addEventListener('click', closeModal);
        m.querySelector('#btn-cancel-clear-modal').addEventListener('click', closeModal);

        m.querySelector('#btn-clear-media-only').addEventListener('click', () => {
            clearAllMedia();
            closeModal();
        });
        m.querySelector('#btn-clear-audio-only').addEventListener('click', () => {
            clearAllAudio();
            closeModal();
        });
        m.querySelector('#btn-clear-full-project').addEventListener('click', () => {
            clearEntireProject();
            closeModal();
        });
    }

    // ── CapCut Pro High-Quality Export Modal (1080P, 2K, 4K, Bitrate, FPS) ──
    function getResolutionDimensions(resChoice, currentAspectRatio) {
        let baseDim = 1080;
        if (resChoice === '480p') baseDim = 480;
        else if (resChoice === '720p') baseDim = 720;
        else if (resChoice === '1080p') baseDim = 1080;
        else if (resChoice === '2k') baseDim = 1440;
        else if (resChoice === '4k') baseDim = 2160;

        if (currentAspectRatio === '9:16') {
            const h = Math.round((baseDim * 16) / 9);
            return [baseDim % 2 === 0 ? baseDim : baseDim + 1, h % 2 === 0 ? h : h + 1];
        } else if (currentAspectRatio === '1:1') {
            return [baseDim % 2 === 0 ? baseDim : baseDim + 1, baseDim % 2 === 0 ? baseDim : baseDim + 1];
        } else if (currentAspectRatio === '4:5') {
            const h = Math.round((baseDim * 5) / 4);
            return [baseDim % 2 === 0 ? baseDim : baseDim + 1, h % 2 === 0 ? h : h + 1];
        } else {
            const w = Math.round((baseDim * 16) / 9);
            return [w % 2 === 0 ? w : w + 1, baseDim % 2 === 0 ? baseDim : baseDim + 1];
        }
    }

    function openExportSettingsModal() {
        if (!mediaClips || mediaClips.length === 0) {
            alert('Please add at least 1 image or video clip to export!');
            return;
        }

        const existing = document.getElementById('capcut-export-pro-modal');
        if (existing) existing.remove();

        const m = document.createElement('div');
        m.id = 'capcut-export-pro-modal';
        m.className = 'capcut-modal-backdrop';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
        
        const defaultName = 'Video_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.mp4';
        
        m.innerHTML = `
            <div style="background:#111827;border:1px solid rgba(255,255,255,0.15);border-radius:12px;width:540px;max-width:94vw;box-shadow:0 25px 60px rgba(0,0,0,0.9);color:#fff;overflow:hidden;font-family:sans-serif;">
                <!-- Header -->
                <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:1.3em;">🚀</span>
                        <h3 style="margin:0;font-size:1.15em;font-weight:700;">Export Video (MP4)</h3>
                    </div>
                    <button id="btn-close-export-modal" style="background:transparent;border:none;color:#9ca3af;font-size:1.3em;cursor:pointer;">✕</button>
                </div>
                <!-- Body -->
                <div style="padding:20px;display:flex;flex-direction:column;gap:14px;max-height:75vh;overflow-y:auto;">
                    <!-- File Name -->
                    <div>
                        <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;font-weight:600;">File Name</label>
                        <input type="text" id="capcut-export-filename" value="${defaultName}" style="width:100%;box-sizing:border-box;padding:8px 12px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.9em;">
                    </div>

                    <!-- Video Section Header -->
                    <div style="font-size:0.85em;font-weight:700;color:#38bdf8;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(56,189,248,0.2);padding-bottom:4px;">
                        <span>📹 Video Quality & Resolution</span>
                    </div>

                    <!-- Resolution & Bitrate Grid -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;">Resolution</label>
                            <select id="capcut-export-res-sel" style="width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.85em;">
                                <option value="480p">480P (SD - Fast)</option>
                                <option value="720p">720P (HD)</option>
                                <option value="1080p" selected>1080P (Full HD - Recommended)</option>
                                <option value="2k">2K (1440p Quad HD)</option>
                                <option value="4k">4K (2160p Ultra HD - Master Quality)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;">Bitrate Quality</label>
                            <select id="capcut-export-bitrate-sel" style="width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.85em;">
                                <option value="recommended" selected>Recommended (Standard High Quality)</option>
                                <option value="higher">Higher / Ultra Crisp (CRF 14 Master)</option>
                                <option value="lower">Lower (Small file size)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Codec & Frame Rate Grid -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;">Codec</label>
                            <select id="capcut-export-codec-sel" style="width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.85em;">
                                <option value="h264" selected>H.264 (Universal MP4 - Recommended)</option>
                                <option value="hevc">HEVC / H.265 (High Efficiency)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;">Frame Rate (FPS)</label>
                            <select id="capcut-export-fps-sel" style="width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.85em;">
                                <option value="24">24 fps (Cinematic Film)</option>
                                <option value="30" selected>30 fps (Standard Video)</option>
                                <option value="60">60 fps (Ultra Smooth 60FPS)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Audio Format -->
                    <div style="font-size:0.85em;font-weight:700;color:#c084fc;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(192,132,252,0.2);padding-bottom:4px;margin-top:2px;">
                        <span>🎙️ Audio Configuration</span>
                    </div>
                    <div>
                        <label style="font-size:0.8em;color:#9ca3af;display:block;margin-bottom:4px;">Audio Quality</label>
                        <select id="capcut-export-audio-sel" style="width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.85em;">
                            <option value="320k" selected>320 kbps High Definition Stereo AAC</option>
                            <option value="192k">192 kbps Standard Stereo AAC</option>
                        </select>
                    </div>

                    <!-- Summary Badge -->
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;font-size:0.8em;color:#9ca3af;">
                        <span>⏱ Duration: <b style="color:#fff;">${fmtTime(totalTimelineDuration)}</b></span>
                        <span>📐 Aspect: <b style="color:#38bdf8;">${aspectRatio}</b></span>
                        <span>🎞 Clips: <b style="color:#fff;">${mediaClips.length}</b></span>
                    </div>

                    <!-- Live Progress Box -->
                    <div id="capcut-export-progress-box" style="display:none;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:12px;">
                        <div style="display:flex;justify-content:space-between;font-size:0.85em;margin-bottom:6px;">
                            <span id="capcut-export-progress-status">🎬 Rendering MP4...</span>
                            <b id="capcut-export-progress-pct" style="color:#38bdf8;">0%</b>
                        </div>
                        <div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                            <div id="capcut-export-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg, #38bdf8, #10b981);transition:width 0.2s;"></div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding:14px 20px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end;gap:10px;background:rgba(0,0,0,0.2);">
                    <button id="btn-cancel-export-dialog" style="padding:8px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;cursor:pointer;">Cancel</button>
                    <button id="btn-start-export-render" style="padding:8px 22px;background:#10b981;border:none;border-radius:6px;color:#fff;font-weight:700;font-size:0.9em;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(16,185,129,0.4);">
                        <span>🚀 Start Export</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(m);

        const closeModal = () => m.remove();
        m.querySelector('#btn-close-export-modal').addEventListener('click', closeModal);
        m.querySelector('#btn-cancel-export-dialog').addEventListener('click', closeModal);

        m.querySelector('#btn-start-export-render').addEventListener('click', () => {
            const fileName = m.querySelector('#capcut-export-filename').value.trim() || defaultName;
            const res = m.querySelector('#capcut-export-res-sel').value;
            const bitrate = m.querySelector('#capcut-export-bitrate-sel').value;
            const codec = m.querySelector('#capcut-export-codec-sel').value;
            const fps = parseInt(m.querySelector('#capcut-export-fps-sel').value, 10) || 30;
            const audioBitrate = m.querySelector('#capcut-export-audio-sel').value;

            executeCapCutRender({
                fileName,
                res,
                bitrate,
                codec,
                fps,
                audioBitrate,
                modalEl: m
            });
        });
    }

    async function executeCapCutRender(opt) {
        const { fileName, res, bitrate, codec, fps, audioBitrate, modalEl } = opt;
        const progressBox = modalEl.querySelector('#capcut-export-progress-box');
        const progressStatus = modalEl.querySelector('#capcut-export-progress-status');
        const progressPct = modalEl.querySelector('#capcut-export-progress-pct');
        const progressBar = modalEl.querySelector('#capcut-export-progress-bar');
        const btnStart = modalEl.querySelector('#btn-start-export-render');
        const btnCancel = modalEl.querySelector('#btn-cancel-export-dialog');

        btnStart.disabled = true;
        btnStart.textContent = '⏳ Rendering...';
        progressBox.style.display = 'block';
        progressStatus.textContent = 'Preparing media files...';

        try {
            const [arW, arH] = getResolutionDimensions(res, aspectRatio);
            const formData = new FormData();

            const clips = mediaClips.map(c => ({
                name: c.name,
                duration: c.duration,
                gap: 0,
                start: c.timestampSec,
                scale: c.scale || 1.0,
                motion: c.motion !== 'none',
                motionType: c.motion,
                transition: c.transition,
                transitionDuration: 0.5,
                volume: c.volume,
                speed: c.speed,
                trimStart: c.trimStart,
                trimEnd: c.trimEnd,
                isVideo: c.type === 'video'
            }));

            const transitionsArray = mediaClips.map((c, idx) => {
                if (idx === 0) return 'cut';
                if (isRandomTransitionMix) {
                    const pool = ['fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen'];
                    return pool[Math.floor(Math.random() * pool.length)];
                }
                return c.transition || globalTransitionType || 'fade';
            });

            const motionsArray = mediaClips.map(c => {
                if (c.type === 'video') return 'none';
                return c.motion || 'none';
            });

            function hexToAssBgr(hex, alpha = '00') {
                if (!hex || typeof hex !== 'string') return `&H${alpha}FFFFFF&`;
                let clean = hex.replace('#', '').trim();
                if (clean.length === 3) {
                    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
                }
                if (clean.length !== 6) return `&H${alpha}FFFFFF&`;
                const r = clean.slice(0, 2);
                const g = clean.slice(2, 4);
                const b = clean.slice(4, 6);
                return `&H${alpha}${b}${g}${r}&`;
            }

            function secToAssTime(sec) {
                const s = Math.max(0, Number(sec) || 0);
                const h = Math.floor(s / 3600);
                const m = Math.floor((s % 3600) / 60);
                const remSec = (s % 60).toFixed(2);
                const [secInt, centis] = remSec.split('.');
                const mm = String(m).padStart(2, '0');
                const ss = String(secInt).padStart(2, '0');
                const cc = String(centis || '00').padEnd(2, '0').slice(0, 2);
                return `${h}:${mm}:${ss}.${cc}`;
            }

            function generateAssSubtitles(opt) {
                const {
                    width,
                    height,
                    words,
                    fontSize,
                    positionY,
                    textColor,
                    highlightColor,
                    strokeColor,
                    strokeWidth,
                    fontFamily,
                    wordsPerPhrase,
                    pacingMode,
                    boxBgStyle,
                    boxBgColor,
                    boxWidthPercent
                } = opt;

                const scaledFontSize = Math.round((fontSize || 26) * (height / 540));
                const borderW = Math.max(1, Math.round((strokeWidth != null ? strokeWidth : 3.5) * (height / 540)));
                const posX = Math.round(width / 2);
                const posY = Math.round(height * ((positionY || 82) / 100));

                const primaryColorAss = hexToAssBgr(textColor || '#ffffff');
                const highlightColorAss = hexToAssBgr(highlightColor || '#f97316');
                const outlineColorAss = hexToAssBgr(strokeColor || '#000000');

                let borderStyle = 1;
                let backColorAss = '&H80000000&';
                let outlineVal = borderW;
                let shadowVal = 0;

                if (boxBgStyle === 'pill' || boxBgStyle === 'rect' || boxBgStyle === 'boxed') {
                    borderStyle = 3;
                    backColorAss = hexToAssBgr(boxBgColor || '#000000', '50');
                }

                const cleanFont = (fontFamily || 'Montserrat').replace(/['"]/g, '').replace(/\(Old\)/g, '').trim();
                const marginSide = Math.round(width * (1 - ((boxWidthPercent || 85) / 100)) / 2);

                let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${cleanFont},${scaledFontSize},${primaryColorAss},&H000000FF,${outlineColorAss},${backColorAss},-1,0,0,0,100,100,0,0,${borderStyle},${outlineVal},${shadowVal},2,${marginSide},${marginSide},40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

                if (!words || words.length === 0) return ass;

                const chunkSize = (pacingMode === 'word') ? 1 : (wordsPerPhrase || 3);
                for (let i = 0; i < words.length; i += chunkSize) {
                    const chunk = words.slice(i, i + chunkSize);
                    if (chunk.length === 0) continue;

                    const phraseStart = chunk[0].start;
                    const phraseEnd = chunk[chunk.length - 1].end;
                    if (phraseEnd <= phraseStart) continue;

                    for (let k = 0; k < chunk.length; k++) {
                        const curWord = chunk[k];
                        const wStart = (k === 0) ? phraseStart : curWord.start;
                        const wEnd = (k === chunk.length - 1) ? phraseEnd : (chunk[k + 1] ? chunk[k + 1].start : curWord.end);

                        if (wEnd <= wStart) continue;

                        const textParts = chunk.map((w, idx) => {
                            if (idx === k) {
                                return `{\\c${highlightColorAss}}${w.word}{\\c${primaryColorAss}}`;
                            } else {
                                return w.word;
                            }
                        });

                        const lineText = `{\\pos(${posX},${posY})}${textParts.join(' ')}`;
                        ass += `Dialogue: 0,${secToAssTime(wStart)},${secToAssTime(wEnd)},Default,,0,0,0,,${lineText}\n`;
                    }
                }

                return ass;
            }

            let exportCaptions = [];
            let assSubtitles = '';
            if (captionConfig.enabled && captionConfig.customWordsList && captionConfig.customWordsList.length > 0) {
                const words = captionConfig.customWordsList;
                const wordsPerSubtitle = (captionConfig.pacingMode === 'word') ? 1 : (captionConfig.wordsPerPhrase || 3);
                for (let i = 0; i < words.length; i += wordsPerSubtitle) {
                    const chunk = words.slice(i, i + wordsPerSubtitle);
                    exportCaptions.push({
                        start: chunk[0].start,
                        end: chunk[chunk.length - 1].end,
                        text: chunk.map(w => w.word).join(' ')
                    });
                }

                assSubtitles = generateAssSubtitles({
                    width: arW,
                    height: arH,
                    words: captionConfig.customWordsList,
                    fontSize: captionConfig.fontSize,
                    positionY: captionConfig.positionY,
                    textColor: captionConfig.textColor,
                    highlightColor: captionConfig.highlightColor,
                    strokeColor: captionConfig.strokeColor,
                    strokeWidth: captionConfig.strokeWidth,
                    fontFamily: captionConfig.fontFamily,
                    wordsPerPhrase: captionConfig.wordsPerPhrase,
                    pacingMode: captionConfig.pacingMode,
                    boxBgStyle: captionConfig.boxBgStyle,
                    boxBgColor: captionConfig.boxBgColor,
                    boxWidthPercent: captionConfig.boxWidthPercent
                });
            }

            const spec = {
                width: arW,
                height: arH,
                fps: fps || 30,
                codec: codec === 'hevc' ? 'libx265' : 'libx264',
                crf: bitrate === 'higher' ? 14 : (bitrate === 'lower' ? 23 : 18),
                videoBitrate: bitrate === 'higher' ? '28M' : (bitrate === 'lower' ? '6M' : '14M'),
                audioBitrate: audioBitrate || '320k',
                clips: clips,
                transitions: transitionsArray,
                transitionDuration: globalTransitionDuration || 0.40,
                motions: motionsArray,
                motionAmount: globalZoomDepth || 0.08,
                captions: exportCaptions,
                assSubtitles: assSubtitles,
                captionStyle: activeCaptionStyleId || 'yellow',
                captionSize: activeCaptionSizeId || 'md',
                captionLineHeight: (captionConfig.boxBgStyle === 'pill') ? 1.45 : 1.16,
                silenceCut: false
            };

            formData.append('spec', JSON.stringify(spec));

            for (const clip of mediaClips) {
                formData.append(clip.name, clip.file, clip.name);
            }

            if (audioClips && audioClips.length > 1) {
                const mergedAudio = await concatenateAudioFiles(audioClips);
                formData.append('audio', mergedAudio, 'voiceover_track.wav');
            } else if (audioClips && audioClips.length === 1) {
                formData.append('audio', audioClips[0].file, audioClips[0].name);
            } else if (voiceoverAudio && voiceoverAudio.file) {
                formData.append('audio', voiceoverAudio.file, voiceoverAudio.name);
            }

            progressStatus.textContent = 'Sending to FFmpeg render engine...';

            const resp = await fetch(`${API_BASE}/render`, {
                method: 'POST',
                body: formData
            });

            const result = await resp.json();

            if (result.jobId) {
                const sse = new EventSource(`${API_BASE}/render/${result.jobId}/events`);
                sse.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        if (data.error || data.status === 'error') {
                            sse.close();
                            btnStart.disabled = false;
                            btnStart.textContent = '🚀 Start Export';
                            progressStatus.innerHTML = `<span style="color:#ef4444;">Error: ${data.error || 'Render failed'}</span>`;
                            return;
                        }
                        if (data.done || data.status === 'done') {
                            sse.close();
                            progressBar.style.width = '100%';
                            progressPct.textContent = '100%';
                            progressStatus.innerHTML = `<span style="color:#10b981;font-weight:700;">✅ Render Complete! Saved to Downloads\\AutoEditor</span>`;
                            btnStart.style.display = 'none';
                            btnCancel.textContent = 'Close';
                            
                            const dlBtn = document.createElement('a');
                            dlBtn.href = `${API_BASE}/render/${result.jobId}/file`;
                            dlBtn.download = fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`;
                            dlBtn.style.cssText = 'padding:8px 22px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(16,185,129,0.4);';
                            dlBtn.innerHTML = `⬇️ Download ${fileName}`;
                            btnStart.parentNode.appendChild(dlBtn);
                            dlBtn.click();
                            return;
                        }
                        if (data.progress !== undefined) {
                            const pct = Math.max(1, Math.min(99, Math.round(data.progress * 100)));
                            progressStatus.innerHTML = `🎬 Rendering MP4 (${res.toUpperCase()} @ ${fps}fps)...`;
                            progressPct.textContent = `${pct}%`;
                            progressBar.style.width = `${pct}%`;
                        }
                    } catch (err) {}
                };
                sse.onerror = () => {
                    // SSE connection error fallback
                };
            } else {
                throw new Error(result.error || 'Could not start render job');
            }
        } catch (err) {
            btnStart.disabled = false;
            btnStart.textContent = '🚀 Start Export';
            progressStatus.innerHTML = `<span style="color:#ef4444;">Error: ${err.message}</span>`;
        }
    }

    // ── Video Jump-Cut Studio Component ──
    function createVideoJumpcutStudio() {
        const c = document.createElement('div');
        c.id = 'video-jumpcut-container';
        c.className = 'studio-card-view';
        renderVideoJumpcutContent(c);
        return c;
    }

    function renderVideoJumpcutContent(c) {
        c.innerHTML = `
            <div class="studio-card">
                <div class="studio-card__head">
                    <h1 class="studio-card__title">🎥 Video Silence Remover & Auto Jump-Cutter</h1>
                    <p class="studio-card__subtitle">
                        Upload any video (MP4, MOV, MKV) to automatically cut awkward pauses, breathing breaks, and dead air with frame-perfect AV sync.
                    </p>
                </div>
                <div class="studio-dropzone" id="vstudio-dropzone">
                    <div class="studio-dropicon">🎬</div>
                    <div class="studio-droptitle">${vStudioFile ? 'Selected: ' + vStudioFile.name : 'Drop Video File (MP4, MOV, MKV, AVI) or Click to Browse'}</div>
                    <div class="studio-drophint">${vStudioFile ? '(' + (vStudioFile.size / (1024*1024)).toFixed(2) + ' MB)' : 'Processes 100% locally on your computer with FFmpeg'}</div>
                    <input type="file" id="vstudio-file-input" accept="video/*" hidden>
                </div>
                <div class="studio-config">
                    <div class="studio-cfg-item">
                        <label>Min Pause Duration: <b id="vstudio-min-val">${minSilence.toFixed(2)}s</b></label>
                        <input type="range" id="vstudio-min-dur" min="0.08" max="1.50" step="0.02" value="${minSilence}">
                    </div>
                    <div class="studio-cfg-item">
                        <label>Sensitivity (dB Threshold)</label>
                        <select id="vstudio-threshold">
                            <option value="-20" ${silenceThreshold === -20 ? 'selected' : ''}>Ultra Aggressive (-20 dB - Zero Pauses)</option>
                            <option value="-25" ${silenceThreshold === -25 ? 'selected' : ''}>Low (-25 dB)</option>
                            <option value="-30" ${silenceThreshold === -30 ? 'selected' : ''}>Medium (-30 dB)</option>
                            <option value="-35" ${silenceThreshold === -35 ? 'selected' : ''}>High (-35 dB - Recommended)</option>
                            <option value="-40" ${silenceThreshold === -40 ? 'selected' : ''}>Very High (-40 dB)</option>
                            <option value="-50" ${silenceThreshold === -50 ? 'selected' : ''}>Max (-50 dB)</option>
                        </select>
                    </div>
                    <div class="studio-cfg-item">
                        <label>Edge Padding (Buffer)</label>
                        <select id="vstudio-padding">
                            <option value="0.01" ${silencePadding === 0.01 ? 'selected' : ''}>Zero Gap (10ms)</option>
                            <option value="0.02" ${silencePadding === 0.02 ? 'selected' : ''}>Tight (20ms)</option>
                            <option value="0.05" ${silencePadding === 0.05 ? 'selected' : ''}>Smooth (50ms - Best)</option>
                            <option value="0.10" ${silencePadding === 0.10 ? 'selected' : ''}>Gentle (100ms)</option>
                        </select>
                    </div>
                </div>
                <button class="studio-btn-action" id="vstudio-process-btn" ${!vStudioFile || vStudioIsProcessing ? 'disabled' : ''}>
                    ${vStudioIsProcessing ? '⏳ Trimming Video with FFmpeg... (Please wait)' : '✂️ Cut Silence & Generate Jump-Cut Video'}
                </button>
                <div id="vstudio-results-area" style="${vStudioResult ? '' : 'display:none;'}">
                    ${vStudioResult ? renderVideoResultsHTML(vStudioResult) : ''}
                </div>
            </div>
        `;
        setupVideoJumpcutEvents(c);
    }

    function renderVideoResultsHTML(res) {
        const pct = res.original_duration > 0 ? ((res.silence_removed / res.original_duration) * 100).toFixed(0) : 0;
        const downUrl = `${API_BASE}${res.download_url}?nocache=${Date.now()}`;
        return `
            <div class="studio-stats-grid">
                <div class="studio-stat-card"><div class="studio-stat-card__val">${fmtTimeShort(res.original_duration)}</div><div class="studio-stat-card__label">Original</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#10b981;">${fmtTimeShort(res.trimmed_duration)}</div><div class="studio-stat-card__label">Jump-Cut Video</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#f59e0b;">-${res.silence_removed.toFixed(1)}s</div><div class="studio-stat-card__label">Dead Air Cut</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#a78bfa;">${pct}%</div><div class="studio-stat-card__label">Time Saved</div></div>
            </div>
            <div class="studio-players">
                <div class="studio-player-row">
                    <label>🎬 Clean Jump-Cut Video Preview:</label>
                    <video controls src="${downUrl}" preload="auto" autoplay playsinline></video>
                </div>
            </div>
            <div class="studio-actions-row">
                <a class="btn-download-primary" href="${downUrl}" download="jumpcut_${vStudioFile ? vStudioFile.name : 'video.mp4'}">
                    ⬇️ Download Clean Video (MP4)
                </a>
                <button class="btn-reset-studio" id="vstudio-reset-btn">
                    ✕ Reset / Upload Another
                </button>
            </div>
        `;
    }

    function setupVideoJumpcutEvents(c) {
        const dropzone = c.querySelector('#vstudio-dropzone');
        const fileInput = c.querySelector('#vstudio-file-input');
        const minSlider = c.querySelector('#vstudio-min-dur');
        const minVal = c.querySelector('#vstudio-min-val');
        const thresholdSel = c.querySelector('#vstudio-threshold');
        const paddingSel = c.querySelector('#vstudio-padding');
        const processBtn = c.querySelector('#vstudio-process-btn');

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    vStudioFile = e.target.files[0];
                    vStudioResult = null;
                    renderVideoJumpcutContent(c);
                }
            });
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('is-over');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    vStudioFile = e.target.files[0];
                    vStudioResult = null;
                    renderVideoJumpcutContent(c);
                }
            });
        }

        if (minSlider && minVal) {
            minSlider.addEventListener('input', () => {
                minSilence = +minSlider.value;
                minVal.textContent = minSilence.toFixed(2) + 's';
            });
        }
        if (thresholdSel) thresholdSel.addEventListener('change', () => silenceThreshold = +thresholdSel.value);
        if (paddingSel) paddingSel.addEventListener('change', () => silencePadding = +paddingSel.value);

        if (processBtn) {
            processBtn.addEventListener('click', async () => {
                if (!vStudioFile || vStudioIsProcessing) return;
                vStudioIsProcessing = true;
                processBtn.disabled = true;
                processBtn.textContent = '⏳ Trimming Video with FFmpeg... (Please wait)';

                try {
                    const formData = new FormData();
                    formData.append('video', vStudioFile, vStudioFile.name);
                    const url = `${API_BASE}/video-silence-trim?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                    const resp = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
                    const res = await resp.json();
                    if (res.success) {
                        vStudioResult = res;
                        renderVideoJumpcutContent(c);
                    } else {
                        alert('Video trim error: ' + (res.error || 'Trimming failed'));
                        vStudioIsProcessing = false;
                        renderVideoJumpcutContent(c);
                    }
                } catch (err) {
                    alert('Backend connection error: ' + err.message);
                    vStudioIsProcessing = false;
                    renderVideoJumpcutContent(c);
                }
            });
        }

        const resetBtn = c.querySelector('#vstudio-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                vStudioFile = null;
                vStudioResult = null;
                renderVideoJumpcutContent(c);
            });
        }
    }

    // ── Audio Editor Studio Component ──
    function createAudioEditorStudio() {
        const c = document.createElement('div');
        c.id = 'audio-editor-container';
        c.className = 'studio-card-view';
        renderAudioEditorContent(c);
        return c;
    }

    function renderAudioEditorContent(c) {
        c.innerHTML = `
            <div class="studio-card">
                <div class="studio-card__head">
                    <h1 class="studio-card__title">🎙️ Audio Editor & Silence Remover</h1>
                    <p class="studio-card__subtitle">
                        Upload voiceover audio to compare before/after visual waveforms, cut pauses, and send directly to the Video Editor timeline.
                    </p>
                </div>
                <div class="studio-dropzone" id="astudio-dropzone">
                    <div class="studio-dropicon">🎵</div>
                    <div class="studio-droptitle">${aStudioFile ? 'Selected: ' + aStudioFile.name : 'Drop Audio File (MP3, WAV, M4A, OGG) or Click to Browse'}</div>
                    <div class="studio-drophint">${aStudioFile ? '(' + (aStudioFile.size / (1024*1024)).toFixed(2) + ' MB)' : 'Works 100% locally on your computer with FFmpeg'}</div>
                    <input type="file" id="astudio-file-input" accept="audio/*" hidden>
                </div>
                <div class="studio-config">
                    <div class="studio-cfg-item">
                        <label>Min Pause Duration: <b id="astudio-min-val">${minSilence.toFixed(2)}s</b></label>
                        <input type="range" id="astudio-min-dur" min="0.08" max="1.50" step="0.02" value="${minSilence}">
                    </div>
                    <div class="studio-cfg-item">
                        <label>Sensitivity (dB Threshold)</label>
                        <select id="astudio-threshold">
                            <option value="-20" ${silenceThreshold === -20 ? 'selected' : ''}>Ultra Aggressive (-20 dB - Zero Pauses)</option>
                            <option value="-25" ${silenceThreshold === -25 ? 'selected' : ''}>Low (-25 dB)</option>
                            <option value="-30" ${silenceThreshold === -30 ? 'selected' : ''}>Medium (-30 dB)</option>
                            <option value="-35" ${silenceThreshold === -35 ? 'selected' : ''}>High (-35 dB - Recommended)</option>
                            <option value="-40" ${silenceThreshold === -40 ? 'selected' : ''}>Very High (-40 dB)</option>
                            <option value="-50" ${silenceThreshold === -50 ? 'selected' : ''}>Max (-50 dB)</option>
                        </select>
                    </div>
                    <div class="studio-cfg-item">
                        <label>Edge Padding (Buffer)</label>
                        <select id="astudio-padding">
                            <option value="0.01" ${silencePadding === 0.01 ? 'selected' : ''}>Zero Gap (10ms)</option>
                            <option value="0.02" ${silencePadding === 0.02 ? 'selected' : ''}>Tight (20ms)</option>
                            <option value="0.05" ${silencePadding === 0.05 ? 'selected' : ''}>Smooth (50ms - Best)</option>
                            <option value="0.10" ${silencePadding === 0.10 ? 'selected' : ''}>Gentle (100ms)</option>
                        </select>
                    </div>
                </div>
                <button class="studio-btn-action" id="astudio-process-btn" ${!aStudioFile || aStudioIsProcessing ? 'disabled' : ''}>
                    ${aStudioIsProcessing ? '⏳ Processing Audio with FFmpeg...' : '✂️ Cut Silence & Generate Clean Audio'}
                </button>
                <div id="astudio-results-area" style="${aStudioResult ? '' : 'display:none;'}">
                    ${aStudioResult ? renderAudioResultsHTML(aStudioResult) : ''}
                </div>
            </div>
        `;
        setupAudioEditorEvents(c);
    }

    function renderAudioResultsHTML(res) {
        const pct = res.original_duration > 0 ? ((res.silence_removed / res.original_duration) * 100).toFixed(0) : 0;
        const downUrl = `${API_BASE}${res.download_url}?nocache=${Date.now()}`;
        return `
            <div class="studio-stats-grid">
                <div class="studio-stat-card"><div class="studio-stat-card__val">${fmtTimeShort(res.original_duration)}</div><div class="studio-stat-card__label">Original</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#10b981;">${fmtTimeShort(res.trimmed_duration)}</div><div class="studio-stat-card__label">Clean Audio</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#f59e0b;">-${res.silence_removed.toFixed(1)}s</div><div class="studio-stat-card__label">Silence Removed</div></div>
                <div class="studio-stat-card"><div class="studio-stat-card__val" style="color:#a78bfa;">${pct}%</div><div class="studio-stat-card__label">Faster Pacing</div></div>
            </div>

            <div class="studio-audio-compare-grid">
                <!-- 📻 Original Audio Track with Visual Waveform -->
                <div class="audio-compare-card">
                    <div class="audio-compare-header">
                        <span>📻 Original Audio (Before):</span>
                        <span style="color:#94a3b8;font-weight:700;">⏱ ${fmtTimeShort(res.original_duration)}</span>
                    </div>
                    <div class="audio-compare-canvas-wrap">
                        <canvas id="astudio-orig-waveform" width="800" height="54"></canvas>
                    </div>
                    <audio controls id="astudio-orig-player" src="${aStudioOrigUrl}" preload="auto"></audio>
                </div>

                <!-- 🔊 Clean Audio Track with Visual Waveform -->
                <div class="audio-compare-card clean-highlight">
                    <div class="audio-compare-header">
                        <span>🔊 Clean Audio (After - Silence Cut):</span>
                        <span style="color:#10b981;font-weight:700;">⏱ ${fmtTimeShort(res.trimmed_duration)} (-${res.silence_removed.toFixed(1)}s dead air cut)</span>
                    </div>
                    <div class="audio-compare-canvas-wrap">
                        <canvas id="astudio-clean-waveform" width="800" height="54"></canvas>
                    </div>
                    <audio controls id="astudio-clean-player" src="${downUrl}" preload="auto" autoplay></audio>
                </div>
            </div>

            <div class="studio-actions-row">
                <button type="button" class="btn-send-to-timeline" id="astudio-send-timeline-btn">
                    🚀 Send Clean Audio to Video Editor Studio
                </button>
                <a class="btn-download-primary" href="${downUrl}" download="clean_${aStudioFile ? aStudioFile.name : 'voiceover.mp3'}">
                    ⬇️ Download Clean Audio (MP3)
                </a>
                <button class="btn-reset-studio" id="astudio-reset-btn">
                    ✕ Reset
                </button>
            </div>
        `;
    }

    function setupAudioEditorEvents(c) {
        const dropzone = c.querySelector('#astudio-dropzone');
        const fileInput = c.querySelector('#astudio-file-input');
        const minSlider = c.querySelector('#astudio-min-dur');
        const minVal = c.querySelector('#astudio-min-val');
        const thresholdSel = c.querySelector('#astudio-threshold');
        const paddingSel = c.querySelector('#astudio-padding');
        const processBtn = c.querySelector('#astudio-process-btn');

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    aStudioFile = e.target.files[0];
                    aStudioOrigUrl = URL.createObjectURL(aStudioFile);
                    aStudioResult = null;
                    const wf = await extractWaveformPeaks(aStudioFile);
                    aStudioOrigPeaks = wf ? wf.peaks : [];
                    renderAudioEditorContent(c);
                }
            });
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
            dropzone.addEventListener('drop', async (e) => {
                e.preventDefault();
                dropzone.classList.remove('is-over');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    aStudioFile = e.dataTransfer.files[0];
                    aStudioOrigUrl = URL.createObjectURL(aStudioFile);
                    aStudioResult = null;
                    const wf = await extractWaveformPeaks(aStudioFile);
                    aStudioOrigPeaks = wf ? wf.peaks : [];
                    renderAudioEditorContent(c);
                }
            });
        }

        if (minSlider && minVal) {
            minSlider.addEventListener('input', () => {
                minSilence = +minSlider.value;
                minVal.textContent = minSilence.toFixed(2) + 's';
            });
        }
        if (thresholdSel) thresholdSel.addEventListener('change', () => silenceThreshold = +thresholdSel.value);
        if (paddingSel) paddingSel.addEventListener('change', () => silencePadding = +paddingSel.value);

        if (processBtn) {
            processBtn.addEventListener('click', async () => {
                if (!aStudioFile || aStudioIsProcessing) return;
                aStudioIsProcessing = true;
                processBtn.disabled = true;
                processBtn.textContent = '⏳ Processing Audio with FFmpeg...';

                try {
                    const formData = new FormData();
                    formData.append('audio', aStudioFile, aStudioFile.name);
                    const url = `${API_BASE}/silence-trim?minSilence=${minSilence}&threshold=${silenceThreshold}&padding=${silencePadding}&nocache=${Date.now()}`;
                    const resp = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
                    const res = await resp.json();
                    
                    if (res.success) {
                        const dlUrl = (res.download_url.startsWith('http') ? res.download_url : `${API_BASE}${res.download_url}`) + '?nocache=' + Date.now();
                        let blobResp = await fetch(dlUrl, { cache: 'no-store' });
                        if (!blobResp.ok && dlUrl.includes(':4000')) {
                            blobResp = await fetch(`http://127.0.0.1:4001${res.download_url}?nocache=` + Date.now(), { cache: 'no-store' });
                        }
                        aStudioCleanBlob = await blobResp.blob();
                        aStudioCleanFile = new File([aStudioCleanBlob], 'clean_' + aStudioFile.name, { type: 'audio/mp3' });
                        aStudioCleanUrl = URL.createObjectURL(aStudioCleanBlob);
                        
                        const wf = await extractWaveformPeaks(aStudioCleanFile);
                        aStudioCleanPeaks = wf ? wf.peaks : [];

                        aStudioResult = res;
                        aStudioIsProcessing = false;
                        renderAudioEditorContent(c);

                        setTimeout(() => {
                            drawWaveformOnCanvas('astudio-orig-waveform', aStudioOrigPeaks, false);
                            drawWaveformOnCanvas('astudio-clean-waveform', aStudioCleanPeaks, true);
                        }, 50);

                    } else {
                        alert('Audio trim error: ' + (res.error || 'Trimming failed'));
                        aStudioIsProcessing = false;
                        renderAudioEditorContent(c);
                    }
                } catch (err) {
                    alert('Backend connection error: ' + err.message);
                    aStudioIsProcessing = false;
                    renderAudioEditorContent(c);
                }
            });
        }

        if (aStudioResult) {
            setTimeout(() => {
                drawWaveformOnCanvas('astudio-orig-waveform', aStudioOrigPeaks, false);
                drawWaveformOnCanvas('astudio-clean-waveform', aStudioCleanPeaks, true);
            }, 50);
        }

        const sendTimelineBtn = c.querySelector('#astudio-send-timeline-btn');
        if (sendTimelineBtn) {
            sendTimelineBtn.addEventListener('click', async () => {
                if (!aStudioCleanFile || !aStudioCleanBlob) return;

                if (voiceoverAudio) {
                    destroyAudioElement(voiceoverAudio.audioElement, voiceoverAudio.url);
                }

                await saveBatchToDB([{ id: 'audio_voiceover_track', file: aStudioCleanFile }]);
                const newAudioUrl = URL.createObjectURL(aStudioCleanBlob);
                const newAudioObj = new Audio();
                newAudioObj.preload = 'auto';
                newAudioObj.src = newAudioUrl;
                newAudioObj.load();

                const cleanAudioClip = {
                    id: 'audio_voiceover_track',
                    file: aStudioCleanFile,
                    url: newAudioUrl,
                    duration: (aStudioCleanPeaks && aStudioCleanPeaks.length) ? aStudioResult.trimmed_duration : 10,
                    name: aStudioCleanFile.name,
                    timestampSec: 0,
                    audioElement: newAudioObj,
                    waveformPeaks: aStudioCleanPeaks
                };

                voiceoverAudio = cleanAudioClip;
                audioClips = [cleanAudioClip];
                selectedAudioClipId = cleanAudioClip.id;

                pushHistoryState();

                if (aStudioResult && aStudioResult.segments && mediaClips.length > 0) {
                    for (let i = 0; i < mediaClips.length; i++) {
                        const oldStart = mediaClips[i].timestampSec;
                        const newStart = mapTimeToTrimmedSegments(oldStart, aStudioResult.segments);
                        mediaClips[i].timestampSec = parseFloat(newStart.toFixed(2));
                    }
                }

                isPlaying = false;
                if (animFrameId) cancelAnimationFrame(animFrameId);
                setPlayheadTime(0);
                rippleRecalculateTimeline();
                renderAssetList();
                renderTimeline();
                renderInspector();
                persistProjectState();

                switchStudioMode('capcut-editor');
                ensurePlayheadVisible(true);
            });
        }

        const resetBtn = c.querySelector('#astudio-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                aStudioFile = null;
                aStudioOrigUrl = null;
                aStudioOrigPeaks = [];
                aStudioResult = null;
                aStudioCleanFile = null;
                aStudioCleanBlob = null;
                aStudioCleanUrl = null;
                aStudioCleanPeaks = [];
                renderAudioEditorContent(c);
            });
        }
    }

    // ── Global Start Guard ──
    function init() {
        buildGlobalAppUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
