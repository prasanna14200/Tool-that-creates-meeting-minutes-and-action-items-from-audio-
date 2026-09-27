const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 30;
const WHISPER_MODEL = "Xenova/whisper-tiny.en";

const els = {
  audioFile: document.querySelector("#audioFile"),
  dropZone: document.querySelector("#dropZone"),
  fileMeta: document.querySelector("#fileMeta"),
  recordButton: document.querySelector("#recordButton"),
  stopButton: document.querySelector("#stopButton"),
  recordingTimer: document.querySelector("#recordingTimer"),
  transcribeButton: document.querySelector("#transcribeButton"),
  transcript: document.querySelector("#transcript"),
  sampleButton: document.querySelector("#sampleButton"),
  minutesButton: document.querySelector("#minutesButton"),
  minutesOutput: document.querySelector("#minutesOutput"),
  downloadButton: document.querySelector("#downloadButton"),
  copyButton: document.querySelector("#copyButton"),
  statusText: document.querySelector("#statusText"),
  statusDot: document.querySelector("#statusDot"),
};

let selectedBlob = null;
let selectedName = "";
let recorder = null;
let recordedChunks = [];
let timerId = null;
let recordingStartedAt = 0;
let transcriberPromise = null;
let lastMinutes = "";

const sampleTranscript = `Sarah: Thanks everyone for joining the product launch meeting. We need to finalize the pricing page and prepare the customer email.
Michael: I reviewed the analytics dashboard. The trial conversion rate improved, but the onboarding checklist still has a drop-off after step two.
Priya: I will update the onboarding copy by Friday and send it to Sarah for review.
Sarah: Decision: we will keep the launch date as May 15 and use the current pricing structure.
Michael: I can prepare the final dashboard screenshots by Wednesday.
Sarah: Action item: Priya owns onboarding copy. Michael owns screenshots. Sarah will approve the launch email.`;

function setStatus(message, type = "ok") {
  els.statusText.textContent = message;
  els.statusDot.classList.toggle("busy", type === "busy");
  els.statusDot.classList.toggle("error", type === "error");
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function validateFile(file) {
  if (!file) {
    throw new Error("Choose or record an audio file first.");
  }
  const name = file.name || "recording.webm";
  const validExtension = /\.(wav|mp3|m4a|webm|ogg)$/i.test(name);
  const validMime = (file.type || "").startsWith("audio/");
  if (!validMime && !validExtension) {
    throw new Error("Unsupported file. Please upload WAV, MP3, M4A, WebM, or OGG audio.");
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Audio is too large. Please use a file under 25 MB.");
  }
}

async function decodeAudio(blob) {
  validateFile(blob);
  const arrayBuffer = await blob.arrayBuffer();
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    if (decoded.duration > MAX_AUDIO_SECONDS) {
      throw new Error(`Audio is ${decoded.duration.toFixed(1)} seconds. Please use ${MAX_AUDIO_SECONDS} seconds or less for this free demo.`);
    }
    const mono = mixToMono(decoded);
    return resample(mono, decoded.sampleRate, 16000);
  } finally {
    await context.close();
  }
}

function mixToMono(audioBuffer) {
  const length = audioBuffer.length;
  const output = new Float32Array(length);
  const channels = audioBuffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      output[i] += data[i] / channels;
    }
  }
  return output;
}

function resample(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const newLength = Math.round(samples.length / ratio);
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    output[i] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return output;
}

async function getTranscriber() {
  if (!transcriberPromise) {
    setStatus(`Downloading ${WHISPER_MODEL} for local transcription...`, "busy");
    transcriberPromise = import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2").then(
      async ({ pipeline, env }) => {
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 1;
        return pipeline("automatic-speech-recognition", WHISPER_MODEL);
      },
    );
  }
  return transcriberPromise;
}

async function transcribeSelectedAudio() {
  try {
    if (!selectedBlob && els.audioFile.files[0]) {
      selectedBlob = els.audioFile.files[0];
      selectedName = selectedBlob.name;
    }
    validateFile(selectedBlob);
    els.transcribeButton.disabled = true;
    setStatus("Decoding audio...", "busy");
    const audio = await decodeAudio(selectedBlob);
    const transcriber = await getTranscriber();
    setStatus("Transcribing locally in your browser...", "busy");
    const result = await transcriber(audio, {
      chunk_length_s: 20,
      stride_length_s: 4,
      language: "english",
      task: "transcribe",
    });
    els.transcript.value = (result.text || "").trim();
    setStatus("Transcription complete.");
  } catch (error) {
    setStatus(error.message || "Transcription failed.", "error");
  } finally {
    els.transcribeButton.disabled = false;
  }
}

