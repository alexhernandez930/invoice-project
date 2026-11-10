const workNotes = document.getElementById("work-notes");
const recordWork = document.getElementById("record-work");
const createWorkItems = document.getElementById("create-work-items");
const assistantStatus = document.getElementById("work-assistant-status");
const assistantApi = "/api/invoices/assistant";
const recordingType = ["audio/webm;codecs=opus", "audio/mp4"].find((type) =>
  navigator.mediaDevices?.getUserMedia && window.MediaRecorder?.isTypeSupported(type));

let assistantAvailable = false;
let assistantPhase = "idle";
let lastGeneratedNotes = "";
let activeRecording;

function updateAssistantControls() {
  const notes = workNotes.value.trim();
  const idle = assistantPhase === "idle";
  recordWork.disabled = !assistantAvailable || !recordingType || (!idle && assistantPhase !== "recording");
  createWorkItems.disabled = !assistantAvailable || !idle || !notes ||
    notes.length > workNotes.maxLength || notes === lastGeneratedNotes;
  previewButton.disabled = !idle;
  workNotes.readOnly = !idle;
  setInvoiceText(recordWork, assistantPhase === "recording" ? "Stop recording" : "Record voice");
}

function showAssistantStatus(message) {
  setInvoiceText(assistantStatus, message);
}

