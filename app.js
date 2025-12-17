document.addEventListener('DOMContentLoaded', () => {
    const setupContainer = document.getElementById('setup-container');
    const setupButton = document.getElementById('setup-button');
    const cameraContainer = document.getElementById('camera-container');
    const cameraView = document.getElementById('camera-view');
    const statusMessage = document.getElementById('status-message');
    const recordButton = document.getElementById('record-button');
    const restartVoiceButton = document.getElementById('restart-voice-button'); // New element

    let stream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let directoryHandle = null; // To store the directory handle

    // IndexedDB Helper Functions
    const DB_NAME = 'CameraAppDB';
    const STORE_NAME = 'settings';
    const HANDLE_KEY = 'directoryHandle';

    async function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject("Error opening DB");
            };
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                db.createObjectStore(STORE_NAME);
            };
        });
    }

    async function setDB(key, value) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(value, key);
        return tx.complete;
    }

    async function getDB(key) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        return new Promise(resolve => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        });
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('Service Worker registered successfully:', registration))
            .catch(error => console.error('Service Worker registration failed:', error));
    }

    // Initialize App - Check for saved directory handle
    async function initializeApp() {
        directoryHandle = await getDB(HANDLE_KEY);
        if (directoryHandle) {
            if (await verifyPermission(directoryHandle)) {
                console.log('Permission already granted for directory.');
                showCameraUI();
            } else {
                console.log('Permission lost or not granted for directory. Re-requesting.');
                statusMessage.textContent = 'Permission needed for saved folder.';
                // User will need to re-click setup if permission is lost
                showSetupUI();
            }
        } else {
            console.log('No directory handle found. Showing setup UI.');
            showSetupUI();
        }
    }

    async function verifyPermission(handle) {
        const options = { mode: 'readwrite' };
        // Check if permission was already granted. If so, return true.
        if ((await handle.queryPermission(options)) === 'granted') {
            return true;
        }
        // Request permission. If the user grants permission, return true.
        if ((await handle.requestPermission(options)) === 'granted') {
            return true;
        }
        // The user didn't grant permission, so return false.
        return false;
    }

    function showSetupUI() {
        setupContainer.style.display = 'flex';
        cameraContainer.style.display = 'none';
        recordButton.disabled = true;
    }

    async function showCameraUI() {
        setupContainer.style.display = 'none';
        cameraContainer.style.display = 'flex';
        await initializeCamera(); // Initialize camera only when UI is ready
    }

    // Main function to get permissions and initialize camera stream
    async function initializeCamera() {
        statusMessage.textContent = 'Waiting for permissions...';
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: true
            });

            cameraView.srcObject = stream;
            cameraView.muted = true; // Mute the video element to prevent feedback
            cameraView.onloadedmetadata = () => {
                cameraView.play();
                statusMessage.textContent = 'Ready';
                initializeSpeechRecognition();
                recordButton.disabled = false;
            };

        } catch (error) {
            console.error('Error accessing media devices.', error);
            const msg = error.name === 'NotAllowedError' ? 'Permissions denied.' : 'Could not access camera.';
            statusMessage.textContent = msg;
            // Potentially show setup UI again if camera permissions are needed to start over
            showSetupUI(); // Maybe a better error state would be good here.
        }
    }

    function isMobileDevice() {
        return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Speech Recognition with enhanced logging
    function initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            statusMessage.textContent = 'Voice control not supported.';
            return;
        }

        let recognition = null; // Declare recognition in a scope accessible by restartVoiceControl

        function restartVoiceControl() {
            if (recognition) {
                recognition.start();
                // When restarted, if not recording, update status to 'Listening...'
                if (!isRecording) statusMessage.textContent = 'Listening...';
                restartVoiceButton.style.display = 'none'; // Hide the restart button
            }
        }
        window.restartVoiceControl = restartVoiceControl; // Expose to global scope

        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = false;

        recognition.onstart = () => {
            console.log('Speech recognition started.');
            if (!isRecording) statusMessage.textContent = 'Listening...';
            restartVoiceButton.style.display = 'none'; // Hide the restart button when recognition starts
        };

        recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
            console.log('Voice command heard:', transcript);

            if (transcript.includes('action') && !isRecording) {
                console.log('Action command detected.');
                startRecording();
            } else if (transcript.includes('thank you') && isRecording) {
                console.log('Stop command detected.');
                stopRecording();
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (isMobileDevice()) {
                statusMessage.textContent = 'Voice control stopped. Tap to restart.';
                restartVoiceButton.style.display = 'block'; // Show the restart button on error
            }
        };

        recognition.onend = () => {
            console.log('Speech recognition service ended.');
            if (!isRecording && cameraContainer.style.display !== 'none') {
                if (isMobileDevice()) {
                    statusMessage.textContent = 'Voice control stopped. Tap to restart.';
                    restartVoiceButton.style.display = 'block'; // Show the restart button
                } else {
                    console.log('Restarting speech recognition...');
                    restartVoiceButton.style.display = 'none'; // Hide the restart button
                    restartVoiceControl();
                }
            }
        };

        restartVoiceControl(); // Start recognition initially
    }

    // Recording Controls
    async function startRecording() {
        if (isRecording || !stream) return;
        if (!directoryHandle) {
            statusMessage.textContent = 'Please select a save folder first.';
            showSetupUI();
            return;
        }

        isRecording = true;
        recordButton.classList.add('recording');

        let countdown = 3;
        statusMessage.textContent = `Recording in ${countdown}...`;
        speak(countdown.toString());

        const countdownInterval = setInterval(() => {
            countdown--;
            statusMessage.textContent = `Recording in ${countdown}...`;
            if (countdown > 0) {
                speak(countdown.toString());
            } else { // Countdown finished
                clearInterval(countdownInterval);
                statusMessage.textContent = 'Recording...';
                playBeep(); // Beep instead of speaking '0' or 'action'

                recordedChunks = [];
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) recordedChunks.push(event.data);
                };
                mediaRecorder.onstop = saveVideo;
                mediaRecorder.start();
            }
        }, 1000);
    }

    function stopRecording() {
        if (!isRecording) return;
        playBeep();
        mediaRecorder.stop(); // This will trigger the 'onstop' event which calls saveVideo
        isRecording = false;
        recordButton.classList.remove('recording');
        statusMessage.textContent = 'Stopping...';
    }

    // Function to speak text
    function speak(text) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.2;
            speechSynthesis.speak(utterance);
        }
    }

    // Function to generate a beep sound
    function playBeep() {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = 880; // A5 note
        gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);

        oscillator.start(audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.15);
        oscillator.stop(audioContext.currentTime + 0.15);
    }

    // Save Video File - Automatically to the selected directory
    async function saveVideo() {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });

        if (!directoryHandle) {
            console.error("Directory handle not available. Cannot save video.");
            statusMessage.textContent = 'Error: Save folder not set.';
            return;
        }

        // Verify permissions again before saving
        if (!(await verifyPermission(directoryHandle))) {
            statusMessage.textContent = 'Permission lost for folder. Re-select.';
            showSetupUI();
            return;
        }

        try {
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0]; // YYYY-MM-DDTHH-MM-SS
            const fileName = `recording-${timestamp}.webm`;
            const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            statusMessage.textContent = 'Video saved!';
            console.log("Video successfully saved:", fileName);
        } catch (err) {
            console.error('Error writing to file:', err);
            statusMessage.textContent = 'Failed to save video.';
        } finally {
            // Reset status message after a delay, and re-enable listening
            setTimeout(() => {
                if (!isRecording && cameraContainer.style.display !== 'none') {
                    statusMessage.textContent = 'Listening...';
                }
            }, 3000);
        }
    }

    // Setup button click handler
    setupButton.addEventListener('click', async () => {
        try {
            directoryHandle = await window.showDirectoryPicker();
            if (await verifyPermission(directoryHandle)) {
                await setDB(HANDLE_KEY, directoryHandle);
                console.log('Directory selected and permissions granted.');
                showCameraUI();
            } else {
                statusMessage.textContent = 'Permission denied for folder. Please try again.';
            }
        } catch (err) {
            console.error('User cancelled directory picker or error occurred:', err);
            statusMessage.textContent = 'Folder selection cancelled.';
        }
    });

    // Manual control
    recordButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    recordButton.disabled = true; // Disabled until camera is ready

    initializeApp();
});