function setSelectedFile(file) {
  try {
    validateFile(file);
    selectedBlob = file;
    selectedName = file.name || "recording.webm";
    els.fileMeta.textContent = `${selectedName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    setStatus("Audio ready to transcribe.");
  } catch (error) {
    selectedBlob = null;
    selectedName = "";
    els.audioFile.value = "";
    els.fileMeta.textContent = "WAV, MP3, M4A, WebM, or OGG";
    setStatus(error.message, "error");
  }
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error("Recording is not supported in this browser. Upload an audio file instead.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new File(recordedChunks, "browser-recording.webm", { type: recorder.mimeType || "audio/webm" });
      setSelectedFile(blob);
    });
    recorder.start();
    recordingStartedAt = Date.now();
    timerId = window.setInterval(() => {
      const seconds = (Date.now() - recordingStartedAt) / 1000;
      els.recordingTimer.textContent = formatTime(seconds);
      if (seconds >= MAX_AUDIO_SECONDS) stopRecording();
    }, 250);
    els.recordButton.disabled = true;
    els.stopButton.disabled = false;
    setStatus("Recording...", "busy");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  window.clearInterval(timerId);
  els.recordingTimer.textContent = "00:00";
  els.recordButton.disabled = false;
  els.stopButton.disabled = true;
  setStatus("Recording stopped.");
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractOwnerTask(sentence) {
  const patterns = [
    /(?:action item:?\s*)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|to|should|can|needs to|is going to)\s+(.+)/i,
    /(?:owner:?\s*)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[-:]\s*(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (match) {
      return { owner: titleCase(match[1]), task: cleanTask(match[2]) };
    }
  }
  return null;
}

function cleanTask(task) {
  return task.replace(/\s*(by|before)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, " by $2").replace(/[.]+$/, "").trim();
}

function titleCase(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function generateMinutes(transcript) {
  const clean = transcript.trim();
  if (clean.length < 20) {
    throw new Error("Add a longer transcript before generating minutes.");
  }

  const sentences = splitSentences(clean);
  const names = [...clean.matchAll(/\b([A-Z][a-z]+):/g)].map((match) => match[1]);
  const attendees = [...new Set(names)].slice(0, 10);
  const decisions = sentences.filter((sentence) => /\b(decision|decided|approved|agreed|confirmed)\b/i.test(sentence));
  const actionItems = [];

  for (const sentence of sentences) {
    if (/\b(will|action item|to prepare|to update|to send|to schedule|owner|by friday|by wednesday|follow up)\b/i.test(sentence)) {
      const item = extractOwnerTask(sentence);
      if (item && item.task.length > 3) actionItems.push(item);
    }
  }

  const discussionPoints = sentences
    .filter((sentence) => !decisions.includes(sentence))
    .filter((sentence) => !/\b(thanks everyone|joining)\b/i.test(sentence))
    .slice(0, 6);

  const summary = sentences.slice(0, 2).join(" ");
  const today = new Date().toISOString().slice(0, 10);

  return `# Meeting Minutes

**Generated:** ${today}
**Source:** Browser-local transcription or pasted transcript
**Attendees detected:** ${attendees.length ? attendees.join(", ") : "Not clearly identified"}

## Summary

${summary || "The meeting transcript was processed into structured notes."}

## Discussion Points

${formatBullets(discussionPoints, "No distinct discussion points were detected.")}

## Decisions

${formatBullets(decisions, "No explicit decisions were detected.")}

## Action Items

${formatActionItems(actionItems)}

## Transcript

${clean}
`;
}

function formatBullets(items, fallback) {
  if (!items.length) return `- ${fallback}`;
  return items.map((item) => `- ${item.replace(/^[A-Z][a-z]+:\s*/, "").trim()}`).join("\n");
}

function formatActionItems(items) {
  if (!items.length) return "- No explicit owner-based action items were detected.";
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.owner}|${item.task}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique.map((item) => `- [ ] **${item.owner}:** ${item.task}`).join("\n");
}

function generateAndRenderMinutes() {
  try {
    lastMinutes = generateMinutes(els.transcript.value);
    els.minutesOutput.textContent = lastMinutes;
    els.downloadButton.disabled = false;
    els.copyButton.disabled = false;
    setStatus("Minutes generated.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function downloadMinutes() {
  const blob = new Blob([lastMinutes], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "meeting-minutes.md";
  link.click();
  URL.revokeObjectURL(url);
}

async function copyMinutes() {
  await navigator.clipboard.writeText(lastMinutes);
  setStatus("Minutes copied.");
}

els.audioFile.addEventListener("change", () => setSelectedFile(els.audioFile.files[0]));
els.transcribeButton.addEventListener("click", transcribeSelectedAudio);
els.recordButton.addEventListener("click", startRecording);
els.stopButton.addEventListener("click", stopRecording);
els.sampleButton.addEventListener("click", () => {
  els.transcript.value = sampleTranscript;
  setStatus("Sample transcript loaded.");
});
els.minutesButton.addEventListener("click", generateAndRenderMinutes);
els.downloadButton.addEventListener("click", downloadMinutes);
els.copyButton.addEventListener("click", copyMinutes);

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  const [file] = event.dataTransfer.files;
  setSelectedFile(file);
});