async function requestAssistant(endpoint, options) {
  const response = await invoiceFetch(assistantApi + endpoint, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function checkAssistantAvailability() {
  try {
    const { available, provider } = await requestAssistant("");
    assistantAvailable = available;
    if (!available) {
      showAssistantStatus("The invoice assistant needs a Groq or OpenAI API key on the server.");
      return;
    }
    const notice = document.getElementById("work-assistant-provider");
    setInvoiceText(notice, provider === "Groq"
      ? "The assistant sends recordings, work descriptions, and job titles to Groq."
      : "The assistant sends recordings, work descriptions, and job titles to OpenAI.");
    notice.hidden = false;
    if (!recordingType) {
      showAssistantStatus("Microphone recording is unavailable here. You can type the work description.");
    }
  } catch {
    showAssistantStatus("The invoice assistant is temporarily unavailable.");
  } finally {
    updateAssistantControls();
  }
}

function appendSuggestedItems(items) {
  const rows = [...itemsBody.querySelectorAll(".item-row")];
  const onlyRow = rows.length === 1 ? rows[0] : null;
  const emptyRow = onlyRow && !onlyRow.querySelector(".item-name").value.trim()
    && !onlyRow.querySelector(".item-description").value.trim()
    && !onlyRow.querySelector(".item-price").value
    && onlyRow.querySelector(".item-quantity").value === "1";
  if (rows.length + items.length - Number(Boolean(emptyRow)) > 500) {
    showAssistantStatus("An invoice can contain up to 500 items.");
    return false;
  }

  items.forEach(function (item, index) {
    const row = emptyRow && index === 0 ? onlyRow : addItemRow();
    fillItemRow(row, { ...item, priceRequired: true });
  });
  calculateTotal();
  showAssistantStatus(items.some((item) => item.price === "")
    ? "Items added. Fill in the highlighted prices before previewing."
    : "Items added. Review the descriptions and prices before saving.");
  return true;
}

workNotes.addEventListener("input", updateAssistantControls);

createWorkItems.addEventListener("click", async function () {
  const notes = workNotes.value.trim();
  assistantPhase = "extracting";
  updateAssistantControls();
  showAssistantStatus("Creating invoice items…");
  try {
    const { items } = await requestAssistant("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (!items.length) {
      showAssistantStatus("No invoice items found. Describe the work and what you charged.");
    } else if (appendSuggestedItems(items)) {
      lastGeneratedNotes = notes;
    }
  } catch (error) {
    showAssistantStatus(invoiceErrorMessage(error, "Could not create invoice items. Try again or enter them manually."));
  } finally {
    assistantPhase = "idle";
    updateAssistantControls();
  }
});

function displayTranscript(recording, text) {
  workNotes.value = [recording.originalNotes, text].filter(Boolean).join("\n");
  workNotes.scrollTop = workNotes.scrollHeight;
}

function startLiveTranscript(recording) {
  const controller = new AbortController();
  let segment;
  let timer;
  let pending = Promise.resolve();

  function stop() {
    controller.abort();
    clearTimeout(timer);
    if (segment?.state === "recording") segment.stop();
  }

  function pauseLiveUpdates() {
    if (controller.signal.aborted) return;
    stop();
    showAssistantStatus("Live updates paused. The full transcript will appear when you stop recording.");
  }

  function captureSegment() {
    try {
      // Each preview segment is its own playable file. The main recorder captures
      // the uninterrupted audio for the final pass.
      segment = new MediaRecorder(recording.stream, { mimeType: recordingType });
      segment.addEventListener("error", pauseLiveUpdates, { once: true });
      segment.addEventListener("dataavailable", ({ data }) => {
        if (!data.size || controller.signal.aborted) return;
        pending = pending.then(async () => {
          if (controller.signal.aborted) return;
          try {
            const { text } = await requestAssistant("/transcribe", {
              method: "POST", body: data, signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            recording.partialText = [recording.partialText, text].filter(Boolean).join(" ");
            displayTranscript(recording, recording.partialText);
          } catch (error) {
            if (!controller.signal.aborted && error.status !== 422) pauseLiveUpdates();
          }
        });
      }, { once: true });
      segment.start();
      timer = setTimeout(() => {
        if (controller.signal.aborted) return;
        if (segment.state === "recording") segment.stop();
        captureSegment();
      }, 5000);
    } catch {
      pauseLiveUpdates();
    }
  }

  captureSegment();
  return stop;
}

async function transcribeRecording(recording, audio) {
  assistantPhase = "transcribing";
  updateAssistantControls();
  showAssistantStatus("Transcribing the recording…");
  try {
    const { text } = await requestAssistant("/transcribe", { method: "POST", body: audio });
    displayTranscript(recording, text);
    showAssistantStatus(workNotes.value.trim().length > workNotes.maxLength
      ? "Shorten the work description to 8,000 characters before creating items."
      : "Recording transcribed. Review the text, then select Create items.");
  } catch (error) {
    const fallback = recording.partialText
      ? "Could not finish the transcript. Review the partial text before creating items."
      : "Could not transcribe the recording. Try again or type the work description.";
    showAssistantStatus(invoiceErrorMessage(error, fallback));
  } finally {
    assistantPhase = "idle";
    updateAssistantControls();
  }
}

function stopWorkRecording(recording) {
  assistantPhase = "transcribing";
  updateAssistantControls();
  recording.stopLive?.();
  recording.recorder.stop();
}

recordWork.addEventListener("click", async function () {
  if (activeRecording?.recorder.state === "recording") {
    stopWorkRecording(activeRecording);
    return;
  }

  assistantPhase = "starting";
  updateAssistantControls();
  showAssistantStatus("Starting the microphone…");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: recordingType });
    const recording = { recorder, stream, discard: false, originalNotes: workNotes.value, partialText: "" };
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      recording.discard = true;
      showAssistantStatus("Could not record audio. You can type the work description.");
    });
    recorder.addEventListener("stop", () => {
      clearTimeout(recording.timeout);
      recording.stopLive?.();
      stream.getTracks().forEach((track) => track.stop());
      activeRecording = undefined;

      if (!recording.discard && chunks.length) {
        transcribeRecording(recording, new Blob(chunks, { type: recorder.mimeType || recordingType }));
      } else {
        assistantPhase = "idle";
        updateAssistantControls();
        if (!recording.discard) showAssistantStatus("Record some audio before transcribing.");
      }
    });
    recorder.start();
    activeRecording = recording;
    recording.timeout = setTimeout(() => {
      if (recorder.state === "recording") stopWorkRecording(recording);
    }, 180000);
    assistantPhase = "recording";
    updateAssistantControls();
    showAssistantStatus("Recording… Text appears every few seconds. Select Stop recording when you finish.");
    recording.stopLive = startLiveTranscript(recording);
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    assistantPhase = "idle";
    updateAssistantControls();
    showAssistantStatus("Could not start the microphone. Check microphone permission or type the work description.");
  }
});

window.addEventListener("pagehide", () => {
  if (!activeRecording) return;
  activeRecording.discard = true;
  activeRecording.stopLive?.();
  activeRecording.stream.getTracks().forEach((track) => track.stop());
});

checkAssistantAvailability();
